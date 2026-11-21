// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "app_config.hpp"
#include "removals.hpp"
#include "text_shaper.hpp"

extern "C" {
#include "er_runtime.h"
}
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <cerrno>
#include <cstdio>
#include <climits>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <iterator>
#include <string>
#include <utility>
#include <vector>

std::atomic<const char*> host::current_call{nullptr};

namespace {
bool exit_requested = false;
int refresh_rate = PS5_REACT_REFRESH_RATE, refresh_request = 0;
GamepadState gamepad;

// A JS path argument and its platform path; frees the JS string on scope exit.
class Path {
public:
  Path(JSContext* ctx, JSValueConst value) : ctx_(ctx), app_(JS_ToCString(ctx, value)) {
    resolved_ = app_ && host::resolve_path(app_, real_, sizeof real_);
  }
  ~Path() { if (app_) JS_FreeCString(ctx_, app_); }
  Path(const Path&) = delete;
  Path& operator=(const Path&) = delete;

  explicit operator bool() const { return resolved_; }
  const char* app() const { return app_; }
  const char* real() const { return real_; }

  // Call immediately after the failing operation so errno still describes it.
  JSValue error(const char* call) const {
    if (!app_) return JS_EXCEPTION;
    if (!resolved_) return JS_ThrowPlainError(ctx_, "%s %s: Path is not allowed", call, app_);
    return JS_ThrowPlainError(ctx_, "%s %s: %s", call, app_, std::strerror(errno));
  }

private:
  JSContext* ctx_;
  const char* app_;
  char real_[PATH_MAX] = "";
  bool resolved_ = false;
};

double modified_ms(const struct stat& st) {
#ifdef __APPLE__
  const timespec& t = st.st_mtimespec;
#else
  const timespec& t = st.st_mtim;
#endif
  return static_cast<double>(t.tv_sec) * 1000.0 + static_cast<double>(t.tv_nsec / 1000000);
}

const char* base_name(const char* path) {
  const char* slash = std::strrchr(path, '/');
  return slash && slash[1] ? slash + 1 : path;
}

JSValue entry(JSContext* ctx, const char* name, const struct stat& st) {
  JSValue object = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, object, "name", JS_NewString(ctx, name));
  JS_SetPropertyStr(ctx, object, "isDirectory", JS_NewBool(ctx, S_ISDIR(st.st_mode)));
  JS_SetPropertyStr(ctx, object, "isFile", JS_NewBool(ctx, S_ISREG(st.st_mode)));
  JS_SetPropertyStr(ctx, object, "size", JS_NewInt64(ctx, st.st_size));
  JS_SetPropertyStr(ctx, object, "modified", JS_NewFloat64(ctx, modified_ms(st)));
  JS_SetPropertyStr(ctx, object, "device", JS_NewString(ctx, std::to_string(st.st_dev).c_str()));
  JS_SetPropertyStr(ctx, object, "inode", JS_NewString(ctx, std::to_string(st.st_ino).c_str()));
  return object;
}

struct Listing {
  JSContext* ctx;
  const char* directory;
  JSValue list;
  std::uint32_t count;
};

void add_entry(const char* name, void* user) {
  Listing& listing = *static_cast<Listing*>(user);
  char child[PATH_MAX];
  struct stat st;
  if (std::snprintf(child, sizeof child, "%s/%s", listing.directory, name) >= static_cast<int>(sizeof child)) return;
  // Fall back to the link itself so a dangling symlink is still listed.
  if (stat(child, &st) != 0 && lstat(child, &st) != 0) return;
  JS_SetPropertyUint32(listing.ctx, listing.list, listing.count++, entry(listing.ctx, name, st));
}

JSValue fs_read_dir(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  if (!path) return path.error("fs.readDir");
  Listing listing{ctx, path.real(), JS_NewArray(ctx), 0};
  if (!host::read_dir(path.real(), add_entry, &listing)) {
    JS_FreeValue(ctx, listing.list);
    return path.error("fs.readDir");
  }
  return listing.list;
}

JSValue fs_stat(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  struct stat st;
  if (!path || stat(path.real(), &st) != 0)
    return path && errno == ENOENT ? JS_NULL : path.error("fs.stat");
  return entry(ctx, base_name(path.app()), st);
}

JSValue fs_read_file(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  const int fd = path ? open(path.real(), O_RDONLY) : -1;
  if (fd < 0) return path.error("fs.readFile");
  struct stat st;
  if (fstat(fd, &st) != 0) {
    const JSValue error = path.error("fs.readFile");
    close(fd);
    return error;
  }
  if (st.st_size > static_cast<off_t>(kMaxReadBytes)) {
    close(fd);
    return JS_ThrowPlainError(ctx, "fs.readFile %s: File is larger than %zu bytes", path.app(), kMaxReadBytes);
  }
  // Size from fstat is only a hint; special files report 0, so read until EOF within the cap. The
  // buffer starts at the reported size, so reading a small file does not take the cap from the heap.
  std::size_t capacity = st.st_size > 0 ? static_cast<std::size_t>(st.st_size) + 1 : kMaxReadBytes + 1;
  char* buffer = static_cast<char*>(std::malloc(capacity));
  std::size_t length = 0;
  ssize_t count = 0;
  while (buffer && length <= kMaxReadBytes && (count = read(fd, buffer + length, capacity - length)) > 0) {
    length += static_cast<std::size_t>(count);
    if (length == capacity && capacity <= kMaxReadBytes) {
      char* grown = static_cast<char*>(std::realloc(buffer, kMaxReadBytes + 1));
      if (!grown) std::free(buffer);
      buffer = grown;
      capacity = kMaxReadBytes + 1;
    }
  }
  if (!buffer) {
    close(fd);
    return JS_ThrowOutOfMemory(ctx);
  }
  JSValue result;
  if (count < 0) result = path.error("fs.readFile");
  else if (length > kMaxReadBytes)
    result = JS_ThrowPlainError(ctx, "fs.readFile %s: File is larger than %zu bytes", path.app(), kMaxReadBytes);
  else result = JS_NewStringLen(ctx, buffer, length);
  std::free(buffer);
  close(fd);
  return result;
}

JSValue fs_write_file(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  if (!path) return path.error("fs.writeFile");
  std::size_t length = 0;
  const char* text = JS_ToCStringLen(ctx, &length, argv[1]);
  if (!text) return JS_EXCEPTION;
  const int append = JS_ToBool(ctx, argv[2]);
  // A state file saved then renamed over the old one must reach the disk first, or a power cut or
  // forced close right after can leave it empty under its final name.
  const int sync = JS_ToBool(ctx, argv[3]);
  const int fd = open(path.real(), O_WRONLY | O_CREAT | (append > 0 ? O_APPEND : O_TRUNC), 0644);
  bool ok = fd >= 0;
  for (std::size_t written = 0; ok && written < length;) {
    const ssize_t count = write(fd, text + written, length - written);
    ok = count > 0 || (count < 0 && errno == EINTR);
    if (count > 0) written += static_cast<std::size_t>(count);
  }
  JS_FreeCString(ctx, text);
  if (ok && sync > 0) ok = fsync(fd) == 0;
  JSValue result = ok ? JS_UNDEFINED : path.error("fs.writeFile");
  if (fd >= 0 && close(fd) != 0 && ok) result = path.error("fs.writeFile");
  return result;
}

bool make_directories(char* path) {
  for (char* slash = std::strchr(path + 1, '/'); slash; slash = std::strchr(slash + 1, '/')) {
    *slash = '\0';
    const bool ok = mkdir(path, 0755) == 0 || errno == EEXIST;
    *slash = '/';
    if (!ok) return false;
  }
  struct stat st;
  if (mkdir(path, 0755) == 0) return true;
  if (errno != EEXIST || stat(path, &st) != 0) return false;
  errno = ENOTDIR;
  return S_ISDIR(st.st_mode);
}

JSValue fs_mkdir(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  if (!path) return path.error("fs.mkdir");
  char real[PATH_MAX];
  std::strcpy(real, path.real());
  const bool ok = JS_ToBool(ctx, argv[1]) > 0 ? make_directories(real) : mkdir(real, 0755) == 0;
  return ok ? JS_UNDEFINED : path.error("fs.mkdir");
}

JSValue fs_remove(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  struct stat st;
  if (!path || lstat(path.real(), &st) != 0) return path.error("fs.remove");
  const int status = S_ISDIR(st.st_mode) ? rmdir(path.real()) : unlink(path.real());
  return status == 0 ? JS_UNDEFINED : path.error("fs.remove");
}

JSValue fs_remove_tree(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  if (!path || !removals::remove_tree(path.real(), false)) return path.error("fs.removeTree");
  return JS_UNDEFINED;
}

JSValue fs_remove_async(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  if (!path) return path.error("fs.removeAsync");
  std::string error;
  const auto id = removals::start(path.real(), error);
  if (!id) return JS_ThrowPlainError(ctx, "fs.removeAsync %s: %s", path.app(), error.c_str());
  return JS_NewUint32(ctx, id);
}

JSValue removals_poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (const auto& snapshot : removals::poll()) {
    JSValue item = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, item, "id", JS_NewUint32(ctx, snapshot.id));
    JS_SetPropertyStr(ctx, item, "state", JS_NewString(ctx, snapshot.state.c_str()));
    JS_SetPropertyStr(ctx, item, "error", JS_NewString(ctx, snapshot.error.c_str()));
    JS_SetPropertyUint32(ctx, out, index++, item);
  }
  return out;
}

JSValue fs_rename(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path from(ctx, argv[0]);
  if (!from) return from.error("fs.rename");
  Path to(ctx, argv[1]);
  if (!to) return to.error("fs.rename");
  if (rename(from.real(), to.real()) == 0) return JS_UNDEFINED;
  return JS_ThrowPlainError(ctx, "fs.rename %s -> %s: %s", from.app(), to.app(), std::strerror(errno));
}

// Bytes, not text: a file beside the app such as a title's sce_sys art. Written beside the target and
// renamed over it, so a reader never sees half a file.
JSValue fs_copy_file(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path from(ctx, argv[0]);
  if (!from) return from.error("fs.copyFile");
  Path to(ctx, argv[1]);
  if (!to) return to.error("fs.copyFile");
  const std::string temporary = std::string(to.real()) + ".copying";
  const int in = open(from.real(), O_RDONLY);
  if (in < 0) return from.error("fs.copyFile");
  const int out = open(temporary.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0644);
  if (out < 0) {
    close(in);
    return to.error("fs.copyFile");
  }
  char buffer[64 * 1024];
  bool ok = true;
  for (ssize_t count; ok && (count = read(in, buffer, sizeof buffer)) != 0;) {
    if (count < 0) {
      ok = errno == EINTR;
      continue;
    }
    for (ssize_t written = 0; ok && written < count;) {
      const ssize_t step = write(out, buffer + written, static_cast<std::size_t>(count - written));
      ok = step > 0 || (step < 0 && errno == EINTR);
      if (step > 0) written += step;
    }
  }
  const int error = errno;
  close(in);
  ok = ok && fchmod(out, 0644) == 0 && fsync(out) == 0;
  ok = close(out) == 0 && ok;
  if (ok && rename(temporary.c_str(), to.real()) == 0) return JS_UNDEFINED;
  const int failed = ok ? errno : error;
  unlink(temporary.c_str());
  return JS_ThrowPlainError(ctx, "fs.copyFile %s -> %s: %s", from.app(), to.app(), std::strerror(failed));
}

JSValue fs_chmod(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  if (!path) return path.error("fs.chmod");
  std::uint32_t mode = 0;
  if (JS_ToUint32(ctx, &mode, argv[1]) || mode > 07777) return JS_ThrowTypeError(ctx, "fs.chmod: mode must be 0 to 0o7777");
  if (chmod(path.real(), static_cast<mode_t>(mode)) == 0) return JS_UNDEFINED;
  return JS_ThrowPlainError(ctx, "fs.chmod %s: %s", path.app(), std::strerror(errno));
}

JSValue mount_object(JSContext* ctx, const char* device, const char* path, const char* type) {
  JSValue mount = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, mount, "device", JS_NewString(ctx, device));
  JS_SetPropertyStr(ctx, mount, "path", JS_NewString(ctx, path));
  JS_SetPropertyStr(ctx, mount, "type", JS_NewString(ctx, type));
  return mount;
}

JSValue fs_mounts(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  static host::MountEntry mounts[64];
  const int count = host::list_mounts(mounts, static_cast<int>(std::size(mounts)));
  if (count < 0) return JS_ThrowPlainError(ctx, "fs.mounts: %s", std::strerror(errno));
  JSValue list = JS_NewArray(ctx);
  for (int i = 0; i < count; ++i)
    JS_SetPropertyUint32(ctx, list, static_cast<std::uint32_t>(i),
                         mount_object(ctx, mounts[i].device, mounts[i].path, mounts[i].type));
  return list;
}

JSValue fs_disk_usage(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  Path path(ctx, argv[0]);
  double total = 0, free = 0;
  if (!path || !host::disk_usage(path.real(), total, free)) return path.error("fs.diskUsage");
  JSValue usage = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, usage, "total", JS_NewFloat64(ctx, total));
  JS_SetPropertyStr(ctx, usage, "free", JS_NewFloat64(ctx, free));
  return usage;
}

JSValue known(JSContext* ctx, std::int64_t value) {
  return value < 0 ? JS_NULL : JS_NewInt64(ctx, value);
}

JSValue known(JSContext* ctx, const char* value) {
  return *value ? JS_NewString(ctx, value) : JS_NULL;
}

JSValue device_info(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  host::DeviceInfo info;
  host::device_info(info);
  JSValue object = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, object, "model", known(ctx, info.model));
  JS_SetPropertyStr(ctx, object, "firmware", known(ctx, info.firmware));
  JS_SetPropertyStr(ctx, object, "cpuTemperature", known(ctx, info.cpu_temperature));
  JS_SetPropertyStr(ctx, object, "socTemperature", known(ctx, info.soc_temperature));
  JS_SetPropertyStr(ctx, object, "cpuFrequency", known(ctx, info.cpu_frequency));
  JS_SetPropertyStr(ctx, object, "freeMemory", known(ctx, info.free_memory));
  JS_SetPropertyStr(ctx, object, "processTime", known(ctx, info.process_time));
  JS_SetPropertyStr(ctx, object, "language", known(ctx, info.language));
  return object;
}

long long days_from_civil(long long y, int m, int d) {
  y -= m <= 2;
  const long long era = (y >= 0 ? y : y - 399) / 400, yoe = y - era * 400;
  const long long doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
  return era * 146097 + yoe * 365 + yoe / 4 - yoe / 100 + doy - 719468;
}

// Minutes east of UTC at an instant: localtime's calendar fields less the instant itself. Not
// tm_gmtoff: the PS5's libc leaves it 0 while the fields carry the console's time zone.
JSValue device_utc_offset(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  double ms = 0;
  if (JS_ToFloat64(ctx, &ms, argv[0]) || !std::isfinite(ms)) {
    return JS_ThrowTypeError(ctx, "device.utcOffset: time must be milliseconds since the epoch");
  }
  const time_t seconds = static_cast<time_t>(std::floor(ms / 1000));
  tm local = {};
  if (!localtime_r(&seconds, &local)) return JS_ThrowInternalError(ctx, "device.utcOffset: %s", strerror(errno));
  const long long fields = days_from_civil(local.tm_year + 1900LL, local.tm_mon + 1, local.tm_mday) * 86400
    + local.tm_hour * 3600 + local.tm_min * 60 + local.tm_sec;
  return JS_NewInt32(ctx, static_cast<int>((fields - seconds) / 60));
}

JSValue user_object(JSContext* ctx, const host::User& user) {
  JSValue object = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, object, "id", JS_NewInt32(ctx, user.id));
  JS_SetPropertyStr(ctx, object, "name", JS_NewString(ctx, user.name));
  return object;
}

JSValue users_foreground(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  host::User user;
  return host::foreground_user(user) ? user_object(ctx, user) : JS_NULL;
}

JSValue users_logged_in(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  host::User users[16];
  const int count = host::logged_in_users(users, 16);
  JSValue list = JS_NewArray(ctx);
  for (int i = 0; i < count; ++i)
    JS_SetPropertyUint32(ctx, list, static_cast<std::uint32_t>(i), user_object(ctx, users[i]));
  return list;
}

JSValue notify(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  const char* message = JS_ToCString(ctx, argv[0]);
  if (!message) return JS_EXCEPTION;
  const bool has_sub = !JS_IsUndefined(argv[1]) && !JS_IsNull(argv[1]);
  const char* sub = has_sub ? JS_ToCString(ctx, argv[1]) : nullptr;
  if (has_sub && !sub) {
    JS_FreeCString(ctx, message);
    return JS_EXCEPTION;
  }
  const bool ok = host::notify(message, sub ? sub : "");
  if (sub) JS_FreeCString(ctx, sub);
  JS_FreeCString(ctx, message);
  return JS_NewBool(ctx, ok);
}

JSValue open_url(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  const char* url = JS_ToCString(ctx, argv[0]);
  if (!url) return JS_EXCEPTION;
  const bool ok = host::open_url(url);
  JS_FreeCString(ctx, url);
  return JS_NewBool(ctx, ok);
}

JSValue pad_set_light_bar(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  std::uint8_t rgb[3];
  for (int i = 0; i < 3; ++i) {
    std::int32_t value = 0;
    if (JS_ToInt32(ctx, &value, argv[i])) return JS_EXCEPTION;
    rgb[i] = static_cast<std::uint8_t>(value < 0 ? 0 : value > 255 ? 255 : value);
  }
  host::set_light_bar(rgb[0], rgb[1], rgb[2]);
  return JS_UNDEFINED;
}

JSValue pad_reset_light_bar(JSContext*, JSValueConst, int, JSValueConst*) {
  host::reset_light_bar();
  return JS_UNDEFINED;
}

JSValue pad_set_trigger_effect(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  std::int32_t mask = 0, mode = 0, a = 0, b = 0, c = 0;
  if (JS_ToInt32(ctx, &mask, argv[0]) || JS_ToInt32(ctx, &mode, argv[1]))
    return JS_EXCEPTION;
  if (mask < 1 || mask > 3) return JS_ThrowRangeError(ctx, "pad.setTriggerEffect: mask 1-3; got %d", mask);
  // Off takes no parameters; the other modes take two or three bytes.
  const int count = mode == 0 ? 0 : mode == 1 ? 2 : 3;
  if (count && (JS_ToInt32(ctx, &a, argv[2]) || JS_ToInt32(ctx, &b, argv[3]) || (count == 3 && JS_ToInt32(ctx, &c, argv[4]))))
    return JS_EXCEPTION;
  switch (mode) {
    case 0: break;
    case 1:
      if (a < 0 || a > 9 || b < 1 || b > 8)
        return JS_ThrowRangeError(ctx, "pad.setTriggerEffect: feedback position 0-9, strength 1-8; got %d, %d", a, b);
      break;
    case 2:
      if (a < 2 || a > 7 || b <= a || b > 8 || c < 1 || c > 8)
        return JS_ThrowRangeError(ctx, "pad.setTriggerEffect: weapon start 2-7, end start+1-8, strength 1-8; got %d, %d, %d",
                                  a, b, c);
      break;
    case 3:
      if (a < 0 || a > 9 || b < 1 || b > 8 || c < 1 || c > 255)
        return JS_ThrowRangeError(ctx, "pad.setTriggerEffect: vibration position 0-9, amplitude 1-8, frequency 1-255; got %d, %d, %d",
                                  a, b, c);
      break;
    default: return JS_ThrowRangeError(ctx, "pad.setTriggerEffect: mode 0 off, 1 feedback, 2 weapon or 3 vibration; got %d", mode);
  }
  const std::uint8_t params[] = {static_cast<std::uint8_t>(a), static_cast<std::uint8_t>(b), static_cast<std::uint8_t>(c)};
  host::set_trigger_effect(static_cast<unsigned>(mask), mode, params, static_cast<std::size_t>(count));
  return JS_UNDEFINED;
}

JSValue pad_vibrate(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  double strength = 0, seconds = 0;
  if (JS_ToFloat64(ctx, &strength, argv[0]) || JS_ToFloat64(ctx, &seconds, argv[1])) return JS_EXCEPTION;
  // Comparisons are written so NaN collapses to zero.
  strength = strength > 0 ? (strength < 1 ? strength : 1) : 0;
  host::vibrate(static_cast<float>(strength), static_cast<float>(seconds > 0 ? seconds : 0));
  return JS_UNDEFINED;
}

JSValue power_keep_awake(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  host::keep_awake(JS_ToBool(ctx, argv[0]) > 0);
  return JS_UNDEFINED;
}

JSValue display_refresh_rate(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  return JS_NewInt32(ctx, refresh_rate);
}

JSValue display_set_refresh_rate(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  std::int32_t hz = 0;
  if (JS_ToInt32(ctx, &hz, argv[0])) return JS_EXCEPTION;
  const int bit = hz == 60 ? 1 : hz == 120 ? 2 : 0;
  if (!bit) return JS_ThrowRangeError(ctx, "display.setRefreshRate: 60 or 120 Hz; got %d", hz);
  if (!(PS5_REACT_REFRESH_RATES & bit))
    return JS_ThrowTypeError(ctx, "display.setRefreshRate: %d Hz is not in app.json \"refreshRates\"", hz);
  // Asking for the current rate cancels a switch that has not happened yet.
  refresh_request = hz == refresh_rate ? 0 : hz;
  return JS_UNDEFINED;
}

JSValue text_set_language(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  const char* tag = JS_ToCString(ctx, argv[0]);
  if (!tag) return JS_EXCEPTION;
  text_shaper::set_language(tag);
  JS_FreeCString(ctx, tag);
  return JS_UNDEFINED;
}

JSValue pad_state(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue state = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, state, "connected", JS_NewBool(ctx, gamepad.connected));
  JS_SetPropertyStr(ctx, state, "leftX", JS_NewFloat64(ctx, gamepad.left_x));
  JS_SetPropertyStr(ctx, state, "leftY", JS_NewFloat64(ctx, gamepad.left_y));
  JS_SetPropertyStr(ctx, state, "rightX", JS_NewFloat64(ctx, gamepad.right_x));
  JS_SetPropertyStr(ctx, state, "rightY", JS_NewFloat64(ctx, gamepad.right_y));
  JS_SetPropertyStr(ctx, state, "l2", JS_NewFloat64(ctx, gamepad.l2));
  JS_SetPropertyStr(ctx, state, "r2", JS_NewFloat64(ctx, gamepad.r2));
  JSValue buttons = JS_NewArray(ctx);
  std::uint32_t count = 0;
  for (std::uint32_t i = 0; i < sizeof kButtonNames / sizeof *kButtonNames; ++i)
    if (gamepad.buttons & (1u << i)) JS_SetPropertyUint32(ctx, buttons, count++, JS_NewString(ctx, kButtonNames[i]));
  JS_SetPropertyStr(ctx, state, "buttons", buttons);
  return state;
}

JSValue request_exit(JSContext* ctx, JSValueConst, int, JSValueConst* argv) {
  exit_requested = true;
  if (!JS_ToBool(ctx, argv[0])) return JS_UNDEFINED;
  char error[256] = "";
  return host::arrange_relaunch(error, sizeof error) ? JS_TRUE : JS_NewString(ctx, error);
}

struct Function {
  const char* name;
  JSCFunction* call;
  int length; // QuickJS pads missing arguments with undefined up to this count.
};

// Every native call goes through `traced`, which reports its first use to host::trace:
// a native fault on the console then leaves the name of the call that caused it.
struct Traced {
  const Function* function;
  char name[64];
  bool reported;
};
Traced g_traced[64];
int g_traced_count = 0;

JSValue traced(JSContext* ctx, JSValueConst self, int argc, JSValueConst* argv, int index, JSValue*) {
  Traced& entry = g_traced[index];
  if (!entry.reported) {
    entry.reported = true;
    host::trace(entry.name);
  }
  host::CallScope scope(entry.name);
  return entry.function->call(ctx, self, argc, argv);
}

template <std::size_t N>
JSValue namespace_object(JSContext* ctx, const char* space, const Function (&functions)[N]) {
  JSValue object = JS_NewObject(ctx);
  for (const Function& function : functions) {
    int index = 0;
    while (index < g_traced_count && g_traced[index].function != &function) ++index;
    if (index == g_traced_count) {
      Traced& entry = g_traced[g_traced_count++];
      entry.function = &function;
      std::snprintf(entry.name, sizeof entry.name, "%s%s%s", space, *space ? "." : "", function.name);
    }
    JS_SetPropertyStr(ctx, object, function.name,
                      JS_NewCFunctionData(ctx, traced, function.length, index, 0, nullptr));
  }
  return object;
}

constexpr Function kFs[] = {
  {"readDir", fs_read_dir, 1}, {"stat", fs_stat, 1}, {"readFile", fs_read_file, 1},
  {"writeFile", fs_write_file, 4}, {"mkdir", fs_mkdir, 2}, {"remove", fs_remove, 1},
  {"removeTree", fs_remove_tree, 1}, {"removeAsync", fs_remove_async, 1},
  {"rename", fs_rename, 2}, {"copyFile", fs_copy_file, 2}, {"chmod", fs_chmod, 2}, {"mounts", fs_mounts, 0}, {"diskUsage", fs_disk_usage, 1},
};
constexpr Function kRemovals[] = {{"poll", removals_poll, 0}};
constexpr Function kDevice[] = {{"info", device_info, 0}, {"utcOffset", device_utc_offset, 1}};
constexpr Function kUsers[] = {{"foreground", users_foreground, 0}, {"loggedIn", users_logged_in, 0}};
constexpr Function kPad[] = {
  {"setLightBar", pad_set_light_bar, 3}, {"resetLightBar", pad_reset_light_bar, 0},
  {"vibrate", pad_vibrate, 2}, {"setTriggerEffect", pad_set_trigger_effect, 5},
  {"state", pad_state, 0},
};
constexpr Function kPower[] = {{"keepAwake", power_keep_awake, 1}};
constexpr Function kDisplay[] = {{"refreshRate", display_refresh_rate, 0}, {"setRefreshRate", display_set_refresh_rate, 1}};
constexpr Function kText[] = {{"setLanguage", text_set_language, 1}};
constexpr Function kRoot[] = {{"notify", notify, 2}, {"openURL", open_url, 1}, {"exit", request_exit, 1}};
} // namespace

void ps5_react_install_host_api(JSContext* ctx) {
  timespec now = {};
  clock_gettime(CLOCK_REALTIME, &now);
  er_runtime_set_wall_clock(static_cast<std::int64_t>(now.tv_sec) * 1000 + now.tv_nsec / 1000000);

  JSValue api = namespace_object(ctx, "", kRoot);
  JS_SetPropertyStr(ctx, api, "platform", JS_NewString(ctx, host::platform_name()));
  JS_SetPropertyStr(ctx, api, "fs", namespace_object(ctx, "fs", kFs));
  JS_SetPropertyStr(ctx, api, "removals", namespace_object(ctx, "removals", kRemovals));
  JS_SetPropertyStr(ctx, api, "device", namespace_object(ctx, "device", kDevice));
  JS_SetPropertyStr(ctx, api, "users", namespace_object(ctx, "users", kUsers));
  JS_SetPropertyStr(ctx, api, "pad", namespace_object(ctx, "pad", kPad));
  JS_SetPropertyStr(ctx, api, "power", namespace_object(ctx, "power", kPower));
  JS_SetPropertyStr(ctx, api, "display", namespace_object(ctx, "display", kDisplay));
  JS_SetPropertyStr(ctx, api, "text", namespace_object(ctx, "text", kText));
  JS_SetPropertyStr(ctx, api, "network", ps5_react_network_api(ctx));
  JS_SetPropertyStr(ctx, api, "archives", ps5_react_archive_api(ctx));
  JS_SetPropertyStr(ctx, api, "inspections", ps5_react_inspection_api(ctx));
  JS_SetPropertyStr(ctx, api, "packages", ps5_react_package_api(ctx));
  JS_SetPropertyStr(ctx, api, "browser", ps5_react_browser_capture_api(ctx));
  JS_SetPropertyStr(ctx, api, "lan", ps5_react_lan_api(ctx));
  JS_SetPropertyStr(ctx, api, "video", ps5_react_video_api(ctx));
  JS_SetPropertyStr(ctx, api, "image", ps5_react_image_api(ctx));
  JS_SetPropertyStr(ctx, api, "sound", ps5_react_sound_api(ctx));
  JS_SetPropertyStr(ctx, api, "audioOutput", ps5_react_audio_output_api(ctx));
  JSValue global = JS_GetGlobalObject(ctx);
  JS_SetPropertyStr(ctx, global, "__ps5ReactNative", api);
  JS_FreeValue(ctx, global);
}

bool ps5_react_exit_requested() {
  return exit_requested;
}

void ps5_react_set_refresh_rate(int hz) {
  refresh_rate = hz;
}

int ps5_react_take_refresh_request() {
  return std::exchange(refresh_request, 0);
}

void ps5_react_set_gamepad(const GamepadState& state) {
  gamepad = state;
}

bool ps5_react_frame(JSContext* ctx, double elapsed_ms) {
  JSValue global = JS_GetGlobalObject(ctx);
  JSValue fn = JS_GetPropertyStr(ctx, global, "__ps5ReactFrame");
  bool ok = true;
  if (JS_IsFunction(ctx, fn)) {
    JSValue arg = JS_NewFloat64(ctx, elapsed_ms);
    JSValue result = JS_Call(ctx, fn, global, 1, &arg);
    ok = !JS_IsException(result);
    if (!ok) JS_FreeValue(ctx, JS_GetException(ctx));
    JS_FreeValue(ctx, result);
    JS_FreeValue(ctx, arg);
  }
  JS_FreeValue(ctx, fn);
  JS_FreeValue(ctx, global);
  return ok;
}
