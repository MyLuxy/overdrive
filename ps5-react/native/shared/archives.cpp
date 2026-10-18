// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "archives.hpp"
#include "archive_writer.hpp"
#include "worker_thread.hpp"
#include <clocale>
#include <mutex>
#include "archive_preflight.hpp"
#include "rar5_password.hpp"
#include <zlib.h>
#include "digest.hpp"
#include "thread_name.hpp"
#include <archive.h>
#include <archive_entry.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <dirent.h>
#include <fcntl.h>
#include <memory>
#include <mutex>
#include <string_view>
#include <sys/stat.h>
#include <thread>
#include <time.h>
#include <unordered_map>
#include <unordered_set>
#include <unistd.h>

namespace archives {
namespace {
constexpr std::size_t max_artifacts = 64, max_path_length = 4096, read_block_size = 128 * 1024;
// libarchive reads each volume in blocks this large, and hands a stored entry out in blocks as large.
constexpr std::size_t volume_block_size = 1024 * 1024;
constexpr unsigned max_depth = 128;
// ShadowMount mounts these images; packages are installed by the console.
constexpr std::array<std::string_view, 4> image_extensions{".ffpfsc", ".ffpfs", ".ffpkg", ".exfat"};
constexpr std::array<std::string_view, 2> package_extensions{".pkg", ".fpkg"};
const char* receipt_name = ".ps5-react-extraction";
const char* stage_name = ".ps5-react-stage";

struct Job {
  Request request;
  Snapshot snapshot;
  std::atomic<bool> cancelled{false};
  std::mutex mutex;
  Timings timings;
  WorkerThread worker;
  // The RAR worker went silent without saying it stopped: it may still be writing into staging.
  bool worker_unconfirmed = false;
};
std::mutex guard;
std::shared_ptr<Job> active;
// Destinations whose RAR worker went silent in this process, with how many times: it may still write into
// that staging, so the next extraction there stages beside it under a new name.
std::mutex silent_guard;
std::unordered_map<std::string, unsigned> silent_workers;
std::uint32_t next_id = 1;

// CPU time of the calling thread, or 0 when the clock is unavailable.
std::uint64_t thread_cpu_us() {
  timespec now{};
  if (clock_gettime(CLOCK_THREAD_CPUTIME_ID, &now)) return 0;
  return static_cast<std::uint64_t>(now.tv_sec) * 1000000 + now.tv_nsec / 1000;
}
bool terminal(const std::string& state) { return state == "completed" || state == "failed" || state == "cancelled"; }
void fail(Job& job, const std::string& error) {
  std::lock_guard lock(job.mutex);
  job.snapshot.error = error;
  job.snapshot.state = job.cancelled ? "cancelled" : "failed";
}
void enter(Job& job, const char* phase) {
  std::lock_guard lock(job.mutex);
  job.snapshot.phase = phase;
}
template <std::size_t count>
bool has_extension(const std::string& path, const std::array<std::string_view, count>& extensions) {
  return std::any_of(extensions.begin(), extensions.end(), [&](std::string_view extension) { return path.ends_with(extension); });
}
bool image(const std::string& path) { return has_extension(path, image_extensions); }
// Check package signatures after extraction.
bool package(const std::string& root, const std::string& path, std::string& error) {
  if (!has_extension(path, package_extensions)) return false;

  const auto file = root + "/" + path;
  int fd;
  // Reject substituted links and avoid blocking on substituted FIFOs.
  do {
    fd = open(file.c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  } while (fd < 0 && errno == EINTR);

  if (fd < 0) {
    error = "Cannot inspect extracted package " + path + ": " + std::strerror(errno);
    return false;
  }

  struct stat st;
  int status;
  do {
    status = fstat(fd, &st);
  } while (status && errno == EINTR);

  if (status || !S_ISREG(st.st_mode)) {
    const char* reason = status ? std::strerror(errno) : "not a regular file.";
    error = "Cannot inspect extracted package " + path + ": " + reason;
    close(fd);
    return false;
  }

  char header[4];
  std::size_t count = 0;
  while (count < sizeof header) {
    const auto bytes = read(fd, header + count, sizeof header - count);
    if (bytes < 0) {
      if (errno == EINTR) continue;
      error = "Cannot inspect extracted package " + path + ": " + std::strerror(errno);
      break;
    }
    if (!bytes) break;
    count += bytes;
  }

  close(fd);
  return count == sizeof header &&
    (!std::memcmp(header, "\x7f" "CNT", 4) || !std::memcmp(header, "\x7f" "FIH", 4));
}

bool installable(const std::string& root, const std::string& path, std::string& error) {
  return image(path) || package(root, path, error);
}

// Writer can report the paths before their contents are complete.
std::string collect_artifacts(Job& job, const std::string& root) {
  const int fd = open((root + "/" + receipt_name).c_str(), O_RDONLY | O_NOFOLLOW | O_NONBLOCK);
  if (fd < 0) return "Cannot inspect extraction receipt.";
  struct Closer { int fd; ~Closer() { close(fd); } } closer{fd};

  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode)) return "Invalid extraction receipt.";

  LineReader reader(fd);
  std::string line;
  if (!reader.next(line) || !line.starts_with("P5AR001:")) return "Invalid extraction receipt.";

  std::vector<std::string> artifacts;
  while (reader.next(line)) {
    const auto split = line.find('|');
    if (split != 64 || line.size() <= split + 1) return "Invalid extraction receipt.";

    std::string path = line.substr(split + 1);
    std::string error;
    const bool artifact = installable(root, path, error);
    if (!error.empty()) return error;
    if (artifact) {
      if (artifacts.size() == max_artifacts) return "Archive has too many installable artifacts.";
      artifacts.push_back(std::move(path));
    }
  }

  if (!reader.clean()) return "Invalid extraction receipt.";
  std::lock_guard lock(job.mutex);
  job.snapshot.artifacts = std::move(artifacts);
  return {};
}
const char* archive_error(archive* archive, const char* fallback) {
  const char* error = archive_error_string(archive);
  return error ? error : fallback;
}

bool safe(const char* name) {
  if (!name || !*name || *name == '/' || std::strlen(name) > max_path_length) return false;
  if (std::strchr(name, '\\') || std::strchr(name, ':')) return false;
  const std::string path(name);
  for (unsigned char c : path) {
    if (c < 32 || c == 127 || c == '|') return false;
  }
  std::size_t start = 0;
  unsigned depth = 0;
  while (start < path.size()) {
    auto end = path.find('/', start);
    if (end == std::string::npos) end = path.size();
    const auto part = path.substr(start, end - start);
    if (part.empty() || part == ".." || ++depth > max_depth) return false;
    start = end + 1;
  }
  return true;
}
// Every directory is opened relative to an owned root, never following archive-created links.
// The console's libkernel for titles has no *at calls (openat, mkdirat, fstatat, unlinkat: only
// libkernel_sys has them), and calling one faulted at address 0 and killed the title. Paths are used
// instead, each directory checked as created here and never a link.
bool plain_directory(const std::string& path) {
  struct stat st;
  return !lstat(path.c_str(), &st) && S_ISDIR(st.st_mode);
}
// The game runs as another user than this app and cannot launch from a tree only its owner reads, so
// what an extraction writes is open to everyone whatever this process's umask, as rar-extract's output is.
// chmod by path: titles already use it (fs.chmod); fchmod is unproven on the console.
bool make_directory(const std::string& path) {
  return !mkdir(path.c_str(), 0777) && !chmod(path.c_str(), 0777);
}
int create_file(const std::string& path) {
  const int fd = open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0666);
  if (fd >= 0 && chmod(path.c_str(), 0666)) {
    const int error = errno;
    close(fd);
    errno = error;
    return -1;
  }
  return fd;
}
// Creates the directories of `name` under `root` and returns the path of its last component. `made`
// holds the directories already created and checked, so a folder of many files costs no syscalls.
bool make_parents(const std::string& root, const std::string& name, std::string& target, std::unordered_set<std::string>& made) {
  target = root;
  std::size_t start = 0;
  while (true) {
    const auto end = name.find('/', start);
    const auto part = name.substr(start, end == std::string::npos ? std::string::npos : end - start);
    if (end == std::string::npos) {
      target += "/" + part;
      return true;
    }
    start = end + 1;
    if (part == ".") continue;
    target += "/" + part;
    if (made.contains(target)) continue;
    if (!make_directory(target) && errno != EEXIST) return false;
    if (!plain_directory(target)) { errno = ENOTDIR; return false; }
    made.insert(target);
  }
}
bool file_hash(const std::string& path, Job& job, std::string& digest) {
  const int fd = open(path.c_str(), O_RDONLY | O_NOFOLLOW);
  if (fd < 0) return false;
  integrity::Hash hash;
  std::array<char, read_block_size> buffer{};
  bool ok = true;
  while (!job.cancelled) {
    const auto bytes = read(fd, buffer.data(), buffer.size());
    if (bytes < 0 && errno == EINTR) continue;
    if (bytes < 0) {
      ok = false;
      break;
    }
    if (!bytes) break;
    if (!hash.update(buffer.data(), bytes)) {
      ok = false;
      break;
    }
  }
  close(fd);
  digest = hash.finish();
  return ok && !job.cancelled && digest.size() == 64;
}
std::string input_identity(const Request& request) {
  std::string identity;
  for (const auto& path : request.sources) {
    struct stat st;
    if (lstat(path.c_str(), &st) || !S_ISREG(st.st_mode)) return {};
#ifdef __APPLE__
    const auto time = st.st_mtimespec;
#else
    const auto time = st.st_mtim;
#endif
    identity += path + "|" + std::to_string(st.st_dev) + "|" + std::to_string(st.st_ino) + "|" + std::to_string(st.st_size);
    identity += "|" + std::to_string(time.tv_sec) + "|" + std::to_string(time.tv_nsec) + "\n";
  }
  integrity::Hash hash;
  hash.update(identity.data(), identity.size());
  return hash.finish();
}
// A streamed set's later volumes do not exist yet, so until the end its identity is the volumes' paths:
// the app keeps each set in a folder of its own. The receipt gets the full identity once all are there.
std::string stream_identity(const Request& request) {
  std::string identity = "stream\n";
  for (const auto& path : request.sources) identity += path + "\n";
  integrity::Hash hash;
  hash.update(identity.data(), identity.size());
  return hash.finish();
}
bool regular_file(const std::string& path) {
  struct stat st;
  return !lstat(path.c_str(), &st) && S_ISREG(st.st_mode);
}
// Bounded metadata I/O avoids libc++ locale machinery unavailable in native titles.
bool read_metadata(const std::string& path, std::string& text) {
  const int fd = open(path.c_str(), O_RDONLY | O_NOFOLLOW);
  if (fd < 0) return false;
  struct stat st;
  if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_size < 0 || static_cast<std::uint64_t>(st.st_size) > max_metadata_bytes) {
    close(fd);
    return false;
  }
  text.resize(st.st_size);
  std::size_t offset = 0;
  while (offset < text.size()) {
    const auto count = read(fd, text.data() + offset, text.size() - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) {
      close(fd);
      return false;
    }
    offset += count;
  }
  close(fd);
  return true;
}
bool write_metadata(const std::string& directory, const char* name, const std::string& text) {
  const int fd = open((directory + "/" + name).c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (fd < 0) return false;
  std::size_t offset = 0;
  bool ok = true;
  while (offset < text.size()) {
    const auto count = write(fd, text.data() + offset, text.size() - offset);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) {
      ok = false;
      break;
    }
    offset += count;
  }
  if (ok && fsync(fd)) ok = false;
  close(fd);
  return ok;
}
bool empty_directory(const std::string& path) {
  std::size_t count = 0;
  return list_directory(path.c_str(), [](const char* name, void* out) {
    if (std::strcmp(name, ".") && std::strcmp(name, "..")) ++*static_cast<std::size_t*>(out);
  }, &count) && !count;
}
// Removes what is under `path` without following links. Names come from the host's listing: opendir
// and the *at calls are unusable in a console title.
bool clear_directory(const std::string& path, unsigned depth = 0) {
  if (depth > max_depth) return false;
  std::vector<std::string> names;
  if (!list_directory(path.c_str(), [](const char* name, void* out) { static_cast<std::vector<std::string>*>(out)->emplace_back(name); }, &names))
    return false;
  for (const auto& name : names) {
    if (name == "." || name == "..") continue;
    const std::string child = path + "/" + name;
    struct stat st;
    if (lstat(child.c_str(), &st)) return false;
    if (S_ISDIR(st.st_mode)) {
      if (!clear_directory(child, depth + 1) || rmdir(child.c_str())) return false;
    } else if (unlink(child.c_str())) {
      return false;
    }
  }
  return true;
}
// True when every component below root is a real directory or, last, the entry itself.
bool plain_path(const std::string& root, const std::string& path) {
  std::string component = root;
  std::size_t begin = 0;
  while (begin < path.size()) {
    auto end = path.find('/', begin);
    if (end == std::string::npos) end = path.size();
    component += "/" + path.substr(begin, end - begin);
    struct stat node;
    if (lstat(component.c_str(), &node) || S_ISLNK(node.st_mode)) return false;
    if (end < path.size() && !S_ISDIR(node.st_mode)) return false;
    begin = end + 1;
  }
  return true;
}
bool recover(Job& job, const std::string& identity) {
  const auto root = job.request.destination;
  struct stat st;
  const auto receipt = root + "/" + receipt_name;
  if (lstat(receipt.c_str(), &st) || !S_ISREG(st.st_mode)) return false;
  // Read a line at a time: a game folder's receipt is far bigger than anything kept in memory (issue #52).
  const int fd = open(receipt.c_str(), O_RDONLY | O_NOFOLLOW);
  if (fd < 0) return false;
  struct Closer { int fd; ~Closer() { close(fd); } } closer{fd};
  LineReader reader(fd);
  auto next_line = [&](std::string& line) { return reader.next(line); };
  std::string line;
  if (!next_line(line) || line != "P5AR001:" + identity) return false;
  Snapshot verified;
  while (next_line(line)) {
    const auto split = line.find('|');
    if (split != 64) return false;
    const auto expected = line.substr(0, split), path = line.substr(split + 1);
    if (!safe(path.c_str()) || !plain_path(root, path)) return false;
    std::string actual;
    if (!file_hash(root + "/" + path, job, actual) || actual != expected) return false;
    if (lstat((root + "/" + path).c_str(), &st) || !S_ISREG(st.st_mode)) return false;
    if (st.st_size < 0 || static_cast<std::uint64_t>(st.st_size) > job.request.max_bytes - verified.written) return false;
    if (++verified.entries > max_entries) return false;
    verified.written += st.st_size;
    std::string error;
    const bool artifact = installable(root, path, error);
    if (!error.empty()) return false;
    if (artifact) verified.artifacts.push_back(path);
    if (verified.artifacts.size() > max_artifacts) return false;
  }
  if (!reader.clean()) return false;
  std::lock_guard lock(job.mutex);
  job.snapshot.written = verified.written;
  job.snapshot.entries = verified.entries;
  job.snapshot.artifacts = std::move(verified.artifacts);
  return true;
}
// Removes staging left by an interrupted run of this same extraction.
bool restart_staging(const std::string& staging, const struct stat& expected) {
  const int previous = open(staging.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  struct stat opened;
  const bool owned = previous >= 0 && !fstat(previous, &opened) && opened.st_dev == expected.st_dev && opened.st_ino == expected.st_ino;
  const bool cleared = owned && clear_directory(staging);
  if (previous >= 0) close(previous);
  return cleared && !rmdir(staging.c_str());
}
// The SHA-256 is taken from the blocks as they are written. A file that arrives out of order or with
// holes is hashed by reading it back.
std::string write_entry(Job& job, archive* archive, int fd, std::int64_t size, const std::string& path, std::string& digest, std::uint32_t* checksum = nullptr) {
  const auto max_bytes = job.request.max_bytes;
  const void* buffer = nullptr;
  std::size_t bytes = 0;
  la_int64_t offset = 0;
  std::uint64_t extent = 0, hashed = 0;
  integrity::Hash hash;
  std::uint32_t crc = 0;
  bool contiguous = true;
  int result = ARCHIVE_OK;
  while (!job.cancelled && (result = archive_read_data_block(archive, &buffer, &bytes, &offset)) == ARCHIVE_OK) {
    if (offset < 0 || static_cast<std::uint64_t>(offset) > max_bytes || bytes > max_bytes - static_cast<std::uint64_t>(offset))
      return "Invalid archive data offset.";
    {
      std::lock_guard lock(job.mutex);
      if (bytes > max_bytes - job.snapshot.written) return "Archive exceeds the extraction size limit.";
      job.snapshot.written += bytes;
    }
    std::size_t written = 0;
    const auto writing = std::chrono::steady_clock::now();
    while (written < bytes && !job.cancelled) {
      const auto count = pwrite(fd, static_cast<const char*>(buffer) + written, bytes - written, offset + written);
      if (count < 0 && errno == EINTR) continue;
      if (count <= 0) return std::strerror(errno);
      written += count;
    }
    job.timings.write_us += elapsed_us(writing);
    ++job.timings.writes;
    if (contiguous && static_cast<std::uint64_t>(offset) == hashed) {
      hash.update(buffer, bytes);
      if (checksum) crc = crc32(crc, static_cast<const Bytef*>(buffer), bytes);
      hashed += bytes;
    } else {
      contiguous = false;
    }
    extent = std::max(extent, static_cast<std::uint64_t>(offset) + bytes);
  }
  if (job.cancelled) return {};
  if (result != ARCHIVE_EOF) return archive_error(archive, "Incomplete archive data.");
  if (extent != static_cast<std::uint64_t>(size)) return "Extracted file size mismatch.";
  const auto syncing = std::chrono::steady_clock::now();
  if (fsync(fd)) return std::strerror(errno);
  job.timings.sync_us += elapsed_us(syncing);
  ++job.timings.syncs;
  if (contiguous && hashed == extent) digest = hash.finish();
  else if (!file_hash(path, job, digest)) digest.clear();
  if (checksum) {
    if (!contiguous) return "Non-contiguous RAR5 file data cannot be verified.";
    *checksum = crc;
  }
  if (digest.size() != 64 && !job.cancelled) return "Cannot verify extracted file.";
  return {};
}
// Hands an entry's blocks to the writer; the decoder goes on while they are written.
std::string stream_entry(Job& job, archive* archive, Writer& writer, std::int64_t size, std::uint32_t* checksum) {
  const auto max_bytes = job.request.max_bytes;
  const void* buffer = nullptr;
  std::size_t bytes = 0;
  la_int64_t offset = 0;
  std::uint64_t extent = 0, checked = 0;
  std::uint32_t crc = 0;
  bool contiguous = true;
  int result = ARCHIVE_OK;
  while (!job.cancelled && (result = archive_read_data_block(archive, &buffer, &bytes, &offset)) == ARCHIVE_OK) {
    if (offset < 0 || static_cast<std::uint64_t>(offset) > max_bytes || bytes > max_bytes - static_cast<std::uint64_t>(offset))
      return "Invalid archive data offset.";
    {
      std::lock_guard lock(job.mutex);
      if (bytes > max_bytes - job.snapshot.written) return "Archive exceeds the extraction size limit.";
      job.snapshot.written += bytes;
    }
    if (!writer.append(buffer, bytes, offset)) return writer.error();
    if (checksum && contiguous && static_cast<std::uint64_t>(offset) == checked) {
      crc = crc32(crc, static_cast<const Bytef*>(buffer), bytes);
      checked += bytes;
    } else {
      contiguous = false;
    }
    extent = std::max(extent, static_cast<std::uint64_t>(offset) + bytes);
  }
  if (job.cancelled) return {};
  if (result != ARCHIVE_EOF) return archive_error(archive, "Incomplete archive data.");
  if (extent != static_cast<std::uint64_t>(size)) return "Extracted file size mismatch.";
  if (checksum) {
    if (!contiguous) return "Non-contiguous RAR5 file data cannot be verified.";
    *checksum = crc;
  }
  return writer.end() ? std::string() : writer.error();
}
// libarchive converts every entry name to the process locale. In the C locale a single non-ASCII
// name ("PPSA15246 – USA ...") failed that conversion, and on the console it faulted at address 0
// and killed the title. Under a UTF-8 locale a UTF-8 name needs no conversion.
void use_utf8_names() {
  static std::once_flag once;
  std::call_once(once, [] {
    const char* locale = std::setlocale(LC_CTYPE, "C.UTF-8");
    if (!locale) locale = std::setlocale(LC_CTYPE, "en_US.UTF-8");
    trace("locale", locale ? locale : "none");
  });
}
// The host's memory hold for the libarchive path, released once the archive is freed.
struct MemoryHold {
  const bool room = hold_memory(true);
  ~MemoryHold() { hold_memory(false); }
};
archive* open_archive(Job& job, std::string& error, std::unique_ptr<Rar5PasswordReader>& decrypted) {
  const auto& request = job.request;
  use_utf8_names();
  auto* archive = archive_read_new();
  archive_read_support_filter_all(archive);
  archive_read_support_format_zip(archive);
  archive_read_support_format_rar(archive);
  archive_read_support_format_rar5(archive);
  archive_read_support_format_7zip(archive);
  archive_read_support_format_tar(archive);
  if (!request.password.empty() && archive_read_add_passphrase(archive, request.password.c_str()) != ARCHIVE_OK) {
    error = archive_error(archive, "Cannot configure archive password.");
    return archive;
  }
  std::vector<const char*> files;
  for (const auto& path : request.sources) files.push_back(path.c_str());
  files.push_back(nullptr);
  int result;
  if (!request.password.empty() && Rar5PasswordReader::matches(request.sources.front())) {
    decrypted = std::make_unique<Rar5PasswordReader>(request.sources, request.password, job.cancelled);
    result = archive_read_open(archive, decrypted.get(), nullptr, Rar5PasswordReader::read, nullptr);
  } else {
    // Large blocks only where the heap leaves room for the write ring too; otherwise as before.
    result = archive_read_open_filenames(archive, files.data(), pipeline_bytes() >= volume_block_size ? volume_block_size : read_block_size);
  }
  if (result != ARCHIVE_OK)
    error = archive_error(archive, "Unsupported or incomplete archive.");
  return archive;
}
// Writes every entry under root and appends its digest line to the receipt.
std::string extract(Job& job, archive* archive, const std::string& staging, Receipt& receipt, Rar5PasswordReader* decrypted, Writer* writer) {
  const auto& request = job.request;
  archive_entry* entry = nullptr;
  int result = ARCHIVE_OK;
  std::uint64_t declared_total = 0;
  std::unordered_set<std::string> made;
  // A warning is a header libarchive could only read in part, such as a name it could not convert.
  while (!job.cancelled && ((result = archive_read_next_header(archive, &entry)) == ARCHIVE_OK || result == ARCHIVE_WARN)) {
    const char* name = archive_entry_pathname_utf8(entry);
    if (job.snapshot.entries < 3) trace("entry", name ? name : "(no name)");
    if (!name) return "Archive has a file name this console cannot read.";
    const auto type = archive_entry_filetype(entry);
    const bool link = archive_entry_symlink(entry) || archive_entry_hardlink(entry);
    const bool reserved = name && std::string(name).find(".ps5-react-") != std::string::npos;
    if (!safe(name) || reserved || link || (type != AE_IFREG && type != AE_IFDIR)) return "Archive contains an unsafe path, link or special file.";
    const auto size = archive_entry_size(entry);
    if (size < 0 || static_cast<std::uint64_t>(size) > request.max_bytes - declared_total) return "Archive exceeds the extraction size limit.";
    declared_total += size;
    std::string path(name);
    while (path.ends_with('/')) path.pop_back();
    // ShadowMount's default scan reaches one subdirectory. Publish images at the set root.
    if (type == AE_IFREG && image(path)) {
      const auto slash = path.find_last_of('/');
      if (slash != std::string::npos) path = path.substr(slash + 1);
    }
    std::string target;
    if (!make_parents(staging, path, target, made)) return std::strerror(errno);
    if (type == AE_IFDIR) {
      if (made.contains(target)) continue;
      if (!make_directory(target) && (errno != EEXIST || !plain_directory(target))) return std::strerror(errno);
      made.insert(target);
      continue;
    }
    const int fd = create_file(target);
    if (fd < 0) return std::strerror(errno);
    std::string digest;
    std::uint32_t crc = 0;
    const std::string original_name(name);
    if (writer) {
      if (!writer->begin(fd, staging + "/" + path, path)) return writer->error();
      const auto error = stream_entry(job, archive, *writer, size, decrypted ? &crc : nullptr);
      if (!error.empty() || job.cancelled) return error;
    } else {
      const auto error = write_entry(job, archive, fd, size, staging + "/" + path, digest, decrypted ? &crc : nullptr);
      close(fd);
      if (!error.empty() || job.cancelled) return error;
      if (!receipt.add(digest, path)) return "Cannot write extraction receipt.";
    }
    if (decrypted && !decrypted->verify(original_name, crc)) return "Extracted RAR5 file checksum mismatch.";
    std::lock_guard lock(job.mutex);
    if (++job.snapshot.entries > max_entries) return "Archive has too many entries.";
  }
  if (!job.cancelled && result != ARCHIVE_EOF) return archive_error(archive, "Incomplete archive headers.");
  return {};
}
// RAR5 and RAR 1.5-4 signatures. UnRAR reads volumes, not one byte stream cut into pieces (the libarchive
// path takes those), so every part must start a volume.
constexpr std::array<std::string_view, 2> rar_signatures{std::string_view("Rar!\x1A\x07\x01\x00", 8), std::string_view("Rar!\x1A\x07\x00", 7)};
// The decoder window the worker accepts, the RAR5 window the preflight admits for libarchive.
constexpr std::uint64_t rar_window = 32ULL * 1024 * 1024;
// Reports come a few times a second; read_rar_worker waits about a quarter second each time.
constexpr unsigned rar_silent_reads = 120, rar_cancel_reads = 40;
bool rar_volumes(const Request& request) {
  if (request.destination.find('\n') != std::string::npos) return false;
  return std::all_of(request.sources.begin(), request.sources.end(), [](const std::string& path) {
    if (path.find('\n') != std::string::npos) return false;
    char head[8] = {};
    const int fd = open(path.c_str(), O_RDONLY | O_NOFOLLOW);
    const auto count = fd < 0 ? -1 : read(fd, head, sizeof head);
    if (fd >= 0) close(fd);
    const std::string_view bytes(head, count < 0 ? 0 : count);
    return std::any_of(rar_signatures.begin(), rar_signatures.end(), [&](std::string_view signature) { return bytes.starts_with(signature); });
  });
}
// Decoder threads: PS5 has 8 cores; the interface keeps two either way, and downloads (a streamed set's own
// included) two more.
unsigned rar_threads(const Request& request) { return request.stream || downloading() ? 4 : 6; }
std::string rar_request(const Request& request, const std::string& staging) {
  constexpr char digits[] = "0123456789abcdef";
  std::string text = "RARX1\nthreads " + std::to_string(rar_threads(request)) + "\nwindow " + std::to_string(rar_window) + "\nlimit " + std::to_string(request.max_bytes) + "\n";
  for (auto extension : image_extensions) text += "flatten " + std::string(extension) + "\n";
  text += "reserved .ps5-react-\n";
  if (request.stream) text += "wait 1\n";
  if (!request.password.empty()) {
    text += "password ";
    for (unsigned char c : request.password) { text += digits[c >> 4]; text += digits[c & 15]; }
    text += "\n";
  }
  text += "dest " + staging + "\n";
  for (const auto& path : request.sources) text += "source " + path + "\n";
  return text + "end\n";
}
// One file the worker wrote and synced: "<sha256> <size> <path>". It is checked as libarchive's entries
// are, since the worker is a separate program.
std::string rar_file(Job& job, const std::string& staging, const std::string& report, std::uint64_t& total, Receipt& receipt) {
  const auto space = report.find(' '), next = space == std::string::npos ? space : report.find(' ', space + 1);
  if (space != 64 || next == std::string::npos) return "Invalid RAR worker output.";
  const auto digest = report.substr(0, space), path = report.substr(next + 1), size_text = report.substr(space + 1, next - space - 1);
  if (!std::all_of(digest.begin(), digest.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); }))
    return "Invalid RAR worker output.";
  char* end = nullptr;
  const std::uint64_t size = std::strtoull(size_text.c_str(), &end, 10);
  struct stat st;
  if (size_text.empty() || *end || !safe(path.c_str()) || path.find(".ps5-react-") != std::string::npos || !plain_path(staging, path) ||
      lstat((staging + "/" + path).c_str(), &st) || !S_ISREG(st.st_mode) || static_cast<std::uint64_t>(st.st_size) != size)
    return "Archive contains an unsafe path, link or special file.";
  if (size > job.request.max_bytes - total) return "Archive exceeds the extraction size limit.";
  total += size;
  if (!receipt.add(digest, path)) return "Cannot write extraction receipt.";
  std::lock_guard lock(job.mutex);
  if (++job.snapshot.entries > max_entries) return "Archive has too many entries.";
  return {};
}
// False when the worker could not be started, before anything was written: libarchive extracts instead.
bool extract_rar(Job& job, const std::string& staging, Receipt& receipt, std::string& error) {
  std::string unavailable;
  const int stream = start_rar_worker(rar_request(job.request, staging), unavailable);
  if (stream < 0) {
    trace("rar worker unavailable", unavailable.c_str());
    return false;
  }
  trace("rar worker started");
  const auto started = std::chrono::steady_clock::now();
  std::string pending, timings;
  std::uint64_t total = 0;
  bool finished = false, succeeded = false, cancel_sent = false, exited = false;
  unsigned silent = 0;
  std::array<char, 4096> buffer;
  while (!finished) {
    if ((job.cancelled || !error.empty()) && !cancel_sent) {
      cancel_rar_worker(stream);
      cancel_sent = true;
      silent = 0;
    }
    const auto count = read_rar_worker(stream, buffer.data(), buffer.size());
    if (!count) {
      exited = true;
      break;
    }
    if (count < 0) {
      if (++silent > (cancel_sent ? rar_cancel_reads : rar_silent_reads)) break;
      continue;
    }
    silent = 0;
    pending.append(buffer.data(), count);
    for (std::size_t end; !finished && (end = pending.find('\n')) != std::string::npos; pending.erase(0, end + 1)) {
      const auto line = pending.substr(0, end);
      if (line.starts_with("p ") && !cancel_sent) {
        const std::uint64_t written = std::strtoull(line.c_str() + 2, nullptr, 10);
        std::lock_guard lock(job.mutex);
        job.snapshot.written = std::min(written, job.request.max_bytes);
      } else if (line.starts_with("f ")) {
        if (const auto refusal = rar_file(job, staging, line.substr(2), total, receipt); !refusal.empty() && error.empty()) error = refusal;
      } else if (line.starts_with("d ")) {
        const std::uint64_t declared = std::strtoull(line.c_str() + 2, nullptr, 10);
        std::lock_guard lock(job.mutex);
        job.snapshot.total = std::min(declared, job.request.max_bytes);
      } else if (line == "s" && !cancel_sent) {
        // Every file is decoded; the worker is writing out and syncing what it still holds.
        trace("rar worker finishing");
        enter(job, "finishing");
      } else if (line.starts_with("t ")) {
        timings = line.substr(1);
      } else if (line == "ok" || line == "cancelled" || line.starts_with("fail ")) {
        finished = true;
        succeeded = line == "ok";
        if (line.starts_with("fail ") && error.empty()) error = line.substr(5);
      }
      // Anything else is the payload loader's own output.
    }
    if (pending.size() > max_path_length * 2 && error.empty()) error = "Invalid RAR worker output.";
  }
  close_rar_worker(stream);
  job.worker_unconfirmed = !finished && !exited;
  trace("rar worker finished", error.c_str());
  {
    std::lock_guard lock(job.mutex);
    // The worker's own timings, as its "t" line names them; one from an older worker has none.
    const auto field = [&](const char* key) {
      const auto at = timings.find(" " + std::string(key) + "=");
      if (at == std::string::npos) return std::string("?");
      const auto from = at + std::strlen(key) + 2;
      return timings.substr(from, timings.find(' ', from) - from);
    };
    const auto summary = "RAR worker " + std::to_string(total >> 20) + "MiB " + std::to_string(job.snapshot.entries)
        + " entries total=" + std::to_string(elapsed_us(started) / 1000) + "ms threads=" + field("threads") + " cores=" + field("cores")
        + " decode-cpu=" + field("cpu") + " write=" + field("write") + " fsync=" + field("fsync") + " waited=" + field("waited");
    trace("throughput", summary.c_str());
  }
  if (error.empty() && !job.cancelled && !succeeded) error = finished ? "RAR extraction failed." : "The RAR worker stopped before finishing.";
  if (error.empty() && !job.cancelled) {
    std::lock_guard lock(job.mutex);
    job.snapshot.written = total;
  }
  return true;
}
std::string staging_path(const std::string& destination, unsigned attempt) {
  return destination + ".extracting" + (attempt ? "-" + std::to_string(attempt) : "");
}
// Staging a silent worker left in an earlier launch, with this extraction's ownership record or none. The
// first staging is restarted as usual unless the set is extracted already.
void remove_leftover_staging(const Request& request, const std::string& identity) {
  const auto leftover = [&](const std::string& staging) {
    struct stat st;
    std::string owner;
    if (lstat(staging.c_str(), &st) || !S_ISDIR(st.st_mode)) return false;
    const bool recorded = read_metadata(staging + "/" + stage_name, owner);
    if ((recorded && owner != "P5ST001:" + identity + "\n" && owner != "P5ST001:" + stream_identity(request) + "\n") ||
        (!recorded && !empty_directory(staging))) return true;
    if (clear_directory(staging)) rmdir(staging.c_str());
    return true;
  };
  struct stat st;
  if (!lstat(request.destination.c_str(), &st)) leftover(staging_path(request.destination, 0));
  for (unsigned attempt = 1; leftover(staging_path(request.destination, attempt)); attempt++) {}
}
void remove_owned_staging(const std::string& staging, const struct stat& owned) {
  struct stat current;
  if (lstat(staging.c_str(), &current) || current.st_dev != owned.st_dev || current.st_ino != owned.st_ino) return;
  if (clear_directory(staging)) rmdir(staging.c_str());
}
void run(const std::shared_ptr<Job>& pointer) {
  name_thread("archive");
  Job& job = *pointer;
  const auto& request = job.request;
  unsigned attempt = 0;
  {
    std::lock_guard lock(silent_guard);
    if (const auto found = silent_workers.find(request.destination); found != silent_workers.end()) attempt = found->second;
  }
  const std::string staging = staging_path(request.destination, attempt);
  struct stat st;
  const auto identity = request.stream ? stream_identity(request) : input_identity(request);
  if (identity.empty() || !regular_file(request.sources.front())) {
    fail(job, "Archive source is missing or not a regular file.");
    return;
  }
  if (!attempt) remove_leftover_staging(request, identity);
  if (!lstat(request.destination.c_str(), &st)) {
    if (S_ISDIR(st.st_mode) && recover(job, identity)) {
      std::lock_guard lock(job.mutex);
      job.snapshot.state = "completed";
    } else {
      fail(job, "Existing extraction has no matching, valid completion receipt; files preserved.");
    }
    return;
  }
  trace("start", request.sources.front().c_str());
  // A streamed set is checked on its first volume, as a partial download is; the worker refuses any later
  // header over its limits. Its paths go to the worker's line protocol.
  const auto streamed = [&] {
    const auto found = inspect({request.sources.front()});
    const bool lines = request.destination.find('\n') == std::string::npos &&
        std::none_of(request.sources.begin(), request.sources.end(), [](const std::string& path) { return path.find('\n') != std::string::npos; });
    return found.kind != "rar" || !lines ? std::string("Only a RAR set can be extracted while it downloads.") : found.refusal;
  };
  if (const auto refusal = request.stream ? streamed() : preflight(request.sources); !refusal.empty()) {
    trace("preflight refused", refusal.c_str());
    fail(job, refusal);
    return;
  }
  trace("preflight ok");
  if (!lstat(staging.c_str(), &st)) {
    std::string owner;
    // Empty staging with no ownership record is this task's own, left by a crash before it wrote one;
    // staging that holds anything without a record for these inputs is preserved.
    const bool recorded = S_ISDIR(st.st_mode) && read_metadata(staging + "/" + stage_name, owner);
    const bool abandoned = S_ISDIR(st.st_mode) && !recorded && empty_directory(staging);
    // Staging a streamed run of the same set left is this task's own too.
    const bool own = recorded && (owner == "P5ST001:" + identity + "\n" || owner == "P5ST001:" + stream_identity(request) + "\n");
    if (!abandoned && !own) {
      fail(job, "Staging belongs to another extraction; files preserved.");
      return;
    }
    if (!restart_staging(staging, st)) {
      fail(job, "Cannot restart owned extraction staging.");
      return;
    }
  }
  if (!make_directory(staging)) {
    fail(job, std::strerror(errno));
    return;
  }
  const int root = open(staging.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (root < 0) {
    fail(job, std::strerror(errno));
    return;
  }
  struct stat owned;
  if (fstat(root, &owned)) {
    fail(job, std::strerror(errno));
    close(root);
    rmdir(staging.c_str());
    return;
  }
  if (!write_metadata(staging, stage_name, "P5ST001:" + identity + "\n") || fsync(root)) {
    close(root);
    fail(job, "Cannot record extraction staging ownership.");
    return;
  }
  Receipt receipt(staging, "P5AR001:" + identity);
  std::string error;
  trace("staging ok", staging.c_str());
  {
    std::lock_guard lock(job.mutex);
    job.snapshot.state = "extracting";
    job.snapshot.phase = "extracting";
  }
  // RAR sets go to rar-extract; everything else, and RAR when the worker cannot start, to libarchive. Only
  // the worker waits for volumes: a streamed set it cannot take fails with nothing written, and the app
  // extracts it once every volume is there.
  if (request.stream) {
    if (!extract_rar(job, staging, receipt, error) && error.empty()) error = "Extracting while downloading needs the RAR worker.";
  } else if (!rar_volumes(request) || !extract_rar(job, staging, receipt, error)) {
    const MemoryHold memory;
    std::unique_ptr<Rar5PasswordReader> decrypted;
    auto* archive = open_archive(job, error, decrypted);
    if (!memory.room) error = no_memory;
    trace("opened", error.c_str());
    {
      // Without the ring or its threads, files are written inline as before.
      Writer writer(job.cancelled, job.timings);
      const bool pipelined = writer.start(pipeline_bytes(), receipt);
      trace("writer", pipelined ? "pipelined" : "inline");
      const auto started = std::chrono::steady_clock::now();
      const auto cpu_started = thread_cpu_us();
      if (error.empty()) error = extract(job, archive, staging, receipt, decrypted.get(), pipelined ? &writer : nullptr);
      const auto decoded_us = elapsed_us(started), cpu_us = thread_cpu_us() - cpu_started;
      // On an error or cancel the writer's destructor drops what is queued and closes every file.
      if (error.empty() && !job.cancelled) enter(job, "finishing");
      if (pipelined && error.empty() && !job.cancelled) error = writer.finish([&](std::size_t synced, std::size_t total) {
        std::lock_guard lock(job.mutex);
        job.snapshot.synced = synced;
        job.snapshot.sync_total = total;
      });
      // Where the time went, to tell decoding, the decoder thread not being scheduled (CPU time well under
      // its wall time with little waiting), writes and fsyncs apart on the console.
      const auto& t = job.timings;
      const auto ms = [](std::uint64_t us) { return std::to_string(us / 1000) + "ms"; };
      std::lock_guard lock(job.mutex);
      const auto summary = std::string(archive_format_name(archive) ? archive_format_name(archive) : "?") + " "
          + std::to_string(job.snapshot.written >> 20) + "MiB " + std::to_string(job.snapshot.entries) + " entries total="
          + ms(elapsed_us(started)) + " decoder=" + ms(decoded_us) + " decoder-cpu=" + (cpu_started ? ms(cpu_us) : "?")
          + " waited=" + ms(t.wait_us) + " write=" + ms(t.write_us) + "/" + std::to_string(t.writes) + " hash=" + ms(t.hash_us)
          + " fsync=" + ms(t.sync_us) + "/" + std::to_string(t.syncs);
      trace("throughput", summary.c_str());
    }
    if (decrypted && !decrypted->error().empty()) error = decrypted->error();
    trace("read", error.c_str());
    archive_read_free(archive);
  }
  // A RAR worker from before the "s" line never said it was finishing.
  if (error.empty() && !job.cancelled) enter(job, "finishing");
  if (error.empty() && !job.cancelled && request.stream) {
    // Every volume exists now: the receipt names them as a run after the download would.
    const auto full = input_identity(request);
    if (full.empty()) error = "Archive source is missing or not a regular file.";
    else receipt.set_header("P5AR001:" + full);
  }
  if (error.empty() && !job.cancelled && !receipt.commit(receipt_name)) error = "Cannot save extraction completion receipt.";
  if (error.empty() && !job.cancelled) error = collect_artifacts(job, staging);
  if (error.empty() && !job.cancelled && fsync(root)) error = std::strerror(errno);
  close(root);
  if (job.cancelled || !error.empty()) {
    // Only this task created staging. Input parts and existing destinations are never removed.
    // A console payload cannot be killed; staging stays for the next attempt rather than vanish under it.
    if (!job.worker_unconfirmed) {
      remove_owned_staging(staging, owned);
    } else {
      std::lock_guard lock(silent_guard);
      silent_workers[request.destination] = attempt + 1;
    }
    fail(job, error.empty() ? "Extraction cancelled; downloaded parts are preserved." : error);
    return;
  }
  const bool still_owned = !lstat(staging.c_str(), &st) && st.st_dev == owned.st_dev && st.st_ino == owned.st_ino;
  const bool destination_taken = !lstat(request.destination.c_str(), &st);
  if (!still_owned || destination_taken || rename(staging.c_str(), request.destination.c_str())) {
    fail(job, "Cannot publish extraction; staging and inputs were preserved.");
    return;
  }
  std::lock_guard lock(job.mutex);
  job.snapshot.state = "completed";
}
}
std::uint32_t enqueue(Request request, std::string& error) {
  std::lock_guard lock(guard);
  if (active) {
    error = "An archive task is already running; poll its completion first.";
    return 0;
  }
  if (request.sources.empty() || request.sources.size() > 1024 || request.destination.empty() || !request.max_bytes
      || request.password.size() > 1024 || request.password.find('\0') != std::string::npos) {
    error = "Invalid archive request.";
    return 0;
  }
  auto job = std::make_shared<Job>();
  job->request = std::move(request);
  job->snapshot.id = next_id++;
  job->snapshot.destination = job->request.destination;
  active = job;
  if (!job->worker.start([job] { run(job); })) {
    active.reset();
    error = "Cannot start the extraction thread.";
    return 0;
  }
  return job->snapshot.id;
}
void cancel(std::uint32_t id) {
  std::lock_guard lock(guard);
  if (active && active->snapshot.id == id) active->cancelled = true;
}
std::vector<Snapshot> poll() {
  std::lock_guard lock(guard);
  if (!active) return {};
  Snapshot snapshot;
  {
    std::lock_guard job_lock(active->mutex);
    snapshot = active->snapshot;
  }
  if (terminal(snapshot.state)) {
    active->worker.join();
    active.reset();
  }
  return {snapshot};
}
void stop() {
  std::lock_guard lock(guard);
  if (!active) return;
  active->cancelled = true;
  active->worker.join();
  active.reset();
}
}
