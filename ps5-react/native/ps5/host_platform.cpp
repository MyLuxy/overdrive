// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// PS5 side of the native API (host_api.hpp) through user-level libkernel and
// libSce* calls. None of these calls has been verified on hardware yet.

#include "host_api.hpp"
#include "async_log.hpp"
#include "host_platform.hpp"
#include "storage_stats.hpp"
#include "directory_records.hpp"
#include <vector>
#include "filesystem_access.hpp"
#include "platform/ps5/audio_out.hpp"
#include "platform/ps5/pad.hpp"
#include "platform/ps5/system.hpp"
#include <dirent.h>
#include <dlfcn.h>
#include <fcntl.h>
#include <sys/mount.h>
#include <cerrno>
#include <cstddef>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <iterator>

namespace {
// The firmware writes at most size bytes, so size must be set before the call.
struct SystemSwVersion {
  std::uint64_t size;
  char version_string[0x1c];
  std::uint32_t version;
};

struct LoginUserIdList {
  int user_id[4];
};

constexpr int kInvalidUserId = -1;
}

// libkernel's toast request, the one Spectrum and Orbit use; it needs no dlopen'd module.
struct NotifyRequest {
  char reserved[45];
  char message[3075];
};

extern "C" {
int scePadGetHandle(int user, int type, int index);
int scePadReadState(int handle, void* data);
int sceUserServiceGetInitialUser(int* user);
int sceKernelSendNotificationRequest(int device, NotifyRequest* request, std::size_t size, int blocking);
int sceKernelGetSystemSwVersion(SystemSwVersion* version);
int sceKernelGetCpuTemperature(int* temperature);
int sceKernelGetSocSensorTemperature(int sensor, int* temperature);
long sceKernelGetCpuFrequency(void);
int sceKernelAvailableFlexibleMemorySize(std::size_t* size);
std::uint64_t sceKernelGetProcessTime(void);
int sceUserServiceGetForegroundUser(int* user);
int sceUserServiceGetUserName(int user, char* name, std::size_t size);
int sceUserServiceGetLoginUserIdList(LoginUserIdList* list);
int sceSystemServiceLaunchWebBrowser(const char* uri, void* parameters);
int sceSystemServicePowerTick(void);
int sceSystemServiceParamGetInt(int param, int* value);
int sceKernelOpen(const char* path, int flags, int mode);
int sceKernelGetdents(int fd, char* buffer, int size);
int sceKernelClose(int fd);
// Native-title export, also used by BlackBearReloaded/ProsperoStore.
// fstatfs/statfs/getfsstat without the underscore belong to libkernel_sys.
int ps5_fstatfs(int fd, struct statfs* buffer) __asm__("_fstatfs");
}

namespace {
hui::ps5::Pad* active_pad = nullptr;
bool keeping_awake = false;
std::int64_t next_power_tick_us = 0;
// The idle timer before rest mode is minutes long at its shortest; a tick restarts it, like input.
constexpr std::int64_t kPowerTickIntervalUs = 30 * 1000000;

// Resolves a function from a module the title does not link, on first use. Only
// the modules the platform already needs are linked: a NEEDED module the title
// cannot load would stop it from starting, while a failed lookup here disables
// one call. The handle stays open for the title's lifetime.
template <typename Function>
class OptionalSymbol {
public:
  constexpr OptionalSymbol(const char* module, const char* name) : module_(module), name_(name) {}
  Function get() {
    if (!resolved_) {
      resolved_ = true;
      void* handle = dlopen(module_, RTLD_LAZY);
      void* symbol = handle ? dlsym(handle, name_) : nullptr;
      if (!symbol) async_log::write("[PS5-REACT] %s unavailable from %s", name_, module_);
      function_ = reinterpret_cast<Function>(symbol);
    }
    return function_;
  }

private:
  const char* module_;
  const char* name_;
  bool resolved_ = false;
  Function function_ = nullptr;
};

OptionalSymbol<int (*)(char*)> hw_model_name{"libkernel_sys.sprx", "sceKernelGetHwModelName"};

constexpr int kSystemParamLanguage = 1; // SCE_SYSTEM_SERVICE_PARAM_ID_LANG
// SCE_SYSTEM_PARAM_LANG_* values, indexed by ID.
constexpr const char* kLanguages[] = {
  "ja", "en-US", "fr", "es", "de", "it", "nl", "pt-PT", "ru", "ko", "zh-Hant", "zh-Hans", "fi", "sv", "da",
  "no", "pl", "pt-BR", "en-GB", "tr", "es-419", "ar", "fr-CA", "cs", "hu", "el", "ro", "th", "vi", "id", "uk",
};

bool user_name(int id, char* name, std::size_t size) {
  const int result = sceUserServiceGetUserName(id, name, size);
  if (result != 0) {
    async_log::write("[PS5-REACT] sceUserServiceGetUserName=0x%08x", static_cast<unsigned>(result));
    name[0] = '\0';
  }
  return result == 0;
}
}

void host_platform_set_pad(hui::ps5::Pad* pad) { active_pad = pad; }
void host_platform_prepare_filesystem_access() {
  hw_model_name.get();
}

namespace host {
const char* platform_name() { return "ps5"; }

// Preserve sandbox aliases, including after opt-in console access. Parent
// traversal remains refused before platform path mapping.
bool resolve_path(const char* path, char* out, std::size_t size) {
  if (path[0] != '/') return false;
  for (const char* part = path; part; part = std::strchr(part + 1, '/'))
    if (part[1] == '.' && part[2] == '.' && (part[3] == '/' || part[3] == '\0')) return false;
  return resolve_filesystem_path(path, out, size);
}

void trace(const char* call) { async_log::write("[PS5-REACT] native %s", call); }

// libkernel's sce* file calls return SCE_KERNEL_ERROR_* (0x8002xxxx, errno in the low bits).
bool sce_failed(int result) {
  if (result >= 0) return false;
  errno = static_cast<int>(static_cast<unsigned>(result) & 0xffffu);
  return true;
}

static_assert(sizeof(struct statfs) == 472 && STATFS_VERSION == 0x20030518);
static_assert(offsetof(struct statfs, f_bsize) == 16);
static_assert(offsetof(struct statfs, f_bavail) == 48);
static_assert(offsetof(struct statfs, f_fstypename) == 280);
static_assert(offsetof(struct statfs, f_mntfromname) == 296);
static_assert(offsetof(struct statfs, f_mntonname) == 384);
static_assert(offsetof(struct dirent, d_fileno) == 0 && offsetof(struct dirent, d_reclen) == 4);
static_assert(offsetof(struct dirent, d_namlen) == 7 && offsetof(struct dirent, d_name) == 8);

// The instruction entering the kernel is inside Sony's native libkernel, never
// in our title. Console-wide access is granted separately during startup.
bool filesystem_info(const char* path, struct statfs& info) {
  const int fd = sceKernelOpen(path, O_RDONLY | O_NONBLOCK, 0);
  if (sce_failed(fd)) return false;
  info = {};
  errno = 0;
  const int result = ps5_fstatfs(fd, &info);
  int error = errno;
  // _fstatfs is a POSIX wrapper. Preserve errno on -1; tolerate SCE-style
  // errors on firmware wrappers without turning -1 into errno 65535.
  if ((static_cast<unsigned>(result) & 0xffff0000u) == 0x80020000u)
    error = static_cast<int>(static_cast<unsigned>(result) & 0xffffu);
  if (result != 0 && error == 0) error = EIO;
  sceKernelClose(fd);
  if (result != 0) { errno = error; return false; }
  if (info.f_version != STATFS_VERSION) { errno = EIO; return false; }
  return true;
}

bool disk_usage(const char* real_path, double& total, double& free) {
  struct statfs info{};
  if (!filesystem_info(real_path, info)) return false;
  if (!storage::disk_bytes(info.f_bsize, info.f_blocks, info.f_bavail, total, free)) {
    errno = EIO;
    return false;
  }
  return true;
}

namespace {
struct MountDiscovery {
  MountEntry* entries;
  int capacity;
  int count = 0;
  int queries = 0;
  int last_error = EACCES;
  const char* parent = "/";

  void probe(const char* path) {
    if (count == capacity || queries++ >= 96) return;
    struct statfs info{};
    if (!filesystem_info(path, info)) { last_error = errno; return; }
    MountEntry entry{};
    std::snprintf(entry.device, sizeof entry.device, "%.*s",
                  static_cast<int>(sizeof info.f_mntfromname), info.f_mntfromname);
    std::snprintf(entry.path, sizeof entry.path, "%.*s",
                  static_cast<int>(sizeof info.f_mntonname), info.f_mntonname);
    std::snprintf(entry.type, sizeof entry.type, "%.*s",
                  static_cast<int>(sizeof info.f_fstypename), info.f_fstypename);
    // Return only kernel-provided mount records, never the candidate path as a
    // guessed mount. Some sandboxes conceal names even when capacity is visible.
    if (!*entry.path) { last_error = EACCES; return; }
    storage::append_unique(entries, capacity, count, entry);
  }
};

void probe_mount_child(const char* name, void* user) {
  auto& discovery = *static_cast<MountDiscovery*>(user);
  char path[512];
  const int length = std::snprintf(path, sizeof path, "%s%s%s", discovery.parent,
                                  std::strcmp(discovery.parent, "/") ? "/" : "", name);
  if (length >= 0 && static_cast<std::size_t>(length) < sizeof path) discovery.probe(path);
}
} // namespace

int list_mounts(MountEntry* mounts, int max) {
  if (max <= 0) return 0;
  MountDiscovery discovery{mounts, max < 64 ? max : 64};
  // Unlike a privileged payload's getmntinfo, a title discovers records through
  // accessible descriptors. Search one level only and bound the number of calls.
  for (const char* path : {"/app0", "/download0", "/temp0", "/", "/data", "/user",
                           "/system", "/system_ex", "/system_data", "/mnt",
                           "/mnt/ext0", "/mnt/ext1"}) discovery.probe(path);
  for (int slot = 0; slot < 8; ++slot) {
    char path[32];
    std::snprintf(path, sizeof path, "/mnt/usb%d", slot);
    discovery.probe(path);
  }
  for (const char* parent : {"/", "/mnt"}) {
    discovery.parent = parent;
    read_dir(parent, probe_mount_child, &discovery);
  }
  if (!discovery.count) { errno = discovery.last_error; return -1; }
  return discovery.count;
}

// sceKernelGetdents, as titles list directories; opendir from libSceLibcInternal
// fails with EPERM inside a title sandbox. The buffer holds a whole directory block: /data's are
// 64 KiB, and a smaller buffer fails there with EINVAL (the sandbox's own folders take 8 KiB).
bool read_dir(const char* real_path, void (*visit)(const char* name, void* user), void* user) {
  const int fd = sceKernelOpen(real_path, O_RDONLY | O_DIRECTORY, 0);
  if (sce_failed(fd)) return false;
  std::vector<char> buffer(64 * 1024);
  int read = 0;
  while (!sce_failed(read = sceKernelGetdents(fd, buffer.data(), buffer.size())) && read > 0) {
    if (read > static_cast<int>(buffer.size()) ||
        !visit_directory_records(buffer.data(), static_cast<std::size_t>(read), visit, user)) {
      errno = EIO;
      read = -1;
      break;
    }
  }
  const int saved = errno;
  sceKernelClose(fd);
  errno = saved;
  return read == 0;
}

void device_info(DeviceInfo& info) {
  if (const auto model_name = hw_model_name.get()) {
    char model[1024] = "";
    if (model_name(model) == 0) std::snprintf(info.model, sizeof info.model, "%s", model);
  }
  SystemSwVersion version{};
  version.size = sizeof version;
  const int version_result = sceKernelGetSystemSwVersion(&version);
  if (version_result == 0)
    std::snprintf(info.firmware, sizeof info.firmware, "%.*s",
                  static_cast<int>(sizeof version.version_string), version.version_string);
  // Once per launch: the raw answer, since what the title is told can differ from the version
  // System Software shows (a console showing 13.20 reported 13.59).
  static bool version_logged = false;
  if (!version_logged) {
    version_logged = true;
    async_log::write("[PS5-REACT] system software version=0x%08x string=\"%.*s\" result=0x%08x",
                     version.version, static_cast<int>(sizeof version.version_string), version.version_string,
                     static_cast<unsigned>(version_result));
  }
  int temperature = 0;
  if (sceKernelGetCpuTemperature(&temperature) == 0) info.cpu_temperature = temperature;
  if (sceKernelGetSocSensorTemperature(0, &temperature) == 0) info.soc_temperature = temperature;
  const long frequency = sceKernelGetCpuFrequency();
  if (frequency > 0) info.cpu_frequency = frequency;
  std::size_t free_memory = 0;
  if (sceKernelAvailableFlexibleMemorySize(&free_memory) == 0)
    info.free_memory = static_cast<std::int64_t>(free_memory);
  info.process_time = static_cast<std::int64_t>(sceKernelGetProcessTime());
  int language = -1;
  if (const int result = sceSystemServiceParamGetInt(kSystemParamLanguage, &language); result != 0)
    async_log::write("[PS5-REACT] sceSystemServiceParamGetInt=0x%08x", static_cast<unsigned>(result));
  else if (language >= 0 && language < static_cast<int>(std::size(kLanguages)))
    std::snprintf(info.language, sizeof info.language, "%s", kLanguages[language]);
}

// Pad::open() initializes the user service before the bundle runs.
bool foreground_user(User& user) {
  int id = kInvalidUserId;
  if (sceUserServiceGetForegroundUser(&id) != 0 || id == kInvalidUserId) return false;
  user.id = id;
  user_name(id, user.name, sizeof user.name);
  return true;
}

int logged_in_users(User* users, int max) {
  LoginUserIdList list{};
  if (sceUserServiceGetLoginUserIdList(&list) != 0) return 0;
  int count = 0;
  for (int id : list.user_id) {
    if (id == kInvalidUserId || count == max) continue;
    users[count].id = id;
    user_name(id, users[count].name, sizeof users[count].name);
    ++count;
  }
  return count;
}

bool notify(const char* message, const char* sub_message) {
  NotifyRequest request{};
  std::snprintf(request.message, sizeof request.message, *sub_message ? "%s\n%s" : "%s", message, sub_message);
  const int result = sceKernelSendNotificationRequest(0, &request, sizeof request, 0);
  if (result != 0) async_log::write("[PS5-REACT] sceKernelSendNotificationRequest=0x%08x", static_cast<unsigned>(result));
  return result == 0;
}

bool open_url(const char* url) {
  if (std::strncmp(url, "http://", 7) != 0 && std::strncmp(url, "https://", 8) != 0) return false;
  const int result = sceSystemServiceLaunchWebBrowser(url, nullptr);
  if (result != 0)
    async_log::write("[PS5-REACT] sceSystemServiceLaunchWebBrowser=0x%08x", static_cast<unsigned>(result));
  return result == 0;
}

void set_light_bar(std::uint8_t r, std::uint8_t g, std::uint8_t b) {
  if (active_pad) active_pad->set_light_bar(r, g, b);
}

// Pad caches the last colour, so the reset goes through it rather than
// scePadResetLightBar; the default is the first player's blue.
void reset_light_bar() { set_light_bar(0, 0, 255); }

void keep_awake(bool enabled) {
  keeping_awake = enabled;
  next_power_tick_us = 0;
}

void vibrate(float strength, float seconds) {
  if (!active_pad) return;
  // Pad::rumble ignores zero; a strength below 1/255 writes stopped motors and
  // still arms tick(), which clears it.
  if (strength <= 0.0f || seconds <= 0.0f) active_pad->rumble(0.001f, 0.001f);
  else active_pad->rumble(strength, seconds);
}

void set_trigger_effect(unsigned mask, int mode, const std::uint8_t* params, std::size_t count) {
  if (!active_pad) return;
  const int result = active_pad->set_trigger_effect(mask, static_cast<unsigned>(mode), params, count);
  // Each mode's first answer, and any change of answer, as hardware evidence without a line per call.
  static int reported[4] = {1, 1, 1, 1};
  if (reported[mode] == result) return;
  reported[mode] = result;
  async_log::write("[PS5-REACT] pad trigger effect mask=%u mode=%d [%d %d %d] -> 0x%08x", mask, mode,
                   count > 0 ? params[0] : 0, count > 1 ? params[1] : 0, count > 2 ? params[2] : 0,
                   static_cast<unsigned>(result));
}

namespace {
// ps5-homebrew-ui's output thread: the main 48 kHz stereo port, 256-frame grains.
hui::ps5::AudioOut audio_out;
}

bool start_audio(hui::audio::Mixer& mixer) { return audio_out.start(mixer); }

void stop_audio() { audio_out.stop(); }
} // namespace host

namespace {
// ScePadData (120 bytes): buttons, sticks, triggers, motion, then the touch data at 0x34, as on the
// PS4 and in the platform's RawPadSample, whose `connected` sits at 0x4c right after it.
struct PadState {
  std::uint8_t before_touch[0x34];
  std::uint8_t touches;
  std::uint8_t reserved0[3];
  std::uint32_t reserved1;
  struct { std::uint16_t x, y; std::uint8_t id, reserved[3]; } touch[2];
  std::uint8_t after_touch[120 - 0x4c];
};
static_assert(sizeof(PadState) == 120);
static_assert(offsetof(PadState, touch) == 0x3c);

// The DualSense reports 0..1919 across and 0..1079 down.
constexpr float kTouchWidth = 1919.0f, kTouchHeight = 1079.0f;
int touch_handle = -2; // -2 until looked up
bool touching = false;
std::uint16_t touch_from[2] = {}, touch_to[2] = {};
} // namespace

bool host_platform_read_touch(float* x, float* y) {
  if (!active_pad || !active_pad->is_open()) return false;
  if (touch_handle == -2) {
    int user = -1;
    sceUserServiceGetInitialUser(&user);
    // The handle Pad::open made: one standard pad per user.
    touch_handle = scePadGetHandle(user, 0, 0);
    async_log::write("[PS5-REACT] touchpad handle=%d", touch_handle);
  }
  PadState state{};
  if (touch_handle < 0 || scePadReadState(touch_handle, &state) < 0) return false;
  const bool down = state.touches > 0;
  const auto& finger = state.touch[0];
  // Where each touch starts and ends, to check the layout and the pad's range on a new console.
  if (down && !touching) {
    touch_from[0] = finger.x;
    touch_from[1] = finger.y;
  } else if (!down && touching) {
    async_log::write("[PS5-REACT] touch from %u,%u to %u,%u", touch_from[0], touch_from[1], touch_to[0], touch_to[1]);
  }
  if (down) {
    touch_to[0] = finger.x;
    touch_to[1] = finger.y;
  }
  touching = down;
  if (!down) return false;
  *x = finger.x / kTouchWidth;
  *y = finger.y / kTouchHeight;
  return true;
}

void host_platform_tick(std::int64_t now_us) {
  if (!keeping_awake || now_us < next_power_tick_us) return;
  next_power_tick_us = now_us + kPowerTickIntervalUs;
  if (const int result = sceSystemServicePowerTick(); result != 0)
    async_log::write("[PS5-REACT] sceSystemServicePowerTick=0x%08x", static_cast<unsigned>(result));
}
