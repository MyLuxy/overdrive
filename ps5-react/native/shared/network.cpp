// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "network.hpp"
#include "digest.hpp"
#include "thread_name.hpp"
#ifdef PROSPERO
#include "app_config.hpp"
#endif
#if !defined(PROSPERO) || PS5_REACT_NETWORKING
#include <curl/curl.h>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/evp.h>
#endif
#include <algorithm>
#include <array>
#include <atomic>
#include <charconv>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstring>
#include <deque>
#include <fcntl.h>
#include <memory>
#include <mutex>
#include <pthread.h>
#include <random>
#include <sys/stat.h>
#include <unistd.h>
#include <sys/socket.h>

namespace network {
namespace {
using Clock = std::chrono::steady_clock;
// Every transfer holds one block while it fills, so the pool must stay well above the connection
// count: at 64 connections, 256 KiB blocks left none free for the writer queue.
constexpr std::size_t block_size = 128 * 1024, block_count = 128;
constexpr unsigned max_connections = 64, max_jobs = 8, max_ranges = 65536;
// The smallest part a range is split into: each split costs a request and closes the cut connection.
constexpr std::uint64_t min_split = 1024 * 1024;
// Two writers keep one large write going while the next batch is copied; more did not raise PS5 storage
// throughput. Every buffer here comes out of the title's one heap (128 MiB at the least), shared with images and JS.
constexpr unsigned writer_count = 2;
static_assert(sizeof(off_t) >= 8, "Large downloads require 64-bit file offsets");
constexpr std::uint64_t safe_integer = 9007199254740991ULL;
std::atomic<bool> downloading_file{false};

// Used for optional final-file verification and checkpoint identity, off the JS thread.
using integrity::Hash;

struct Source {
  Piece piece;
  std::string etag, location;
  bool ranged = false;
};
struct Segment {
  std::uint64_t begin = 0, length = 0;
  unsigned source = 0;
};
struct Job {
  explicit Job(Request value, std::uint32_t id) : request(std::move(value)) {
    snapshot.id = id; snapshot.destination = request.destination;
  }
  ~Job() { if (root_fd >= 0) close(root_fd); }
  Request request;
  Snapshot snapshot;
  std::mutex mutex;
  std::atomic<bool> cancelled{false}, failed{false}, finalized{false}, syncing{false};
  std::atomic<unsigned> pending{0};
  int fd = -1;
  int root_fd = -1;
  struct stat root_stat{};
  // Read and written by every writer thread; 0 forces the next check.
  std::atomic<Clock::rep> storage_checked{0};
  // A strong ETag, else Last-Modified; without a strong ETag a resume first compares a sample (check_sample).
  std::string etag, last_modified, location, identity, response, receipt_identity, verified_digest;
  std::vector<unsigned char> completed;
  std::vector<Source> sources;
  // Mirrors whose size and ETag matched the primary; one that fails a range is emptied.
  std::vector<std::string> mirrors;
  std::vector<Segment> segments;
  std::uint64_t total = 0, committed = 0;
  unsigned retries = 0, splits = 0;
  bool ranged = false, known = false, checkpoint_ready = false, recovering = false;
  void fail(const std::string& reason) {
    std::lock_guard lock(mutex);
    if (failed.exchange(true)) return;
    snapshot.error = reason;
    platform_log(("download failed: " + reason).c_str());
  }
};

const char* terminal_state(const Job& job) {
  if (job.failed) return "failed";
  if (job.cancelled) return "cancelled";
  return "completed";
}

struct Block { char* data = nullptr; };
class Service;
struct Transfer {
  Service* owner = nullptr;
  CURL* curl = nullptr;
  curl_slist* headers = nullptr;
  std::shared_ptr<Job> job;
  Block* block = nullptr;
  std::size_t fill = 0, header_bytes = 0;
  // `length` is where the range ends now; `requested` is what the server was asked for, which stays
  // larger once the range is split and its tail handed to another connection (`cut`).
  std::uint64_t begin = 0, length = 0, requested = 0, accepted = 0, block_offset = 0;
  std::atomic<std::uint64_t> written{0};
  std::atomic<unsigned> pending{0};
  // `attempt` counts this span's tries: the parts of a split range each get their own.
  unsigned piece = 0, source = 0, retry_after = 0, window = 0, attempt = 0;
  unsigned mirror = 0; // 0 is the primary URL, n is Job::mirrors[n-1]
  long status = 0;
  std::string etag, last_modified, encoding, error, content_type, html_prefix, sample;
  // A probe requests these bytes; only a sample check keeps them (in `sample`).
  std::uint64_t probe_from = 0, probe_length = 1;
  std::vector<std::pair<std::string, std::string>> response_headers;
  std::uint64_t content_length = 0;
  bool length_known = false;
  std::uint64_t range_begin = 0, range_end = 0, range_total = 0;
  bool content_range = false, probe = false, paused = false, active = false, draining = false, redirected = false, cut = false;
  // Paused by the rate limit until its shared budget refills (paused waits for a free disk block).
  bool rate_paused = false;
  // A 200 or 206 that is not the range asked for but carries the file's validators: a proxy or a busy
  // node answering oddly, retried a few times rather than taken for a changed file.
  bool glitch = false;
  // Opened while its origin cooled down: once answered on a fresh connection, the cooldown ends.
  bool gated = false;
  Clock::time_point started{};
  CURLcode result = CURLE_OK;
};

bool valid_file_response(const Transfer& t) {
  const Job& job = *t.job;
  if (!t.encoding.empty() && t.encoding != "identity") return false;
  if (job.request.reject_html && (t.content_type.starts_with("text/html") ||
      t.content_type.starts_with("application/xhtml+xml"))) return false;
  if (!job.sources.empty()) {
    const auto& source = job.sources[t.source];
    if (!source.ranged) return t.status == 200;
    const auto begin = t.begin-source.piece.offset;
    return t.status == 206 && t.content_range && t.range_begin == begin &&
      t.range_end == begin+t.requested-1 && t.range_total == source.piece.size &&
      (source.etag.empty() || t.etag == source.etag);
  }
  if (!job.ranged) return t.status == 200;
  return t.status == 206 && t.content_range && t.range_begin == t.begin &&
         t.range_end == t.begin+t.requested-1 && t.range_total == job.total &&
         (job.etag.empty() || t.etag == job.etag) && (job.last_modified.empty() || t.last_modified == job.last_modified);
}

// Judges a 200/206 that valid_file_response refused. Only validators that differ on the very URL they
// came from mean the file changed; a range that was redirected elsewhere may have reached another
// node's copy, and a right file with the wrong span is a glitch to retry.
void classify_invalid(Transfer& t) {
  const Job& job = *t.job;
  if (!t.encoding.empty() && t.encoding != "identity") { t.error = "server sent the file with Content-Encoding " + t.encoding; return; }
  if (job.request.reject_html && (t.content_type.starts_with("text/html") ||
      t.content_type.starts_with("application/xhtml+xml"))) {
    t.error = "provider returned a web page; browser verification required"; return;
  }
  const Source* source = job.sources.empty() ? nullptr : &job.sources[t.source];
  const bool ranged = source ? source->ranged : job.ranged;
  const auto& etag = source ? source->etag : job.etag;
  const auto total = source ? source->piece.size : job.total;
  const bool changed = (!etag.empty() && !t.etag.empty() && t.etag != etag) ||
    (!source && !job.last_modified.empty() && !t.last_modified.empty() && t.last_modified != job.last_modified) ||
    (ranged && t.content_range && t.range_total != total);
  long redirects = 0;
  curl_easy_getinfo(t.curl, CURLINFO_REDIRECT_COUNT, &redirects);
  t.glitch = !changed || redirects > 0;
  t.error = changed ? "server changed the resource (ETag, Last-Modified or size differ)" :
    t.status == 200 ? "server ignored the byte range (HTTP 200)" : "server returned an unexpected range response (HTTP " + std::to_string(t.status) + ")";
}

// Error statuses carry no file bytes and are judged by the retry policy; anything else must be exactly
// the bytes asked for.
bool accept_response(Transfer& t) {
  if (t.status != 200 && t.status != 206) return false;
  if (valid_file_response(t)) return true;
  classify_invalid(t);
  return false;
}

std::string describe(const Transfer& t) {
  if (!t.error.empty()) return t.error;
  if (t.status >= 400) return "server answered HTTP " + std::to_string(t.status);
  return curl_easy_strerror(t.result);
}

// Signed links expire mid-download; the app re-resolves the source page on this message.
bool denied(Transfer& t) {
  if (t.status != 401 && t.status != 403) return false;
  t.error = "provider denied the file; link expired or browser verification required (HTTP " + std::to_string(t.status) + ")";
  return true;
}

// Ranges skip the redirect hop by reusing the probe's final URL. Such a URL can expire (signed CDN
// links) or its node can stop serving, so a client error there, or a server error on a range's second
// attempt, resolves the original URL again; the next range it lands pins the new target.
bool forget_redirect(Job& job, const Transfer& t, unsigned attempt) {
  if (!t.redirected || t.status < 400 || (t.status >= 500 && attempt < 2)) return false;
  (job.sources.empty() ? job.location : job.sources[t.source].location).clear();
  return true;
}

// A mirror that fails a range, even transiently, is dropped and the range retried on the primary:
// a lost mirror costs only speed, while retrying it could exhaust the range's attempts.
bool forget_mirror(Job& job, const Transfer& t) {
  if (!t.mirror || job.mirrors[t.mirror-1].empty()) return false;
  job.mirrors[t.mirror-1].clear();
  return true;
}

// Transfers are spread over the primary and the mirrors still in use. Each transfer slot keeps one
// server so its connection is reused; picking per range reconnected and kept idle TLS sessions alive.
unsigned pick_mirror(const Job& job, unsigned slot) {
  if (job.mirrors.empty()) return 0;
  const auto index = static_cast<unsigned>(slot % (job.mirrors.size()+1));
  return index && !job.mirrors[index-1].empty() ? index : 0;
}

// A busy or overloaded server: the range is retried and the origin's connection window shrinks.
bool congested(const Transfer& t) {
  if (!t.error.empty()) return false;
  if (t.status == 408 || t.status == 429 || (t.status >= 500 && t.status <= 599)) return true;
  switch (t.result) {
    case CURLE_RECV_ERROR: case CURLE_SEND_ERROR: case CURLE_OPERATION_TIMEDOUT: case CURLE_PARTIAL_FILE:
    case CURLE_COULDNT_CONNECT: case CURLE_GOT_NOTHING: case CURLE_SSL_CONNECT_ERROR: case CURLE_COULDNT_RESOLVE_HOST:
      return true;
    default: return false;
  }
}

// The origin turned the connection down before answering anything: TCP or TLS refused, or no reply
// in time. MediaFire sheds new TLS handshakes this way while its open connections keep streaming.
bool refused_connection(const Transfer& t) {
  return !t.status && !t.header_bytes && (t.result == CURLE_COULDNT_CONNECT ||
    t.result == CURLE_SSL_CONNECT_ERROR || t.result == CURLE_OPERATION_TIMEDOUT);
}

// A transfer loop pass this long after the previous one means the process was suspended (rest mode,
// or another app in front); passes are otherwise at most 50 ms apart. Rest mode may stop the monotonic
// clock, so the wall clock is compared as well.
constexpr auto suspension_gap = std::chrono::seconds(10);
// After a suspension the console's network takes a while to come back, and connections that crossed
// it may only time out (LOW_SPEED_TIME, 30 s): connection failures until then are not a busy server.
constexpr auto suspension_grace = std::chrono::seconds(60);

// A broken connection that a suspension explains. An HTTP error is the server's answer, which the
// connection survived: it counts as ever.
bool cut_by_suspension(const Transfer& t, Clock::time_point now, Clock::time_point grace_until) {
  return t.status < 400 && congested(t) && now < grace_until;
}

// Total attempts a range (or probe) gets after this failure; 0 fails the job at once.
unsigned attempt_limit(const Transfer& t) {
  if (congested(t)) return 8;
  if (t.glitch) return 3;
  return 0;
}

// Exponential from half a second up to 30 seconds, with jitter so throttled ranges do not return
// together, and never sooner than the server's Retry-After (up to a minute).
std::chrono::milliseconds retry_delay(const Transfer& t, unsigned attempt) {
  static std::minstd_rand random(static_cast<unsigned>(Clock::now().time_since_epoch().count()));
  const unsigned base = std::min(30000u, 500u << std::min(attempt-1, 6u));
  const unsigned jittered = base/2 + static_cast<unsigned>(random() % (base/2+1));
  return std::chrono::milliseconds(std::max(std::min(t.retry_after, 60u)*1000u, jittered));
}

// One line per failed range, with what the server answered: enough to tell throttling from a changed file.
void log_failure(const Transfer& t, unsigned attempt) {
  const auto header = [&](const char* name) {
    for (const auto& [key, value] : t.response_headers) if (key == name) return value;
    return std::string("-");
  };
  char* effective = nullptr;
  curl_easy_getinfo(t.curl, CURLINFO_EFFECTIVE_URL, &effective);
  const std::string line = "download range " + std::to_string(t.piece) + " attempt " + std::to_string(attempt) +
    " failed: " + describe(t) + "; HTTP " + std::to_string(t.status) + " range=" + header("content-range") +
    " length=" + header("content-length") + " etag=" + header("etag") + " encoding=" + (t.encoding.empty() ? "-" : t.encoding) +
    " retry-after=" + header("retry-after") + " accepted=" + std::to_string(t.accepted) + "/" + std::to_string(t.length) +
    " url=" + (effective ? effective : "-");
  platform_log(line.c_str());
}

struct Write {
  std::shared_ptr<Job> job;
  Transfer* transfer = nullptr;
  Block* block = nullptr;
  std::uint64_t offset = 0;
  std::size_t size = 0;
  std::vector<unsigned char> checkpoint;
};

struct Checkpoint {
  char magic[8] = {'P','5','R','D','L','0','0','1'};
  std::uint64_t total = 0, range_bytes = 0;
  std::uint32_t count = 0;
  char identity[65] = {};
};

bool write_all(int fd, const void* bytes, std::size_t size, std::uint64_t offset) {
  const char* data = static_cast<const char*>(bytes);
  while (size) {
    const ssize_t n = pwrite(fd, data, size, static_cast<off_t>(offset));
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return false;
    data += n; size -= static_cast<std::size_t>(n); offset += static_cast<std::uint64_t>(n);
  }
  return true;
}

bool read_all(int fd, void* bytes, std::size_t size) {
  char* data = static_cast<char*>(bytes);
  while (size) {
    const ssize_t n = read(fd, data, size);
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0) return false;
    data += n; size -= static_cast<std::size_t>(n);
  }
  return true;
}

std::string system_error(const char* action) {
  return std::string(action) + ": " + std::strerror(errno);
}

bool storage_matches(Job& job) {
  if (job.root_fd < 0) return true;
  const auto now = Clock::now().time_since_epoch().count();
  const auto checked = job.storage_checked.load();
  if (checked && now-checked < std::chrono::duration_cast<Clock::duration>(std::chrono::seconds(1)).count()) return true;
  job.storage_checked = now;
  struct stat current;
  if (stat(job.request.storage_root.c_str(), &current) != 0 || current.st_dev != job.root_stat.st_dev ||
      current.st_ino != job.root_stat.st_ino) {
    job.fail("storage disconnected or changed; reconnect the original drive before resuming"); return false;
  }
  return true;
}

bool sync_parent(const std::string& path) {
  const auto parent = path.substr(0, path.find_last_of('/'));
  const int fd = open(parent.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
  if (fd < 0) return false;
  const int result = fsync(fd), saved = errno;
  close(fd);
  // Some filesystems do not implement directory fsync.
  return result == 0 || saved == EINVAL || saved == ENOTSUP;
}

struct CompletionReceipt {
  char magic[8] = {'P', 'S', '5', 'D', 'O', 'N', 'E', '1'};
  // Empty when the request had no hash to check: the file was not read back to make one.
  char identity[65]{}, sha256[65]{};
  std::uint64_t total = 0, device = 0, inode = 0;
};

std::string receipt_identity(const Job& job) {
  Hash hash;
  const auto add = [&](const std::string& value) {
    return hash.update(value.data(), value.size()) && hash.update("\0", 1);
  };
  // URLs are left out, like the checkpoint's: a re-resolved signed link still names the same file.
  if (!add(job.request.sha256) || !add(std::to_string(job.request.expected_bytes)) ||
      !add(std::to_string(job.root_stat.st_dev)) || !add(std::to_string(job.root_stat.st_ino))) return {};
  for (const auto& piece : job.request.pieces)
    if (!add(piece.sha1) || !add(std::to_string(piece.offset)) || !add(std::to_string(piece.size))) return {};
  return hash.finish();
}

bool save_receipt(Job& job) {
  struct stat file{};
  if (fstat(job.fd, &file) != 0) { job.fail(system_error("inspect completed file")); return false; }
  CompletionReceipt receipt;
  std::memcpy(receipt.identity, job.receipt_identity.c_str(), 64);
  std::memcpy(receipt.sha256, job.verified_digest.data(), std::min<std::size_t>(64, job.verified_digest.size()));
  receipt.total = job.total; receipt.device = file.st_dev; receipt.inode = file.st_ino;
  const auto path = job.request.destination+".complete", temporary = path+".tmp";
  const int fd = open(temporary.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0600);
  if (fd < 0) { job.fail(system_error("open completion receipt")); return false; }
  bool ok = write_all(fd, &receipt, sizeof receipt, 0) && fsync(fd) == 0;
  if (close(fd) != 0) ok = false;
  if (ok) ok = rename(temporary.c_str(), path.c_str()) == 0 && sync_parent(path);
  if (!ok) job.fail(system_error("save completion receipt"));
  return ok;
}

bool recover_file(Job& job) {
  CompletionReceipt receipt, expected;
  const int meta = open((job.request.destination+".complete").c_str(), O_RDONLY | O_NOFOLLOW);
  const bool valid = meta >= 0 && read_all(meta, &receipt, sizeof receipt) &&
    !std::memcmp(receipt.magic, expected.magic, sizeof receipt.magic) &&
    !std::memcmp(receipt.identity, job.receipt_identity.c_str(), 65) && receipt.sha256[64] == '\0' &&
    (!receipt.sha256[0] || std::all_of(receipt.sha256, receipt.sha256+64, [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); }));
  if (meta >= 0) close(meta);
  struct stat file{};
  job.fd = open(job.request.destination.c_str(), O_RDONLY | O_NOFOLLOW);
  if (!valid || job.fd < 0 || fstat(job.fd, &file) != 0 || !S_ISREG(file.st_mode) || file.st_size < 0 ||
      static_cast<std::uint64_t>(file.st_size) != receipt.total ||
      static_cast<std::uint64_t>(file.st_dev) != receipt.device || static_cast<std::uint64_t>(file.st_ino) != receipt.inode ||
      (!job.request.sha256.empty() && job.request.sha256 != receipt.sha256) ||
      (job.request.expected_bytes && receipt.total != job.request.expected_bytes)) {
    if (job.fd >= 0) close(job.fd);
    job.fd = -1;
    job.fail("existing destination has no matching completion receipt; preserve it and inspect it"); return false;
  }
  // The receipt is trusted for its own file (same root, inode and size); the content is read again
  // only to check a hash the request expects.
  job.total = job.committed = receipt.total; job.known = job.recovering = true;
  return true;
}

// The PS5 libkernel gives titles no link(): its import binds to null and the first call faults.
// Reporting ENOTSUP sends publication down the exclusive-reserve-and-rename path instead.
int hard_link(const char* from, const char* to) {
#ifdef PROSPERO
  (void)from; (void)to;
  errno = ENOTSUP;
  return -1;
#else
  return link(from, to);
#endif
}

bool publish_file(Job& job) {
  // Persist proof of verification before the final name can become visible.
  if (job.request.recover_completed && !save_receipt(job)) return false;
  const std::string partial = job.request.destination+".part";
  if (hard_link(partial.c_str(), job.request.destination.c_str()) == 0) {
    if (unlink(partial.c_str()) != 0) { job.fail(system_error("remove published partial")); return false; }
  } else {
    if (errno != EPERM && errno != ENOTSUP && errno != ENOSYS) {
      job.fail(system_error("publish completed file without overwriting")); return false;
    }
    // exFAT cannot create hard links. Reserve the destination exclusively before rename.
    const int reserved = open(job.request.destination.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
    if (reserved < 0) { job.fail(system_error("reserve completed filename")); return false; }
    close(reserved);
    if (rename(partial.c_str(), job.request.destination.c_str()) != 0) {
      const int saved = errno; unlink(job.request.destination.c_str()); errno = saved;
      job.fail(system_error("publish completed file")); return false;
    }
  }
  unlink((job.request.destination+".resume").c_str());
  if (!sync_parent(job.request.destination)) { job.fail(system_error("sync completed directory")); return false; }
  return true;
}

bool checkpoint(Job& job, const std::vector<unsigned char>& completed) {
  if (!job.ranged) return true;
  if (fsync(job.fd) != 0) { job.fail(system_error("sync partial file")); return false; }
  Checkpoint header;
  header.total = job.total; header.range_bytes = job.request.range_bytes;
  header.count = static_cast<std::uint32_t>(completed.size());
  std::memcpy(header.identity, job.identity.c_str(), 64);
  const std::string path = job.request.destination + ".resume", temporary = path + ".tmp";
  const int fd = open(temporary.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0600);
  if (fd < 0) { job.fail(system_error("open checkpoint")); return false; }
  bool ok = write_all(fd, &header, sizeof header, 0) &&
            write_all(fd, completed.data(), completed.size(), sizeof header) && fsync(fd) == 0;
  if (close(fd) != 0) ok = false;
  if (ok) ok = rename(temporary.c_str(), path.c_str()) == 0;
  if (ok) ok = sync_parent(path);
  if (!ok) job.fail(system_error("save checkpoint"));
  return ok;
}

bool verify_file(Job& job) {
  const bool piece_hashes = std::any_of(job.sources.begin(), job.sources.end(),
    [](const Source& source) { return !source.piece.sha1.empty(); });
  if (job.request.sha256.empty() && !piece_hashes) return true;
  { std::lock_guard lock(job.mutex); job.snapshot.state = "verifying"; }
  Hash hash;
  auto buffer = std::make_unique<char[]>(block_size);
  std::size_t source = 0;
  auto piece_hash = std::make_unique<Hash>(true);
  for (std::uint64_t offset = 0; offset < job.total;) {
    if (job.cancelled) return false;
    const auto end = job.sources.empty() ? job.total :
      job.sources[source].piece.offset+job.sources[source].piece.size;
    const auto wanted = static_cast<std::size_t>(std::min<std::uint64_t>(block_size, end-offset));
    const ssize_t n = pread(job.fd, buffer.get(), wanted, static_cast<off_t>(offset));
    if (n < 0 && errno == EINTR) continue;
    if (n <= 0 || !hash.update(buffer.get(), static_cast<std::size_t>(n))) {
      job.fail("read/hash verification failed"); return false;
    }
    offset += static_cast<std::uint64_t>(n);
    if (!job.sources.empty()) {
      if (!piece_hash->update(buffer.get(), static_cast<std::size_t>(n))) {
        job.fail("SHA-1 verification failed"); return false;
      }
      if (offset == end) {
        const auto& expected = job.sources[source].piece.sha1;
        if (!expected.empty() && piece_hash->finish() != expected) {
          job.fail("SHA-1 mismatch in piece " + std::to_string(source)); return false;
        }
        ++source;
        piece_hash = std::make_unique<Hash>(true);
      }
    }
  }
  job.verified_digest = hash.finish();
  if (job.verified_digest.empty()) { job.fail("SHA-256 verification failed"); return false; }
  if (!job.request.sha256.empty() && job.verified_digest != job.request.sha256) { job.fail("SHA-256 mismatch"); return false; }
  return true;
}

} // namespace

bool configure_transport(void* handle, const std::string& url, bool follow_redirects) {
  CURL* curl = static_cast<CURL*>(handle);
  bool ok = true;
  const auto set = [&](CURLoption option, auto value) {
    if (curl_easy_setopt(curl, option, value) != CURLE_OK) ok = false;
  };
  set(CURLOPT_URL, url.c_str());
  set(CURLOPT_NOSIGNAL, 1L);
  set(CURLOPT_PROTOCOLS_STR, "http,https");
  set(CURLOPT_REDIR_PROTOCOLS_STR, url.starts_with("https:") ? "https" : "http,https");
  set(CURLOPT_FOLLOWLOCATION, follow_redirects ? 1L : 0L);
  set(CURLOPT_MAXREDIRS, 5L);
  set(CURLOPT_HTTP_VERSION, static_cast<long>(CURL_HTTP_VERSION_1_1));
  set(CURLOPT_SSL_VERIFYPEER, 1L); set(CURLOPT_SSL_VERIFYHOST, 2L);
  if (const char* path = ca_path()) set(CURLOPT_CAINFO, path);
  set(CURLOPT_ACCEPT_ENCODING, "identity");
  set(CURLOPT_USERAGENT, "PS5React/0.1");
  set(CURLOPT_CONNECTTIMEOUT, 10L);
  set(CURLOPT_LOW_SPEED_LIMIT, 1L); set(CURLOPT_LOW_SPEED_TIME, 30L);
  set(CURLOPT_TCP_KEEPALIVE, 1L);
#ifdef PROSPERO
  set(CURLOPT_IPRESOLVE, static_cast<long>(CURL_IPRESOLVE_V4));
  set(CURLOPT_SOCKOPTFUNCTION, +[](void*, curl_socket_t fd, curlsocktype)->int {
    int enabled = 1;
    // The console's default receive window caps each connection far below the link on
    // high-latency origins; 2 MiB matches what Spectrum requests. A refusal keeps the default.
    int window = 2*1024*1024;
    setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &window, sizeof window);
    return setsockopt(fd, SOL_SOCKET, 0x1200, &enabled, sizeof enabled) == 0 ? CURL_SOCKOPT_OK : CURL_SOCKOPT_ERROR;
  });
#endif
  return ok;
}

namespace {
std::string host_of(const std::string& url) {
  const auto scheme = url.find("://");
  const auto start = scheme == std::string::npos ? 0 : scheme+3;
  const auto end = url.find_first_of("/?#", start);
  return url.substr(start, end == std::string::npos ? std::string::npos : end-start);
}

// The URL configure() requests for a range of this source on this mirror.
const std::string& range_url(const Job& job, unsigned source, unsigned mirror) {
  if (!job.sources.empty()) {
    const auto& s = job.sources[source];
    return s.location.empty() ? s.piece.url : s.location;
  }
  if (mirror) return job.mirrors[mirror-1];
  return job.location.empty() ? job.request.url : job.location;
}

// An origin that refuses connections cools down for five seconds after the last refusal: new connections
// one at a time, from a quarter second apart up to four, and splits only onto connections left open by
// finished ranges, which curl reuses without a handshake. Without it a console opened 121 handshakes into
// a MediaFire refusal burst and sat at one connection for half a minute.
constexpr auto cooldown = std::chrono::seconds(5);

// Connections one origin may hold, adapted like TCP congestion control (AIMD). It starts small and
// grows by half each second while the window is nine-tenths busy and healthy (a console download sat at
// 25 of 27 for most of a 1.27 GB file, never full at the instant of the check); a 5xx, 429, 408 or broken connection
// halves it, after which it grows by one a second. archive.org storage nodes answer HTTP 500 to some
// ranges past about a dozen connections, while CDNs take all 64.
struct Window {
  std::string host;
  // `idle` counts the connections finished ranges left open, which the next transfers reuse.
  unsigned allowed = 0, in_flight = 0, refusals = 0, idle = 0;
  bool congested = false;
  Clock::time_point grown{}, shrunk{}, paused_until{}, refused{}, next_connect{};
  bool open(Clock::time_point now) const { return in_flight < allowed && now >= paused_until && (idle || now >= next_connect); }
  bool cooling(Clock::time_point now) const { return refusals && now-refused < cooldown; }
  std::chrono::milliseconds gap() const {
    static std::minstd_rand random(static_cast<unsigned>(Clock::now().time_since_epoch().count()));
    const unsigned base = 250u << std::min(refusals-1, 4u);
    return std::chrono::milliseconds(base/2 + random() % (base/2+1));
  }
  // Connections opened together are refused together, so the gap steps once per gap; a refusal after
  // a quiet cooldown starts over.
  void refuse(Clock::time_point now) {
    if (!cooling(now)) refusals = 0;
    if (now >= next_connect) {
      refusals = std::min(refusals+1, 5u);
      platform_log(("download: " + host + " refused a connection; new ones spaced up to " +
                    std::to_string(250u << (refusals-1)) + " ms").c_str());
    }
    refused = now; next_connect = std::max(next_connect, now+gap());
  }
  // Whether this transfer needs a new connection, which the cooldown paces.
  bool connecting(Clock::time_point now) {
    if (idle) { --idle; return false; }
    if (cooling(now)) next_connect = now+gap();
    return true;
  }
  // A connection opened at `since` was accepted, with no refusal after: splits and full pacing resume.
  void accepted(Clock::time_point since) {
    if (!cooling(since) || refused >= since) return;
    refused = since-cooldown; next_connect = {};
    platform_log(("download: " + host + " accepts connections again").c_str());
  }
  void grow(Clock::time_point now, unsigned limit) {
    if (allowed >= limit || in_flight+allowed/10 < allowed || now-grown < std::chrono::seconds(1) ||
        now-shrunk < std::chrono::seconds(3)) return;
    allowed = std::min(limit, congested ? allowed+1 : allowed+std::max(2u, allowed/2));
    grown = now;
  }
  void shrink(Clock::time_point now, unsigned retry_after) {
    if (retry_after) paused_until = std::max(paused_until, now+std::chrono::seconds(std::min(retry_after, 60u)));
    // Ranges failing together report one overload: one cut per two seconds.
    if (congested && now-shrunk < std::chrono::seconds(2)) return;
    allowed = std::max(1u, std::min(allowed, in_flight+1)/2);
    congested = true; shrunk = grown = now;
  }
};

class Service {
public:
  bool start();
  void stop();
  std::uint32_t enqueue(Request request, std::string& error);
  void cancel(std::uint32_t id);
  std::vector<Snapshot> poll();
  bool running() const { return running_; }
  void set_rate_limit(std::uint64_t bytes_per_second) { rate_limit_ = bytes_per_second; }
private:
  std::mutex mutex_, disk_mutex_;
  std::condition_variable wake_, disk_wake_, sync_wake_;
  std::deque<std::shared_ptr<Job>> jobs_, waiting_;
  std::deque<Write> writes_, syncs_;
  std::vector<Block*> free_;
  std::array<Block, block_count> blocks_{};
  std::array<Transfer, max_connections> transfers_{};
  CURLM* multi_ = nullptr;
  std::atomic<bool> stopping_{false}, writer_stopping_{false};
  std::atomic<unsigned> write_max_us_{0}, sync_max_us_{0};
  std::atomic<std::uint64_t> write_calls_{0}, write_bytes_{0};
  // The rate limit: a budget of bytes refilled each pass of the transfer loop, which callbacks spend.
  // Only the network thread touches the budget; the limit itself is set from JavaScript's thread.
  std::atomic<std::uint64_t> rate_limit_{0};
  double rate_budget_ = 0;
  Clock::time_point rate_refilled_{};
  std::size_t rate_turn_ = 0;
  void refill_rate(Clock::time_point now);
  void resume_rate_paused(Job& job);
  std::uint64_t perform_us_ = 0;
  pthread_t network_thread_{}, sync_thread_{};
  std::array<pthread_t, writer_count> writer_threads_{};
  unsigned writers_started_ = 0;
  bool running_ = false, network_started_ = false, sync_started_ = false, platform_started_ = false, curl_started_ = false;
  std::uint32_t next_id_ = 1;
  std::string error_;
  Block* take_block() {
    std::lock_guard lock(disk_mutex_);
    if (free_.empty()) return nullptr;
    Block* out = free_.back(); free_.pop_back(); return out;
  }
  void release(Block* block) {
    std::lock_guard lock(disk_mutex_); free_.push_back(block);
  }
  void flush(Transfer& t) {
    if (!t.block) return;
    if (!t.fill) { release(t.block); t.block = nullptr; return; }
    Write command; command.job = t.job; command.transfer = &t; command.block = t.block;
    command.offset = t.block_offset; command.size = t.fill;
    ++t.pending; ++t.job->pending;
    { std::lock_guard lock(disk_mutex_); writes_.push_back(std::move(command)); }
    t.block = nullptr; t.fill = 0; disk_wake_.notify_one();
  }
  // Checkpoints fsync the partial file, which can take seconds on console storage.
  // They run on their own thread so block writes, and therefore reception, keep flowing.
  void queue_checkpoint(const std::shared_ptr<Job>& job) {
    if (job->syncing.exchange(true)) return;
    Write command; command.job = job; command.checkpoint = job->completed;
    ++job->pending;
    { std::lock_guard lock(disk_mutex_); syncs_.push_back(std::move(command)); }
    sync_wake_.notify_one();
  }
  void network_loop();
  void writer_loop();
  void sync_loop();
  void finalize(Job& job);
  static void record_max(std::atomic<unsigned>& slot, Clock::time_point started) {
    const auto us = static_cast<unsigned>(std::chrono::duration_cast<std::chrono::microseconds>(Clock::now()-started).count());
    unsigned seen = slot.load();
    while (us > seen && !slot.compare_exchange_weak(seen, us)) {}
  }
  void log_stats(const Job& job, unsigned allowed, std::uint64_t& previous_received, std::uint64_t& previous_written);
  void run_job(const std::shared_ptr<Job>& job);
  bool prepare(Job& job);
  bool probe_source(Job& job, unsigned source);
  bool check_sample(Job& job);
  void verify_mirrors(Job& job);
  CURLcode perform_probe(Transfer& probe);
  bool configure(Transfer& t);
  void finish_transfer(Transfer& t);
  void snapshot(Job& job, unsigned allowed, Clock::time_point now, Clock::time_point& previous,
                std::uint64_t& previous_written);
  static std::size_t body(char* bytes, std::size_t size, std::size_t count, void* opaque);
  static std::size_t header(char* bytes, std::size_t size, std::size_t count, void* opaque);
  static int progress(void* opaque, curl_off_t, curl_off_t, curl_off_t, curl_off_t) {
    return static_cast<Transfer*>(opaque)->job->cancelled.load() ? 1 : 0;
  }
};
Service service;

bool spawn(pthread_t& thread, void* (*entry)(void*), void* data) {
  pthread_attr_t attributes;
  if (pthread_attr_init(&attributes) != 0) return false;
  const int stack = pthread_attr_setstacksize(&attributes, 1024 * 1024);
  const int result = stack ? stack : pthread_create(&thread, &attributes, entry, data);
  pthread_attr_destroy(&attributes);
  return result == 0;
}

bool Service::start() {
  if (running_) return true;
  stopping_ = false; writer_stopping_ = false;
  platform_started_ = platform_start(error_);
  if (!platform_started_) return false;
  if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) { error_ = "curl initialization failed"; stop(); return false; }
  curl_started_ = true;
  multi_ = curl_multi_init();
  if (!multi_) { error_ = "curl multi initialization failed"; stop(); return false; }
  for (Block& block : blocks_) {
    block.data = static_cast<char*>(std::malloc(block_size));
    if (!block.data) { error_ = "download buffer allocation failed"; stop(); return false; }
    free_.push_back(&block);
  }
  // The idle-connection cache defaults to four per handle, and every cached TLS session costs heap.
  if (curl_multi_setopt(multi_, CURLMOPT_MAXCONNECTS, static_cast<long>(max_connections)) != CURLM_OK ||
      curl_multi_setopt(multi_, CURLMOPT_MAX_HOST_CONNECTIONS, static_cast<long>(max_connections)) != CURLM_OK ||
      curl_multi_setopt(multi_, CURLMOPT_MAX_TOTAL_CONNECTIONS, static_cast<long>(max_connections)) != CURLM_OK) {
    error_ = "curl connection limit configuration failed"; stop(); return false;
  }
  for (Transfer& t : transfers_) {
    t.owner = this;
    t.curl = curl_easy_init();
    if (!t.curl) { error_ = "curl handle allocation failed"; stop(); return false; }
  }
  for (auto& thread : writer_threads_) {
    if (!spawn(thread, +[](void* p)->void* { name_thread("dl-writer"); static_cast<Service*>(p)->writer_loop(); return nullptr; }, this)) break;
    ++writers_started_;
  }
  sync_started_ = writers_started_ == writer_count && spawn(sync_thread_, +[](void* p)->void* { name_thread("dl-sync"); static_cast<Service*>(p)->sync_loop(); return nullptr; }, this);
  network_started_ = sync_started_ && spawn(network_thread_, +[](void* p)->void* { name_thread("dl-network"); static_cast<Service*>(p)->network_loop(); return nullptr; }, this);
  if (!network_started_) { error_ = "download worker creation failed"; stop(); return false; }
  running_ = true; return true;
}

void Service::stop() {
  stopping_ = true;
  { std::lock_guard lock(mutex_); for (const auto& job : jobs_) job->cancelled = true; }
  wake_.notify_all();
  if (multi_) curl_multi_wakeup(multi_);
  if (network_started_) pthread_join(network_thread_, nullptr);
  network_started_ = false;
  writer_stopping_ = true;
  disk_wake_.notify_all();
  sync_wake_.notify_all();
  for (unsigned i = 0; i < writers_started_; ++i) pthread_join(writer_threads_[i], nullptr);
  if (sync_started_) pthread_join(sync_thread_, nullptr);
  writers_started_ = 0; sync_started_ = false;
  for (Transfer& t : transfers_) {
    if (t.headers) curl_slist_free_all(t.headers);
    if (t.curl) curl_easy_cleanup(t.curl);
    t.headers = nullptr; t.curl = nullptr; t.job.reset();
  }
  if (multi_) curl_multi_cleanup(multi_);
  multi_ = nullptr;
  for (Block& block : blocks_) { std::free(block.data); block.data = nullptr; }
  free_.clear(); jobs_.clear(); waiting_.clear(); writes_.clear();
  if (curl_started_) curl_global_cleanup();
  curl_started_ = false;
  if (platform_started_) platform_stop();
  platform_started_ = false; running_ = false;
}

std::uint32_t Service::enqueue(Request request, std::string& error) {
  if (!running_) { error = error_.empty() ? "networking is not initialized" : error_; return 0; }
  if (!request.pieces.empty()) {
    std::uint64_t offset = 0;
    bool valid = request.pieces.size() <= 1024 && !request.destination.empty();
    for (const auto& piece : request.pieces) {
      valid = valid && piece.offset == offset && piece.size > 0 && piece.size <= safe_integer-offset;
      if (!valid) break;
      offset += piece.size;
    }
    if (!valid || offset != request.expected_bytes) {
      error = "manifest pieces must cover expectedBytes exactly without gaps or overlaps"; return 0;
    }
  }
  std::lock_guard lock(mutex_);
  if (jobs_.size() >= max_jobs) { error = "download/request queue is full (8 tasks); poll completed tasks"; return 0; }
  for (const auto& job : jobs_) if (!request.destination.empty() && job->request.destination == request.destination) {
    error = "destination already belongs to a queued task"; return 0;
  }
  auto job = std::make_shared<Job>(std::move(request), next_id_++);
  jobs_.push_back(job); waiting_.push_back(job); wake_.notify_one();
  return job->snapshot.id;
}

void Service::cancel(std::uint32_t id) {
  std::lock_guard lock(mutex_);
  for (const auto& job : jobs_) if (job->snapshot.id == id) job->cancelled = true;
  if (multi_) curl_multi_wakeup(multi_);
}

std::vector<Snapshot> Service::poll() {
  std::vector<Snapshot> out;
  std::lock_guard lock(mutex_);
  for (auto it = jobs_.begin(); it != jobs_.end();) {
    const auto& job = *it;
    { std::lock_guard job_lock(job->mutex); out.push_back(job->snapshot); }
    if (job->finalized) it = jobs_.erase(it); else ++it;
  }
  return out;
}

bool decimal(std::string_view text, std::uint64_t& value) {
  const auto result = std::from_chars(text.data(), text.data()+text.size(), value);
  return result.ec == std::errc{} && result.ptr == text.data()+text.size();
}

std::string_view trim(std::string_view text) {
  while (!text.empty() && (text.front() == ' ' || text.front() == '\t')) text.remove_prefix(1);
  while (!text.empty() && (text.back() == ' ' || text.back() == '\r' || text.back() == '\n')) text.remove_suffix(1);
  return text;
}

std::size_t Service::header(char* data, std::size_t size, std::size_t count, void* opaque) {
  auto& t = *static_cast<Transfer*>(opaque);
  if (size && count > 65536/size) return 0;
  const auto length = size*count;
  if (length > 65536-t.header_bytes) { t.error = "response headers exceed 64 KiB"; return 0; }
  t.header_bytes += length;
  std::string_view line(data, length);
  if (line.starts_with("HTTP/")) {
    t.etag.clear(); t.last_modified.clear(); t.encoding.clear(); t.content_range = false; t.length_known = false;
    t.content_type.clear(); t.response_headers.clear();
    const auto space = line.find(' ');
    if (space != std::string_view::npos && line.size() >= space+4) {
      std::uint64_t status = 0;
      if (decimal(line.substr(space+1, 3), status)) t.status = static_cast<long>(status);
    }
    return length;
  }
  const auto colon = line.find(':');
  if (colon == std::string_view::npos) return length;
  std::string name(line.substr(0, colon));
  for (char& c : name) if (c >= 'A' && c <= 'Z') c += 'a'-'A';
  const auto value = trim(line.substr(colon+1));
  if (name == "content-type") {
    t.content_type.assign(value);
    for (char& c : t.content_type) if (c >= 'A' && c <= 'Z') c += 'a'-'A';
  }
  // Only bounded transfer metadata crosses into JS; never expose cookies or auth headers.
  if (name == "content-type" || name == "content-length" || name == "content-disposition" ||
      name == "content-range" || name == "location" || name == "hx-redirect" ||
      name == "etag" || name == "last-modified" || name == "retry-after") {
    auto found = std::find_if(t.response_headers.begin(), t.response_headers.end(),
                            [&](const auto& item) { return item.first == name; });
    if (found == t.response_headers.end()) t.response_headers.emplace_back(name, value);
    else found->second.assign(value);
  }
  if (name == "etag") t.etag.assign(value);
  if (name == "last-modified") t.last_modified.assign(value);
  if (name == "content-encoding") t.encoding.assign(value);
  if (name == "content-length") t.length_known = decimal(value, t.content_length);
  if (name == "retry-after") {
    std::uint64_t seconds = 0;
    if (decimal(value, seconds)) t.retry_after = static_cast<unsigned>(std::min<std::uint64_t>(3600, seconds));
  }
  if (name == "content-range" && value.starts_with("bytes ")) {
    const auto dash = value.find('-'), slash = value.find('/');
    t.content_range = dash != std::string_view::npos && slash != std::string_view::npos && dash >= 6 && dash < slash &&
      decimal(value.substr(6, dash-6), t.range_begin) &&
      decimal(value.substr(dash+1, slash-dash-1), t.range_end) &&
      decimal(value.substr(slash+1), t.range_total) &&
      t.range_begin <= t.range_end && t.range_end < t.range_total;
  }
  return length;
}

void Service::refill_rate(Clock::time_point now) {
  const auto limit = static_cast<double>(rate_limit_.load(std::memory_order_relaxed));
  const double seconds = std::min(1.0, std::chrono::duration<double>(now-rate_refilled_).count());
  rate_refilled_ = now;
  if (!limit) { rate_budget_ = 0; return; }
  // At most a quarter second's worth (256 KiB at least, above any one callback) banks up.
  rate_budget_ = std::min(rate_budget_+limit*seconds, std::max(limit/4, 256.0*1024));
}

// Resumes transfers the limit paused, starting one further along each pass so none waits long.
void Service::resume_rate_paused(Job& job) {
  const bool capped = rate_limit_.load(std::memory_order_relaxed) != 0;
  for (std::size_t step = 0; step < transfers_.size(); ++step) {
    Transfer& t = transfers_[(rate_turn_+step) % transfers_.size()];
    if (!t.active || !t.rate_paused) continue;
    if (capped && rate_budget_ < 64.0*1024) { rate_turn_ = (rate_turn_+step) % transfers_.size(); return; }
    t.rate_paused = false;
    const auto result = curl_easy_pause(t.curl, CURLPAUSE_CONT);
    if (result != CURLE_OK) { job.fail(curl_easy_strerror(result)); return; }
  }
  rate_turn_ = (rate_turn_+1) % transfers_.size();
}

std::size_t Service::body(char* data, std::size_t size, std::size_t count, void* opaque) {
  auto& t = *static_cast<Transfer*>(opaque);
  if (size && count > block_size/size) { t.error = "unexpected callback block size"; return 0; }
  const auto length = size*count;
  Job& job = *t.job;
  if (job.cancelled || job.failed) return 0;
  if (t.probe) {
    if (t.status != 206) return 0; // Ignore error/redirect bodies and unbounded responses to an ignored Range.
    if (length > t.probe_length-t.accepted) { t.error = "invalid range probe body"; return 0; }
    if (t.probe_length > 1) t.sample.append(data, length);
    t.accepted += length; return length;
  }
  if (!job.request.destination.empty()) {
    // An error page (archive.org's HTTP 500 is HTML) is not the file; the retry policy judges its status.
    if (denied(t) || (t.status != 200 && t.status != 206)) return 0;
    if (job.request.reject_html && t.html_prefix.size() < 64 && t.begin == 0) {
      t.html_prefix.append(data, std::min<std::size_t>(length, 64-t.html_prefix.size()));
      std::string prefix = t.html_prefix;
      for (char& c : prefix) if (c >= 'A' && c <= 'Z') c += 'a'-'A';
      auto view = trim(prefix);
      while (!view.empty() && (view.front() == '\r' || view.front() == '\n')) view.remove_prefix(1);
      if (view.starts_with("<!doctype html") || view.starts_with("<html")) {
        t.error = "provider returned a web page; browser verification required"; return 0;
      }
    }
    if (!accept_response(t)) return 0;
    const std::uint64_t limit = job.ranged ? t.length : (job.known ? job.total : safe_integer);
    // A split range keeps only the bytes before its new end and drops the rest until the transfer loop
    // removes it. Refusing them instead would fail the transfer, or curl_easy_pause when it resumes one.
    const std::size_t keep = t.cut ? static_cast<std::size_t>(std::min<std::uint64_t>(length, limit-t.accepted)) : length;
    if (!t.cut && (t.accepted > limit || length > limit-t.accepted)) { t.error = "response exceeds expected size"; return 0; }
    if (!keep) return length;
    if (!job.request.unlimited && t.owner->rate_limit_.load(std::memory_order_relaxed)) {
      // Over the budget: curl hands these bytes back once the transfer loop resumes the transfer.
      if (t.owner->rate_budget_ < static_cast<double>(keep)) { t.rate_paused = true; return CURL_WRITEFUNC_PAUSE; }
      t.owner->rate_budget_ -= static_cast<double>(keep);
    }
    if (t.block && block_size-t.fill < keep) t.owner->flush(t);
    if (!t.block) {
      t.block = t.owner->take_block();
      if (!t.block) { t.paused = true; return CURL_WRITEFUNC_PAUSE; }
      t.block_offset = t.begin+t.accepted;
    }
    std::memcpy(t.block->data+t.fill, data, keep);
    t.fill += keep; t.accepted += keep;
    if (t.fill == block_size) t.owner->flush(t);
  } else {
    if (length > job.request.max_bytes-t.accepted) { t.error = "response exceeds maxBytes"; return 0; }
    job.response.append(data, length); t.accepted += length;
  }
  return length;
}

bool Service::configure(Transfer& t) {
  curl_easy_reset(t.curl);
  if (t.headers) curl_slist_free_all(t.headers);
  t.headers = nullptr; t.status = 0; t.header_bytes = 0;
  t.etag.clear(); t.last_modified.clear(); t.encoding.clear(); t.error.clear(); t.content_type.clear();
  t.response_headers.clear(); t.html_prefix.clear(); t.sample.clear();
  t.content_range = false; t.length_known = false; t.paused = false; t.rate_paused = false; t.retry_after = 0; t.glitch = false;
  t.requested = t.length; t.cut = false;
  Job& job = *t.job;
  bool ok = true;
  const auto set = [&](CURLoption option, auto value) {
    if (curl_easy_setopt(t.curl, option, value) != CURLE_OK) ok = false;
  };
  const auto add = [&](const std::string& text) {
    curl_slist* list = curl_slist_append(t.headers, text.c_str());
    if (!list) ok = false; else t.headers = list;
  };
  for (const auto& text : job.request.headers) add(text);
  const Source* source = job.sources.empty() ? nullptr : &job.sources[t.source];
  const auto& origin = source ? source->piece.url : job.request.url;
  const auto& location = source ? source->location : job.location;
  const std::string* mirror = !source && t.mirror ? &job.mirrors[t.mirror-1] : nullptr;
  t.redirected = !mirror && !t.probe && !location.empty();
  const auto& url = mirror ? *mirror : t.redirected ? location : origin;
  const auto& validator = source ? source->etag : job.etag.empty() ? job.last_modified : job.etag;
  const bool ranged = source ? source->ranged : job.ranged;
  if (ranged && !t.probe && !validator.empty()) add("If-Range: " + validator);
  // Custom application headers must never be forwarded to an unrelated redirect origin.
  if (!configure_transport(t.curl, url, job.request.follow_redirects && job.request.headers.empty())) ok = false;
  // body() copies each callback into one block, so curl must never hand over more than a block. Smaller
  // still: older curl gives every one of the 64 transfers its own buffer, out of the title's heap.
  set(CURLOPT_BUFFERSIZE, 64L * 1024);
  set(CURLOPT_HTTPHEADER, t.headers);
  set(CURLOPT_WRITEFUNCTION, body); set(CURLOPT_WRITEDATA, &t);
  set(CURLOPT_HEADERFUNCTION, header); set(CURLOPT_HEADERDATA, &t);
  set(CURLOPT_XFERINFOFUNCTION, progress); set(CURLOPT_XFERINFODATA, &t);
  set(CURLOPT_NOPROGRESS, 0L); set(CURLOPT_PRIVATE, &t);
  if (t.probe) {
    const std::string range = std::to_string(t.probe_from)+"-"+std::to_string(t.probe_from+t.probe_length-1);
    set(CURLOPT_RANGE, range.c_str());
  } else if (ranged) {
    const auto begin = t.begin-(source ? source->piece.offset : 0);
    const std::string range = std::to_string(begin)+"-"+std::to_string(begin+t.length-1);
    set(CURLOPT_RANGE, range.c_str());
  } else if (job.request.destination.empty()) {
    set(CURLOPT_TIMEOUT, 30L);
    set(CURLOPT_CUSTOMREQUEST, job.request.method.c_str());
    if (job.request.method == "HEAD") set(CURLOPT_NOBODY, 1L);
    if (!job.request.body.empty() || job.request.method == "POST") {
      set(CURLOPT_POSTFIELDS, job.request.body.c_str());
      set(CURLOPT_POSTFIELDSIZE_LARGE, static_cast<curl_off_t>(job.request.body.size()));
    }
  }
  if (!ok) t.error = "could not configure the HTTP transport";
  return ok;
}

CURLcode Service::perform_probe(Transfer& probe) {
  // Probe through the same multi handle so its TCP/TLS connection can be reused.
  CURLcode result = CURLE_FAILED_INIT;
  if (curl_multi_add_handle(multi_, probe.curl) != CURLM_OK) {
    probe.error = "could not schedule range probe"; return CURLE_FAILED_INIT;
  }
  bool done = false;
  while (!done && !probe.job->cancelled) {
    int running = 0;
    const auto state = curl_multi_perform(multi_, &running);
    if (state != CURLM_OK) { probe.error = curl_multi_strerror(state); break; }
    int left = 0;
    while (CURLMsg* message = curl_multi_info_read(multi_, &left)) {
      if (message->msg == CURLMSG_DONE && message->easy_handle == probe.curl) {
        result = message->data.result; done = true;
      }
    }
    if (!done) curl_multi_poll(multi_, nullptr, 0, 50, nullptr);
  }
  curl_multi_remove_handle(multi_, probe.curl);
  return probe.job->cancelled ? CURLE_ABORTED_BY_CALLBACK : result;
}

bool Service::probe_source(Job& job, unsigned source_index) {
  Transfer& probe = transfers_[0];
  probe.probe = true; probe.source = source_index;
  CURLcode result = CURLE_FAILED_INIT;
  for (unsigned attempt = 1;; ++attempt) {
    probe.accepted = 0;
    if (!configure(probe)) { job.fail(probe.error); return false; }
    result = perform_probe(probe); probe.result = result;
    if (job.cancelled) return false;
    if (attempt >= std::min(6u, attempt_limit(probe))) break;
    ++job.retries;
    const auto retry_at = Clock::now()+retry_delay(probe, attempt);
    while (!job.cancelled && Clock::now() < retry_at) curl_multi_poll(multi_, nullptr, 0, 50, nullptr);
  }
  if (job.cancelled) return false;
  if (job.request.reject_html && denied(probe)) { job.fail(probe.error); return false; }
  if (probe.status >= 400) {
    job.fail("range probe failed (HTTP " + std::to_string(probe.status) + ", " + curl_easy_strerror(result) + ")"); return false;
  }
  if (job.request.reject_html && (probe.content_type.starts_with("text/html") ||
      probe.content_type.starts_with("application/xhtml+xml"))) {
    job.fail("provider returned a web page; browser verification required"); return false;
  }
  if (probe.status == 200 && result == CURLE_WRITE_ERROR && probe.error.empty()) {
    job.known = probe.length_known; job.total = probe.content_length;
  } else if (result == CURLE_OK && probe.status == 206 && probe.content_range &&
             probe.range_begin == 0 && probe.range_end == 0 && probe.accepted == 1) {
    job.known = true; job.total = probe.range_total;
    if (!probe.etag.empty() && !probe.etag.starts_with("W/")) job.etag = probe.etag;
    else job.last_modified = probe.last_modified;
    job.ranged = true;
  } else if (result == CURLE_OK && probe.status == 200 && probe.length_known && probe.content_length == 0) {
    job.known = true; job.total = 0;
  } else {
    job.fail(probe.error.empty() ? "range probe failed (HTTP " + std::to_string(probe.status) + ", " + curl_easy_strerror(result) + ")" : probe.error);
    return false;
  }
  if ((!probe.encoding.empty() && probe.encoding != "identity") || job.total > safe_integer) {
    job.fail("unsupported content encoding or file size"); return false;
  }
  char* effective = nullptr;
  if (curl_easy_getinfo(probe.curl, CURLINFO_EFFECTIVE_URL, &effective) == CURLE_OK && effective) {
    auto& location = job.sources.empty() ? job.location : job.sources[source_index].location;
    if (effective != (job.sources.empty() ? job.request.url : job.sources[source_index].piece.url)) location.assign(effective);
  }
  if (!job.sources.empty()) {
    auto& source = job.sources[source_index];
    if (!job.known || job.total != source.piece.size) {
      job.fail("manifest piece size does not match the server: " + std::to_string(source_index)); return false;
    }
    source.etag = job.etag;
    const bool protected_identity = !source.etag.empty() || !source.piece.sha1.empty() || !job.request.sha256.empty();
    if (!protected_identity) {
      job.fail("manifest pieces require a strong ETag, SHA-1, or whole-file SHA-256"); return false;
    }
    source.ranged = probe.status == 206;
  }
  return true;
}

// Keeps the mirrors that serve exactly the primary's bytes: same size, and the same strong ETag (or,
// without one, a SHA-256 that verifies the whole file at the end).
void Service::verify_mirrors(Job& job) {
  Transfer& probe = transfers_[0];
  for (const auto& url : job.request.mirrors) {
    if (job.cancelled) break;
    job.mirrors.push_back(url);
    probe.probe = true; probe.source = 0; probe.mirror = static_cast<unsigned>(job.mirrors.size()); probe.accepted = 0;
    const bool same = configure(probe) && perform_probe(probe) == CURLE_OK && probe.status == 206 && probe.content_range &&
      probe.range_begin == 0 && probe.range_end == 0 && probe.range_total == job.total &&
      (job.etag.empty() ? !job.request.sha256.empty() : probe.etag == job.etag);
    if (!same) {
      job.mirrors.pop_back();
      platform_log(("download mirror ignored: " + url).c_str());
    }
  }
  probe.mirror = 0;
}

// Without a strong ETag the server cannot promise that kept ranges still match its file, so before
// appending, the tail of the last completed range is downloaded again and compared with the partial.
bool Service::check_sample(Job& job) {
  std::size_t last = job.completed.size();
  while (last && !job.completed[last-1]) --last;
  if (!last) return true;
  const auto end = std::min(job.total, last*job.request.range_bytes);
  const auto length = std::min<std::uint64_t>(64*1024, end-(last-1)*job.request.range_bytes);
  Transfer& probe = transfers_[0];
  probe.probe = true; probe.source = 0; probe.mirror = 0; probe.accepted = 0;
  probe.probe_from = end-length; probe.probe_length = length;
  const bool fetched = configure(probe) && perform_probe(probe) == CURLE_OK && probe.status == 206 && probe.content_range &&
    probe.range_begin == end-length && probe.range_end == end-1 && probe.range_total == job.total &&
    probe.sample.size() == length && (job.last_modified.empty() || probe.last_modified == job.last_modified);
  probe.probe_from = 0; probe.probe_length = 1;
  if (job.cancelled) return false;
  if (!fetched) { job.fail(probe.error.empty() ? "could not re-read the partial file's tail from the server" : probe.error); return false; }
  std::string local(length, '\0');
  if (pread(job.fd, local.data(), local.size(), static_cast<off_t>(end-length)) != static_cast<ssize_t>(length)) {
    job.fail(system_error("read partial file")); return false;
  }
  if (local != probe.sample) {
    job.fail("the server's file changed since this partial download; restart from zero"); return false;
  }
  return true;
}

bool Service::prepare(Job& job) {
  if (!job.request.storage_root.empty()) {
    job.root_fd = open(job.request.storage_root.c_str(), O_RDONLY | O_DIRECTORY | O_NOFOLLOW);
    if (job.root_fd < 0 || fstat(job.root_fd, &job.root_stat) != 0 || !storage_matches(job)) {
      job.fail("cannot open original storage root"); return false;
    }
  }
  if (job.request.recover_completed) {
    job.receipt_identity = receipt_identity(job);
    if (job.receipt_identity.empty()) { job.fail("completion identity hash failed"); return false; }
    struct stat existing{};
    if (lstat(job.request.destination.c_str(), &existing) == 0) return recover_file(job);
    if (errno != ENOENT) { job.fail(system_error("inspect destination")); return false; }
  }
  if (job.request.pieces.empty()) {
    if (!probe_source(job, 0)) return false;
    if (job.request.expected_bytes && (!job.known || job.total != job.request.expected_bytes)) {
      job.fail("expectedBytes does not match the server file size"); return false;
    }
    if (job.ranged) verify_mirrors(job);
  } else {
    for (const auto& piece : job.request.pieces) job.sources.push_back({piece, {}, {}, false});
    for (unsigned i = 0; i < job.sources.size(); ++i) {
      job.etag.clear(); job.last_modified.clear(); job.ranged = false; job.known = false; job.total = 0;
      if (!probe_source(job, i)) return false;
      const auto& source = job.sources[i];
      for (std::uint64_t local = 0; local < source.piece.size;) {
        const auto length = source.ranged ? std::min(job.request.range_bytes, source.piece.size-local) : source.piece.size;
        if (job.segments.size() == max_ranges) { job.fail("too many manifest ranges; increase rangeBytes"); return false; }
        job.segments.push_back({source.piece.offset+local, length, i});
        local += length;
      }
    }
    job.total = job.request.expected_bytes; job.known = true; job.ranged = true;
  }
  if (job.ranged) {
    const auto count = job.sources.empty() ? (job.total+job.request.range_bytes-1)/job.request.range_bytes : job.segments.size();
    if (count > max_ranges) { job.fail("too many ranges; increase rangeBytes (maximum 65536 ranges)"); return false; }
    job.completed.resize(static_cast<std::size_t>(count));
    // No URL: signed links change on every resolution while the file stays the same. The validator,
    // size and hashes identify the bytes; the storage root and the sidecar's path identify the place.
    Hash hash;
    const auto validator = !job.etag.empty() ? "etag:"+job.etag : !job.last_modified.empty() ? "modified:"+job.last_modified : "size";
    for (const auto& value : {validator, job.request.sha256, std::to_string(job.total)}) {
      hash.update(value.data(), value.size()); hash.update("\0", 1);
    }
    for (const auto& source : job.sources) {
      for (const auto& value : {source.etag, source.piece.sha1,
                               std::to_string(source.piece.offset), std::to_string(source.piece.size)}) {
        hash.update(value.data(), value.size()); hash.update("\0", 1);
      }
    }
    if (job.root_fd >= 0) {
      const auto identity = std::to_string(job.root_stat.st_dev)+":"+std::to_string(job.root_stat.st_ino);
      hash.update(identity.data(), identity.size());
    }
    job.identity = hash.finish();
    if (job.identity.empty()) { job.fail("checkpoint identity hash failed"); return false; }
  }
  struct stat existing;
  if (lstat(job.request.destination.c_str(), &existing) == 0 || errno != ENOENT) {
    job.fail("destination already exists or cannot be inspected; choose a new destination"); return false;
  }
  const std::string partial = job.request.destination+".part";
  job.fd = open(partial.c_str(), O_RDWR | O_CREAT | O_EXCL | O_NOFOLLOW, 0600);
  if (job.fd < 0 && errno == EEXIST && job.request.resume && job.ranged) {
    job.fd = open(partial.c_str(), O_RDWR | O_NOFOLLOW);
    const int meta = open((job.request.destination+".resume").c_str(), O_RDONLY | O_NOFOLLOW);
    Checkpoint saved, expected;
    bool valid = job.fd >= 0 && meta >= 0 && fstat(job.fd, &existing) == 0 && S_ISREG(existing.st_mode) &&
      existing.st_size >= 0 && static_cast<std::uint64_t>(existing.st_size) <= job.total && read_all(meta, &saved, sizeof saved) &&
      !std::memcmp(saved.magic, expected.magic, sizeof saved.magic) && saved.total == job.total &&
      saved.range_bytes == job.request.range_bytes && saved.count == job.completed.size() &&
      !std::memcmp(saved.identity, job.identity.c_str(), 65) && read_all(meta, job.completed.data(), job.completed.size());
    if (meta >= 0) close(meta);
    for (unsigned char value : job.completed) if (value > 1) valid = false;
    if (!valid) { job.fail("partial file has no matching durable checkpoint; remove .part/.resume or choose another destination"); return false; }
    for (std::size_t i = 0; i < job.completed.size(); ++i) if (job.completed[i]) {
      const auto begin = job.sources.empty() ? i*job.request.range_bytes : job.segments[i].begin;
      const auto end = job.sources.empty() ? std::min(job.total, (i+1)*job.request.range_bytes) : begin+job.segments[i].length;
      if (end > static_cast<std::uint64_t>(existing.st_size)) { job.fail("partial file is shorter than its checkpoint"); return false; }
      job.committed += end-begin;
    }
    if (job.committed && job.etag.empty() && job.sources.empty() && !check_sample(job)) return false;
  }
  if (job.fd < 0) { job.fail(system_error("open partial file (parent must exist; existing partial files require a valid checkpoint)")); return false; }
  struct stat partial_stat;
  if (fstat(job.fd, &partial_stat) != 0 || !S_ISREG(partial_stat.st_mode) || partial_stat.st_nlink != 1 ||
      (job.root_fd >= 0 && partial_stat.st_dev != job.root_stat.st_dev)) {
    job.fail("partial file must be a regular, unshared file on the selected storage"); return false;
  }
  // Establish ownership and a recoverable empty checkpoint before accepting file bytes.
  job.checkpoint_ready = true;
  if (job.ranged && !checkpoint(job, job.completed)) return false;
  return true;
}

// Contiguous blocks of one transfer are joined into one write. Thousands of 128 KiB pwrites spread over
// 64 ranges held PS5 storage near 30 MB/s however many writers ran; large sequential writes are far
// faster. A writer without its staging buffer still works, one block per write.
void Service::writer_loop() {
  constexpr std::size_t max_batch = 16;
  char* const staging = static_cast<char*>(std::malloc(block_size * max_batch));
  const std::size_t batch_limit = staging ? max_batch : 1;
  std::vector<Write> batch;
  batch.reserve(max_batch);
  for (;;) {
    batch.clear();
    {
      std::unique_lock lock(disk_mutex_);
      disk_wake_.wait(lock, [&] { return writer_stopping_ || !writes_.empty(); });
      if (writes_.empty() && writer_stopping_) break;
      batch.push_back(std::move(writes_.front())); writes_.pop_front();
      // A transfer queues its blocks in order and is reused only once none are pending, so its
      // next blocks are the queue entries that continue at the batch's end.
      std::uint64_t end = batch[0].offset + batch[0].size;
      for (auto it = writes_.begin(); it != writes_.end() && batch.size() < batch_limit;) {
        if (it->transfer != batch[0].transfer || it->offset != end) { ++it; continue; }
        end += it->size;
        batch.push_back(std::move(*it));
        it = writes_.erase(it);
      }
    }
    Job& job = *batch[0].job;
    const char* data = batch[0].block->data;
    std::size_t size = batch[0].size;
    if (batch.size() > 1) {
      size = 0;
      for (const Write& write : batch) { std::memcpy(staging + size, write.block->data, write.size); size += write.size; }
      data = staging;
    }
    const auto started = Clock::now();
    if (!job.failed && storage_matches(job) && write_all(job.fd, data, size, batch[0].offset)) {
      batch[0].transfer->written += size;
      ++write_calls_; write_bytes_ += size;
    }
    else if (!job.failed) job.fail(system_error("write partial file"));
    record_max(write_max_us_, started);
    for (const Write& write : batch) {
      release(write.block);
      --write.transfer->pending;
      --job.pending;
    }
    if (multi_) curl_multi_wakeup(multi_);
  }
  std::free(staging);
}

void Service::finalize(Job& job) {
  if (!job.cancelled && !job.failed && !job.recovering && ftruncate(job.fd, static_cast<off_t>(job.total)) != 0)
    job.fail(system_error("truncate completed file"));
  if (!job.cancelled && !job.failed && verify_file(job)) {
    if (!job.recovering && fsync(job.fd) != 0) job.fail(system_error("sync completed file"));
    job.storage_checked = 0;
    if (!job.cancelled && !job.failed && storage_matches(job)) {
      if (job.recovering) {
        struct stat visible{}, opened{};
        if (lstat(job.request.destination.c_str(), &visible) != 0 || fstat(job.fd, &opened) != 0 ||
            visible.st_dev != opened.st_dev || visible.st_ino != opened.st_ino)
          job.fail("completed destination changed during recovery");
      } else publish_file(job);
    }
  }
  if (job.fd >= 0 && close(job.fd) != 0) job.fail(system_error("close partial file"));
  job.fd = -1;
  {
    std::lock_guard lock(job.mutex);
    job.snapshot.state = terminal_state(job);
    job.snapshot.connections = 0;
  }
  job.finalized = true;
}

void Service::sync_loop() {
  for (;;) {
    Write command;
    {
      std::unique_lock lock(disk_mutex_);
      sync_wake_.wait(lock, [&] { return writer_stopping_ || !syncs_.empty(); });
      if (syncs_.empty() && writer_stopping_) break;
      command = std::move(syncs_.front()); syncs_.pop_front();
    }
    Job& job = *command.job;
    const auto started = Clock::now();
    if (job.fd >= 0 && job.checkpoint_ready) checkpoint(job, command.checkpoint);
    record_max(sync_max_us_, started);
    job.syncing = false;
    --job.pending;
    if (multi_) curl_multi_wakeup(multi_);
  }
}

// Every two seconds while downloading: enough to tell network, disk and sync stalls apart on the console.
void Service::log_stats(const Job& job, unsigned allowed, std::uint64_t& previous_received, std::uint64_t& previous_written) {
  std::uint64_t received = job.committed, written = job.committed;
  unsigned active = 0, paused = 0;
  for (const Transfer& t : transfers_) if (t.active || t.draining) {
    received += t.accepted; written += t.written.load(); ++active; paused += t.paused;
  }
  std::size_t free_blocks, queued;
  { std::lock_guard lock(disk_mutex_); free_blocks = free_.size(); queued = writes_.size(); }
  const std::uint64_t calls = write_calls_.exchange(0), bytes = write_bytes_.exchange(0);
  const std::uint64_t average_write = calls ? bytes / calls : 0;
  char line[320];
  std::snprintf(line, sizeof line,
    "download: conns=%u/%u paused=%u recv=%lluKB/s disk=%lluKB/s buffered=%zuKiB queued=%zu retries=%u write_max=%ums sync_max=%ums net_busy=%llu%% write_avg=%lluKiB mirrors=%zu splits=%u",
    active, allowed, paused, static_cast<unsigned long long>((received-previous_received)/2048),
    static_cast<unsigned long long>((written-previous_written)/2048), (block_count-free_blocks)*block_size/1024, queued,
    job.retries, write_max_us_.exchange(0)/1000, sync_max_us_.exchange(0)/1000,
    static_cast<unsigned long long>(perform_us_/20000), static_cast<unsigned long long>(average_write / 1024),
    static_cast<std::size_t>(std::count_if(job.mirrors.begin(), job.mirrors.end(), [](const std::string& url) { return !url.empty(); })),
    job.splits);
  perform_us_ = 0;
  platform_log(line);
  previous_received = received; previous_written = written;
}

void Service::snapshot(Job& job, unsigned allowed, Clock::time_point now,
                       Clock::time_point& previous, std::uint64_t& previous_written) {
  std::uint64_t written = job.committed, received = job.committed;
  unsigned active = 0;
  for (const Transfer& t : transfers_) if (t.active || t.draining) {
    written += t.written.load(); received += t.accepted; ++active;
  }
  std::uint64_t completed_bytes = written;
  if (job.ranged) {
    completed_bytes = 0;
    for (std::size_t i = 0; i < job.completed.size(); ++i) {
      if (!job.completed[i]) continue;
      completed_bytes += job.sources.empty()
        ? std::min(job.request.range_bytes, job.total - i*job.request.range_bytes)
        : job.segments[i].length;
    }
  }
  std::uint64_t buffered;
  { std::lock_guard lock(disk_mutex_); buffered = (block_count-free_.size())*block_size; }
  const double elapsed = std::chrono::duration<double>(now-previous).count();
  const double speed = elapsed > 0 && written >= previous_written ? (written-previous_written)/elapsed : 0;
  {
    std::lock_guard lock(job.mutex);
    job.snapshot.received = received; job.snapshot.written = written; job.snapshot.completed_bytes = completed_bytes;
    job.snapshot.total = job.total; job.snapshot.total_known = job.known;
    job.snapshot.bytes_per_second = speed; job.snapshot.buffered = buffered;
    job.snapshot.connections = std::min(active, allowed); job.snapshot.retries = job.retries;
  }
  previous = now; previous_written = written;
}

void Service::finish_transfer(Transfer& t) {
  Job& job = *t.job;
  if (t.block) flush(t);
  t.active = false; t.draining = true;
  // A cut range that holds all its bytes is done, whatever ended the request for the rest.
  if (t.cut && t.accepted == t.length && t.error.empty()) t.result = CURLE_OK;
  if (t.result != CURLE_OK || job.request.destination.empty() || denied(t)) return;
  if (!accept_response(t)) { if (t.error.empty()) t.result = CURLE_HTTP_RETURNED_ERROR; return; }
  // Bytes still missing with the response complete: retried like a reset connection.
  if ((job.ranged || job.known) && t.accepted != t.length) { t.result = CURLE_PARTIAL_FILE; return; }
  if (!job.known && !job.ranged) { job.total = t.accepted; job.known = true; }
  // A range that reached the file through a fresh redirect pins its target for the ranges after it.
  long redirects = 0;
  char* effective = nullptr;
  auto& location = job.sources.empty() ? job.location : job.sources[t.source].location;
  if (job.ranged && !t.mirror && location.empty() && curl_easy_getinfo(t.curl, CURLINFO_REDIRECT_COUNT, &redirects) == CURLE_OK &&
      redirects > 0 && curl_easy_getinfo(t.curl, CURLINFO_EFFECTIVE_URL, &effective) == CURLE_OK && effective)
    location.assign(effective);
}

void Service::run_job(const std::shared_ptr<Job>& job) {
  for (Transfer& t : transfers_) {
    t.job = job; t.active = false; t.draining = false; t.probe = false; t.source = 0; t.mirror = 0;
    t.accepted = 0; t.written = 0; t.pending = 0;
  }
  { std::lock_guard lock(job->mutex); job->snapshot.state = "connecting"; }
  const bool file = !job->request.destination.empty();
  downloading_file = file;
  const bool prepared = !file || prepare(*job);
  for (Transfer& t : transfers_) t.probe = false;
  if (prepared && !job->cancelled && !job->recovering) {
    { std::lock_guard lock(job->mutex); job->snapshot.state = "downloading"; }
    // A capped download needs few connections: about one per MB/s, so each gets bytes often enough to
    // stay over curl's low-speed cutoff (1 byte/s for 30 s) between its turns.
    const std::uint64_t capped = job->request.unlimited ? 0 : rate_limit_.load();
    const unsigned limit = !job->ranged ? 1 : !capped ? job->request.connections :
      std::min(std::max(static_cast<unsigned>(capped/(1024*1024)), 2u), job->request.connections);
    const unsigned initial = job->request.adaptive ? std::min(8u, limit) : limit;
    std::vector<Window> windows;
    const auto window_for = [&](const std::string& url) {
      auto host = host_of(url);
      for (unsigned i = 0; i < windows.size(); ++i) if (windows[i].host == host) return i;
      windows.push_back({std::move(host), initial});
      return static_cast<unsigned>(windows.size()-1);
    };
    const auto allowed = [&] {
      unsigned sum = 0;
      for (const Window& w : windows) sum += w.allowed;
      return std::min(limit, windows.empty() ? initial : sum);
    };
    const std::size_t count = job->ranged ? job->completed.size() : 1;
    std::vector<unsigned char> scheduled(count);
    std::vector<unsigned> attempts(count);
    std::vector<Clock::time_point> retry_at(count);
    // Ranges whose suspension-cut failure was logged: the next ones while the network comes back add nothing.
    std::vector<unsigned char> waived(count);
    // Refused connections a range retried for free while its origin kept streaming other ranges.
    std::vector<unsigned> forgiven(count);
    // Once every range has a connection, idle connections split the range with the most bytes left
    // (a slow connection's, or the last ones') instead of waiting out the tail. A split range is done
    // when all its parts are (`open`); a part that fails retries alone, as a span.
    struct Span { unsigned piece, attempt; std::uint64_t begin, length; Clock::time_point at; };
    std::vector<Span> spans;
    std::vector<unsigned> open(count);
    std::vector<unsigned char> split(count);
    const auto requeue = [&](const Transfer& t, unsigned attempt, Clock::time_point at) {
      if (split[t.piece]) { spans.push_back({t.piece, attempt, t.begin, t.length, at}); return; }
      scheduled[t.piece] = 0; open[t.piece] = 0; attempts[t.piece] = attempt; retry_at[t.piece] = at;
    };
    for (std::size_t i = 0; i < count && job->ranged; ++i) scheduled[i] = job->completed[i];
    Clock::time_point previous = Clock::now(), checkpointed = previous, logged = previous;
    std::uint64_t logged_received = job->committed, logged_written = job->committed;
    std::uint64_t previous_written = job->committed;
    std::size_t finished = static_cast<std::size_t>(std::count(scheduled.begin(), scheduled.end(), 1));
    Clock::time_point last_pass = previous, grace_until{};
    auto last_wall = std::chrono::system_clock::now();
    while (finished < count && !job->failed && !job->cancelled) {
      const auto now = Clock::now();
      const auto wall = std::chrono::system_clock::now();
      if (now-last_pass > suspension_gap || wall-last_wall > suspension_gap) {
        grace_until = now+suspension_grace;
        platform_log("download: resumed after a suspension; ranges it cut retry without counting");
      }
      last_pass = now; last_wall = wall;
      refill_rate(now);
      resume_rate_paused(*job);
      unsigned in_flight = 0;
      for (Transfer& t : transfers_) if (t.active || t.draining) ++in_flight;
      if (job->request.adaptive) for (Window& w : windows) w.grow(now, limit);
      for (Transfer& t : transfers_) {
        if (t.draining && !t.pending) {
          t.draining = false; --in_flight; --windows[t.window].in_flight;
          if (t.result == CURLE_OK && t.error.empty()) {
            job->committed += t.written;
            if (!t.cut) ++windows[t.window].idle;
            if (!--open[t.piece]) {
              if (job->ranged) job->completed[t.piece] = 1;
              ++finished;
            }
          } else if (cut_by_suspension(t, now, grace_until)) {
            // Counted as a busy server, every range in flight across a rest-mode cycle shrank the window
            // for the rest of the job and spent an attempt on its way to failing the download.
            if (!waived[t.piece]) { waived[t.piece] = 1; log_failure(t, t.attempt); }
            requeue(t, t.attempt-1, now+retry_delay(t, 1));
          } else if (refused_connection(t) && forgiven[t.piece] < 16 &&
                     std::any_of(transfers_.begin(), transfers_.end(), [&](const Transfer& other) {
                       return other.active && other.window == t.window && other.accepted; })) {
            // The origin is up and only turning new connections away: the range waits for the cooldown's
            // pacing without spending an attempt. A host that refuses for good still fails once these run out.
            ++forgiven[t.piece]; ++job->retries;
            log_failure(t, t.attempt);
            if (job->request.adaptive) windows[t.window].shrink(now, 0);
            windows[t.window].refuse(now);
            requeue(t, t.attempt-1, now+retry_delay(t, 1));
          } else {
            const unsigned attempt = t.attempt;
            log_failure(t, attempt);
            if (refused_connection(t)) windows[t.window].refuse(now);
            if (job->request.adaptive && congested(t)) windows[t.window].shrink(now, t.retry_after);
            unsigned allowed_attempts = attempt_limit(t);
            if (forget_mirror(*job, t)) allowed_attempts = std::max(allowed_attempts, 4u);
            else if (forget_redirect(*job, t, attempt)) allowed_attempts = std::max(allowed_attempts, 4u);
            if (attempt >= allowed_attempts) { job->fail(describe(t)); break; }
            ++job->retries;
            requeue(t, attempt, now+retry_delay(t, attempt));
          }
        }
        if (t.active && t.gated && t.status) {
          t.gated = false;
          long connects = 0;
          if (curl_easy_getinfo(t.curl, CURLINFO_NUM_CONNECTS, &connects) == CURLE_OK && connects)
            windows[t.window].accepted(t.started);
        }
        if (t.active && t.cut && t.accepted == t.length) {
          curl_multi_remove_handle(multi_, t.curl);
          finish_transfer(t);
        }
        if (t.active && t.paused) {
          bool available;
          { std::lock_guard lock(disk_mutex_); available = !free_.empty(); }
          if (available) {
            t.paused = false;
            const auto result = curl_easy_pause(t.curl, CURLPAUSE_CONT);
            if (result != CURLE_OK) job->fail(curl_easy_strerror(result));
          }
        }
        if (!t.active && !t.draining && in_flight < limit) {
          const unsigned mirror = job->ranged && job->sources.empty() ?
            pick_mirror(*job, static_cast<unsigned>(&t - transfers_.data())) : 0;
          // The first waiting range whose origin has room; manifest sources sit in order, so each
          // source's window is looked up once per pass.
          std::size_t next = 0;
          unsigned window = 0, checked = ~0u;
          bool room = false;
          for (; next < count; ++next) {
            if (scheduled[next] || now < retry_at[next]) continue;
            const unsigned source = job->sources.empty() ? 0 : job->segments[next].source;
            if (source != checked) {
              checked = source; window = window_for(range_url(*job, source, mirror));
              room = windows[window].open(now);
            }
            if (room) break;
          }
          if (next < count) {
            t.piece = static_cast<unsigned>(next); scheduled[next] = 1; open[next] = 1; t.attempt = ++attempts[next];
            if (!job->sources.empty()) {
              const auto& segment = job->segments[next];
              t.begin = segment.begin; t.length = segment.length; t.source = segment.source;
            } else {
              t.begin = job->ranged ? t.piece*job->request.range_bytes : 0;
              t.length = job->ranged ? std::min(job->request.range_bytes, job->total-t.begin) : job->total;
              t.mirror = mirror;
            }
          } else {
            if (!job->ranged || !job->sources.empty()) continue;
            window = window_for(range_url(*job, 0, mirror));
            if (!windows[window].open(now)) continue;
            const auto ready = std::find_if(spans.begin(), spans.end(), [&](const Span& span) { return now >= span.at; });
            if (ready != spans.end()) {
              t.piece = ready->piece; t.begin = ready->begin; t.length = ready->length;
              t.attempt = ready->attempt+1; spans.erase(ready);
            } else {
              // A split's fresh connection may be refused again by an origin that refused one: none while it
              // cools down unless a finished range left a connection open, and only for a tail that would take
              // the victim over two seconds more.
              if (windows[window].cooling(now) && !windows[window].idle) continue;
              Transfer* victim = nullptr;
              for (Transfer& other : transfers_) if (other.active && other.length-other.accepted >
                  (victim ? victim->length-victim->accepted : 2*min_split)) victim = &other;
              if (!victim) continue;
              if (windows[window].refusals && !windows[window].idle) {
                const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(now-victim->started).count();
                if (elapsed <= 0 || (victim->length-victim->accepted)*elapsed < 2000*victim->accepted) continue;
              }
              const auto keep = victim->accepted+(victim->length-victim->accepted)/2;
              t.piece = victim->piece; t.begin = victim->begin+keep; t.length = victim->length-keep;
              victim->length = keep; victim->cut = true;
              split[t.piece] = 1; ++open[t.piece]; ++job->splits; t.attempt = 1;
            }
            t.mirror = mirror;
          }
          t.accepted = 0; t.written = 0;
          if (!file) job->response.clear();
          if (!configure(t) || curl_multi_add_handle(multi_, t.curl) != CURLM_OK) {
            job->fail(t.error.empty() ? "could not schedule transfer" : t.error); break;
          }
          t.active = true; t.window = window; ++in_flight; ++windows[window].in_flight;
          const bool fresh = windows[window].connecting(now);
          t.gated = fresh && windows[window].cooling(now); t.started = now;
        }
      }
      int running = 0;
      const auto performing = Clock::now();
      const auto result = curl_multi_perform(multi_, &running);
      perform_us_ += std::chrono::duration_cast<std::chrono::microseconds>(Clock::now()-performing).count();
      if (result != CURLM_OK) { job->fail(curl_multi_strerror(result)); break; }
      int left = 0;
      while (CURLMsg* message = curl_multi_info_read(multi_, &left)) if (message->msg == CURLMSG_DONE) {
        Transfer* t = nullptr;
        curl_easy_getinfo(message->easy_handle, CURLINFO_PRIVATE, &t);
        curl_multi_remove_handle(multi_, message->easy_handle);
        if (!t) { job->fail("missing transfer identity"); break; }
        t->result = message->data.result;
        {
          std::lock_guard lock(job->mutex);
          job->snapshot.status = static_cast<int>(t->status);
          if (!file) {
            job->snapshot.headers = t->response_headers;
            char* effective = nullptr;
            if (curl_easy_getinfo(t->curl, CURLINFO_EFFECTIVE_URL, &effective) == CURLE_OK && effective)
              job->snapshot.url.assign(effective, std::min<std::size_t>(std::strlen(effective), 8192));
          }
        }
        finish_transfer(*t);
      }
      if (now-previous >= std::chrono::milliseconds(250)) snapshot(*job, allowed(), now, previous, previous_written);
      if (now-logged >= std::chrono::seconds(2)) { log_stats(*job, allowed(), logged_received, logged_written); logged = now; }
      if (job->ranged && now-checkpointed >= std::chrono::seconds(5)) {
        queue_checkpoint(job); checkpointed = now;
      }
      if (finished < count) curl_multi_poll(multi_, nullptr, 0, 50, nullptr);
    }
    for (Transfer& t : transfers_) {
      if (t.active) { curl_multi_remove_handle(multi_, t.curl); t.active = false; }
      flush(t);
    }
    // Draining pointers must remain stable until the writer has returned their blocks.
    while (job->pending) curl_multi_poll(multi_, nullptr, 0, 50, nullptr);
    snapshot(*job, 0, Clock::now(), previous, previous_written);
    { std::lock_guard lock(job->mutex); job->snapshot.connections = 0; }
  }
  if (prepared && job->recovering) {
    std::lock_guard lock(job->mutex);
    job->snapshot.written = job->snapshot.received = job->snapshot.completed_bytes = job->total;
    job->snapshot.total = job->total; job->snapshot.total_known = true;
  }
  if (file && job->fd >= 0) {
    if (job->checkpoint_ready) checkpoint(*job, job->completed);
    finalize(*job);
  } else {
    std::lock_guard lock(job->mutex);
    job->snapshot.body = std::move(job->response);
    if (!file) {
      job->snapshot.received = job->snapshot.body.size();
      job->snapshot.total = job->snapshot.body.size(); job->snapshot.total_known = true;
    }
    job->snapshot.state = terminal_state(*job);
    job->snapshot.connections = 0; job->finalized = true;
  }
}

void Service::network_loop() {
  for (;;) {
    std::shared_ptr<Job> job;
    {
      std::unique_lock lock(mutex_);
      wake_.wait(lock, [&] { return stopping_ || !waiting_.empty(); });
      if (stopping_ && waiting_.empty()) break;
      job = waiting_.front(); waiting_.pop_front();
    }
    run_job(job);
    downloading_file = false;
  }
}
} // namespace
bool start() { return service.start(); }
void stop() { service.stop(); }
std::uint32_t enqueue(Request request, std::string& error) { return service.enqueue(std::move(request), error); }
void cancel(std::uint32_t id) { service.cancel(id); }
std::vector<Snapshot> poll() { return service.poll(); }
void set_rate_limit(std::uint64_t bytes_per_second) { service.set_rate_limit(bytes_per_second); }
bool downloading() { return downloading_file; }
bool running() { return service.running(); }
const char* version() { return curl_version(); }
} // namespace network
#else
namespace network {
bool start() { return false; }
void stop() {}
std::uint32_t enqueue(Request, std::string& error) {
  error = "enable networking: true and filesystemAccess: console in app.json"; return 0;
}
void cancel(std::uint32_t) {}
std::vector<Snapshot> poll() { return {}; }
void set_rate_limit(std::uint64_t) {}
bool downloading() { return false; }
bool running() { return false; }
const char* version() { return "disabled"; }
bool configure_transport(void*, const std::string&, bool) { return false; }
} // namespace network
#endif
