// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "network.hpp"
#include "image_loader.hpp"
#include "archives.hpp"
#include "packages.hpp"
#include "pkg_proxy.hpp"
#include "removals.hpp"
#include "browser_capture.hpp"
#include "lan.hpp"
#include "torrent_engine.hpp"
#include "app_config.hpp"
#define SDL_MAIN_HANDLED
#include <SDL2/SDL.h>
#ifdef __APPLE__
#include <OpenGL/gl3.h>
#else
#define GL_GLEXT_PROTOTYPES
#include <SDL2/SDL_opengl.h>
#endif

extern "C" {
#include "er_runtime.h"
#include "er_scene.h"
#include "native_renderer.h"
#include "software_backend.h"
void er_register_assets(void);
}
#include "baked_sounds.h"
#include "damage_tracker.hpp"
#include "frame_stats.hpp"
#include "gl_presenter.hpp"
#include "host_api.hpp"
#include "host_platform.hpp"
#include "actions.hpp"
#include "control.hpp"
#include "input_script.hpp"
#include "js_heap.hpp"
#include "js_profiler.hpp"
#include "render_workers.hpp"
#include "screenshot.hpp"
#include "text_shaper.hpp"
#include "video_api.hpp"
#include "storage_stats.hpp"
#include "directory_records.hpp"
#include <algorithm>
#include <cerrno>
#include <climits>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iterator>
#include <string>
#include <utility>
#include <vector>
#include <sys/stat.h>
#include <unistd.h>

namespace {
// Render at twice the logical resolution so rounded edges remain smooth on Retina.
constexpr int width = PS5_REACT_WIDTH, height = PS5_REACT_HEIGHT;

std::int64_t now_us() {
  static const Uint64 frequency = SDL_GetPerformanceFrequency();
  const Uint64 ticks = SDL_GetPerformanceCounter();
  return static_cast<std::int64_t>(ticks / frequency * 1000000 + ticks % frequency * 1000000 / frequency);
}

std::uint32_t perf_clock() { return static_cast<std::uint32_t>(now_us()); }

// Keyboard and controller bindings; triggers are axes, read separately. See docs/NAVIGATION.md.
constexpr std::pair<SDL_Keycode, HostAction> kKeyActions[] = {
  {SDLK_UP, HostAction::up}, {SDLK_DOWN, HostAction::down}, {SDLK_LEFT, HostAction::left},
  {SDLK_RIGHT, HostAction::right}, {SDLK_RETURN, HostAction::confirm}, {SDLK_SPACE, HostAction::confirm},
  {SDLK_BACKSPACE, HostAction::back}, {SDLK_q, HostAction::l1}, {SDLK_e, HostAction::r1},
  {SDLK_t, HostAction::triangle}, {SDLK_f, HostAction::square}, {SDLK_o, HostAction::options},
};
// The keys' GamepadState buttons (kButtonNames indexes). Z and C are L2 and R2: full travel, or a light
// press (kLightTravel, short of the half-travel press) while Shift is down. O is Options, P the touchpad.
constexpr std::pair<SDL_Scancode, int> kKeyButtons[] = {
  {SDL_SCANCODE_UP, 0}, {SDL_SCANCODE_DOWN, 1}, {SDL_SCANCODE_LEFT, 2}, {SDL_SCANCODE_RIGHT, 3},
  {SDL_SCANCODE_RETURN, 4}, {SDL_SCANCODE_SPACE, 4}, {SDL_SCANCODE_BACKSPACE, 5}, {SDL_SCANCODE_T, 6},
  {SDL_SCANCODE_F, 7}, {SDL_SCANCODE_Q, 8}, {SDL_SCANCODE_E, 9}, {SDL_SCANCODE_O, 14}, {SDL_SCANCODE_P, 15},
};
constexpr float kLightTravel = 0.4f;

float key_travel(SDL_Scancode key) {
  // Under QWERTZ the logical Z key can occupy the SDL_SCANCODE_Y position.
  // Accept both physical layouts for the L2 keyboard shortcut.
  const Uint8* keys = SDL_GetKeyboardState(nullptr);
  if (!keys[key] && !(key == SDL_SCANCODE_Z && keys[SDL_SCANCODE_Y])) return 0;
  return SDL_GetModState() & KMOD_SHIFT ? kLightTravel : 1;
}

// Triggers are analog: an action on crossing half travel, re-armed below a quarter.
bool crossed(bool& down, float travel) {
  if (!down && travel > 0.5f) return down = true;
  if (down && travel < 0.25f) down = false;
  return false;
}
constexpr std::pair<SDL_GameControllerButton, HostAction> kButtonActions[] = {
  {SDL_CONTROLLER_BUTTON_DPAD_UP, HostAction::up}, {SDL_CONTROLLER_BUTTON_DPAD_DOWN, HostAction::down},
  {SDL_CONTROLLER_BUTTON_DPAD_LEFT, HostAction::left}, {SDL_CONTROLLER_BUTTON_DPAD_RIGHT, HostAction::right},
  {SDL_CONTROLLER_BUTTON_A, HostAction::confirm}, {SDL_CONTROLLER_BUTTON_B, HostAction::back},
  {SDL_CONTROLLER_BUTTON_LEFTSHOULDER, HostAction::l1}, {SDL_CONTROLLER_BUTTON_RIGHTSHOULDER, HostAction::r1},
  {SDL_CONTROLLER_BUTTON_Y, HostAction::triangle}, {SDL_CONTROLLER_BUTTON_X, HostAction::square},
  {SDL_CONTROLLER_BUTTON_START, HostAction::options},
};

float stick(SDL_GameController* controller, SDL_GameControllerAxis axis) {
  constexpr float deadzone = 0.16f;
  const float value = std::clamp(SDL_GameControllerGetAxis(controller, axis) / 32767.0f, -1.0f, 1.0f);
  if (std::abs(value) < deadzone) return 0;
  return std::copysign((std::abs(value) - deadzone) / (1 - deadzone), value);
}

GamepadState read_gamepad(SDL_GameController* controller) {
  GamepadState state;
  // Indexes follow kButtonNames; l2/r2 come from the triggers below.
  constexpr int buttons[] = {
    SDL_CONTROLLER_BUTTON_DPAD_UP, SDL_CONTROLLER_BUTTON_DPAD_DOWN, SDL_CONTROLLER_BUTTON_DPAD_LEFT,
    SDL_CONTROLLER_BUTTON_DPAD_RIGHT, SDL_CONTROLLER_BUTTON_A, SDL_CONTROLLER_BUTTON_B, SDL_CONTROLLER_BUTTON_Y,
    SDL_CONTROLLER_BUTTON_X, SDL_CONTROLLER_BUTTON_LEFTSHOULDER, SDL_CONTROLLER_BUTTON_RIGHTSHOULDER, -1, -1,
    SDL_CONTROLLER_BUTTON_LEFTSTICK, SDL_CONTROLLER_BUTTON_RIGHTSTICK, SDL_CONTROLLER_BUTTON_START,
    SDL_CONTROLLER_BUTTON_TOUCHPAD,
  };
  if (controller && SDL_GameControllerGetAttached(controller)) {
    state.connected = true;
    state.left_x = stick(controller, SDL_CONTROLLER_AXIS_LEFTX);
    state.left_y = stick(controller, SDL_CONTROLLER_AXIS_LEFTY);
    state.right_x = stick(controller, SDL_CONTROLLER_AXIS_RIGHTX);
    state.right_y = stick(controller, SDL_CONTROLLER_AXIS_RIGHTY);
    state.l2 = std::max(0.0f, SDL_GameControllerGetAxis(controller, SDL_CONTROLLER_AXIS_TRIGGERLEFT) / 32767.0f);
    state.r2 = std::max(0.0f, SDL_GameControllerGetAxis(controller, SDL_CONTROLLER_AXIS_TRIGGERRIGHT) / 32767.0f);
    for (std::uint32_t i = 0; i < std::size(buttons); ++i)
      if (buttons[i] >= 0 && SDL_GameControllerGetButton(controller, static_cast<SDL_GameControllerButton>(buttons[i])))
        state.buttons |= 1u << i;
    if (state.l2 > 0.5f) state.buttons |= 1u << 10;
    if (state.r2 > 0.5f) state.buttons |= 1u << 11;
  }
  const Uint8* keys = SDL_GetKeyboardState(nullptr);
  for (const auto& [key, button] : kKeyButtons)
    if (keys[key]) state.buttons |= 1u << button;
  state.l2 = std::max(state.l2, key_travel(SDL_SCANCODE_Z));
  state.r2 = std::max(state.r2, key_travel(SDL_SCANCODE_C));
  if (state.l2 > 0.5f) state.buttons |= 1u << 10;
  if (state.r2 > 0.5f) state.buttons |= 1u << 11;
  return state;
}

struct Host {
  SDL_Window* window = nullptr;
  SDL_GLContext context = nullptr;
  SDL_GameController* controller = nullptr;
  GlPresenter presenter;
  FrameStats stats;
  bool log_frames = true, running = true, runtime_started = false, backend_started = false;
  // The interactive loop leaves a frame that changed nothing unpresented, as the PS5 host does; the
  // self-tests read back every frame. exposed forces the next frame out after the window reappears.
  bool skip_still = false, exposed = false;
  int render_worker_count = 1;
  Uint32 previous_tick = 0, next_repeat = 0, next_image_stats = 0;
  // When the last frame callback ran: the next one advances by the whole frame period, swap wait included.
  std::int64_t previous_step_us = 0;
  // The monitor's frame interval, for picking video frames by display frame.
  std::int64_t display_frame_us = 16667;
  std::string image_stats;
  const char* held_action = nullptr;
  InputScript script;
  Control control;
  bool controlled = false;
  struct Wait { int client; Uint32 until; };
  std::vector<Wait> waits;
  Uint32 slow_frame_us = 33000;
  SDL_Scancode held_key = SDL_SCANCODE_UNKNOWN;
  SDL_GameControllerButton held_button = SDL_CONTROLLER_BUTTON_INVALID;
  GcScheduler gc_scheduler{now_us};
  JsProfiler profiler{now_us};
  bool l2_down = false, r2_down = false, key_l2_down = false, key_r2_down = false;
  VirtualPad virtual_pad;

  ~Host() {
    ps5_react_stop_images();
    archives::stop();
    browser_capture::stop();
    lan::stop();
    torrent::stop();
    packages::stop();
    pkg_proxy::stop();
    removals::stop();
    network::stop();
    video_layers::stop();
    if (runtime_started) er_runtime_shutdown();
    text_shaper::shutdown();
    ps5_react_stop_sound();
    render_workers::stop();
    if (backend_started) er_software_backend_destroy();
    presenter.release(); // GL objects must be deleted before their context.
    desktop_set_controller(nullptr);
    if (controller) SDL_GameControllerClose(controller);
    if (context) SDL_GL_DeleteContext(context);
    if (window) SDL_DestroyWindow(window);
    SDL_Quit();
  }

  bool start() {
    SDL_SetMainReady();
    if (SDL_Init(SDL_INIT_VIDEO | SDL_INIT_GAMECONTROLLER) != 0) return false;
    if (SDL_GL_SetAttribute(SDL_GL_CONTEXT_MAJOR_VERSION, 4) ||
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_MINOR_VERSION, 1) ||
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_PROFILE_MASK, SDL_GL_CONTEXT_PROFILE_CORE) ||
        SDL_GL_SetAttribute(SDL_GL_CONTEXT_FLAGS, SDL_GL_CONTEXT_FORWARD_COMPATIBLE_FLAG) ||
        SDL_GL_SetAttribute(SDL_GL_DOUBLEBUFFER, 1)) return false;
    window = SDL_CreateWindow(PS5_REACT_NAME,
      SDL_WINDOWPOS_CENTERED, SDL_WINDOWPOS_CENTERED, width/2, height/2,
      SDL_WINDOW_OPENGL | SDL_WINDOW_SHOWN | SDL_WINDOW_RESIZABLE | SDL_WINDOW_ALLOW_HIGHDPI);
    if (!window || !(context = SDL_GL_CreateContext(window))) return false;
    SDL_GL_SetSwapInterval(1);
    if (SDL_DisplayMode mode; SDL_GetWindowDisplayMode(window, &mode) == 0 && mode.refresh_rate > 0)
      display_frame_us = 1000000 / mode.refresh_rate;
    std::printf("GL %s / %s\n", glGetString(GL_VERSION), glGetString(GL_RENDERER));
    for (int i = 0; i < SDL_NumJoysticks(); ++i)
      if (SDL_IsGameController(i) && (controller = SDL_GameControllerOpen(i))) break;
    std::printf("Physical controller: %s\n", controller ? SDL_GameControllerName(controller) : "not connected");
    desktop_set_controller(controller);
    previous_tick = SDL_GetTicks();
    previous_step_us = now_us();
    er_perf_set_clock(perf_clock);
    return presenter.init(width, height);
  }

  bool boot(const char* path) {
    backend_started = er_software_backend_init(width, height);
    if (!backend_started || !damage_tracker_install(width, height)) return false;
    // The presenter draws qualifying <Image layer> images itself; PS5_REACT_LAYERS=0 rasterizes them all.
    const char* layers = std::getenv("PS5_REACT_LAYERS");
    er_set_layers_enabled((!layers || std::atoi(layers) != 0) && presenter.layers_supported());
    // PS5_REACT_RENDER_WORKERS=1 renders single-core, for comparisons.
    const char* workers = std::getenv("PS5_REACT_RENDER_WORKERS");
    render_worker_count = render_workers::start(workers && std::atoi(workers) > 0 ? std::atoi(workers)
                                                                                   : render_workers::available_cpus());
    std::printf("[PS5-REACT] render workers=%d of %d, cpus=%d\n", render_worker_count, render_workers::max_workers(),
                render_workers::available_cpus());
    if (network::start()) ps5_react_start_images();
    ps5_react_start_sound();
    ErRuntimeConfig cfg = {};
    cfg.screen_width = width; cfg.screen_height = height; cfg.screen_scale = 2;
    cfg.memory_limit = kJsMemoryLimit;
    cfg.malloc_functions = js_heap_functions();
#ifdef __APPLE__
    cfg.max_stack_size = 1024 * 1024;
#else
    // x86-64 Linux builds use deeper native frames per JS call; the main thread has 8 MiB.
    cfg.max_stack_size = 4 * 1024 * 1024;
#endif
    cfg.install_host_globals = ps5_react_install_host_api;
    runtime_started = er_runtime_init(&cfg);
    if (!runtime_started) return false;
    // PS5_REACT_PROFILE=<file> samples JavaScript; the folded stacks are written there on exit.
    if (std::getenv("PS5_REACT_PROFILE")) profiler.start(JS_GetRuntime(er_runtime_context()), 1000);
    {
      // Read when the bundle loads: the pointer hit-test exists only where a mouse can call it, and
      // Text reports its content to the inspector only under the control channel.
      JSContext* ctx = er_runtime_context();
      JSValue global = JS_GetGlobalObject(ctx);
      JS_SetPropertyStr(ctx, global, "__ps5ReactPointer", JS_TRUE);
      if (controlled) JS_SetPropertyStr(ctx, global, "__ps5ReactInspecting", JS_TRUE);
      JS_FreeValue(ctx, global);
    }
    er_register_assets();
    text_shaper::install(PS5_REACT_FONT_DIR, [](const char* line) { std::printf("[PS5-REACT] %s\n", line); });
    FILE* file = std::fopen(path, "rb");
    if (!file) return false;
    bool ok = std::fseek(file, 0, SEEK_END) == 0;
    const long size = ok ? std::ftell(file) : -1;
    ok = size >= 0 && std::fseek(file, 0, SEEK_SET) == 0;
    const std::size_t length = ok ? static_cast<std::size_t>(size) : 0;
    // QuickJS's source parser requires a trailing NUL beyond the supplied length.
    std::vector<char> source(length + 1, '\0');
    if (ok) ok = std::fread(source.data(), 1, length, file) == length;
    std::fclose(file);
    return ok && er_runtime_load_source(source.data(), length, path);
  }

  const char* hold(const char* action, SDL_Scancode key,
                   SDL_GameControllerButton button = SDL_CONTROLLER_BUTTON_INVALID) {
    held_action = action; held_key = key; held_button = button;
    next_repeat = SDL_GetTicks() + 350;
    return action;
  }

  // Calls the runtime's input entry `name` with `argc` arguments, which it frees.
  bool call_input(const char* name, int argc, JSValue* argv) {
    gc_scheduler.input(now_us());
    er_perf_phase_begin(ER_PERF_PHASE_JS);
    JSContext* ctx = er_runtime_context();
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue fn = JS_GetPropertyStr(ctx, global, name);
    JSValue result = JS_Call(ctx, fn, global, argc, argv);
    const bool ok = !JS_IsException(result);
    if (!ok) {
      JSValue error = JS_GetException(ctx);
      const char* message = JS_ToCString(ctx, error);
      std::fprintf(stderr, "Input failed: %s\n", message ? message : "JS exception");
      if (message) JS_FreeCString(ctx, message);
      JS_FreeValue(ctx, error);
    }
    JS_FreeValue(ctx, result);
    for (int i = 0; i < argc; ++i) JS_FreeValue(ctx, argv[i]);
    JS_FreeValue(ctx, fn); JS_FreeValue(ctx, global);
    er_perf_phase_end(ER_PERF_PHASE_JS);
    return ok;
  }

  bool dispatch(const char* action) {
    JSValue arg = JS_NewString(er_runtime_context(), action);
    return call_input("__ps5ReactDispatch", 1, &arg);
  }

  // A controller touchpad's first finger at (x, y) 0..1, or lifted.
  bool touch(bool down, float x, float y) {
    JSContext* ctx = er_runtime_context();
    JSValue args[2] = {down ? JS_NewFloat64(ctx, x) : JS_NULL, down ? JS_NewFloat64(ctx, y) : JS_NULL};
    return call_input("__ps5ReactTouch", 2, args);
  }

  // A mouse click at window point (x, y): focuses the element under it, as a developer's pointer. The
  // frame is letterboxed in the window, so the point maps through that scale and offset.
  bool click(int x, int y) {
    int ww = 0, wh = 0;
    SDL_GetWindowSize(window, &ww, &wh);
    if (ww <= 0 || wh <= 0) return false;
    const float scale = std::min(float(ww) / width, float(wh) / height);
    return hit((x - (ww - width * scale) / 2) / scale, (y - (wh - height * scale) / 2) / scale);
  }

  // Focuses the navigable element under logical point (fx, fy); whether one took focus.
  bool hit(float fx, float fy) {
    if (fx < 0 || fy < 0 || fx >= width || fy >= height) return false;
    gc_scheduler.input(now_us());
    JSContext* ctx = er_runtime_context();
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue fn = JS_GetPropertyStr(ctx, global, "__ps5ReactHit");
    // As fractions: the runtime's layout units need not be the render's pixels.
    JSValue args[2] = {JS_NewFloat64(ctx, fx / width), JS_NewFloat64(ctx, fy / height)};
    JSValue result = JS_Call(ctx, fn, global, 2, args);
    const bool hit = !JS_IsException(result) && JS_ToBool(ctx, result) == 1;
    if (JS_IsException(result)) {
      JSValue error = JS_GetException(ctx);
      const char* message = JS_ToCString(ctx, error);
      std::fprintf(stderr, "Click failed: %s\n", message ? message : "JS exception");
      if (message) JS_FreeCString(ctx, message);
      JS_FreeValue(ctx, error);
    }
    JS_FreeValue(ctx, result); JS_FreeValue(ctx, args[0]); JS_FreeValue(ctx, args[1]);
    JS_FreeValue(ctx, fn); JS_FreeValue(ctx, global);
    return hit;
  }

  // A development hook's result as text: strings as they are, anything else through JSON.
  std::string call_js(const char* name, const char* arg) {
    JSContext* ctx = er_runtime_context();
    JSValue global = JS_GetGlobalObject(ctx);
    JSValue fn = JS_GetPropertyStr(ctx, global, name);
    JSValue argument = arg ? JS_NewString(ctx, arg) : JS_UNDEFINED;
    JSValue result = JS_Call(ctx, fn, global, arg ? 1 : 0, &argument);
    std::string text;
    if (JS_IsException(result)) {
      JSValue error = JS_GetException(ctx);
      const char* message = JS_ToCString(ctx, error);
      text = std::string("error: ") + (message ? message : "JS exception");
      if (message) JS_FreeCString(ctx, message);
      JS_FreeValue(ctx, error);
    } else {
      JSValue json = JS_IsString(result) ? JS_DupValue(ctx, result) : JS_JSONStringify(ctx, result, JS_UNDEFINED, JS_UNDEFINED);
      if (const char* value = JS_ToCString(ctx, json)) { text = value; JS_FreeCString(ctx, value); }
      JS_FreeValue(ctx, json);
    }
    JS_FreeValue(ctx, result); JS_FreeValue(ctx, argument);
    JS_FreeValue(ctx, fn); JS_FreeValue(ctx, global);
    return text;
  }

  // Commands from tools/ps5_drive.py, a few a frame so a busy client cannot stall rendering.
  bool serve_control() {
    const Uint32 ticks = SDL_GetTicks();
    std::erase_if(waits, [&](const Wait& wait) {
      if (!SDL_TICKS_PASSED(ticks, wait.until)) return false;
      Control::reply(wait.client, "ok");
      return true;
    });
    for (int served = 0; served < 4; ++served) {
      int client = -1;
      const std::string line = control.next(client);
      if (client < 0) return true;
      const std::size_t space = line.find(' ');
      const std::string verb = line.substr(0, space), arg = space == std::string::npos ? "" : line.substr(space + 1);
      if (verb == "press") {
        const bool known = std::any_of(std::begin(kActionNames), std::end(kActionNames),
                                       [&](const char* name) { return arg == name; });
        if (known && !dispatch(arg.c_str())) return false;
        Control::reply(client, known ? "ok" : "unknown action: " + arg);
      } else if (verb == "hold" || verb == "release" || verb == "trigger") {
        std::string step = line;
        std::replace(step.begin(), step.end(), ' ', ':');
        char error[160];
        Control::reply(client, virtual_pad.apply(step, SDL_GetTicks64(), error, sizeof error) ? "ok" : std::string(error));
      } else if (verb == "shot") {
        // `shot <path> full` keeps the framebuffer's full resolution, for images meant to be shown.
        const bool full = arg.size() > 5 && arg.ends_with(" full");
        const std::string path = full ? arg.substr(0, arg.size() - 5) : arg;
        Control::reply(client, save_screenshot(path.c_str(), full ? 1 : 2) ? path : std::string("error: ") + std::strerror(errno));
      } else if (verb == "snapshot") {
        Control::reply(client, call_js("__ps5ReactInspect", nullptr));
      } else if (verb == "focus") {
        Control::reply(client, call_js("__ps5ReactFocus", arg.c_str()) == "true" ? "ok" : "not found: " + arg);
      } else if (verb == "click") {
        // `click <x> <y>` in logical pixels: a left mouse click there.
        int x = 0, y = 0;
        const bool found = std::sscanf(arg.c_str(), "%d %d", &x, &y) == 2 && hit(float(x), float(y));
        if (found && !dispatch(action_name(HostAction::confirm))) return false;
        Control::reply(client, found ? "ok" : "nothing at " + arg);
      } else if (verb == "script") {
        // Runs input-script steps from now on, e.g. a touchpad swipe.
        char error[512] = {};
        Control::reply(client, script.parse(arg.c_str(), error, sizeof error) ? "ok" : std::string("error: ") + error);
      } else if (verb == "logs") {
        Control::reply(client, control.take_logs());
      } else if (verb == "wait") {
        waits.push_back({client, ticks + static_cast<Uint32>(std::max(0, std::atoi(arg.c_str())))});
      } else if (verb == "quit") {
        running = false;
        Control::reply(client, "ok");
      } else {
        Control::reply(client, "unknown command: " + verb);
      }
    }
    return true;
  }

  // Runs the scripted action that is due; it goes through the same dispatch as keys.
  bool play_script() {
    const char* action = script.next(SDL_GetTicks64());
    if (!action) return true;
    if (log_frames) std::printf("[PS5-REACT] script: %s\n", action);
    if (!std::strcmp(action, "quit")) running = false;
    else if (VirtualPad::is_step(action)) {
      char error[160];
      if (!virtual_pad.apply(action, SDL_GetTicks64(), error, sizeof error)) std::fprintf(stderr, "script: %s\n", error);
    } else if (!std::strncmp(action, "shot:", 5)) {
      // The preview keeps shots in the sandbox's temporary folder rather than the app's sources.
      char path[PATH_MAX];
      const std::string name = std::string("/temp0/") + (action + 5) + ".bmp";
      const bool saved = host::resolve_path(name.c_str(), path, sizeof path) && save_screenshot(path);
      std::printf("[PS5-REACT] shot %s: %s\n", path, saved ? "saved" : std::strerror(errno));
    } else if (!std::strncmp(action, "touch:", 6)) {
      float x = 0, y = 0;
      return touch(std::sscanf(action + 6, "%f,%f", &x, &y) == 2, x, y);
    } else return dispatch(action);
    return true;
  }

  bool frame(bool swap = true) {
    if (const char* line = stats.start_frame(now_us()); line && log_frames) {
      std::printf("[PS5-REACT] %s\n", line);
      std::fflush(stdout); // The dev watcher reads a pipe, where stdout is fully buffered.
    }
    // Input and JavaScript commit layout only; the commit after them paints the frame once.
    er_set_raster_deferred(true);
    SDL_Event event;
    while (SDL_PollEvent(&event)) {
      const char* action = nullptr;
      if (event.type == SDL_QUIT) running = false;
      if (event.type == SDL_WINDOWEVENT && event.window.event == SDL_WINDOWEVENT_EXPOSED) exposed = true;
      // The host repeats held directions itself, so OS key repeats are ignored.
      if (event.type == SDL_KEYDOWN && !event.key.repeat) {
        const SDL_Scancode key = event.key.keysym.scancode;
        // Escape stands for the PS button: it leaves. O is Options.
        if (event.key.keysym.sym == SDLK_ESCAPE) running = false;
        for (const auto& [code, mapped] : kKeyActions) {
          if (code == event.key.keysym.sym) action = repeats(mapped) ? hold(action_name(mapped), key) : action_name(mapped);
        }
      } else if (event.type == SDL_CONTROLLERBUTTONDOWN) {
        const auto button = static_cast<SDL_GameControllerButton>(event.cbutton.button);
        for (const auto& [code, mapped] : kButtonActions) {
          if (code == button)
            action = repeats(mapped) ? hold(action_name(mapped), SDL_SCANCODE_UNKNOWN, button) : action_name(mapped);
        }
      } else if ((event.type == SDL_CONTROLLERTOUCHPADDOWN || event.type == SDL_CONTROLLERTOUCHPADMOTION ||
                  event.type == SDL_CONTROLLERTOUCHPADUP) && event.ctouchpad.touchpad == 0 && event.ctouchpad.finger == 0) {
        if (!touch(event.type != SDL_CONTROLLERTOUCHPADUP, event.ctouchpad.x, event.ctouchpad.y)) return false;
      } else if (event.type == SDL_MOUSEBUTTONDOWN) {
        // A developer's mouse stands in for the pad: left selects what is under it, right goes back.
        if (event.button.button == SDL_BUTTON_LEFT) {
          if (click(event.button.x, event.button.y)) action = action_name(HostAction::confirm);
        } else if (event.button.button == SDL_BUTTON_RIGHT) action = action_name(HostAction::back);
      } else if (event.type == SDL_MOUSEWHEEL && event.wheel.y != 0) {
        action = action_name(event.wheel.y > 0 ? HostAction::up : HostAction::down);
      } else if (event.type == SDL_CONTROLLERAXISMOTION) {
        const auto trigger = [&](bool& down, const char* name) {
          if (crossed(down, event.caxis.value / 32767.0f)) action = name;
        };
        if (event.caxis.axis == SDL_CONTROLLER_AXIS_TRIGGERLEFT) trigger(l2_down, action_name(HostAction::l2));
        else if (event.caxis.axis == SDL_CONTROLLER_AXIS_TRIGGERRIGHT) trigger(r2_down, action_name(HostAction::r2));
      }
      if (action && !dispatch(action)) return false;
    }
    if (!play_script()) return false;
    if (controlled && !serve_control()) return false;
    if (held_action) {
      // Polled state, not key-up events: synthetic self-test presses never stay held.
      const bool down = held_key != SDL_SCANCODE_UNKNOWN ? SDL_GetKeyboardState(nullptr)[held_key]
        : controller && SDL_GameControllerGetButton(controller, held_button);
      const Uint32 ticks = SDL_GetTicks();
      if (!down) held_action = nullptr;
      else if (SDL_TICKS_PASSED(ticks, next_repeat)) {
        next_repeat = ticks + 110;
        if (!dispatch(held_action)) return false;
      }
    }
    if (!running) return true;
    if (crossed(key_l2_down, key_travel(SDL_SCANCODE_Z)) && !dispatch(action_name(HostAction::l2))) return false;
    if (crossed(key_r2_down, key_travel(SDL_SCANCODE_C)) && !dispatch(action_name(HostAction::r2))) return false;
    GamepadState state = read_gamepad(controller);
    // What a tool holds presses like the controller: the buttons' actions, once (directions do not repeat).
    for (std::uint32_t pressed = virtual_pad.merge(state, SDL_GetTicks64()), i = 0; pressed; pressed >>= 1, ++i) {
      const char* held = pressed & 1 ? VirtualPad::action(i) : nullptr;
      if (held && !dispatch(held)) return false;
    }
    ps5_react_set_gamepad(state);
    stats.lap(FrameStats::input, now_us());
    er_perf_phase_begin(ER_PERF_PHASE_JS);
    er_runtime_pump();
    const std::int64_t step_us = now_us();
    const bool stepped = ps5_react_frame(er_runtime_context(), std::min(50.0, (step_us - previous_step_us) / 1000.0));
    previous_step_us = step_us;
    er_perf_phase_end(ER_PERF_PHASE_JS);
    if (!stepped) {
      std::fprintf(stderr, "Frame callback failed\n");
      return false;
    }
    er_set_raster_deferred(false);
    er_commit();
    stats.lap(FrameStats::update, now_us());
    if (ps5_react_exit_requested()) {
      running = false;
      return true;
    }
    int sw = 0, sh = 0;
    SDL_GL_GetDrawableSize(window, &sw, &sh);
    const std::size_t repainted = damage_tracker_area();
    const bool still = skip_still && !exposed && sw > 0 && sh > 0 &&
                       presenter.unchanged(damage_tracker_rects(), damage_tracker_moves(), sw, sh);
    exposed = false;
    if (sw > 0 && sh > 0 && !still) {
      er_perf_phase_begin(ER_PERF_PHASE_PRESENT);
      int layer_count = 0;
      const ERLayer* layers = er_get_layers(&layer_count);
      presenter.set_layers({layers, static_cast<std::size_t>(layer_count)});
      video_layers::update(now_us(), display_frame_us);
      if (!presenter.draw(er_software_framebuffer(), damage_tracker_rects(), damage_tracker_moves(), sw, sh)) return false;
      er_perf_phase_end(ER_PERF_PHASE_PRESENT);
      {
        const GlPresenter::Timing& t = presenter.last_timing();
        stats.note_present(t.upload_us, t.draw_us, t.upload_bytes);
      }
    }
    if (sw > 0 && sh > 0) damage_tracker_clear();
    stats.lap(FrameStats::present, now_us());
    if (still) {
      SDL_DisplayMode mode{};
      SDL_Delay(1000 / (SDL_GetWindowDisplayMode(window, &mode) == 0 && mode.refresh_rate > 0 ? mode.refresh_rate : 60));
    } else if (swap) SDL_GL_SwapWindow(window);
    stats.lap(FrameStats::swap, now_us());
    if (const char* line = gc_scheduler.frame(JS_GetRuntime(er_runtime_context()), now_us(), repainted,
                                              static_cast<std::size_t>(width) * height);
        line && log_frames)
      std::printf("[PS5-REACT] %s\n", line);
    const Uint32 now = SDL_GetTicks();
    embedded_renderer_tick(std::min<Uint32>(now - previous_tick, 50));
    previous_tick = now;
    if (const char* line = stats.end_frame(slow_frame_us); line && log_frames) {
      std::printf("[PS5-REACT] %s\n", line);
      std::fflush(stdout);
    }
    if (const int hz = ps5_react_take_refresh_request()) {
      // The preview keeps the monitor's rate, but rebuilds the presenter as the PS5 host must, so that
      // path runs here too, and reports the requested rate as the one the display accepted.
      presenter.release();
      if (!presenter.init(width, height)) return false;
      ps5_react_set_refresh_rate(hz);
      std::printf("[PS5-REACT] refresh switch to %d Hz (the preview keeps the monitor's rate)\n", hz);
      std::fflush(stdout);
    }
    // The PS5 host prints this with its memory line; here every two seconds while it changes.
    if (SDL_TICKS_PASSED(now, next_image_stats)) {
      next_image_stats = now + 2000;
      if (std::string line = images::stats(); line != image_stats) {
        std::printf("[PS5-REACT] images: %s\n", line.c_str());
        std::fflush(stdout);
        image_stats = std::move(line);
      }
    }
    return !*er_runtime_last_error();
  }

  bool snapshot(const char* path) {
    if (!frame(false)) return false;
    int sw = 0, sh = 0;
    SDL_GL_GetDrawableSize(window, &sw, &sh);
    if (sw <= 0 || sh <= 0) return false;
    std::vector<unsigned char> rgb(static_cast<std::size_t>(sw) * sh * 3);
    glPixelStorei(GL_PACK_ALIGNMENT, 1);
    glReadBuffer(GL_BACK);
    glReadPixels(0, 0, sw, sh, GL_RGB, GL_UNSIGNED_BYTE, rgb.data());
    if (glGetError() != GL_NO_ERROR) return false;
    FILE* file = std::fopen(path, "wb");
    if (!file) return false;
    bool ok = std::fprintf(file, "P6\n%d %d\n255\n", sw, sh) > 0;
    for (int y = sh - 1; y >= 0 && ok; --y)
      ok = std::fwrite(rgb.data() + static_cast<std::size_t>(y) * sw * 3, 3, sw, file) == static_cast<std::size_t>(sw);
    if (std::fclose(file) != 0) ok = false;
    SDL_GL_SwapWindow(window);
    return ok;
  }
};

bool expect(int focus, int count, int detail) {
  JSContext* ctx = er_runtime_context();
  JSValue global = JS_GetGlobalObject(ctx);
  JSValue state = JS_GetPropertyStr(ctx, global, "__ps5ReactTestState");
  const char* fields[] = {"focus", "count", "detail"};
  const int expected[] = {focus, count, detail};
  bool ok = true;
  for (int i = 0; i < 3; ++i) {
    JSValue value = JS_GetPropertyStr(ctx, state, fields[i]);
    int32_t actual = -1;
    if (JS_ToInt32(ctx, &actual, value) || actual != expected[i]) {
      std::fprintf(stderr, "%s: expected %d, got %d\n", fields[i], expected[i], actual);
      ok = false;
    }
    JS_FreeValue(ctx, value);
  }
  JS_FreeValue(ctx, state); JS_FreeValue(ctx, global);
  return ok;
}

bool color_test(Host& host) {
  const std::uint32_t colors[] = {0xffff0000, 0xff00ff00, 0xff0000ff, 0xffffffff};
  std::vector<std::uint32_t> pattern(width * height);
  for (int y = 0; y < height; ++y)
    for (int x = 0; x < width; ++x)
      pattern[y*width+x] = colors[(y >= height/2 ? 2 : 0) + (x >= width/2 ? 1 : 0)];
  int sw = 0, sh = 0;
  SDL_GL_GetDrawableSize(host.window, &sw, &sh);
  if (!host.presenter.draw(pattern.data(), sw, sh)) return false;
  // Samples in the centre of each quadrant test channel order and vertical orientation.
  for (int i = 0; i < 4; ++i) {
    unsigned char pixel[4] = {};
    glReadPixels((i%2 ? 3 : 1)*sw/4, (i/2 ? 1 : 3)*sh/4, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, pixel);
    const auto c = colors[i];
    if (pixel[0] != ((c>>16)&255) || pixel[1] != ((c>>8)&255) ||
        pixel[2] != (c&255) || pixel[3] != 255) return false;
  }
  return glGetError() == GL_NO_ERROR;
}

bool press(Host& host, SDL_Keycode key, int focus, int count, int detail) {
  SDL_Event event = {};
  event.type = SDL_KEYDOWN; event.key.keysym.sym = key;
  if (SDL_PushEvent(&event) != 1) return false;
  for (int i = 0; i < 4; ++i) if (!host.frame()) return false;
  return expect(focus, count, detail);
}

bool storage_test() {
  double total = 0, free = 0;
  if (!storage::disk_bytes(4096, 100, 25, total, free) || total != 409600 || free != 102400 ||
      !storage::disk_bytes(4096, 100, -2, total, free) || total != 409600 || free != 0 ||
      !storage::disk_bytes(4096, 100, 120, total, free) || free != total ||
      storage::disk_bytes(0, 100, 50, total, free) ||
      !storage::disk_bytes(4096, UINT64_MAX, 1, total, free) ||
      total <= static_cast<double>(UINT64_MAX) || free != 4096) return false;
  host::MountEntry mounts[2]{};
  int count = 0;
  host::MountEntry mount{};
  std::strcpy(mount.path, "/app0");
  std::strcpy(mount.device, "/dev/test");
  std::strcpy(mount.type, "nullfs");
  storage::append_unique(mounts, 2, count, mount);
  storage::append_unique(mounts, 2, count, mount);
  if (count != 1) return false;
  std::strcpy(mount.path, "/download0");
  storage::append_unique(mounts, 2, count, mount);
  std::strcpy(mount.path, "/temp0");
  storage::append_unique(mounts, 2, count, mount);
  if (count != 2 || std::strcmp(mounts[1].path, "/download0")) return false;

  // Packed PS5 records can be unaligned and must never read past their bounds.
  char bytes[25]{};
  const auto record = [&](int offset, const char* name) {
    const std::uint32_t inode = 1;
    const std::uint16_t length = 12;
    std::memcpy(bytes + offset, &inode, sizeof inode);
    std::memcpy(bytes + offset + 4, &length, sizeof length);
    bytes[offset + 7] = static_cast<char>(std::strlen(name));
    std::strcpy(bytes + offset + 8, name);
  };
  record(1, "."); record(13, "abc");
  std::vector<std::string> names;
  const auto collect = [](const char* name, void* user) {
    static_cast<std::vector<std::string>*>(user)->emplace_back(name);
  };
  if (!host::visit_directory_records(bytes + 1, 24, collect, &names) ||
      names.size() != 1 || names[0] != "abc") return false;
  names.clear();
  if (host::visit_directory_records(bytes + 13, 7, collect, &names) ||
      host::visit_directory_records(bytes + 13, 11, collect, &names)) return false;
  bytes[24] = 'x'; // Missing NUL.
  if (host::visit_directory_records(bytes + 13, 12, collect, &names)) return false;
  bytes[24] = '\0'; bytes[17] = 0; bytes[18] = 0; // Zero record length.
  if (host::visit_directory_records(bytes + 13, 12, collect, &names) || !names.empty()) return false;
  // Exercise actual host bindings, sandbox path resolution, and error propagation.
  constexpr char script[] = R"JS((() => {
    const network = globalThis.__ps5ReactNative.network;
    if (!network || !network.version().includes("libcurl") ||
        !Array.isArray(network.poll())) return false;
    for (const invalid of [
      () => network.request("file:///tmp/example", {}),
      () => network.request("https://example.com", {maxBytes: 0}),
      () => network.request("https://example.com", {headers: {Host: "other.test"}}),
      () => network.download("https://example.com", "/download0/a", {headers: {Range: "bytes=0-1"}}),
      () => network.download("https://example.com", "/download0/a", {connections: 65}),
      () => network.download("https://example.com", "/download0/a", {recoverCompleted: 'yes'}),
      () => network.cancel(),
    ]) {
      try { invalid(); return false; }
      catch (error) { if (!error.message.includes("network.")) return false; }
    }
    const rangeProbe = network.request("http://127.0.0.1:1", {headers: {Range: "bytes=0-0"}, maxBytes: 8192});
    if (!Number.isInteger(rangeProbe) || rangeProbe <= 0) return false;
    network.cancel(rangeProbe);
    // With any sound baked, a second play while the first still sounds is skipped.
    const sound = globalThis.__ps5ReactNative.sound;
    const baked = globalThis.__ps5ReactTestSound;
    if (baked && (sound.play(baked, 0, 0) !== true || sound.play(baked, 0, 0) !== false)) return false;
    // Baked names drop the extension, so no import is named this.
    try { sound.play('not-baked.wav', 1, 0); return false; }
    catch (error) { if (!error.message.includes('sound.play not-baked.wav')) return false; }
    const fs = globalThis.__ps5ReactNative.fs;
    const testName = `listing-test-${Date.now()}.txt`;
    const testPath = `/download0/${testName}`;
    fs.writeFile(testPath, 'listing test', false);
    try {
      const listing = fs.readDir('/download0');
      const item = listing.find(entry => entry.name === testName);
      if (!item || !item.isFile || item.isDirectory || item.size !== 12 ||
          !Number.isFinite(item.modified)) return false;
      const info = fs.stat(testPath);
      if (!/^\d+$/.test(info.device) || !/^\d+$/.test(info.inode) ||
          typeof info.device !== 'string' || typeof info.inode !== 'string' ||
          info.device !== item.device || info.inode !== item.inode) return false;
      try { fs.readDir(testPath); return false; }
      catch (error) { if (!error.message.includes('fs.readDir')) return false; }
      // readFile sizes its buffer from the file: exact for small, empty and multi-megabyte files.
      if (fs.readFile(testPath) !== 'listing test') return false;
      fs.writeFile(testPath, '', false);
      if (fs.readFile(testPath) !== '') return false;
      const large = 'x'.repeat(3 * 1024 * 1024 + 7);
      fs.writeFile(testPath, large, false);
      if (fs.readFile(testPath) !== large) return false;
      fs.writeFile(testPath, 'synced', false, true);
      if (fs.readFile(testPath) !== 'synced') return false;
    } finally { fs.remove(testPath); }
    // removeTree deletes the tree but only unlinks the symbolic link set up below, keeping its target.
    fs.removeTree('/download0/remove-tree-test');
    if (fs.stat('/download0/remove-tree-test') || !fs.stat('/download0/remove-tree-target/keep.txt')) return false;
    fs.removeTree('/download0/remove-tree-target');
    try { fs.removeTree('/download0/remove-tree-test'); return false; }
    catch (error) { if (!error.message.includes('fs.removeTree')) return false; }
    const usage = fs.diskUsage('/download0');
    if (!Number.isFinite(usage.total) || usage.total <= 0 ||
        usage.free < 0 || usage.free > usage.total) return false;
    const mounts = fs.mounts();
    if (!Array.isArray(mounts) || !mounts.length || mounts.length > 64 ||
        !mounts.every(m => typeof m.path === 'string' && typeof m.device === 'string' &&
                           typeof m.type === 'string')) return false;
    try { fs.diskUsage('/missing-storage-test-path'); return false; }
    catch (error) {
      return error.message.includes('fs.diskUsage') &&
             error.message.includes('/missing-storage-test-path');
    }
  })())JS";
  char tree[PATH_MAX], target[PATH_MAX];
  if (!host::resolve_path("/download0/remove-tree-test", tree, sizeof tree) ||
      !host::resolve_path("/download0/remove-tree-target", target, sizeof target)) return false;
  const std::string tree_path = tree, target_path = target;
  // A previous run that stopped early may have left the fixture behind.
  const auto directory = [](const std::string& path) { return mkdir(path.c_str(), 0755) == 0 || errno == EEXIST; };
  unlink((tree_path + "/nested/link").c_str());
  std::FILE* kept = nullptr;
  if (!directory(target_path) || !(kept = std::fopen((target_path + "/keep.txt").c_str(), "w")) ||
      !directory(tree_path) || !directory(tree_path + "/nested") ||
      symlink(target, (tree_path + "/nested/link").c_str()) != 0) {
    if (kept) std::fclose(kept);
    return false;
  }
  std::fclose(kept);
  if (std::FILE* file = std::fopen((tree_path + "/nested/file.txt").c_str(), "w")) std::fclose(file);
  JSContext* ctx = er_runtime_context();
  // The first sound the app baked, whatever it is named; none leaves only the unknown-name check.
  JSValue global = JS_GetGlobalObject(ctx);
  JS_SetPropertyStr(ctx, global, "__ps5ReactTestSound",
                    ps5_react_sound_count ? JS_NewString(ctx, ps5_react_sounds[0].name) : JS_NULL);
  JS_FreeValue(ctx, global);
  JSValue result = JS_Eval(ctx, script, sizeof script - 1, "storage-test.js", JS_EVAL_TYPE_GLOBAL);
  const bool ok = !JS_IsException(result) && JS_ToBool(ctx, result) == 1;
  if (JS_IsException(result)) {
    JSValue error = JS_GetException(ctx);
    const char* message = JS_ToCString(ctx, error);
    std::fprintf(stderr, "Storage test: %s\n", message ? message : "unknown exception");
    JS_FreeCString(ctx, message);
    JS_FreeValue(ctx, error);
  }
  JS_FreeValue(ctx, result);
  if (ok) std::puts("PASS: bounded PS5 directory records, mount deduplication, storage bytes, sounds and desktop native bindings.");
  return ok;
}

bool self_test(Host& host) {
  if (!storage_test()) return false;
  for (int i = 0; i < 4; ++i) if (!host.frame()) return false;
  if (!expect(0, 0, 0) || !host.snapshot("texture-initial.ppm")) return false;
  if (!press(host, SDLK_RETURN, 0, 1, 1) || !host.snapshot("texture-increment.ppm") ||
      !press(host, SDLK_BACKSPACE, 0, 1, 0) || !press(host, SDLK_RIGHT, 1, 1, 0) ||
      !press(host, SDLK_RETURN, 1, 11, 1) || !press(host, SDLK_BACKSPACE, 1, 11, 0) ||
      !press(host, SDLK_RIGHT, 2, 11, 0) || !press(host, SDLK_RETURN, 2, 0, 1) ||
      !press(host, SDLK_BACKSPACE, 2, 0, 0)) return false;
  SDL_Event button = {};
  button.type = SDL_CONTROLLERBUTTONDOWN;
  button.cbutton.button = SDL_CONTROLLER_BUTTON_DPAD_RIGHT;
  if (SDL_PushEvent(&button) != 1) return false;
  button.cbutton.button = SDL_CONTROLLER_BUTTON_A;
  if (SDL_PushEvent(&button) != 1 || !host.frame() || !expect(0, 1, 1)) return false;
  if (SDL_SetWindowFullscreen(host.window, SDL_WINDOW_FULLSCREEN_DESKTOP) != 0) return false;
  for (int i = 0; i < 4; ++i) if (!host.frame()) return false;
  if (!(SDL_GetWindowFlags(host.window) & SDL_WINDOW_FULLSCREEN) ||
      !expect(0, 1, 1) || !host.snapshot("texture-fullscreen.ppm")) return false;
  std::puts("PASS: software framebuffer → OpenGL texture, channel order, orientation, React state/focus, simulated controller and fullscreen.");
  // The snapshots are compared against a single-core run, which proves nothing if no commit forked.
  if (host.render_worker_count > 1 && render_workers::forked_commits() == 0) {
    std::fprintf(stderr, "Render workers: %d installed, but no commit rendered in parallel\n", host.render_worker_count);
    return false;
  }
  if (host.render_worker_count > 1)
    std::printf("PASS: %u commits rendered across %d workers.\n", render_workers::forked_commits(), host.render_worker_count);
  return true;
}
} // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "Usage: %s bundle.js [--self-test|--fullscreen]\n", argv[0]);
    return 1;
  }
  const bool testing = argc > 2 && !std::strcmp(argv[2], "--self-test");
  if (testing) SDL_setenv("SDL_AUDIODRIVER", "dummy", 1);
  Host host;
  host.log_frames = !testing;
  bool ok = host.start();
  if (ok && testing) ok = color_test(host);
  if (ok && !testing) {
    if (const char* path = std::getenv("PS5_REACT_CONTROL")) {
      host.controlled = host.control.start(path);
      if (!host.controlled) std::fprintf(stderr, "PS5_REACT_CONTROL: cannot listen on %s: %s\n", path, std::strerror(errno));
      else std::printf("[PS5-REACT] control: %s\n", path);
    }
  }
  if (ok) ok = host.boot(argv[1]);
  if (ok && testing) ok = self_test(host);
  else if (ok) {
    if (const char* ms = std::getenv("PS5_REACT_SLOW_FRAME_MS")) {
      char* rest = nullptr;
      const long value = std::strtol(ms, &rest, 10);
      if (*ms && !*rest && value > 0 && value <= 60000) host.slow_frame_us = static_cast<Uint32>(value) * 1000;
      else std::fprintf(stderr, "PS5_REACT_SLOW_FRAME_MS: expected milliseconds (1-60000), got '%s'\n", ms);
    }
    if (const char* text = std::getenv("PS5_REACT_INPUT_SCRIPT")) {
      char error[160];
      ok = host.script.parse(text, error, sizeof error);
      if (!ok) std::fprintf(stderr, "PS5_REACT_INPUT_SCRIPT: %s\n", error);
    }
    if (ok && argc > 2 && !std::strcmp(argv[2], "--fullscreen")) {
      ok = SDL_SetWindowFullscreen(host.window, SDL_WINDOW_FULLSCREEN_DESKTOP) == 0;
      SDL_ShowCursor(SDL_DISABLE);
    }
    host.skip_still = true;
    while (ok && host.running) ok = host.frame();
    if (host.profiler.running()) {
      host.profiler.stop();
      const char* path = std::getenv("PS5_REACT_PROFILE");
      std::printf("profile: %llu samples, %s %s\n", static_cast<unsigned long long>(host.profiler.samples()),
                  host.profiler.write(path) ? "saved to" : "could not write", path);
    }
  }
  if (!ok) std::fprintf(stderr, "Texture proof failed: %s / %s\n", SDL_GetError(), er_runtime_last_error());
  if (ok && desktop_relaunch_requested()) {
    SDL_Quit();
    execv(argv[0], argv);
    std::fprintf(stderr, "relaunch: %s\n", std::strerror(errno));
  }
  return ok ? 0 : 1;
}

void archives::trace(const char*, const char*) {}
std::size_t archives::pipeline_bytes() { return 32 * 1024 * 1024; }
bool archives::hold_memory(bool hold) { images::hold_memory(hold); return true; }
bool archives::downloading() { return network::downloading(); }
bool archives::list_directory(const char* path, void (*visit)(const char*, void*), void* user) { return host::read_dir(path, visit, user); }
