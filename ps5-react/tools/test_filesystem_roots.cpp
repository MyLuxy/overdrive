// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include <cassert>
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <functional>
#include <map>
#include <set>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

namespace fixture {
std::map<std::string, bool> directories;
std::map<std::string, char> files;
std::map<int, std::string> handles;
int next_fd = 10;
bool corrupt_read = false;

int open(const char* path, int flags, int) {
  const std::string name = path;
  if (flags & O_DIRECTORY) {
    if (name != "." && !directories.contains(name)) { errno = ENOENT; return -1; }
  } else if (flags & O_CREAT) {
    const auto parent = name.substr(0, name.rfind('/'));
    if (!directories.contains(parent)) { errno = ENOENT; return -1; }
    if (!directories.at(parent)) { errno = EACCES; return -1; }
    if (files.contains(name)) { errno = EEXIST; return -1; }
    files[name] = 0;
  } else if (!files.contains(name)) { errno = ENOENT; return -1; }
  handles[next_fd] = name;
  return next_fd++;
}
int close(int fd) { handles.erase(fd); return 0; }
ssize_t write(int fd, const void* data, std::size_t) {
  files.at(handles.at(fd)) = *static_cast<const char*>(data);
  return 1;
}
ssize_t read(int fd, void* data, std::size_t) {
  *static_cast<char*>(data) = corrupt_read ? '?' : files.at(handles.at(fd));
  return 1;
}
int unlink(const char* path) { return files.erase(path) ? 0 : -1; }
int mkdir(const char* path, mode_t) {
  const std::string name = path;
  if (directories.contains(name)) { errno = EEXIST; return -1; }
  const auto parent = name.substr(0, name.rfind('/'));
  if (!directories.contains(parent)) { errno = ENOENT; return -1; }
  if (!directories.at(parent)) { errno = EACCES; return -1; }
  directories[name] = true;
  return 0;
}
pid_t getpid() { return 123; }

// A directory's identity is its path unless `inodes` names it, so two paths can be one directory
// seen from the sandbox's root and from the console's.
std::map<std::string, ino_t> inodes;
std::map<std::string, time_t> mtimes;
std::function<void()> elevate;
// What getcwd names each folder opened before elevation, once the process changed into it.
std::map<std::string, std::string> held;
std::string cwd = ".";
int fchdir(int fd) { cwd = handles.at(fd); return 0; }
char* getcwd(char* out, std::size_t size) {
  if (!held.contains(cwd)) { errno = ENOENT; return nullptr; }
  std::snprintf(out, size, "%s", held.at(cwd).c_str());
  return out;
}
int stat_path(const char* path, struct stat* out) {
  const std::string name = path;
  *out = {};
  if (directories.contains(name)) {
    out->st_mode = S_IFDIR;
    out->st_ino = inodes.contains(name) ? inodes.at(name) : std::hash<std::string>{}(name);
  } else if (files.contains(name)) {
    out->st_mode = S_IFREG;
    out->st_mtime = mtimes.contains(name) ? mtimes.at(name) : 0;
  } else {
    errno = ENOENT;
    return -1;
  }
  out->st_dev = 1;
  return 0;
}
struct Listing {
  std::set<std::string> names;
  std::set<std::string>::iterator next;
  dirent entry;
};
DIR* opendir(const char* path) {
  const std::string prefix = std::string(path) + "/";
  if (!directories.contains(path)) { errno = ENOENT; return nullptr; }
  auto* listing = new Listing;
  for (const auto& [name, writable] : directories)
    if (name.starts_with(prefix)) listing->names.insert(name.substr(prefix.size(), name.find('/', prefix.size()) - prefix.size()));
  listing->next = listing->names.begin();
  return reinterpret_cast<DIR*>(listing);
}
dirent* readdir(DIR* dir) {
  auto* listing = reinterpret_cast<Listing*>(dir);
  if (listing->next == listing->names.end()) return nullptr;
  std::snprintf(listing->entry.d_name, sizeof listing->entry.d_name, "%s", (listing->next++)->c_str());
  return &listing->entry;
}
int closedir(DIR* dir) { delete reinterpret_cast<Listing*>(dir); return 0; }
}

#define open fixture::open
#define close fixture::close
#define write fixture::write
#define read fixture::read
#define unlink fixture::unlink
#define mkdir fixture::mkdir
#define getpid fixture::getpid
#define stat(path, out) fixture::stat_path(path, out)
#define opendir fixture::opendir
#define readdir fixture::readdir
#define closedir fixture::closedir
#define fchdir fixture::fchdir
#define getcwd fixture::getcwd
#include "../native/ps5/filesystem_access.cpp"
#undef open
#undef close
#undef write
#undef read
#undef unlink
#undef mkdir
#undef getpid
#undef stat
#undef opendir
#undef readdir
#undef closedir
#undef fchdir
#undef getcwd

elevation::Status status = elevation::Status::ok;
elevation::Status elevation::request(Capability, const char*) noexcept {
  if (fixture::elevate) fixture::elevate();
  return status;
}
void crash_log::start(const char*) {}
const char* elevation::path() noexcept { return "fixture"; }
extern "C" int sceNetInit() { return 0; }
extern "C" int sceNetTerm() { return 0; }
extern "C" int sceNetPoolCreate(const char*, int, int) { return 1; }
extern "C" int sceNetPoolDestroy(int) { return 0; }
void host_platform_prepare_filesystem_access() {}

void reset(bool writable_sandbox) {
  fixture::directories = {{"/app0", true}, {"/download0", writable_sandbox},
                          {"/temp0", writable_sandbox}, {"/data", true}};
  fixture::files.clear();
  fixture::handles.clear();
  fixture::corrupt_read = false;
  fixture::inodes.clear();
  fixture::mtimes.clear();
  fixture::elevate = nullptr;
  fixture::held.clear();
  console_access = false;
  std::strcpy(app_root, "/app0");
  std::strcpy(data_root, "/download0");
  std::strcpy(temp_root, "/temp0");
  status = elevation::Status::ok;
}

void expect_path(const char* logical, const char* expected) {
  char result[512];
  assert(resolve_filesystem_path(logical, result, sizeof result));
  assert(std::strcmp(result, expected) == 0);
}

int main() {
  reset(true);
  initialize_filesystem_access();
  expect_path("/download0/overdrive/downloads.json.tmp", "/download0/overdrive/downloads.json.tmp");
  assert(fixture::files.empty() && fixture::handles.empty());

  reset(false);
  initialize_filesystem_access();
  expect_path("/download0/overdrive/downloads.json.tmp", "/data/ps5-react/PPSA99058/overdrive/downloads.json.tmp");
  expect_path("/temp0/test", "/data/ps5-react/PPSA99058/tmp/test");
  assert(console_filesystem_accessible());
  assert(fixture::files.empty() && fixture::handles.empty());

  reset(true);
  fixture::files["/download0/.ps5-react-write-123-0"] = 'X';
  assert(writable("/download0"));
  assert(fixture::files.size() == 1 && fixture::files.begin()->second == 'X');

  reset(true);
  fixture::corrupt_read = true;
  assert(!writable("/download0"));
  assert(fixture::files.empty() && fixture::handles.empty());

  reset(false);
  status = elevation::Status::transport_error;
  initialize_filesystem_access();
  assert(!console_filesystem_accessible());
  assert(!fixture::directories.contains("/data/ps5-react"));
  expect_path("/download0/file", "/download0/file");

  // Elevation moved the root, and another instance's sandbox holds _000: each root is the
  // directory that was /app0, /download0 and /temp0 before.
  reset(true);
  fixture::inodes = {{"/app0", 1}, {"/download0", 2}, {"/temp0", 3}};
  fixture::elevate = [] {
    fixture::directories = {{"/data", true}, {"/mnt", false}, {"/mnt/sandbox", false},
                            {"/mnt/sandbox/PPSA99058_000", false}, {"/mnt/sandbox/PPSA99058_000/app0", false},
                            {"/mnt/sandbox/PPSA99058_000/download0", false},
                            {"/mnt/sandbox/PPSA99058_001", false}, {"/mnt/sandbox/PPSA99058_001/app0", false},
                            {"/mnt/sandbox/PPSA99058_001/download0", true}, {"/mnt/sandbox/PPSA99058_001/temp0", true},
                            {"/mnt/sandbox/NPXS40028_000", false}};
    fixture::inodes = {{"/mnt/sandbox/PPSA99058_001/app0", 1}, {"/mnt/sandbox/PPSA99058_001/download0", 2},
                       {"/mnt/sandbox/PPSA99058_001/temp0", 3}};
  };
  initialize_filesystem_access();
  expect_path("/app0/i18n/locales/en.json", "/mnt/sandbox/PPSA99058_001/app0/i18n/locales/en.json");
  expect_path("/download0/overdrive/downloads.json", "/mnt/sandbox/PPSA99058_001/download0/overdrive/downloads.json");
  expect_path("/temp0/x", "/mnt/sandbox/PPSA99058_001/temp0/x");

  // Without an identity to match, the app root is the newest candidate holding the eboot.
  reset(true);
  fixture::directories.erase("/app0");
  fixture::elevate = [] {
    for (const char* name : {"/mnt", "/mnt/sandbox", "/mnt/sandbox/pfsmnt", "/mnt/sandbox/pfsmnt/PPSA99058-app0",
                             "/mnt/sandbox/PPSA99058_000", "/mnt/sandbox/PPSA99058_000/app0",
                             "/mnt/sandbox/PPSA99058_002", "/mnt/sandbox/PPSA99058_002/app0"})
      fixture::directories[name] = false;
    fixture::files["/mnt/sandbox/pfsmnt/PPSA99058-app0/eboot.bin"] = 'E';
    fixture::files["/mnt/sandbox/PPSA99058_002/app0/eboot.bin"] = 'E';
    fixture::mtimes = {{"/mnt/sandbox/pfsmnt/PPSA99058-app0/eboot.bin", 100},
                       {"/mnt/sandbox/PPSA99058_002/app0/eboot.bin", 200}};
  };
  initialize_filesystem_access();
  expect_path("/app0/eboot.bin", "/mnt/sandbox/PPSA99058_002/app0/eboot.bin");

  // The descriptor held across elevation names the app folder wherever it is mounted.
  reset(true);
  fixture::inodes = {{"/app0", 1}};
  fixture::held = {{"/app0", "/mnt/shadowmnt/Overdrive-PPSA99058_1a2b3c4d"}};
  fixture::elevate = [] {
    fixture::directories = {{"/data", true}, {"/mnt", false}, {"/mnt/sandbox", false},
                            {"/mnt/sandbox/PPSA99058_000", false}, {"/mnt/sandbox/PPSA99058_000/app0", false},
                            {"/mnt/shadowmnt", false}, {"/mnt/shadowmnt/Overdrive-PPSA99058_1a2b3c4d", false}};
    fixture::inodes = {{"/mnt/shadowmnt/Overdrive-PPSA99058_1a2b3c4d", 1}};
  };
  initialize_filesystem_access();
  expect_path("/app0/i18n/locales/en.json", "/mnt/shadowmnt/Overdrive-PPSA99058_1a2b3c4d/i18n/locales/en.json");
  assert(fixture::handles.empty());

  // A ShadowMount install without a match: _000 holds no eboot, its /system_ex/app folder does.
  reset(true);
  fixture::elevate = [] {
    fixture::directories = {{"/data", true}, {"/mnt", false}, {"/mnt/sandbox", false},
                            {"/mnt/sandbox/PPSA99058_000", false}, {"/mnt/sandbox/PPSA99058_000/app0", false},
                            {"/system_ex", false}, {"/system_ex/app", false}, {"/system_ex/app/PPSA99058", false}};
    fixture::files["/system_ex/app/PPSA99058/eboot.bin"] = 'E';
  };
  initialize_filesystem_access();
  expect_path("/app0/eboot.bin", "/system_ex/app/PPSA99058/eboot.bin");

  // Without a resolvable descriptor, /system_ex/app/<TITLE> matching /app0's identity is the app root.
  reset(true);
  fixture::inodes = {{"/app0", 1}};
  fixture::elevate = [] {
    fixture::directories = {{"/data", true}, {"/mnt", false}, {"/mnt/sandbox", false},
                            {"/mnt/sandbox/PPSA99058_000", false}, {"/mnt/sandbox/PPSA99058_000/app0", false},
                            {"/system_ex", false}, {"/system_ex/app", false}, {"/system_ex/app/PPSA99058", false}};
    fixture::inodes = {{"/system_ex/app/PPSA99058", 1}};
  };
  initialize_filesystem_access();
  expect_path("/app0/x", "/system_ex/app/PPSA99058/x");

  // Nothing to verify keeps the old guess.
  reset(true);
  fixture::directories.erase("/app0");
  initialize_filesystem_access();
  expect_path("/app0/x", "/mnt/sandbox/PPSA99058_000/app0/x");
  std::puts("PASS: writable roots, read-only fallback, exclusive probes, failed proof and failed elevation, "
            "verified sandbox roots");
}
