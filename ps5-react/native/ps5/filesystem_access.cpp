// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "filesystem_access.hpp"
#include "crash_log.hpp"
#include "app_config.hpp"
#include "host_platform.hpp"
#include "platform/ps5/system.hpp"
#include <cstdio>
#include <cerrno>
#include <cstring>
#include <initializer_list>
#include <fcntl.h>
#include <sys/stat.h>
#include <dirent.h>
#include <unistd.h>
#if PS5_REACT_CONSOLE_FILESYSTEM
#include "elevation.hpp"
extern "C" {
int sceNetInit(void);
int sceNetTerm(void);
int sceNetPoolCreate(const char* name, int size, int flags);
int sceNetPoolDestroy(int pool);
}
#endif

namespace {
bool console_access = false;
char app_root[256] = "/app0";
char data_root[256] = "/download0";
char temp_root[256] = "/temp0";
// Caches that may grow large: the title's download0 is a fixed image of a few hundred MiB that also holds
// its state, so a full cache there left the app nowhere to write.
char cache_root[256] = "/download0/.cache";

#if PS5_REACT_CONSOLE_FILESYSTEM
// Native titles must initialize libSceNet; linking its stub is not enough.
// The resident/helper client owns its sockets; this scope owns only our pool
// and library initialization, never a pool or initialization owned elsewhere.
struct Network {
  int init = sceNetInit();
  int pool = sceNetPoolCreate("ps5-react-filesystem", 0x10000, 0);
  Network() {
    hui::sys::log("[PS5-REACT] filesystem network init=0x%08x pool=%d",
                  static_cast<unsigned>(init), pool);
  }
  ~Network() {
    if (pool >= 0) sceNetPoolDestroy(pool);
    if (init == 0) sceNetTerm();
  }
};

bool accessible(const char* path) {
  const int fd = open(path, O_RDONLY | O_DIRECTORY, 0);
  if (fd < 0) return false;
  close(fd);
  return true;
}

// A sandbox mount can remain readable after elevation while denying writes.
// Exercise the same file operations as the app, without replacing any file.
bool writable(const char* root) {
  char path[512];
  int fd = -1;
  for (int attempt = 0; attempt < 8; ++attempt) {
    if (std::snprintf(path, sizeof path, "%s/.ps5-react-write-%ld-%d", root,
                      static_cast<long>(getpid()), attempt) >= static_cast<int>(sizeof path)) {
      errno = ENAMETOOLONG;
      return false;
    }
    fd = open(path, O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd >= 0 || errno != EEXIST) break;
  }
  if (fd < 0) return false;
  const char token = 'R';
  ssize_t count;
  do { count = write(fd, &token, 1); } while (count < 0 && errno == EINTR);
  bool ok = count == 1;
  int error = ok ? 0 : count < 0 ? errno : EIO;
  if (close(fd) != 0 && ok) { ok = false; error = errno; }
  if (ok) {
    fd = open(path, O_RDONLY, 0);
    char received = 0;
    if (fd < 0) { ok = false; error = errno; }
    else {
      do { count = read(fd, &received, 1); } while (count < 0 && errno == EINTR);
      ok = count == 1 && received == token;
      if (!ok) error = count < 0 ? errno : EIO;
    }
    if (fd >= 0 && close(fd) != 0 && ok) { ok = false; error = errno; }
  }
  if (unlink(path) != 0 && ok) { ok = false; error = errno; }
  if (!ok) errno = error ? error : EIO;
  return ok;
}

// Images were cached in download0 until it filled the title's fixed-size image and left no room for
// its state; they now live under /data, and the old files go before download0 is checked.
void remove_legacy_image_cache() {
  char directory[320];
  std::snprintf(directory, sizeof directory, "%s/.cache/images", data_root);
  DIR* dir = opendir(directory);
  if (!dir) return;
  int removed = 0;
  while (dirent* item = readdir(dir)) {
    if (item->d_name[0] == '.') continue;
    char path[600];
    std::snprintf(path, sizeof path, "%s/%s", directory, item->d_name);
    removed += unlink(path) == 0;
  }
  closedir(dir);
  rmdir(directory);
  hui::sys::log("[PS5-REACT] removed %d cached images from %s", removed, directory);
}

bool ensure_directory(const char* path) {
  if (mkdir(path, 0700) == 0) return true;
  return errno == EEXIST && accessible(path);
}

// /<name> as it was before elevation. The helper replaces only the process's root and jail: this
// descriptor, like the working directory, still names the sandbox's own folder afterwards.
struct Before {
  int fd = -1;
  struct stat identity;
};

bool same_directory(const char* path, const Before& before) {
  struct stat now;
  return before.fd >= 0 && stat(path, &now) == 0 && S_ISDIR(now.st_mode) &&
         now.st_dev == before.identity.st_dev && now.st_ino == before.identity.st_ino;
}

// The held folder's path from the console's root, as the kernel names it.
bool held_path(const Before& before, char* out, std::size_t size) {
  const int cwd = open(".", O_RDONLY | O_DIRECTORY, 0);
  const bool found = cwd >= 0 && fchdir(before.fd) == 0 && getcwd(out, size);
  if (!found) *out = '\0';
  if (cwd >= 0) {
    (void)fchdir(cwd);
    close(cwd);
  }
  return found;
}

// After elevation the sandbox's /app0 is not at a fixed path: /mnt/sandbox/<TITLE>_NNN/app0 with an
// NNN that is not always 000, and one console with a ShadowMount image install found no app files
// at _000. Each root is the folder /<name> was before elevation: by the descriptor held
// across it, else by its identity among the title's sandboxes. Without either, an app root must
// hold the eboot (the newest wins, ShadowMount's /system_ex/app/<TITLE> among them), and the old
// guess comes last. Every rejected candidate is logged.
void sandbox_root(const char* name, const Before& before, char* out, std::size_t size) {
  char path[256];
  std::snprintf(path, sizeof path, "/%s", name);
  if (same_directory(path, before)) {
    std::snprintf(out, size, "%s", path);
    return;
  }
  char held[256] = "";
  if (before.fd >= 0 && held_path(before, held, sizeof held) && same_directory(held, before)) {
    std::snprintf(out, size, "%s", held);
    return;
  }
  if (before.fd >= 0) hui::sys::log("[PS5-REACT] %s root not found by its descriptor: '%s' errno=%d", name, held, errno);
  const bool app = !std::strcmp(name, "app0");
  char newest[256] = "";
  time_t newest_time = 0;
  const auto consider = [&](const char* candidate) {
    if (same_directory(candidate, before)) return true;
    char marker[320];
    std::snprintf(marker, sizeof marker, "%s/eboot.bin", candidate);
    struct stat found;
    const bool has_eboot = app && stat(marker, &found) == 0;
    if (has_eboot && (!*newest || found.st_mtime > newest_time)) {
      std::snprintf(newest, sizeof newest, "%s", candidate);
      newest_time = found.st_mtime;
    }
    hui::sys::log("[PS5-REACT] %s root candidate rejected: %s%s", name, candidate, has_eboot ? " (holds eboot.bin)" : "");
    return false;
  };
  constexpr std::size_t prefix = sizeof PS5_REACT_TITLE - 1;
  if (DIR* dir = opendir("/mnt/sandbox")) {
    bool matched = false;
    while (dirent* item = readdir(dir)) {
      if (std::strncmp(item->d_name, PS5_REACT_TITLE "_", prefix + 1)) continue;
      std::snprintf(path, sizeof path, "/mnt/sandbox/%s/%s", item->d_name, name);
      if ((matched = consider(path))) break;
    }
    closedir(dir);
    if (matched) {
      std::snprintf(out, size, "%s", path);
      return;
    }
  }
  if (app)
    for (const char* candidate : {"/system_ex/app/" PS5_REACT_TITLE, "/mnt/sandbox/pfsmnt/" PS5_REACT_TITLE "-app0"})
      if (consider(candidate)) {
        std::snprintf(out, size, "%s", candidate);
        return;
      }
  if (*newest) {
    std::snprintf(out, size, "%s", newest);
  } else {
    std::snprintf(path, sizeof path, "/%s", name);
    if (!accessible(path)) std::snprintf(path, sizeof path, "/mnt/sandbox/%s_000/%s", PS5_REACT_TITLE, name);
    std::snprintf(out, size, "%s", path);
  }
  hui::sys::log("[PS5-REACT] %s root unverified, using %s", name, out);
}
#endif
}

void initialize_filesystem_access() {
#if PS5_REACT_CONSOLE_FILESYSTEM
  host_platform_prepare_filesystem_access();
  const char* names[] = {"app0", "download0", "temp0"};
  char* roots[] = {app_root, data_root, temp_root};
  Before before[3];
  for (int i = 0; i < 3; ++i) {
    char path[32];
    std::snprintf(path, sizeof path, "/%s", names[i]);
    before[i].fd = open(path, O_RDONLY | O_DIRECTORY, 0);
    if (before[i].fd >= 0 && stat(path, &before[i].identity) != 0) {
      close(before[i].fd);
      before[i].fd = -1;
    }
  }
  const auto status = [] {
    Network network;
    // An already-initialized library can return an error from sceNetInit;
    // successful pool creation establishes that sockets can be attempted.
    if (network.pool < 0) return elevation::Status::transport_error;
    return elevation::request(elevation::Capability::filesystem);
  }();
  hui::sys::log("[PS5-REACT] filesystem access status=%u path=%s",
                static_cast<unsigned>(status), elevation::path());
  if (status == elevation::Status::ok)
    for (int i = 0; i < 3; ++i) sandbox_root(names[i], before[i], roots[i], sizeof app_root);
  for (const Before& held : before)
    if (held.fd >= 0) close(held.fd);
  if (status != elevation::Status::ok) return;
  console_access = true;
  remove_legacy_image_cache();
  if (!writable(data_root)) {
    hui::sys::log("[PS5-REACT] data root not writable path=%s errno=%d; trying title data", data_root, errno);
    std::snprintf(data_root, sizeof data_root, "/data/ps5-react/%s", PS5_REACT_TITLE);
    if (!ensure_directory("/data/ps5-react") || !ensure_directory(data_root) || !writable(data_root))
      hui::sys::log("[PS5-REACT] data root write proof failed path=%s errno=%d", data_root, errno);
  }
  if (!writable(temp_root)) {
    std::snprintf(temp_root, sizeof temp_root, "%s/tmp", data_root);
    if (!ensure_directory(temp_root) || !writable(temp_root))
      hui::sys::log("[PS5-REACT] temp root write proof failed path=%s errno=%d", temp_root, errno);
  }
  char title_data[256];
  std::snprintf(title_data, sizeof title_data, "/data/ps5-react/%s", PS5_REACT_TITLE);
  std::snprintf(cache_root, sizeof cache_root, "%s/cache", title_data);
  if (!ensure_directory("/data/ps5-react") || !ensure_directory(title_data) || !ensure_directory(cache_root) || !writable(cache_root))
    std::snprintf(cache_root, sizeof cache_root, "%s/.cache", data_root);
  else crash_log::start(title_data);
  hui::sys::log("[PS5-REACT] filesystem roots app=%s data=%s temp=%s cache=%s", app_root, data_root, temp_root, cache_root);
#endif
}

bool resolve_filesystem_path(const char* path, char* out, std::size_t size) {
  const char* suffix = "";
  const char* base = path;
  if (!std::strncmp(path, "/cache0", 7) && (!path[7] || path[7] == '/')) {
    // Without console access the sandbox paths are used as they are.
    base = console_access ? cache_root : "/download0/.cache";
    suffix = path + 7;
  } else if (console_access) {
    const char* logical[] = {"/app0", "/download0", "/temp0"};
    const char* physical[] = {app_root, data_root, temp_root};
    for (int i = 0; i < 3; ++i) {
      const auto length = std::strlen(logical[i]);
      if (!std::strncmp(path, logical[i], length) && (!path[length] || path[length] == '/')) {
        base = physical[i];
        suffix = path + length;
        break;
      }
    }
  }
  const int length = std::snprintf(out, size, "%s%s", base, suffix);
  return length >= 0 && static_cast<std::size_t>(length) < size;
}

bool console_filesystem_accessible() { return console_access; }
