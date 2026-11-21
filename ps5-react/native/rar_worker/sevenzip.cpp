// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: MIT
//
// rar-extract's 7z extractor. A 7z whose decoder needs more memory than the app's own heap can give
// (most often an LZMA2 dictionary over 64 MiB, which repacks set to 256 MiB) is extracted here with
// libarchive, in this process's memory, which goes back to the console when the process exits. The
// engine sends one only when the archive's headers declare no more than the budget it names.
//
// Request, after the "7ZX1" line: "memory <bytes>" (what the headers declare the decoder needs, 0 when the
// archive stores its files), "limit <bytes>", "flatten <extension>"..., "reserved <text>", "dest <directory>",
// "source <path>"... in volume order, then "end". The engine can then write "cancel" at any time. Answers as
// for a RAR set: "ready", "p <bytes written>", "k" every second, "f <sha256> <size> <path>" once a file is on
// disk and synced, "s" once every file is decoded, "t <key>=<value>...", then "ok", "cancelled" or
// "fail <reason>".
//
// A program's malloc on the console has no ceiling of its own: the system hands over memory it takes
// from everything else, slowly (a probe on a console took 8.5 s for 512 MiB and froze its interface
// beyond that), and keeps it with this process until it exits. So the decoder's memory is taken and
// every page touched before anything is decoded; when the console needs over a second to give it, the
// extraction stops there instead of running with the console short. The block is then freed into this
// process's heap, where libarchive's own allocation finds it.
#include "sevenzip.hpp"
#include "worker_io.hpp"
#include <archive.h>
#include <archive_entry.h>
#include <chrono>
#include <cstdlib>
#include <new>

namespace sevenzip {
namespace {
using namespace worker;
const char* memory_busy = "The console has too little free memory to extract this archive now. Close other apps and retry.";
const char* unsafe = "Archive contains an unsafe path, link or special file.";
const char* too_large = "Archive exceeds the extraction size limit.";
// What the extraction holds beside the decoder: the writer's buffers and libarchive's read blocks.
constexpr std::uint64_t overhead = 32ULL << 20;
constexpr std::uint64_t claim_ms = 1000;
constexpr std::uint64_t page = 4096;
constexpr size_t read_block = 1 << 20;

struct Options {
  std::uint64_t memory = 0, limit = 0;
  std::vector<std::string> flatten, sources;
  std::string reserved, destination;
};

bool cancelled = false;  // Only the decoding thread reads and sets it.

bool read_options(Options& options) {
  std::string line;
  // A 7z that stores its files declares no decoder memory at all. That is a measured 0, not a missing line:
  // the engine always sends "memory", so the line present is what makes the request complete.
  bool memory_seen = false;
  while (read_line(line)) {
    const auto space = line.find(' ');
    const std::string key = line.substr(0, space), value = space == std::string::npos ? "" : line.substr(space + 1);
    if (key == "end") return !options.destination.empty() && !options.sources.empty() && options.limit && memory_seen;
    if (key == "memory") {
      memory_seen = true;
      options.memory = strtoull(value.c_str(), nullptr, 10);
    } else if (key == "limit") options.limit = strtoull(value.c_str(), nullptr, 10);
    else if (key == "flatten") options.flatten.push_back(value);
    else if (key == "reserved") options.reserved = value;
    else if (key == "dest") options.destination = value;
    else if (key == "source") options.sources.push_back(value);
  }
  return false;
}

// Takes `bytes` and writes a byte in every page so the console really hands them over, then frees them.
std::string claim(std::uint64_t bytes, std::uint64_t& took_ms) {
  const auto started = now_ns();
  auto* block = static_cast<volatile unsigned char*>(std::malloc(bytes));
  if (!block) return too_much_memory;
  for (std::uint64_t at = 0; at < bytes; at += page) block[at] = 1;
  took_ms = (now_ns() - started) / 1000000;
  std::free(const_cast<unsigned char*>(block));
  return took_ms > claim_ms ? memory_busy : std::string();
}

struct Progress {
  std::uint64_t written = 0, last_report = 0;
  void beat() {
    const auto now = now_ns();
    if (now - last_report < progress_ns) return;
    last_report = now;
    say("p " + std::to_string(written));
    if (stop_requested()) cancelled = true;
  }
};

// libarchive names a failed allocation in its decoder only by liblzma's code; either way it is memory.
std::string archive_failure(archive* reader, const char* fallback) {
  const char* text = archive_error_string(reader);
  if (archive_errno(reader) == ENOMEM || (text && std::strstr(text, "memory"))) return too_much_memory;
  return text && *text ? text : fallback;
}

std::string extract(const Options& options, Writer& writer, Progress& progress) {
  archive* reader = archive_read_new();
  if (!reader) return too_much_memory;
  archive_read_support_format_7zip(reader);
  std::vector<const char*> files;
  for (const auto& path : options.sources) files.push_back(path.c_str());
  files.push_back(nullptr);
  std::string error;
  if (archive_read_open_filenames(reader, files.data(), read_block) != ARCHIVE_OK) error = archive_failure(reader, "Unsupported or incomplete archive.");
  archive_entry* entry = nullptr;
  int result = ARCHIVE_OK;
  std::uint64_t declared = 0;
  // A warning is a header libarchive could only read in part, such as a name it could not convert.
  while (error.empty() && !cancelled && ((result = archive_read_next_header(reader, &entry)) == ARCHIVE_OK || result == ARCHIVE_WARN)) {
    progress.beat();
    if (cancelled) break;
    const char* raw = archive_entry_pathname_utf8(entry);
    if (!raw) {
      error = "Archive has a file name this console cannot read.";
      break;
    }
    std::string name(raw);
    while (!name.empty() && name.back() == '/') name.pop_back();
    if (!name.empty() && name[0] != '/') name = without_dots(name);
    const auto type = archive_entry_filetype(entry);
    const bool link = archive_entry_symlink(entry) || archive_entry_hardlink(entry);
    if (!safe(name) || link || (type != AE_IFREG && type != AE_IFDIR) ||
        (!options.reserved.empty() && name.find(options.reserved) != std::string::npos)) {
      error = unsafe;
      break;
    }
    const auto size = archive_entry_size(entry);
    if (type == AE_IFREG) {
      if (size < 0 || std::uint64_t(size) > options.limit - declared) {
        error = too_large;
        break;
      }
      declared += std::uint64_t(size);
      // ShadowMount's default scan reaches one subdirectory, so images are published at the set root.
      if (flattened(options.flatten, name)) name = name.substr(name.rfind('/') + 1);
    }
    std::string target;
    if (!make_parents(options.destination, name, target)) {
      error = strerror(errno);
      break;
    }
    if (type == AE_IFDIR) {
      if (mkdir(target.c_str(), 0777) && (errno != EEXIST || !plain_directory(target))) error = strerror(errno);
      continue;
    }
    const int fd = open(target.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0666);
    if (fd < 0) {
      error = strerror(errno);
      break;
    }
    writer.begin(fd, name);
    const void* data = nullptr;
    size_t bytes = 0;
    la_int64_t offset = 0;
    std::uint64_t file_written = 0;
    while (!cancelled && (result = archive_read_data_block(reader, &data, &bytes, &offset)) == ARCHIVE_OK) {
      // 7z entries come in order; a gap would be a sparse file, which 7-Zip does not write.
      if (offset < 0 || std::uint64_t(offset) != file_written) {
        error = "Unsupported or damaged 7z archive.";
        break;
      }
      if (bytes > options.limit - progress.written) {
        error = too_large;
        break;
      }
      if (!writer.append(static_cast<const unsigned char*>(data), bytes)) break;
      file_written += bytes;
      progress.written += bytes;
      progress.beat();
    }
    if (error.empty() && !cancelled && result != ARCHIVE_EOF && result != ARCHIVE_OK) error = archive_failure(reader, "Unsupported or damaged 7z archive.");
    if (error.empty()) error = writer.error();
    if (!error.empty() || cancelled) break;
    writer.end(std::uint64_t(size));
  }
  if (error.empty() && !cancelled && result != ARCHIVE_EOF) error = archive_failure(reader, "Incomplete archive headers.");
  archive_read_free(reader);
  return error;
}
}

int run() {
  // Directories and files stay usable by the app, which may run as another user than this program.
  umask(0);
  Options options;
  if (!read_options(options)) {
    say("fail Invalid 7z worker request.");
    return 1;
  }
  say("ready");
  // "k" every second says this process is alive while the claim, a long fsync or a slow block holds it.
  std::mutex alive_mutex;
  std::condition_variable alive_wake;
  bool done = false;
  std::thread alive;
  try {
    alive = std::thread([&] {
      std::unique_lock lock(alive_mutex);
      while (!alive_wake.wait_for(lock, std::chrono::seconds(1), [&] { return done; })) say("k");
    });
  } catch (...) {
  }
  std::uint64_t claim_took = 0;
  std::string error;
  {
    Progress progress;
    std::unique_ptr<Writer> writer;
    try {
      error = claim(options.memory + overhead, claim_took);
      if (error.empty()) {
        writer = std::make_unique<Writer>();
        error = extract(options, *writer, progress);
      }
    } catch (std::bad_alloc&) {
      error = too_much_memory;
    } catch (...) {
      error = "7z extraction failed.";
    }
    if (writer) {
      if (error.empty() && !cancelled) say("s");
      const auto written = writer->finish();
      if (error.empty()) error = written;
    }
    const auto ms = [](std::uint64_t ns) { return std::to_string(ns / 1000000) + "ms"; };
    std::string timings = "t threads=1 cores=" + std::to_string(cores()) + " claim=" + std::to_string(claim_took) + "ms";
    if (writer) {
      timings += " write=" + ms(writer->write_ns) + "/" + std::to_string(writer->writes) + " fsync=" + ms(writer->sync_ns) + "/" +
                 std::to_string(writer->syncs) + " waited=" + ms(writer->wait_ns);
    }
    if (const std::uint64_t cpu = process_cpu_us()) timings += " cpu=" + ms(cpu * 1000);
    say(timings);
  }
  {
    std::lock_guard lock(alive_mutex);
    done = true;
  }
  alive_wake.notify_all();
  if (alive.joinable()) alive.join();
  if (cancelled) say("cancelled");
  else say(error.empty() ? "ok" : "fail " + error);
  return error.empty() ? 0 : 1;
}
}
