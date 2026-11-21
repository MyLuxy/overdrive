// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: MIT
//
// What rar-extract's extractors share, whatever the format: the request and report lines on standard
// input and output, the engine's path rule, SHA-256 and the writer thread that writes, hashes and syncs
// every file. Free of UnRAR's headers, so the 7z extractor, which uses libarchive, includes it too.
#pragma once
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/evp.h>
#endif
#include <algorithm>
#include <cerrno>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <deque>
#include <fcntl.h>
#include <memory>
#include <mutex>
#include <poll.h>
#include <string>
#include <sys/resource.h>
#include <sys/stat.h>
#include <thread>
#include <time.h>
#include <unistd.h>
#include <vector>

namespace worker {
inline constexpr size_t max_path_length = 4096, max_line = 8192, buffer_bytes = 4 << 20, buffer_count = 4;
// Each queued file holds its descriptor; empty files take no buffer, so this bounds how far ahead they open.
inline constexpr size_t max_queued_files = 32;
inline constexpr unsigned max_depth = 128;
inline constexpr std::uint64_t progress_ns = 250000000;
inline const char* const too_much_memory = "This archive needs more memory to extract than the console app can use.";
inline constexpr size_t sha256_size = 32;

inline std::mutex say_mutex;
inline bool output_lost = false;

inline void say(const std::string& line) {
  std::lock_guard lock(say_mutex);
  const std::string text = line + "\n";
  size_t done = 0;
  while (done < text.size() && !output_lost) {
    const ssize_t count = write(STDOUT_FILENO, text.data() + done, text.size() - done);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) output_lost = true;
    else done += count;
  }
}

inline std::uint64_t now_ns() {
  timespec time;
  clock_gettime(CLOCK_MONOTONIC, &time);
  return std::uint64_t(time.tv_sec) * 1000000000 + time.tv_nsec;
}

// The request is read unsigned char by unsigned char so nothing past "end" (a later "cancel") is consumed early.
inline bool read_line(std::string& line) {
  line.clear();
  char c;
  while (line.size() < max_line) {
    const ssize_t count = read(STDIN_FILENO, &c, 1);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    if (c == '\n') return true;
    line += c;
  }
  return false;
}

// True once the engine asked to stop or went away; checked a few times a second.
inline bool stop_requested() {
  pollfd input{STDIN_FILENO, POLLIN, 0};
  if (poll(&input, 1, 0) > 0) {
    std::string line;
    if (!read_line(line) || line == "cancel") return true;
  }
  return output_lost;
}

// "a/./b" is "a/b", as the engine reads it.
inline std::string without_dots(const std::string& name) {
  std::string out;
  size_t start = 0;
  while (start <= name.size()) {
    size_t end = name.find('/', start);
    if (end == std::string::npos) end = name.size();
    const std::string part = name.substr(start, end - start);
    if (part != ".") out += (out.empty() ? "" : "/") + part;
    start = end + 1;
  }
  return out;
}

// The same rule as the engine: a relative path of plain components, no separators or controls that
// another system would read differently.
inline bool safe(const std::string& name) {
  if (name.empty() || name.size() > max_path_length || name[0] == '/') return false;
  for (unsigned char c : name)
    if (c < 32 || c == 127 || c == '|' || c == '\\' || c == ':') return false;
  size_t start = 0;
  unsigned depth = 0;
  while (start < name.size()) {
    size_t end = name.find('/', start);
    if (end == std::string::npos) end = name.size();
    const std::string part = name.substr(start, end - start);
    if (part.empty() || part == ".." || ++depth > max_depth) return false;
    start = end + 1;
  }
  return true;
}

inline bool plain_directory(const std::string& path) {
  struct stat st;
  return !lstat(path.c_str(), &st) && S_ISDIR(st.st_mode);
}

// Creates the directories of `name` under `root`, none of them a link, and returns the full path.
inline bool make_parents(const std::string& root, const std::string& name, std::string& target) {
  target = root;
  size_t start = 0, end;
  while ((end = name.find('/', start)) != std::string::npos) {
    target += "/" + name.substr(start, end - start);
    if (mkdir(target.c_str(), 0777) && errno != EEXIST) return false;
    if (!plain_directory(target)) { errno = ENOTDIR; return false; }
    start = end + 1;
  }
  target += "/" + name.substr(start);
  return true;
}

// UnRAR's own SHA-256 is portable C and slower than decoding; these use the CPU's SHA instructions.
class Sha256 {
public:
#ifdef __APPLE__
  void init() { CC_SHA256_Init(&context_); }
  void update(const void* data, size_t size) { CC_SHA256_Update(&context_, data, CC_LONG(size)); }
  void finish(unsigned char* digest) { CC_SHA256_Final(digest, &context_); }
#else
  Sha256() : context_(EVP_MD_CTX_new()) {}
  ~Sha256() { EVP_MD_CTX_free(context_); }
  void init() { EVP_DigestInit_ex(context_, EVP_sha256(), nullptr); }
  void update(const void* data, size_t size) { EVP_DigestUpdate(context_, data, size); }
  void finish(unsigned char* digest) { EVP_DigestFinal_ex(context_, digest, nullptr); }
#endif

private:
#ifdef __APPLE__
  CC_SHA256_CTX context_;
#else
  EVP_MD_CTX* context_;
#endif
};

inline std::string hex(const unsigned char* data, size_t size) {
  static const char digits[] = "0123456789abcdef";
  std::string out;
  for (size_t i = 0; i < size; ++i) { out += digits[data[i] >> 4]; out += digits[data[i] & 15]; }
  return out;
}

// Writes, hashes, syncs and closes files on a thread of its own, so decoding never waits on the disk.
// Memory is the fixed set of buffers; the decoder waits for a free one when the disk falls behind.
class Writer {
public:
  Writer() {
    for (auto& buffer : buffers_) {
      buffer.reset(new unsigned char[buffer_bytes]);
      free_.push_back(buffer.get());
    }
    thread_ = std::thread([this] { loop(); });
  }
  ~Writer() {
    {
      std::lock_guard lock(mutex_);
      quit_ = true;
    }
    changed_.notify_all();
    thread_.join();
    if (fd_ >= 0) close(fd_);
  }
  // Takes the descriptor; the file is reported as `name` once synced.
  void begin(int fd, const std::string& name) {
    current_ = nullptr;
    {
      const std::uint64_t started = now_ns();
      std::unique_lock lock(mutex_);
      changed_.wait(lock, [this] { return queued_files_ < max_queued_files; });
      ++queued_files_;
      wait_ns += now_ns() - started;
    }
    push({Command::begin, fd, name, nullptr, 0});
  }
  bool append(const unsigned char* data, size_t size) {
    while (size) {
      if (!current_ && !(current_ = take())) return false;
      const size_t count = std::min(size, buffer_bytes - used_);
      memcpy(current_ + used_, data, count);
      used_ += count;
      data += count;
      size -= count;
      if (used_ == buffer_bytes) flush();
    }
    return error().empty();
  }
  void end(std::uint64_t size) {
    if (current_) flush();
    push({Command::end, -1, {}, nullptr, size});
  }
  // Waits until every queued file is closed; the first error, if any.
  std::string finish() {
    std::unique_lock lock(mutex_);
    changed_.wait(lock, [this] { return queue_.empty() && !busy_; });
    return error_;
  }
  std::string error() {
    std::lock_guard lock(mutex_);
    return error_;
  }
  // Time in pwrite and fsync on the writer thread, and the decoder's waits for a buffer or a file slot.
  // Read once finish() returned.
  std::uint64_t write_ns = 0, sync_ns = 0, wait_ns = 0;
  unsigned writes = 0, syncs = 0;

private:
  struct Command {
    enum Type { begin, data, end } type;
    int fd;
    std::string name;
    unsigned char* buffer;
    std::uint64_t size;
  };
  unsigned char* take() {
    const std::uint64_t started = now_ns();
    std::unique_lock lock(mutex_);
    changed_.wait(lock, [this] { return !free_.empty() || !error_.empty(); });
    wait_ns += now_ns() - started;
    if (!error_.empty()) return nullptr;
    unsigned char* buffer = free_.front();
    free_.pop_front();
    used_ = 0;
    return buffer;
  }
  void flush() {
    push({Command::data, -1, {}, current_, used_});
    current_ = nullptr;
  }
  void push(Command command) {
    {
      std::lock_guard lock(mutex_);
      queue_.push_back(std::move(command));
    }
    changed_.notify_all();
  }
  void fail(const std::string& reason) {
    std::lock_guard lock(mutex_);
    if (error_.empty()) error_ = reason;
  }
  void run(Command& command) {
    if (command.type == Command::begin) {
      fd_ = command.fd;
      name_ = command.name;
      written_ = 0;
      hash_.init();
    } else if (command.type == Command::data) {
      const std::uint64_t started = now_ns();
      size_t done = 0;
      while (done < command.size && error().empty()) {
        const ssize_t count = pwrite(fd_, command.buffer + done, command.size - done, written_ + done);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) fail(strerror(count < 0 ? errno : ENOSPC));
        else done += count;
      }
      write_ns += now_ns() - started;
      ++writes;
      hash_.update(command.buffer, command.size);
      written_ += command.size;
    } else {
      if (written_ != command.size) {
        fail("Extracted file size mismatch.");
      } else {
        const std::uint64_t started = now_ns();
        if (fsync(fd_)) fail(strerror(errno));
        sync_ns += now_ns() - started;
        ++syncs;
      }
      const bool closed = !close(fd_);
      fd_ = -1;
      if (!closed) fail(strerror(errno));
      if (error().empty()) {
        unsigned char digest[sha256_size];
        hash_.finish(digest);
        say("f " + hex(digest, sizeof digest) + " " + std::to_string(written_) + " " + name_);
      }
    }
  }
  void loop() {
    std::unique_lock lock(mutex_);
    while (true) {
      changed_.wait(lock, [this] { return quit_ || !queue_.empty(); });
      if (queue_.empty()) return;
      Command command = std::move(queue_.front());
      queue_.pop_front();
      queued_files_ -= command.type == Command::begin;
      busy_ = true;
      lock.unlock();
      // After an error, commands only give their buffers and descriptors back.
      if (error().empty()) run(command);
      else if (command.type == Command::begin) close(command.fd);
      lock.lock();
      busy_ = false;
      if (command.buffer) free_.push_back(command.buffer);
      changed_.notify_all();
    }
  }

  std::unique_ptr<unsigned char[]> buffers_[buffer_count];
  std::deque<unsigned char*> free_;
  std::deque<Command> queue_;
  std::mutex mutex_;
  std::condition_variable changed_;
  std::string error_;
  bool quit_ = false, busy_ = false;
  size_t queued_files_ = 0;
  std::thread thread_;
  unsigned char* current_ = nullptr;
  size_t used_ = 0;
  // Writer thread only.
  int fd_ = -1;
  std::string name_;
  std::uint64_t written_ = 0;
  Sha256 hash_;
};

inline long cores() { return sysconf(_SC_NPROCESSORS_ONLN); }

inline std::uint64_t process_cpu_us() {
  rusage usage;
  if (getrusage(RUSAGE_SELF, &usage)) return 0;
  return (std::uint64_t(usage.ru_utime.tv_sec) + usage.ru_stime.tv_sec) * 1000000 + usage.ru_utime.tv_usec + usage.ru_stime.tv_usec;
}

inline bool flattened(const std::vector<std::string>& extensions, const std::string& name) {
  for (const auto& extension : extensions)
    if (name.size() >= extension.size() && !name.compare(name.size() - extension.size(), extension.size(), extension)) return true;
  return false;
}
}
