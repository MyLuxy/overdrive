// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "audio_sink.hpp"
#include "host_platform.hpp"
#include "storage_stats.hpp"
#include "audio/mixer.hpp"

#include <dirent.h>
#include <spawn.h>
#include <sys/statvfs.h>
#include <sys/param.h>
#include <sys/resource.h>
#include <sys/wait.h>
#ifdef __APPLE__
#include <mach/mach.h>
#include <sys/mount.h>
#include <sys/sysctl.h>
#else
#include <mntent.h>
#include <sys/sysinfo.h>
#endif
#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>

extern char** environ;

namespace {
SDL_GameController* controller = nullptr;

void sysctl_string([[maybe_unused]] const char* name, char* out, [[maybe_unused]] std::size_t size) {
#ifdef __APPLE__
  if (sysctlbyname(name, out, &size, nullptr, 0) != 0) *out = '\0';
#else
  *out = '\0';
#endif
}

// "pt_BR.UTF-8" → "pt-BR"; the C and POSIX locales name no language.
void environment_language(char* out, std::size_t size) {
  const char* value = nullptr;
  for (const char* name : {"PS5_REACT_LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"})
    if ((value = std::getenv(name)) && *value) break;
  if (!value || !*value || !std::strcmp(value, "C") || !std::strncmp(value, "C.", 2) || !std::strcmp(value, "POSIX")) return;
  std::size_t length = std::strcspn(value, ".@");
  if (length >= size) length = size - 1;
  for (std::size_t i = 0; i < length; ++i) out[i] = value[i] == '_' ? '-' : value[i];
  out[length] = '\0';
}

std::int64_t free_memory() {
#ifndef __APPLE__
  struct sysinfo info;
  if (sysinfo(&info) != 0) return -1;
  return static_cast<std::int64_t>(info.freeram + info.bufferram) * static_cast<std::int64_t>(info.mem_unit);
#else
  vm_statistics64_data_t stats;
  mach_msg_type_number_t count = HOST_VM_INFO64_COUNT;
  vm_size_t page = 0;
  if (host_page_size(mach_host_self(), &page) != KERN_SUCCESS ||
      host_statistics64(mach_host_self(), HOST_VM_INFO64, reinterpret_cast<host_info64_t>(&stats), &count) != KERN_SUCCESS)
    return -1;
  return static_cast<std::int64_t>(stats.free_count + stats.inactive_count) * static_cast<std::int64_t>(page);
#endif
}
} // namespace

void desktop_set_controller(SDL_GameController* value) {
  controller = value;
}

namespace host {
const char* platform_name() {
  return "desktop";
}

bool relaunch = false;

bool arrange_relaunch(char*, std::size_t) {
  relaunch = true;
  return true;
}

int list_mounts(MountEntry* mounts, int max) {
#ifndef __APPLE__
  FILE* table = setmntent("/proc/self/mounts", "r");
  if (!table) return -1;
  int used = 0;
  while (used < max) {
    const mntent* entry = getmntent(table);
    if (!entry) break;
    std::snprintf(mounts[used].device, sizeof mounts[used].device, "%s", entry->mnt_fsname);
    std::snprintf(mounts[used].path, sizeof mounts[used].path, "%s", entry->mnt_dir);
    std::snprintf(mounts[used].type, sizeof mounts[used].type, "%s", entry->mnt_type);
    ++used;
  }
  endmntent(table);
  return used;
#else
  struct statfs* found = nullptr;
  const int count = getmntinfo(&found, MNT_NOWAIT);
  if (count <= 0) return -1;
  const int used = count < max ? count : max;
  for (int i = 0; i < used; ++i) {
    std::snprintf(mounts[i].device, sizeof mounts[i].device, "%s", found[i].f_mntfromname);
    std::snprintf(mounts[i].path, sizeof mounts[i].path, "%s", found[i].f_mntonname);
    std::snprintf(mounts[i].type, sizeof mounts[i].type, "%s", found[i].f_fstypename);
  }
  return used;
#endif
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
  const char* root = std::getenv("PS5_REACT_SANDBOX");
  if (!root || !*root) root = "./sandbox";
  const int written = std::snprintf(out, size, "%s%s", root, length == 1 ? "" : path);
  return written >= 0 && static_cast<std::size_t>(written) < size;
}

void device_info(DeviceInfo& info) {
  char model[48];
  sysctl_string("hw.model", model, sizeof model);
  std::snprintf(info.model, sizeof info.model, "Desktop preview%s%s%s", *model ? " (" : "", model, *model ? ")" : "");
  char version[24];
  sysctl_string("kern.osproductversion", version, sizeof version);
  if (*version) std::snprintf(info.firmware, sizeof info.firmware, "macOS %s", version);
#ifdef __APPLE__
  std::uint64_t frequency = 0;
  std::size_t size = sizeof frequency;
  // Apple silicon does not publish a CPU frequency; it stays unknown there.
  if (sysctlbyname("hw.cpufrequency", &frequency, &size, nullptr, 0) == 0)
    info.cpu_frequency = static_cast<std::int64_t>(frequency);
#endif
  info.free_memory = free_memory();
  rusage usage;
  if (getrusage(RUSAGE_SELF, &usage) == 0)
    info.process_time = (static_cast<std::int64_t>(usage.ru_utime.tv_sec) + usage.ru_stime.tv_sec) * 1000000 +
                        usage.ru_utime.tv_usec + usage.ru_stime.tv_usec;
  environment_language(info.language, sizeof info.language);
}

bool foreground_user(User& user) {
  const char* name = std::getenv("USER");
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

bool open_url(const char* url) {
  if (std::strncmp(url, "http://", 7) && std::strncmp(url, "https://", 8)) return false;
#ifdef __APPLE__
  char open[] = "open";
#else
  char open[] = "xdg-open";
#endif
  char* argv[] = {open, const_cast<char*>(url), nullptr};
  pid_t pid = 0;
  if (posix_spawnp(&pid, open, nullptr, nullptr, argv, environ) != 0) return false;
  int status = 0;
  // `open` hands the URL to Launch Services and exits at once.
  return waitpid(pid, &status, 0) == pid && WIFEXITED(status) && WEXITSTATUS(status) == 0;
}

void set_light_bar(std::uint8_t r, std::uint8_t g, std::uint8_t b) {
  if (!controller || SDL_GameControllerSetLED(controller, r, g, b) != 0)
    std::printf("[pad] light bar %u,%u,%u (no controller LED)\n", r, g, b);
}

void reset_light_bar() {
  // SDL has no reset; restore the DualSense player-one blue.
  if (!controller || SDL_GameControllerSetLED(controller, 0, 0, 64) != 0)
    std::puts("[pad] light bar reset (no controller LED)");
}

void vibrate(float strength, float seconds) {
  const auto level = static_cast<Uint16>(strength * 0xffff);
  if (!controller || SDL_GameControllerRumble(controller, level, level, static_cast<Uint32>(seconds * 1000)) != 0)
    std::printf("[pad] vibrate %.2f for %.2fs (no controller rumble)\n", strength, seconds);
}
// SDL2 can send DualSense trigger effects only as raw report bytes; the preview logs the request instead.
void set_trigger_effect(unsigned mask, int mode, const std::uint8_t* params, std::size_t count) {
  static constexpr const char* kModes[] = {"off", "feedback", "weapon", "vibration"};
  std::printf("[pad] trigger effect mask=%u %s", mask, kModes[mode]);
  for (std::size_t i = 0; i < count; ++i) std::printf(" %d", params[i]);
  std::puts(" (not sent on desktop)");
}
// SDL keeps the display awake while a window is open; keepAwake(false) lets it sleep.
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
// SDL_AUDIODRIVER=dummy keeps the preview silent (the self-test sets it).
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

// The preview has no HDMI sink to read or to send a bitstream to: video audio is always decoded.
bool has_bitstream() { return false; }
bool open_bitstream(iec61937::Codec, BitstreamFill) { return false; }
void close_bitstream() {}
bool sink_edid(std::vector<std::uint8_t>&) { return false; }
} // namespace host

bool desktop_relaunch_requested() { return host::relaunch; }
