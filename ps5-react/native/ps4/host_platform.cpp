// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// The PS4 host: the desktop SDL host re-targeted to Open Orbis. Fixed data roots instead of
// a mount table, no child processes, no browser; everything else follows
// native/desktop/host_platform.cpp so the two hosts stay comparable.
#include "host_api.hpp"
#include "audio_sink.hpp"
#include "host_platform.hpp"
#include "storage_stats.hpp"
#include "audio/mixer.hpp"

#include <dirent.h>
#include <sys/statvfs.h>
#include <sys/resource.h>
#include <cerrno>
#include <cstdio>
#include <string>
#include <cstdlib>
#include <cstring>

namespace {
SDL_GameController* controller = nullptr;

const char* data_root() {
  const char* value = std::getenv("PS4_OVERDRIVE_DATA");
  return value && *value ? value : "/data/overdrive";
}

// The console's system language is not exposed; the app language comes from the environment,
// and the interface falls back to its own default when neither variable is set.
void environment_language(char* out, std::size_t size) {
  const char* value = nullptr;
  for (const char* name : {"PS4_OVERDRIVE_LANGUAGE", "PS5_REACT_LANGUAGE", "LC_ALL", "LANG"})
    if ((value = std::getenv(name)) && *value) break;
  if (!value || !*value || !std::strcmp(value, "C") || !std::strncmp(value, "C.", 2) ||
      !std::strcmp(value, "POSIX"))
    return;
  std::size_t length = std::strcspn(value, ".@");
  if (length >= size) length = size - 1;
  for (std::size_t i = 0; i < length; ++i) out[i] = value[i] == '_' ? '-' : value[i];
  out[length] = '\0';
}
} // namespace

void desktop_set_controller(SDL_GameController* value) {
  controller = value;
}

namespace host {
const char* platform_name() { return "ps4"; }

bool relaunch = false;

bool arrange_relaunch(char*, std::size_t) {
  relaunch = true;
  return true;
}

// An Open Orbis process cannot read /proc/self/mounts; probe the roots homebrew uses instead.
int list_mounts(MountEntry* mounts, int max) {
  static constexpr const char* roots[] = {"/data", "/app0", "/mnt/usb0", "/mnt/usb1", "/mnt/usb2",
                                          "/mnt/usb3", "/mnt/usb4", "/mnt/usb5", "/mnt/usb6", "/mnt/usb7"};
  int used = 0;
  for (const char* root : roots) {
    if (used >= max) break;
    struct statvfs fs;
    if (statvfs(root, &fs) != 0) continue;
    std::snprintf(mounts[used].device, sizeof mounts[used].device, "%s", root);
    std::snprintf(mounts[used].path, sizeof mounts[used].path, "%s", root);
    const bool usb = !std::strncmp(root, "/mnt/usb", 8);
    std::snprintf(mounts[used].type, sizeof mounts[used].type, "%s", usb ? "usb" : "internal");
    ++used;
  }
  return used;
}

bool disk_usage(const char* real_path, double& total, double& free) {
  struct statvfs fs;
  if (statvfs(real_path, &fs) != 0) return false;
  if (!storage::disk_bytes(fs.f_frsize, fs.f_blocks, static_cast<std::int64_t>(fs.f_bavail), total, free)) {
    errno = EIO;
    return false;
  }
  return true;
}

void trace(const char*) {}

bool read_dir(const char* real_path, void (*visit)(const char* name, void* user), void* user) {
  DIR* dir = opendir(real_path);
  if (!dir) return false;
  while (const dirent* item = readdir(dir))
    if (std::strcmp(item->d_name, ".") && std::strcmp(item->d_name, "..")) visit(item->d_name, user);
  closedir(dir);
  return true;
}

bool resolve_path(const char* path, char* out, std::size_t size) {
  if (path[0] != '/' || std::strstr(path, "/../")) return false;
  const std::size_t length = std::strlen(path);
  if (length >= 3 && !std::strcmp(path + length - 3, "/..")) return false;
  const char* root = std::getenv("PS4_OVERDRIVE_SANDBOX");
  if (!root || !*root) {
    static std::string resolved;
    resolved = std::string(data_root()) + "/sandbox";
    root = resolved.c_str();
  }
  const int written = std::snprintf(out, size, "%s%s", root, length == 1 ? "" : path);
  return written >= 0 && static_cast<std::size_t>(written) < size;
}

void device_info(DeviceInfo& info) {
  std::snprintf(info.model, sizeof info.model, "PlayStation 4 (Open Orbis)");
  info.firmware[0] = '\0';
  info.cpu_frequency = -1;
  // No sysinfo on the console: the panel hides free memory when the value stays negative.
  info.free_memory = -1;
  rusage usage;
  if (getrusage(RUSAGE_SELF, &usage) == 0)
    info.process_time = (static_cast<std::int64_t>(usage.ru_utime.tv_sec) + usage.ru_stime.tv_sec) * 1000000 +
                        usage.ru_utime.tv_usec + usage.ru_stime.tv_usec;
  environment_language(info.language, sizeof info.language);
}

bool foreground_user(User& user) {
  const char* name = std::getenv("PS4_OVERDRIVE_USER");
  user.id = 1;
  std::snprintf(user.name, sizeof user.name, "%s", name && *name ? name : "player");
  return true;
}

int logged_in_users(User* users, int max) {
  return max > 0 && foreground_user(users[0]) ? 1 : 0;
}

bool notify(const char* message, const char* sub_message) {
  std::printf("[notify] %s%s%s\n", message, *sub_message ? ": " : "", sub_message);
  std::fflush(stdout);
  return true;
}

bool open_url(const char*) { return false; }

void set_light_bar(std::uint8_t r, std::uint8_t g, std::uint8_t b) {
  if (!controller || SDL_GameControllerSetLED(controller, r, g, b) != 0)
    std::printf("[pad] light bar %u,%u,%u (no controller LED)\n", r, g, b);
}

void reset_light_bar() {
  if (!controller || SDL_GameControllerSetLED(controller, 0, 0, 64) != 0)
    std::puts("[pad] light bar reset (no controller LED)");
}

void vibrate(float strength, float seconds) {
  const auto level = static_cast<Uint16>(strength * 0xffff);
  if (!controller || SDL_GameControllerRumble(controller, level, level, static_cast<Uint32>(seconds * 1000)) != 0)
    std::printf("[pad] vibrate %.2f for %.2fs (no controller rumble)\n", strength, seconds);
}

void set_trigger_effect(unsigned mask, int mode, const std::uint8_t* params, std::size_t count) {
  static constexpr const char* kModes[] = {"off", "feedback", "weapon", "vibration"};
  std::printf("[pad] trigger effect mask=%u %s", mask, kModes[mode]);
  for (std::size_t i = 0; i < count; ++i) std::printf(" %d", params[i]);
  std::puts(" (not sent on PS4)");
}

void keep_awake(bool enabled) {
  if (enabled) SDL_DisableScreenSaver();
  else SDL_EnableScreenSaver();
  std::printf("[power] keep awake %s\n", enabled ? "on" : "off");
}
} // namespace host

namespace {
SDL_AudioDeviceID audio_device = 0;

void render_audio(void* mixer, Uint8* stream, int bytes) {
  static_cast<hui::audio::Mixer*>(mixer)->render(reinterpret_cast<std::int16_t*>(stream), bytes / 4);
}
}

namespace host {
bool start_audio(hui::audio::Mixer& mixer) {
  SDL_AudioSpec want = {};
  want.freq = hui::audio::kSampleRate;
  want.format = AUDIO_S16SYS;
  want.channels = 2;
  want.samples = 256;
  want.callback = render_audio;
  want.userdata = &mixer;
  if (SDL_InitSubSystem(SDL_INIT_AUDIO) != 0 ||
      !(audio_device = SDL_OpenAudioDevice(nullptr, 0, &want, nullptr, 0))) {
    std::printf("[sound] no audio output: %s\n", SDL_GetError());
    return false;
  }
  SDL_PauseAudioDevice(audio_device, 0);
  return true;
}

void stop_audio() {
  SDL_CloseAudioDevice(audio_device);
  audio_device = 0;
  SDL_QuitSubSystem(SDL_INIT_AUDIO);
}

// HDMI passthrough is a PS5 payload; the PS4 build always decodes.
bool has_bitstream() { return false; }
bool open_bitstream(iec61937::Codec, BitstreamFill) { return false; }
void close_bitstream() {}
bool sink_edid(std::vector<std::uint8_t>&) { return false; }
} // namespace host

bool desktop_relaunch_requested() { return host::relaunch; }
