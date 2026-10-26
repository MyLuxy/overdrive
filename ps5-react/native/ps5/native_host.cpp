// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Independent React proof: PS5 lifecycle/display/input, software UI and GL texture.

#include "network.hpp"
#include "archives.hpp"
#include "packages.hpp"
#include "pkg_proxy.hpp"
#include "removals.hpp"
#include "browser_capture.hpp"
#include "lan.hpp"
#include "render_workers.hpp"
#include "thread_name.hpp"
#include "app_config.hpp"
#include "async_log.hpp"
#include "platform/ps5/display_egl.hpp"
#include "platform/ps5/pad.hpp"
#include "platform/ps5/system.hpp"
#include "core/input.hpp"
#include "damage_tracker.hpp"
#include "frame_stats.hpp"
#include "gl_presenter.hpp"
#include "image_loader.hpp"
#include "host_api.hpp"
#include "host_platform.hpp"
#include "actions.hpp"
#include "input_script.hpp"
#include "js_heap.hpp"
#include "js_profiler.hpp"
#include "payload_loader.hpp"
#include "screenshot.hpp"
#include "text_shaper.hpp"
#include "video_api.hpp"
#include "layouts.h"
#include "video_output.hpp"
#include "video_frame.hpp"
#include "filesystem_access.hpp"
#include <unistd.h>
#include <EGL/egl.h>
#include <ps5_opengl_display_modes.h>
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <climits>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cstdint>
#include <iterator>
#include <string>
#include <utility>
#include <pthread.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

extern "C" {
#include "er_runtime.h"
#include "er_scene.h"
#include "native_renderer.h"
#include "software_backend.h"
std::uint64_t sceKernelReadTsc(void);
std::uint64_t sceKernelGetTscFrequency(void);
void hui_heap_capacity(std::size_t* size, std::size_t* flexible_before, std::size_t* flexible_after);
void hui_heap_stats(std::size_t* live_bytes, std::size_t* peak_bytes, std::size_t* blocks, std::size_t* failures);
}

// Extraction steps go to the console log, so the crash log keeps the last one before a fault.
bool archives::list_directory(const char* path, void (*visit)(const char*, void*), void* user) { return host::read_dir(path, visit, user); }
void archives::trace(const char* step, const char* detail) { async_log::write("[PS5-REACT] archive %s %s", step, detail); }
// The extraction's write ring: larger on larger heaps, and none (inline writes, as before) unless the
// heap still has room for the 64 MiB decoder budget the preflight admits, the ring, and a margin.
std::size_t archives::pipeline_bytes() {
  constexpr std::size_t MiB = 1024 * 1024;
  std::size_t size = 0, live = 0, peak = 0, blocks = 0, failures = 0;
  hui_heap_capacity(&size, nullptr, nullptr);
  hui_heap_stats(&live, &peak, &blocks, &failures);
  const std::size_t ring = size >= 256 * MiB ? 32 * MiB : size >= 192 * MiB ? 16 * MiB : 8 * MiB;
  return live + 64 * MiB + ring + 16 * MiB <= size ? ring : 0;
}
// The image caches drop to their low budgets for an in-process extraction (the render thread trims
// within a frame or two; images on screen stay), then the heap must still hold the decoder budget and
// the margin. pipeline_bytes() sizes the ring from what is left after the trim.
bool archives::hold_memory(bool hold) {
  images::hold_memory(hold);
  if (!hold) return true;
  for (int i = 0; i < 25 && images::memory().decoded > images::kLowCacheBytes; ++i) usleep(10'000);
  constexpr std::size_t MiB = 1024 * 1024;
  std::size_t size = 0, live = 0, peak = 0, blocks = 0, failures = 0;
  hui_heap_capacity(&size, nullptr, nullptr);
  hui_heap_stats(&live, &peak, &blocks, &failures);
  const bool room = !size || live + 64 * MiB + 16 * MiB <= size;
  async_log::write("[PS5-REACT] extraction memory: heap=%zu/%zuMiB img decoded=%zuKiB room=%d", live >> 20, size >> 20,
                   images::memory().decoded >> 10, room);
  return room;
}
bool archives::downloading() { return network::downloading(); }
// rar-extract.elf goes to the payload loader as the package installer does, and reports on the socket.
int archives::start_rar_worker(const std::string& request, std::string& error) {
  const int socket = payload_loader::send("rar-extract.elf", request, 5'000'000, "Archives.extract", error);
  if (socket >= 0) payload_loader::receive_timeout(socket, 250'000);
  return socket;
}
long archives::read_rar_worker(int stream, char* data, std::size_t size) {
  const int count = payload_loader::receive(stream, data, size);
  return count < 0 ? -1 : count;
}
void archives::cancel_rar_worker(int stream) { payload_loader::write(stream, "cancel\n", 7); }
void archives::close_rar_worker(int stream) { payload_loader::close(stream); }

namespace {
// Startup steps log their time since main(), to show where launch time goes.
std::int64_t launch_us = 0;
long long since_launch_ms() { return (hui::sys::monotonic_us() - launch_us) / 1000; }

void log_memory() {
  std::size_t live = 0, peak = 0, blocks = 0, failures = 0, size = 0;
  hui_heap_stats(&live, &peak, &blocks, &failures);
  hui_heap_capacity(&size, nullptr, nullptr);
  const images::Memory image = images::memory();
  async_log::write("[PS5-REACT] memory: heap=%zu/%zuMiB peak=%zuMiB failed=%zu img encoded=%zuKiB decoded=%zuKiB",
                   live >> 20, size >> 20, peak >> 20, failures, image.encoded >> 10, image.decoded >> 10);
  async_log::write("[PS5-REACT] images: %s", images::stats().c_str());
}

// A frozen screen on a tester's console says where the render loop hangs: past three seconds without
// a turn, the log names the loop's phase, the native call it is in and how far script got meanwhile
// (QuickJS polls its interrupt handler while it runs, so rising js_ticks with no call is a script loop).
std::atomic<std::int64_t> loop_beat{0};
std::atomic<const char*> loop_phase{"start"};
std::atomic<std::uint64_t> js_ticks{0};
std::atomic<bool> watching{true};

void beat(const char* phase) {
  loop_phase.store(phase, std::memory_order_relaxed);
  loop_beat.store(hui::sys::monotonic_us(), std::memory_order_relaxed);
}

void* watch_loop(void*) {
  name_thread("stall-watch");
  std::int64_t stalled_at = 0, next_report = 0;
  std::uint64_t ticks = 0;
  while (watching) {
    usleep(500'000);
    const std::int64_t now = hui::sys::monotonic_us(), last = loop_beat.load(std::memory_order_relaxed);
    if (stalled_at && last != stalled_at) {
      async_log::write("[PS5-REACT] stall: loop turned again after %lldms", static_cast<long long>((last-stalled_at)/1000));
      stalled_at = 0;
    }
    if (now - last < 3'000'000) continue;
    if (!stalled_at) { stalled_at = last; next_report = now; ticks = js_ticks; }
    if (now < next_report) continue;
    const char* call = host::current_call.load();
    const std::uint64_t seen = js_ticks;
    async_log::write("[PS5-REACT] stall: loop stuck %llds phase=%s call=%s js_ticks=+%llu",
                     static_cast<long long>((now-last)/1000000), loop_phase.load(std::memory_order_relaxed),
                     call ? call : "none", static_cast<unsigned long long>(seen-ticks));
    ticks = seen; next_report = now + 5'000'000;
  }
  return nullptr;
}

// Unused decoded images kept for scrolling back. Browsing peaks near 110 MiB live with 24 MiB of them
// and a 64-connection download, so a 128 MiB heap keeps 24 MiB; a 256 MiB heap holds 64 MiB (about 160
// grid covers, or a hero and 140 covers) and still leaves over 80 MiB free at that peak.
std::size_t image_cache_bytes() {
  std::size_t heap = 0;
  hui_heap_capacity(&heap, nullptr, nullptr);
  constexpr std::size_t MiB = 1024 * 1024;
  return heap >= 256 * MiB ? 64 * MiB : heap >= 192 * MiB ? 40 * MiB : 24 * MiB;
}

// A file in the app folder's dev/ directory. After console filesystem elevation /app0 is only a
// logical path, so it is resolved like the native API's paths.
std::string dev_path(const char* name) {
  char path[PATH_MAX];
  return host::resolve_path((std::string("/app0/dev/") + name).c_str(), path, sizeof path) ? path : "";
}

constexpr std::int64_t duration_us = static_cast<std::int64_t>(PS5_REACT_TIMEOUT) * 1000000;

void react_log(const char* line) { async_log::write("[REACT] %s", line); }

// The smallest layout at least as tall as the console's output, else the largest. An unreadable
// output picks the smallest.
const Ps5ReactLayout& choose_layout() {
  if (ps5_react_layout_count == 1) return ps5_react_layouts[0];
  const int lines = video_output::output_lines();
  for (unsigned i = 0; i < ps5_react_layout_count; ++i)
    if (ps5_react_layouts[i].height >= lines) return ps5_react_layouts[i];
  return ps5_react_layouts[ps5_react_layout_count - 1];
}

// An app folder may carry dev/input-script.txt (InputScript syntax) for unattended profiling; it is
// never part of a build, only added to a test deploy.
void load_input_script(InputScript& script) {
  FILE* file = std::fopen(dev_path("input-script.txt").c_str(), "rb");
  if (!file) return;
  char text[4096] = {};
  text[std::fread(text, 1, sizeof text - 1, file)] = '\0';
  std::fclose(file);
  char error[160];
  if (script.parse(text, error, sizeof error)) async_log::write("[PS5-REACT] input script loaded");
  else async_log::write("[PS5-REACT] input script ignored: %s", error);
}

// Live commands for a running title: a test machine overwrites dev/commands.txt with lines
// "<sequence> <steps>" (InputScript syntax); about once a second the host runs the steps of every line
// whose sequence number is new. Active only when the app folder has a dev directory, which a build never
// creates. Lines present at launch are skipped.
class LiveCommands {
public:
  void start() {
    struct stat info;
    enabled_ = stat(dev_path("").c_str(), &info) == 0 && S_ISDIR(info.st_mode);
    if (enabled_) read(false);
  }

  // Appends new commands to `script` once it has finished its previous steps.
  void poll(std::int64_t now_us, InputScript& script) {
    if (!enabled_ || now_us < next_poll_us_) return;
    next_poll_us_ = now_us + 1000000;
    read(true);
    if (pending_.empty() || !script.done()) return;
    char error[160];
    if (!script.parse(pending_.c_str(), error, sizeof error)) async_log::write("[PS5-REACT] command ignored: %s", error);
    pending_.clear();
  }

private:
  void read(bool queue) {
    FILE* file = std::fopen(dev_path("commands.txt").c_str(), "rb");
    if (!file) return;
    char text[4096] = {};
    text[std::fread(text, 1, sizeof text - 1, file)] = '\0';
    std::fclose(file);
    for (char* line = std::strtok(text, "\n"); line; line = std::strtok(nullptr, "\n")) {
      char* steps = nullptr;
      const unsigned long long sequence = std::strtoull(line, &steps, 10);
      if (steps == line || sequence <= last_sequence_) continue;
      steps += std::strspn(steps, " \t");
      last_sequence_ = sequence;
      if (!queue) continue;
      async_log::write("[PS5-REACT] command: %s", steps);
      pending_ += steps;
      pending_ += ' ';
    }
  }

  bool enabled_ = false;
  unsigned long long last_sequence_ = 0;
  std::int64_t next_poll_us_ = 0;
  std::string pending_;
};

// The engine reads this clock around every blit, thousands of times in a full-screen frame:
// clock_gettime made the frame log cost about 10 ms there, the time-stamp counter costs nothing.
std::uint64_t tsc_per_us = 1;
std::uint32_t perf_clock() { return static_cast<std::uint32_t>(sceKernelReadTsc() / tsc_per_us); }

// Indexed like kButtonNames.
constexpr hui::Action kButtonActions[] = {
  hui::Action::up, hui::Action::down, hui::Action::left, hui::Action::right,
  hui::Action::confirm, hui::Action::back, hui::Action::north, hui::Action::west,
  hui::Action::page_prev, hui::Action::page_next, hui::Action::jump_prev, hui::Action::jump_next,
  hui::Action::l3, hui::Action::r3, hui::Action::menu, hui::Action::touch,
};
static_assert(std::size(kButtonActions) == std::size(kButtonNames));

// Buttons delivered to the app as actions; the D-pad and left stick come through input.nav.
constexpr std::pair<hui::Action, HostAction> kExtraActions[] = {
  {hui::Action::confirm, HostAction::confirm}, {hui::Action::back, HostAction::back},
  {hui::Action::page_prev, HostAction::l1}, {hui::Action::page_next, HostAction::r1},
  {hui::Action::jump_prev, HostAction::l2}, {hui::Action::jump_next, HostAction::r2},
  {hui::Action::north, HostAction::triangle}, {hui::Action::west, HostAction::square},
  {hui::Action::menu, HostAction::options},
};

GamepadState gamepad_state(const hui::InputFrame& input) {
  GamepadState state;
  state.connected = input.connected;
  state.left_x = input.stick_x; state.left_y = input.stick_y;
  state.right_x = input.stick2_x; state.right_y = input.stick2_y;
  state.l2 = input.trigger_l; state.r2 = input.trigger_r;
  for (std::size_t i = 0; i < std::size(kButtonActions); ++i)
    if (input.is_held(kButtonActions[i])) state.buttons |= 1u << i;
  return state;
}

const char* nav_action(hui::Direction direction) {
  switch (direction) {
    case hui::Direction::up: return action_name(HostAction::up);
    case hui::Direction::down: return action_name(HostAction::down);
    case hui::Direction::left: return action_name(HostAction::left);
    case hui::Direction::right: return action_name(HostAction::right);
    default: return nullptr;
  }
}

GcScheduler gc_scheduler(hui::sys::monotonic_us);
JsProfiler profiler(hui::sys::monotonic_us);

// Calls the runtime's input entry `name` with `argc` arguments, which it frees.
bool call_input(const char* name, int argc, JSValue* argv) {
  gc_scheduler.input(hui::sys::monotonic_us());
  er_perf_phase_begin(ER_PERF_PHASE_JS);
  JSContext* ctx = er_runtime_context();
  JSValue global = JS_GetGlobalObject(ctx);
  JSValue fn = JS_GetPropertyStr(ctx, global, name);
  JSValue result = JS_Call(ctx, fn, global, argc, argv);
  const bool ok = !JS_IsException(result);
  if (!ok) {
    JSValue error = JS_GetException(ctx);
    const char* message = JS_ToCString(ctx, error);
    async_log::write("[PS5-REACT] input exception: %s", message ? message : "unknown");
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
  JSValue value = JS_NewString(er_runtime_context(), action);
  return call_input("__ps5ReactDispatch", 1, &value);
}

// The touchpad's finger at (x, y) 0..1, or lifted.
bool touch(bool down, float x, float y) {
  JSContext* ctx = er_runtime_context();
  JSValue args[2] = {down ? JS_NewFloat64(ctx, x) : JS_NULL, down ? JS_NewFloat64(ctx, y) : JS_NULL};
  return call_input("__ps5ReactTouch", 2, args);
}

// Display.setRefreshRate: the rate can change only while EGL is terminated (ps5_opengl_display_modes.h),
// so the presenter's GL objects go with the context and are made again. The engine framebuffer is CPU
// memory and survives; the presenter's first draw uploads all of it.
bool switch_refresh_rate(hui::ps5::Display& display, GlPresenter& presenter, const Ps5ReactLayout& layout, int hz) {
  const std::int64_t start = hui::sys::monotonic_us();
  presenter.release();
  display.close();
  if (!eglSetDisplayRefreshPS5(eglGetDisplay(EGL_DEFAULT_DISPLAY), hz))
    async_log::write("[PS5-REACT] refresh %d Hz refused: 0x%x", hz, eglGetError());
  const bool ok = display.open(layout.surface_width, layout.surface_height) && presenter.init(layout.width, layout.height);
  async_log::write("[PS5-REACT] refresh switch to %d Hz ok=%d in %lldms", hz, ok,
                   static_cast<long long>((hui::sys::monotonic_us() - start) / 1000));
  return ok;
}

// Owned resources are released while the context is valid; closing the title
// happens after this scope, through the platform's lifecycle API.
bool run_proof() {
  hui::ps5::Display display;
  hui::ps5::Pad pad;
  GlPresenter presenter;
  hui::InputTracker tracker;
  hui::PadSample samples[64];
  FrameStats stats;
  unsigned summaries = 0;
  bool runtime = false, software = false;
  // Accepted only before Display::open initializes EGL. A display without 120 Hz stays at 60.
  if (PS5_REACT_REFRESH_RATE != 60 && !eglSetDisplayRefreshPS5(eglGetDisplay(EGL_DEFAULT_DISPLAY), PS5_REACT_REFRESH_RATE))
    async_log::write("[PS5-REACT] refresh %d Hz refused: 0x%x", PS5_REACT_REFRESH_RATE, eglGetError());
  const Ps5ReactLayout& layout = choose_layout();
  const int width = layout.width, height = layout.height;
  bool ok = display.open(layout.surface_width, layout.surface_height);
  async_log::write("[PS5-REACT] display=%d at %lldms", ok, since_launch_ms());
  if (ok) {
    ok = presenter.init(width, height);
    async_log::write("[PS5-REACT] presenter=%d", ok);
  }
  if (ok) {
    software = er_software_backend_init(width, height);
    ok = software && damage_tracker_install(width, height);
    // The presenter draws qualifying <Image layer> images itself (er_set_layers_enabled). A test deploy may
    // rasterize them all with a dev/layers.txt holding 0, for comparisons.
    bool layers = true;
    if (FILE* file = std::fopen(dev_path("layers.txt").c_str(), "rb")) {
      char text[16] = {};
      layers = !std::fgets(text, sizeof text, file) || std::atoi(text) != 0;
      std::fclose(file);
    }
    er_set_layers_enabled(ok && layers && presenter.layers_supported());
    // A test deploy may upload video as textures instead of storage buffers with dev/video-upload.txt "textures".
    if (FILE* file = std::fopen(dev_path("video-upload.txt").c_str(), "rb")) {
      char text[16] = {};
      if (std::fgets(text, sizeof text, file) && !std::strncmp(text, "textures", 8)) presenter.set_video_upload(false);
      std::fclose(file);
    }
    // A test deploy may dump the upscaler's input and output at its Nth frame with dev/upscale-dump.txt "N".
    if (FILE* file = std::fopen(dev_path("upscale-dump.txt").c_str(), "rb")) {
      char text[16] = {};
      if (std::fgets(text, sizeof text, file) && std::atoi(text) > 0)
        presenter.video().dump_upscale_at(dev_path("upscale"), std::uint64_t(std::atoi(text)));
      std::fclose(file);
    }
    async_log::write("[PS5-REACT] video upload=%s",
                     presenter.video().upload_mode() == GlVideo::Upload::storage ? "storage" : "textures");
    async_log::write("[PS5-REACT] software framebuffer=%d %dx%d", ok, width, height);
  }
  if (ok) {
    // A test deploy may pick the count with dev/render-workers.txt (1 renders single-core).
    const int cpus = render_workers::available_cpus();
    int wanted = cpus;
    if (FILE* file = std::fopen(dev_path("render-workers.txt").c_str(), "rb")) {
      char text[16] = {};
      if (std::fgets(text, sizeof text, file) && std::atoi(text) > 0) wanted = std::atoi(text);
      std::fclose(file);
    }
    async_log::write("[PS5-REACT] render workers=%d of %d, cpus=%d", render_workers::start(wanted),
                     render_workers::max_workers(), cpus);
  }
  // The pad opens before the bundle runs: it also initializes the user service
  // that the users, notification and browser calls need.
  if (ok) {
    async_log::write("[PS5-REACT] pad=%d at %lldms", pad.open(), since_launch_ms());
    host_platform_set_pad(&pad);
  }
  if (ok) {
    images::set_cache_bytes(image_cache_bytes());
    images::set_heap_probe([] {
      images::Heap heap;
      std::size_t peak = 0, blocks = 0, failures = 0;
      hui_heap_stats(&heap.live, &peak, &blocks, &failures);
      hui_heap_capacity(&heap.size, nullptr, nullptr);
      return heap;
    });
    if (network::start()) ps5_react_start_images();
    async_log::write("[PS5-REACT] sound=%d at %lldms", ps5_react_start_sound(), since_launch_ms());
    ErRuntimeConfig config = {};
    config.screen_width = width; config.screen_height = height;
    config.screen_scale = 2;
    config.log = react_log;
    config.max_stack_size = 1024 * 1024;
    config.memory_limit = kJsMemoryLimit;
    config.malloc_functions = js_heap_functions();
    config.install_host_globals = ps5_react_install_host_api;
    runtime = er_runtime_init(&config);
    ok = runtime;
    async_log::write("[PS5-REACT] runtime=%d at %lldms", ok, since_launch_ms());
    // A test deploy samples JavaScript with dev/profile.txt holding the interval in microseconds.
    if (FILE* file = ok ? std::fopen(dev_path("profile.txt").c_str(), "rb") : nullptr) {
      char text[16] = {};
      const int interval = std::fgets(text, sizeof text, file) ? std::atoi(text) : 0;
      std::fclose(file);
      profiler.start(JS_GetRuntime(er_runtime_context()), interval > 0 ? interval : 1000);
      async_log::write("[PS5-REACT] profiling JavaScript every %d us", interval > 0 ? interval : 1000);
    }
  }
  if (ok) {
    layout.register_assets();
    char fonts[256];
    if (host::resolve_path("/app0/fonts", fonts, sizeof fonts))
      text_shaper::install(fonts, [](const char* line) { async_log::write("[PS5-REACT] %s", line); });
    ok = er_runtime_load_source(layout.bundle, layout.bundle_length, "app.jsx.bundle");
    async_log::write("[PS5-REACT] bundle=%d gc_accounting=%d at %lldms", ok, er_runtime_gc_accounting_ok(), since_launch_ms());
  }
  if (ok) {
    // Input failure is logged; timeout still allows the display-only proof to end.
    async_log::write("[PS5-REACT] timeout=%ds after first frame", PS5_REACT_TIMEOUT);
    std::int64_t first_present = 0, previous = hui::sys::monotonic_us(), last_vblank_us = previous;
    // Replaced by the accepted mode after the first frame at a rate: a display without 120 Hz stays at 60.
    int refresh_hz = PS5_REACT_REFRESH_RATE;
    bool mode_known = false;
    double tick_carry_ms = 0;
    std::uint64_t frames = 0;
    InputScript script;
    load_input_script(script);
    bool touched = false;
    VirtualPad virtual_pad;
    LiveCommands commands;
    commands.start();
    beat("start");
    JS_SetInterruptHandler(JS_GetRuntime(er_runtime_context()),
                           [](JSRuntime*, void*) { js_ticks.fetch_add(1, std::memory_order_relaxed); return 0; }, nullptr);
    pthread_t watcher;
    const bool watcher_started = pthread_create(&watcher, nullptr, watch_loop, nullptr) == 0;
    // A test deploy may lower the slow-frame threshold (milliseconds) with dev/slow-frame-ms.txt.
    std::uint32_t slow_frame_us = 33000;
    if (FILE* file = std::fopen(dev_path("slow-frame-ms.txt").c_str(), "rb")) {
      char text[16] = {};
      if (std::fgets(text, sizeof text, file) && std::atoi(text) > 0) slow_frame_us = std::atoi(text) * 1000u;
      std::fclose(file);
    }
    // And report every slow frame instead of the first few per window, with dev/slow-frame-lines.txt.
    if (FILE* file = std::fopen(dev_path("slow-frame-lines.txt").c_str(), "rb")) {
      char text[16] = {};
      if (std::fgets(text, sizeof text, file) && std::atoi(text) > 0) stats.set_slow_line_limit(std::atoi(text));
      std::fclose(file);
    }
    tsc_per_us = std::max<std::uint64_t>(sceKernelGetTscFrequency() / 1000000, 1);
    er_perf_set_clock(perf_clock);
    // A test deploy may let idle collections run during motion with a dev/gc-still.txt holding 0.
    if (FILE* file = std::fopen(dev_path("gc-still.txt").c_str(), "rb")) {
      char text[16] = {};
      if (std::fgets(text, sizeof text, file)) gc_scheduler.wait_for_still(std::atoi(text) != 0);
      std::fclose(file);
    }
    while (ok) {
      const std::int64_t now = hui::sys::monotonic_us();
      beat("input");
      if (now <= 0 || (duration_us > 0 && first_present && now - first_present >= duration_us)) break;
      if (const char* line = stats.start_frame(now)) {
        async_log::write("[PS5-REACT] %s", line);
        // Every fifth summary, about ten seconds apart.
        if (++summaries % 5 == 1) log_memory();
        if (const std::string videos = video_layers::summary(); !videos.empty()) {
          const std::uint64_t bytes = presenter.video().take_upload_bytes();
          const std::uint32_t us = presenter.video().take_upload_us();
          // The whole process's CPU time since the last line, as cores busy: decoding threads included.
          static std::int64_t cpu_before = 0, wall_before = 0;
          rusage usage{};
          getrusage(RUSAGE_SELF, &usage);
          const std::int64_t cpu_us = (usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) * std::int64_t{1000000} +
                                      usage.ru_utime.tv_usec + usage.ru_stime.tv_usec;
          const std::int64_t wall_us = hui::sys::monotonic_us();
          const double cores = wall_before && wall_us > wall_before ? double(cpu_us - cpu_before) / (wall_us - wall_before) : 0;
          cpu_before = cpu_us;
          wall_before = wall_us;
          async_log::write("[PS5-REACT] video upload %.1f MiB in %.1f ms, process cpu %.2f cores", bytes / 1048576.0,
                           us / 1000.0, cores);
          if (const std::string upscale = presenter.video().take_upscale_log(); !upscale.empty())
            async_log::write("[PS5-REACT] video upscale %s", upscale.c_str());
          std::size_t start = 0;
          while (start < videos.size()) {
            const std::size_t end = videos.find('\n', start);
            async_log::write("[PS5-REACT] %s", videos.substr(start, end - start).c_str());
            if (end == std::string::npos) break;
            start = end + 1;
          }
        }
      }
      // Input and JavaScript commit layout only; the commit after them paints the frame once.
      er_set_raster_deferred(true);
      const auto count = pad.read(samples);
      const auto input = tracker.update(std::span<const hui::PadSample>(samples, count), now);
      pad.tick(static_cast<float>(now - previous) / 1000000.0f);
      host_platform_tick(now);
      if (const char* direction = nav_action(input.nav)) ok = dispatch(direction);
      for (const auto& [button, action] : kExtraActions) {
        if (ok && input.is_pressed(button)) ok = dispatch(action_name(action));
      }
      // Each frame the finger is down, and once when it lifts.
      float touch_x = 0, touch_y = 0;
      const bool touch_down = host_platform_read_touch(&touch_x, &touch_y);
      if (ok && (touch_down || touched)) ok = touch(touch_down, touch_x, touch_y);
      touched = touch_down;
      commands.poll(now, script);
      if (const char* action = ok ? script.next(static_cast<std::uint64_t>(now / 1000)) : nullptr) {
        async_log::write("[PS5-REACT] script: %s", action);
        if (!std::strcmp(action, "quit")) break;
        if (VirtualPad::is_step(action)) {
          char error[160];
          if (!virtual_pad.apply(action, static_cast<std::uint64_t>(now / 1000), error, sizeof error))
            async_log::write("[PS5-REACT] script: %s", error);
        } else if (!std::strncmp(action, "shot:", 5)) {
          const std::string path = dev_path((std::string(action + 5) + ".bmp").c_str());
          async_log::write("[PS5-REACT] shot %s: %s", path.c_str(), save_screenshot(path.c_str()) ? "saved" : std::strerror(errno));
        } else if (!std::strncmp(action, "touch:", 6)) {
          float x = 0, y = 0;
          ok = touch(std::sscanf(action + 6, "%f,%f", &x, &y) == 2, x, y);
        } else {
          ok = dispatch(action);
        }
      }
      GamepadState state = gamepad_state(input);
      // A scripted hold presses like the controller: the button's action, once.
      for (std::uint32_t pressed = virtual_pad.merge(state, static_cast<std::uint64_t>(now / 1000)), i = 0; ok && pressed;
           pressed >>= 1, ++i) {
        if (const char* held = pressed & 1 ? VirtualPad::action(i) : nullptr) ok = dispatch(held);
      }
      ps5_react_set_gamepad(state);
      if (!ok) break;
      stats.lap(FrameStats::input, hui::sys::monotonic_us());
      er_perf_phase_begin(ER_PERF_PHASE_JS);
      beat("js");
      er_runtime_pump();
      // The display shows a new frame every vblank, so motion advances by whole vblanks, not by the
      // loop's jittery wall-clock interval.
      const std::int64_t vblank_us = 1000000 / refresh_hz;
      const std::int64_t vblanks = std::max<std::int64_t>(1, (now - previous + vblank_us / 2) / vblank_us);
      const double elapsed_ms = vblanks * 1000.0 / refresh_hz;
      ok = ps5_react_frame(er_runtime_context(), elapsed_ms);
      er_perf_phase_end(ER_PERF_PHASE_JS);
      if (!ok) {
        async_log::write("[PS5-REACT] frame callback exception");
        break;
      }
      er_set_raster_deferred(false);
      beat("commit");
      er_commit();
      if (*er_runtime_last_error()) { ok = false; break; }
      stats.lap(FrameStats::update, hui::sys::monotonic_us());
      er_perf_phase_begin(ER_PERF_PHASE_PRESENT);
      beat("present");
      int layer_count = 0;
      const ERLayer* layers = er_get_layers(&layer_count);
      presenter.set_layers({layers, static_cast<std::size_t>(layer_count)});
      video_layers::update(hui::sys::monotonic_us(), 1000000 / refresh_hz);
      // A frame that changed nothing is not presented: the screen keeps showing the last one, and the
      // loop sleeps to the next vblank instead of waiting in the driver, which costs CPU.
      const bool still = first_present && presenter.unchanged(damage_tracker_rects(), damage_tracker_moves(),
                                                              display.width(), display.height());
      if (!still)
        ok = presenter.draw(er_software_framebuffer(), damage_tracker_rects(), damage_tracker_moves(),
                            display.width(), display.height());
      er_perf_phase_end(ER_PERF_PHASE_PRESENT);
      {
        const GlPresenter::Timing& t = presenter.last_timing();
        stats.note_present(t.upload_us, t.draw_us, t.upload_bytes);
      }
      const std::size_t repainted = damage_tracker_area();
      damage_tracker_clear();
      stats.lap(FrameStats::present, hui::sys::monotonic_us());
      beat("swap");
      if (still) {
        const std::int64_t wake = last_vblank_us + (hui::sys::monotonic_us() - last_vblank_us + 1000000 / refresh_hz) /
                                                       (1000000 / refresh_hz) * (1000000 / refresh_hz);
        const std::int64_t left = wake - hui::sys::monotonic_us();
        if (left > 0) usleep(static_cast<useconds_t>(left));
      } else {
        ok = ok && display.swap();
        last_vblank_us = hui::sys::monotonic_us();
      }
      stats.lap(FrameStats::swap, hui::sys::monotonic_us());
      if (!ok) break;
      beat("gc");
      if (const char* line = gc_scheduler.frame(JS_GetRuntime(er_runtime_context()), hui::sys::monotonic_us(),
                                                repainted, static_cast<std::size_t>(width) * height))
        async_log::write("[PS5-REACT] %s", line);
      if (!first_present) {
        first_present = hui::sys::monotonic_us();
        hui::sys::hide_splash_screen();
        async_log::write("[PS5-REACT] first frame presented at %lldms", since_launch_ms());
      }
      beat("embedded");
      const bool first_at_mode = !mode_known;
      if (first_at_mode) {
        // The accepted mode is known only once a frame has been presented.
        mode_known = true;
        EGLint mode_width = 0, mode_height = 0, mode_hz = 0;
        if (eglGetDisplayModePS5(eglGetDisplay(EGL_DEFAULT_DISPLAY), &mode_width, &mode_height, &mode_hz)) {
          async_log::write("[PS5-REACT] display mode %dx%d at %d Hz", mode_width, mode_height, mode_hz);
          if (mode_hz > 0) refresh_hz = mode_hz;
        }
        ps5_react_set_refresh_rate(refresh_hz);
      }
      // The engine clock takes whole milliseconds; carrying the remainder keeps 8.33 ms frames at speed.
      tick_carry_ms += std::min(elapsed_ms, 50.0);
      const auto tick_ms = static_cast<std::uint32_t>(tick_carry_ms);
      tick_carry_ms -= tick_ms;
      embedded_renderer_tick(tick_ms);
      previous = now;
      // The first frame at a mode may wait out the TV's resync in its swap; that wait is not motion.
      if (first_at_mode) previous = hui::sys::monotonic_us();
      ++frames;
      if (const char* line = stats.end_frame(slow_frame_us)) async_log::write("[PS5-REACT] %s", line);
      if (ps5_react_exit_requested()) break;
      if (const int hz = ps5_react_take_refresh_request()) {
        ok = switch_refresh_rate(display, presenter, layout, hz);
        refresh_hz = hz;
        mode_known = false;
        // Nor is the reopen itself.
        previous = hui::sys::monotonic_us();
      }
    }
    async_log::write("[PS5-REACT] loop ended ok=%d frames=%llu", ok, static_cast<unsigned long long>(frames));
    watching = false;
    if (watcher_started) pthread_join(watcher, nullptr);
    if (profiler.running()) {
      profiler.stop();
      const bool saved = profiler.write(dev_path("profile.folded").c_str());
      async_log::write("[PS5-REACT] profile: %llu samples, saved=%d", static_cast<unsigned long long>(profiler.samples()), saved);
    }
  }
  if (!ok && runtime) async_log::write("[PS5-REACT] error=%s", er_runtime_last_error());
  video_layers::stop();
  ps5_react_stop_images();
  archives::stop();
  browser_capture::stop();
  lan::stop();
  packages::stop();
  pkg_proxy::stop();
  removals::stop();
  network::stop();
  if (runtime) er_runtime_shutdown();
  text_shaper::shutdown();
  ps5_react_stop_sound();
  render_workers::stop();
  if (software) er_software_backend_destroy();
  host_platform_set_pad(nullptr);
  pad.close();
  presenter.release();
  display.close();
  return ok;
}

void* render_thread(void*) {
  name_thread("render");
  hui::sys::log("[PS5-REACT] render thread started, 8 MiB stack, at %lldms", since_launch_ms());
  if (!async_log::start()) hui::sys::log("[PS5-REACT] log writer thread failed; logging synchronously");
  const bool ok = run_proof();
  async_log::stop();
  hui::sys::log("[PS5-REACT] cleanup complete, result=%d; requesting title closure", ok);
  hui::sys::quit();
  return nullptr;
}
} // namespace

int main() {
  hui::sys::log("[PS5-REACT] %s (%s)", PS5_REACT_NAME, PS5_REACT_TITLE);
  std::size_t heap = 0, flexible_before = 0, flexible_after = 0;
  hui_heap_capacity(&heap, &flexible_before, &flexible_after);
  if (heap)
    hui::sys::log("[PS5-REACT] heap: %zu MiB (flexible memory free %zu MiB before it, %zu MiB after)",
                  heap >> 20, flexible_before >> 20, flexible_after >> 20);
  else
    hui::sys::log("[PS5-REACT] heap: none, system malloc (flexible memory free %zu MiB)", flexible_before >> 20);
  launch_us = hui::sys::monotonic_us();
#if PS5_REACT_VIDEO
  video::preload_platform_decoder();
#endif
  initialize_filesystem_access();
  pthread_attr_t attributes;
  int result = pthread_attr_init(&attributes);
  if (!result) {
    result = pthread_attr_setstacksize(&attributes, 8 * 1024 * 1024);
    pthread_t thread;
    if (!result) result = pthread_create(&thread, &attributes, render_thread, nullptr);
    pthread_attr_destroy(&attributes);
  }
  if (result) {
    hui::sys::log("[PS5-REACT] thread creation failed=%d", result);
    hui::sys::quit();
  }
  // Native titles must not return to CRT exit(); the render thread owns closure.
  hui::sys::park();
  return 0;
}
