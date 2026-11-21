// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <memory>
#include <string>
#include <sys/stat.h>
#include <unistd.h>

namespace archives {
// Reads a file's lines in order through a small buffer. `next` is false at the end; `clean` then says
// whether the file ended on a newline (a last line cut short is not a line).
class LineReader {
public:
  explicit LineReader(int fd, std::uint64_t offset = 0) : fd_(fd), offset_(offset) {}
  bool next(std::string& line) {
    while (true) {
      const auto end = buffer_.find('\n', start_);
      if (end != std::string::npos) {
        line.assign(buffer_, start_, end - start_);
        start_ = end + 1;
        return true;
      }
      buffer_.erase(0, start_);
      start_ = 0;
      if (buffer_.size() > max_line) { failed_ = true; return false; }
      char chunk[64 * 1024];
      ssize_t got;
      do got = pread(fd_, chunk, sizeof chunk, static_cast<off_t>(offset_)); while (got < 0 && errno == EINTR);
      if (got < 0) { failed_ = true; return false; }
      if (got == 0) return false;
      offset_ += static_cast<std::uint64_t>(got);
      buffer_.append(chunk, static_cast<std::size_t>(got));
    }
  }
  bool clean() const { return !failed_ && start_ == buffer_.size(); }

private:
  static constexpr std::size_t max_line = 64 * 1024;
  int fd_;
  std::uint64_t offset_;
  std::string buffer_;
  std::size_t start_ = 0;
  bool failed_ = false;
};

// The extraction receipt: a "P5AR001:<identity>" header, then one "<sha256>|<path>" line per extracted
// file. A game folder holds hundreds of thousands of files (issue #52: ASTRO BOT and Resident Evil
// Requiem overran the 16 MiB a receipt kept in memory could take), so its lines go to a file in the
// staging folder as they come, through a 1 MiB buffer, and the receipt itself is written from that file
// at the end. Memory stays the same whatever the number of files. Used from one thread at a time.
class Receipt {
public:
  Receipt(std::string directory, std::string header) : directory_(std::move(directory)), header_(std::move(header)) {}
  ~Receipt() {
    if (fd_ >= 0) close(fd_);
    if (fd_ >= 0 || spilled_) unlink(spill_path().c_str());
  }
  Receipt(const Receipt&) = delete;
  Receipt& operator=(const Receipt&) = delete;

  // False when the line could not be kept (the disk is full or failing).
  bool add(const std::string& digest, const std::string& name) {
    if (failed_) return false;
    buffer_ += digest;
    buffer_ += '|';
    buffer_ += name;
    buffer_ += '\n';
    ++lines_;
    return buffer_.size() < buffer_bytes || flush();
  }
  std::uint64_t lines() const { return lines_; }
  void set_header(std::string header) { header_ = std::move(header); }

  // Reads the lines from line `first` on (counted from 0), in order: what one writer added, for its fsyncs.
  // Valid until the next add().
  class Lines {
  public:
    bool next(std::string& line) {
      while (skip_) {
        if (!reader_.next(line)) return false;
        --skip_;
      }
      return reader_.next(line);
    }
  private:
    friend class Receipt;
    Lines(int fd, std::uint64_t skip) : reader_(fd), skip_(skip) {}
    LineReader reader_;
    std::uint64_t skip_;
  };
  bool lines_from(std::uint64_t first, Lines*& out) {
    out = nullptr;
    if (!flush()) return false;
    lines_view_.reset(new Lines(fd_, first));
    out = lines_view_.get();
    return true;
  }

  // Writes <directory>/<name>: the header, then every line, synced. The line file goes with it. False
  // on any failure, leaving no receipt behind.
  bool commit(const char* name) {
    if (!flush()) return false;
    const auto path = directory_ + "/" + name;
    const int out = open(path.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (out < 0) return false;
    const auto header = header_ + "\n";
    bool ok = write_all(out, header.data(), header.size());
    if (ok && fd_ >= 0) {
      char chunk[256 * 1024];
      for (off_t at = 0; ok;) {
        ssize_t got;
        do got = pread(fd_, chunk, sizeof chunk, at); while (got < 0 && errno == EINTR);
        if (got < 0) ok = false;
        if (got <= 0) break;
        ok = write_all(out, chunk, static_cast<std::size_t>(got));
        at += got;
      }
    }
    if (ok && fsync(out)) ok = false;
    if (close(out)) ok = false;
    if (!ok) {
      unlink(path.c_str());
      return false;
    }
    if (fd_ >= 0) {
      close(fd_);
      fd_ = -1;
      unlink(spill_path().c_str());
      spilled_ = false;
    }
    return true;
  }

private:
  static constexpr std::size_t buffer_bytes = 1024 * 1024;
  std::string spill_path() const { return directory_ + "/.ps5-react-receipt-lines"; }
  static bool write_all(int fd, const char* data, std::size_t size) {
    while (size) {
      const auto count = write(fd, data, size);
      if (count < 0 && errno == EINTR) continue;
      if (count <= 0) return false;
      data += count;
      size -= static_cast<std::size_t>(count);
    }
    return true;
  }
  bool flush() {
    if (failed_) return false;
    if (buffer_.empty()) return true;
    if (fd_ < 0) {
      fd_ = open(spill_path().c_str(), O_RDWR | O_CREAT | O_EXCL | O_APPEND | O_NOFOLLOW, 0600);
      if (fd_ < 0) { failed_ = true; return false; }
      spilled_ = true;
    }
    if (!write_all(fd_, buffer_.data(), buffer_.size())) { failed_ = true; return false; }
    buffer_.clear();
    return true;
  }
  std::string directory_, header_, buffer_;
  int fd_ = -1;
  std::uint64_t lines_ = 0;
  bool failed_ = false, spilled_ = false;
  std::unique_ptr<Lines> lines_view_;
};
}
