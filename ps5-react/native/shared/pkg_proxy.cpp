// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "pkg_proxy.hpp"
#include "network.hpp"
#include "thread_name.hpp"
#include "worker_thread.hpp"
#include <arpa/inet.h>
#include <algorithm>
#include <atomic>
#include <cctype>
#include <cerrno>
#include <chrono>
#include <condition_variable>
#include <deque>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <curl/curl.h>
#include <exception>
#include <list>
#include <map>
#include <memory>
#include <mutex>
#include <netinet/in.h>
#include <new>
#include <poll.h>
#include <sys/socket.h>
#include <thread>
#include <unistd.h>
#include <vector>
#ifdef __APPLE__
#include <stdlib.h>
#else
#include <openssl/rand.h>
#endif

namespace pkg_proxy {
namespace {
using Clock = std::chrono::steady_clock;
#ifdef MSG_NOSIGNAL
constexpr int kSendFlags = MSG_NOSIGNAL;
#else
constexpr int kSendFlags = 0;
#endif
// The console's queue opens a few connections per package and keeps them open between ranges; past
// this it is asked to come back.
constexpr unsigned kMaxConnections = 32;
// A request line and its headers; the console's are a few hundred bytes.
constexpr std::size_t kMaxRequest = 8192;
// The first requests of each link are logged, so app.log shows how the console asks; the rest are not.
constexpr unsigned kLoggedRequests = 6;

struct Link {
  std::string url;
  std::string tag;  // the first eight characters of the token, for the log
  std::uint64_t total = 0;
  std::atomic<std::uint64_t> delivered{0};
  std::atomic<unsigned> requests{0};
  std::atomic<std::uint64_t> gets{0}, asked{0};  // GET requests and the bytes they asked for
  std::atomic<std::int64_t> last{0};  // Clock ticks of the last request
  // Read-ahead (see the ring below); everything here is reachable only through `ring_mutex`.
  std::mutex ring_mutex;
  std::condition_variable ring_cv;
  std::unique_ptr<char[]> ring;  // kRingBytes, or nothing while the ring is asleep
  std::uint64_t base = 0;    // the file offset ring[0] is
  std::uint64_t have = 0;    // bytes valid from base, contiguous
  std::uint64_t filled = 0;  // bytes from base claimed by chunks, always >= have
  unsigned generation = 0;   // bumped when the window starts again: older chunks are dropped
  bool filling = false;      // a ring thread is running
  bool broken = false;       // a chunk failed: every request goes to the origin from now on
};
struct Connection {
  int fd = -1;
  bool loopback = false;  // the peer is this console: only it may use the control commands
  std::atomic<bool> done{false};
  WorkerThread thread;
};

std::mutex mutex;
std::map<std::string, std::shared_ptr<Link>> links;
std::list<std::unique_ptr<Connection>> connections;
WorkerThread acceptor;
int listener = -1;
std::uint16_t port = 0;
std::atomic<bool> stopping{false};
std::string control;  // the control commands' secret; empty in the app, where nothing else asks
std::atomic<std::int64_t> touched{0};

std::int64_t ticks() { return Clock::now().time_since_epoch().count(); }

void log(const std::string& line) { network::platform_log(("pkg-proxy: " + line).c_str()); }

bool send_all(int fd, const char* data, std::size_t size) {
  while (size) {
    const auto count = send(fd, data, size, kSendFlags);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    data += count;
    size -= static_cast<std::size_t>(count);
  }
  return true;
}

// Every answer carries what the console's downloader expects of a package origin. A package's own
// answers keep the connection open for the console's next range; an error closes it.
constexpr const char* kCommon = "Accept-Ranges: bytes\r\nCache-Control: no-store\r\n";

bool reply_text(int fd, int status, const char* reason, const std::string& body) {
  char head[300];
  const int size = std::snprintf(head, sizeof head, "HTTP/1.1 %d %s\r\nContent-Type: text/plain\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: %zu\r\n\r\n",
                                 status, reason, body.size());
  return send_all(fd, head, static_cast<std::size_t>(size)) && send_all(fd, body.data(), body.size());
}

bool reply(int fd, int status, const char* reason, const char* extra = "") {
  char head[300];
  const int size = std::snprintf(head, sizeof head, "HTTP/1.1 %d %s\r\n%s%sConnection: close\r\nContent-Length: 0\r\n\r\n", status, reason, kCommon, extra);
  return send_all(fd, head, static_cast<std::size_t>(size));
}

// The request line and headers, up to the blank line, from what the connection holds (`pending`, which
// keeps whatever follows); false when the client hangs up, stays quiet or sends too much.
bool read_request(int fd, std::string& pending, std::string& out, int wait_ms) {
  char buffer[4096];
  for (;;) {
    const auto end = pending.find("\r\n\r\n");
    if (end != std::string::npos) {
      out = pending.substr(0, end + 4);
      pending.erase(0, end + 4);
      return true;
    }
    pollfd ready{fd, POLLIN, 0};
    if (stopping || poll(&ready, 1, wait_ms) <= 0) return false;
    const auto count = recv(fd, buffer, sizeof buffer, 0);
    if (count <= 0 || pending.size() + static_cast<std::size_t>(count) > kMaxRequest) return false;
    pending.append(buffer, static_cast<std::size_t>(count));
  }
}

// One pool of origin connections, TLS sessions and names for every request, so a console asking range
// after range does not pay a new TCP and TLS handshake for each: with a fresh one per range the console
// took 2.4 MB/s (2026-10-25).
std::mutex share_locks[CURL_LOCK_DATA_LAST];
CURLSH* origin_pool() {
  static CURLSH* pool = [] {
    CURLSH* made = curl_share_init();
    if (!made) return made;
    curl_share_setopt(made, CURLSHOPT_LOCKFUNC, +[](CURL*, curl_lock_data data, curl_lock_access, void*) { share_locks[data].lock(); });
    curl_share_setopt(made, CURLSHOPT_UNLOCKFUNC, +[](CURL*, curl_lock_data data, void*) { share_locks[data].unlock(); });
    curl_share_setopt(made, CURLSHOPT_SHARE, CURL_LOCK_DATA_DNS);
    curl_share_setopt(made, CURLSHOPT_SHARE, CURL_LOCK_DATA_SSL_SESSION);
    curl_share_setopt(made, CURLSHOPT_SHARE, CURL_LOCK_DATA_CONNECT);
    return made;
  }();
  return pool;
}

// The value of `name` (lower case) among the request's headers, empty when it has none.
std::string header(const std::string& request, const char* name) {
  std::size_t at = request.find("\r\n");
  while (at != std::string::npos && at + 2 < request.size()) {
    const auto start = at + 2, end = request.find("\r\n", start);
    const auto colon = request.find(':', start);
    if (end == std::string::npos || end == start) break;
    if (colon != std::string::npos && colon < end) {
      std::string key = request.substr(start, colon - start);
      for (auto& c : key) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
      if (key == name) {
        auto value = request.substr(colon + 1, end - colon - 1);
        while (!value.empty() && value.front() == ' ') value.erase(0, 1);
        return value;
      }
    }
    at = end;
  }
  return {};
}

// "bytes=<first>-<last>" or "bytes=<first>-": one range inside the file. Several ranges or a suffix
// range ("bytes=-500") are answered with the whole file, which HTTP allows.
bool parse_range(const std::string& value, std::uint64_t total, std::uint64_t& first, std::uint64_t& last) {
  unsigned long long a = 0, b = 0;
  char tail = 0;
  if (std::sscanf(value.c_str(), "bytes=%llu-%llu%c", &a, &b, &tail) == 2) { first = a; last = b; }
  else if (std::sscanf(value.c_str(), "bytes=%llu-%c", &a, &tail) == 1) { first = a; last = total - 1; }
  else return false;
  if (last >= total) last = total - 1;
  return first <= last;
}

// ---- Read-ahead ------------------------------------------------------------
// The console's queue asks ~5 MiB ranges one after another on a single connection, so a
// pass-through carries one origin stream: the console crawled at 1.4 MB/s where the app's own
// sixteen connections reach 11 MB/s (2026-10-25). A range is now fetched ahead by several origin
// connections into a fixed ring and handed over only once it is whole, so its Content-Length can
// never be short. Anything that goes wrong — no memory, a range too wide for the ring, an origin
// error, a wait that runs too long — falls back to the pass-through below, which is what the
// console had before.
constexpr std::size_t kRingBytes = 32u << 20;  // the window, whatever the package's size
constexpr std::size_t kChunkBytes = 2u << 20;  // one origin request
constexpr unsigned kChunkJobs = 8;             // origin connections filling the ring
constexpr unsigned kChunkQuiet = 2;            // ... while the console has gone quiet
constexpr std::int64_t kQuietMs = 5000;        // silence that means a slow console, not a gap
constexpr int kRingWaitMs = 20000;             // a range not whole in this long is passed through
constexpr std::int64_t kRingIdleMs = 60000;    // the ring is freed after this much silence

struct RingJob {
  CURL* easy = nullptr;
  Link* link = nullptr;
  std::uint64_t file_offset = 0;    // where in the file this chunk starts
  std::size_t length = 0, got = 0;  // `got` is written under the link's ring_mutex
  unsigned generation = 0;          // the window it was asked for
  bool done = false;
};

// Writes one origin chunk into the ring at the place the window puts it now: a slide moves the ring
// under a running chunk without touching what the chunk asked the origin for.
std::size_t ring_body(char* data, std::size_t size, std::size_t count, void* user) {
  auto& job = *static_cast<RingJob*>(user);
  Link& link = *job.link;
  const std::size_t length = size * count;
  std::lock_guard lock(link.ring_mutex);
  if (job.generation != link.generation || job.got + length > job.length) return 0;
  const std::int64_t at = static_cast<std::int64_t>(job.file_offset + job.got) - static_cast<std::int64_t>(link.base);
  if (at < 0 || static_cast<std::size_t>(at) + length > kRingBytes) return 0;
  std::memcpy(link.ring.get() + at, data, length);
  job.got += length;
  return length;
}

void drop_jobs(CURLM* multi, std::deque<std::unique_ptr<RingJob>>& jobs) {
  for (auto& job : jobs) {
    if (!job->easy) continue;
    curl_multi_remove_handle(multi, job->easy);
    curl_easy_cleanup(job->easy);
    job->easy = nullptr;
  }
  jobs.clear();
}

// Fills the ring in `kChunkJobs` origin connections until it is full, sleeps between slides, and
// frees the ring once the console has been quiet long enough. One `have` advances only across whole
// chunks, so what the ring calls valid is always what the origin really sent.
void ring_loop(std::shared_ptr<Link> link) {
  name_thread("pkg-ring");
  CURLM* multi = curl_multi_init();
  std::deque<std::unique_ptr<RingJob>> jobs;
  unsigned gen = 0;
  while (multi && !stopping) {
    bool idle = false;
    {
      std::unique_lock lock(link->ring_mutex);
      if (gen != link->generation) { drop_jobs(multi, jobs); gen = link->generation; }
      const auto silent = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::duration(ticks() - link->last)).count();
      const unsigned quota = silent > kQuietMs ? kChunkQuiet : kChunkJobs;
      while (!link->broken && jobs.size() < quota) {
        const std::uint64_t room = kRingBytes - link->filled;
        const std::uint64_t left = link->total > link->base + link->filled ? link->total - link->base - link->filled : 0;
        if (!room || !left) break;
        auto job = std::make_unique<RingJob>();
        job->link = link.get();
        job->file_offset = link->base + link->filled;
        job->length = static_cast<std::size_t>(std::min({std::uint64_t(kChunkBytes), room, left}));
        job->generation = link->generation;
        job->easy = curl_easy_init();
        bool ok = job->easy && network::configure_transport(job->easy, link->url, true);
        if (CURLSH* pool = origin_pool()) ok = ok && curl_easy_setopt(job->easy, CURLOPT_SHARE, pool) == CURLE_OK;
        char span[64];
        std::snprintf(span, sizeof span, "%llu-%llu", static_cast<unsigned long long>(job->file_offset),
                      static_cast<unsigned long long>(job->file_offset + job->length - 1));
        ok = ok && curl_easy_setopt(job->easy, CURLOPT_RANGE, span) == CURLE_OK;
        ok = ok && curl_easy_setopt(job->easy, CURLOPT_WRITEFUNCTION, ring_body) == CURLE_OK;
        ok = ok && curl_easy_setopt(job->easy, CURLOPT_WRITEDATA, job.get()) == CURLE_OK;
        ok = ok && curl_easy_setopt(job->easy, CURLOPT_NOPROGRESS, 0L) == CURLE_OK;
        ok = ok && curl_easy_setopt(job->easy, CURLOPT_XFERINFOFUNCTION, +[](void*, curl_off_t, curl_off_t, curl_off_t, curl_off_t) -> int { return stopping ? 1 : 0; }) == CURLE_OK;
        if (!ok || curl_multi_add_handle(multi, job->easy) != CURLM_OK) {
          if (job->easy) curl_easy_cleanup(job->easy);
          link->broken = true;
          link->ring_cv.notify_all();
          break;
        }
        link->filled += job->length;
        jobs.push_back(std::move(job));
      }
      if (jobs.empty()) {
        if (link->broken || silent > kRingIdleMs) idle = true;
        else link->ring_cv.wait_for(lock, std::chrono::milliseconds(200));
      }
    }
    if (idle) break;
    int running = 0;
    curl_multi_perform(multi, &running);
    int wait = 0;
    curl_multi_wait(multi, nullptr, 0, 200, &wait);
    int queued = 0;
    while (CURLMsg* message = curl_multi_info_read(multi, &queued)) {
      if (message->msg != CURLMSG_DONE) continue;
      CURL* easy = message->easy_handle;
      const CURLcode result = message->data.result;
      bool failed = false;
      {
        std::lock_guard lock(link->ring_mutex);
        for (auto& job : jobs) {
          if (job->easy != easy) continue;
          curl_multi_remove_handle(multi, easy);
          curl_easy_cleanup(easy);
          job->easy = nullptr;
          // One chunk short or refused: the console is never left waiting on a range that will not
          // be whole; from here on every request goes to the origin as before.
          if (result != CURLE_OK || job->got != job->length) {
            log(link->tag + " read-ahead failed (" + curl_easy_strerror(result) + "); ranges go to the origin");
            link->broken = true;
            failed = true;
            break;
          }
          job->done = true;
          while (!jobs.empty() && jobs.front()->done) {
            link->have += jobs.front()->length;
            jobs.pop_front();
          }
          link->ring_cv.notify_all();
          break;
        }
        if (failed) { drop_jobs(multi, jobs); link->ring_cv.notify_all(); }
      }
    }
  }
  if (multi) {
    drop_jobs(multi, jobs);
    curl_multi_cleanup(multi);
  }
  std::lock_guard lock(link->ring_mutex);
  link->ring.reset();
  link->base = link->have = link->filled = 0;
  ++link->generation;
  link->filling = false;
  link->ring_cv.notify_all();
}

// Allocates the ring and starts its thread; the caller holds `ring_mutex`.
bool start_ring(const std::shared_ptr<Link>& link) {
  if (link->broken) return false;
  // Nothrow new: the build has no exceptions, and a ring that cannot be allocated is a range served
  // the old way, not a crash.
  if (!link->ring) {
    link->ring.reset(new (std::nothrow) char[kRingBytes]);
    if (!link->ring) { link->broken = true; return false; }
  }
  if (!link->filling) {
    link->filling = true;
    log(link->tag + " fetching ahead in " + std::to_string(kChunkJobs) + " origin connections");
    std::thread(ring_loop, link).detach();
  }
  return true;
}

// 1 when the range was served from the ring, 0 when it has to go to the origin, -1 when sending it
// failed and the connection must close.
int serve_from_ring(const std::shared_ptr<Link>& link, int fd, const char* head, std::size_t head_size,
                    std::uint64_t first, std::uint64_t last) {
  const std::uint64_t length = last - first + 1;
  if (length > kChunkBytes * 4) return 0;  // a range that wide is not what the console's queue asks
  std::unique_lock lock(link->ring_mutex);
  for (int attempt = 0; attempt < 8; ++attempt) {
    if (link->broken || !start_ring(link)) return 0;
    if (first < link->base || first - link->base > link->have) {
      // A jump (the queue's first probes, or a seek): the window starts again where it asked.
      link->base = first;
      link->have = link->filled = 0;
      ++link->generation;
      link->ring_cv.notify_all();
      continue;
    }
    if (const std::uint64_t delta = first - link->base) {
      // The console has read past this: drop it, so the window keeps room ahead of what it asks.
      const std::uint64_t kept = link->have - delta;
      std::memmove(link->ring.get(), link->ring.get() + delta, static_cast<std::size_t>(kept));
      link->base = first;
      link->have = kept;
      link->filled -= delta;
      link->ring_cv.notify_all();
    }
    const std::uint64_t at = first - link->base;
    if (at + length > kRingBytes) return 0;
    const unsigned gen = link->generation;
    const auto deadline = Clock::now() + std::chrono::milliseconds(kRingWaitMs);
    while (link->have < at + length) {
      if (link->broken || !link->ring) break;
      if (link->generation != gen) break;
      if (link->ring_cv.wait_until(lock, deadline) == std::cv_status::timeout) return 0;
    }
    if (link->broken) return 0;
    if (link->generation != gen || !link->ring) continue;
    // A whole range, from memory: the answer cannot be short, and the connection stays open for the
    // console's next range.
    std::vector<char> body(link->ring.get() + static_cast<std::ptrdiff_t>(at),
                           link->ring.get() + static_cast<std::ptrdiff_t>(at + length));
    lock.unlock();
    const bool sent = send_all(fd, head, head_size) && send_all(fd, body.data(), body.size());
    if (sent) link->delivered += length;
    link->ring_cv.notify_all();
    return sent ? 1 : -1;
  }
  return 0;
}

struct Forward {
  int fd = -1;
  CURL* curl = nullptr;
  Link* link = nullptr;
  std::string head;     // sent before the first body byte, once the origin answered as expected
  bool ranged = false, started = false, refused = false;
  long status = 0;
};

std::size_t forward_body(char* data, std::size_t size, std::size_t count, void* user) {
  auto& f = *static_cast<Forward*>(user);
  if (!f.started) {
    curl_easy_getinfo(f.curl, CURLINFO_RESPONSE_CODE, &f.status);
    // The origin is always asked for a range; a 200 is the whole file, right only when that is what
    // the console asked for, and anything else would hand it the wrong bytes.
    if (f.status != 206 && !(f.status == 200 && !f.ranged)) { f.refused = true; return 0; }
    if (!send_all(f.fd, f.head.data(), f.head.size())) return 0;
    f.started = true;
  }
  if (stopping || !send_all(f.fd, data, size * count)) return 0;
  f.link->delivered += size * count;
  return size * count;
}

bool valid_token(const std::string& token);
bool new_token(std::string& out);
std::string lan_address();
std::string plain(const std::string& file);

// A small body after the headers (a control command's), up to 4 KiB.
bool read_body(int fd, const std::string& request, std::string& body) {
  const auto end = request.find("\r\n\r\n") + 4;
  body = request.substr(end);
  const auto length = std::strtoull(header(request, "content-length").c_str(), nullptr, 10);
  if (length > 4096) return false;
  char buffer[1024];
  while (body.size() < length) {
    pollfd ready{fd, POLLIN, 0};
    if (poll(&ready, 1, 5000) <= 0) return false;
    const auto count = recv(fd, buffer, sizeof buffer, 0);
    if (count <= 0) return false;
    body.append(buffer, static_cast<std::size_t>(count));
  }
  body.resize(length);
  return true;
}

// Adds a link; the caller holds `mutex`.
bool add_locked(const Request& request, Served& out, std::string& error) {
  std::string token = request.token;
  if (!valid_token(token) && !new_token(token)) { error = "no random bytes for the link's token"; return false; }
  // A link the helper already serves (the app reopened while it ran) keeps what it has sent so far.
  if (!links.count(token)) {
    auto link = std::make_shared<Link>();
    link->url = request.url;
    link->tag = token.substr(0, 8);
    link->total = request.total;
    link->last = ticks();
    links[token] = link;
  }
  touched = ticks();
  const std::string path = ":" + std::to_string(port) + "/" + token + "/" + plain(request.file);
  const std::string lan = lan_address();
  out.url = lan.empty() ? std::string() : "http://" + lan + path;
  out.local_url = "http://127.0.0.1" + path;
  out.token = token;
  out.port = port;
  log(token.substr(0, 8) + " serving " + std::to_string(request.total) + " bytes at " + (lan.empty() ? "127.0.0.1 only" : lan));
  return true;
}

void serve_control(Connection& connection, const std::string& method, const std::string& command, const std::string& request) {
  const int fd = connection.fd;
  if (!connection.loopback) { reply(fd, 403, "Forbidden"); return; }
  if (command == "ping") { reply_text(fd, 200, "OK", "ok " + std::to_string(port) + "\n"); return; }
  if (command == "stats") {
    std::string body;
    for (const auto& item : stats())
      body += item.token + " " + std::to_string(item.total) + " " + std::to_string(item.delivered) + " " +
              std::to_string(item.requests) + " " + std::to_string(item.idle_ms) + " " + std::to_string(item.gets) + " " +
              std::to_string(item.asked) + "\n";
    reply_text(fd, 200, "OK", body);
    return;
  }
  std::string body;
  if (method != "POST" || !read_body(fd, request, body)) { reply(fd, 400, "Bad Request"); return; }
  if (command == "remove") {
    while (!body.empty() && (body.back() == '\n' || body.back() == '\r')) body.pop_back();
    remove(body);
    reply_text(fd, 200, "OK", "ok\n");
    return;
  }
  if (command != "add") { reply(fd, 404, "Not Found"); return; }
  std::string lines[4];
  std::size_t at = 0;
  for (auto& line : lines) {
    const auto end = body.find('\n', at);
    line = body.substr(at, end == std::string::npos ? std::string::npos : end - at);
    if (!line.empty() && line.back() == '\r') line.pop_back();
    at = end == std::string::npos ? body.size() : end + 1;
  }
  Request add;
  add.token = lines[0] == "-" ? std::string() : lines[0];
  add.total = std::strtoull(lines[1].c_str(), nullptr, 10);
  add.url = lines[2];
  add.file = lines[3];
  const bool link = (!add.url.compare(0, 8, "https://") || !add.url.compare(0, 7, "http://")) && add.url.size() < 4000 &&
                    add.url.find_first_of(" \t\r\n") == std::string::npos;
  if (!add.total || !link) { reply_text(fd, 400, "Bad Request", "expected a token, a size, an http(s) link and a name\n"); return; }
  Served out;
  std::string error;
  bool ok;
  {
    std::lock_guard lock(mutex);
    ok = add_locked(add, out, error);
  }
  if (!ok) { reply_text(fd, 500, "Internal Server Error", error + "\n"); return; }
  reply_text(fd, 200, "OK", "token=" + out.token + "\nurl=" + out.url + "\nlocal=" + out.local_url + "\nport=" + std::to_string(out.port) + "\n");
}

// One request on the connection; true when it can take the next one.
bool serve_request(Connection& connection, std::string& pending, CURL*& curl, bool first) {
  const int fd = connection.fd;
  std::string request;
  // The console opens a connection to ask at once; one it keeps open may stay quiet between ranges.
  if (!read_request(fd, pending, request, first ? 10000 : 30000)) return false;
  const auto line_end = request.find("\r\n");
  const auto first_space = request.find(' ');
  const auto second_space = first_space == std::string::npos ? std::string::npos : request.find(' ', first_space + 1);
  if (second_space == std::string::npos || second_space > line_end) { reply(fd, 400, "Bad Request"); return false; }
  const std::string method = request.substr(0, first_space);
  const std::string path = request.substr(first_space + 1, second_space - first_space - 1);
  if (!control.empty() && !path.compare(0, 10 + control.size(), "/control/" + control + "/")) {
    // A command's body may already sit in what the connection read after its headers.
    serve_control(connection, method, path.substr(10 + control.size()), request + pending);
    return false;
  }
  // "/<token>/<file>.pkg"
  const auto slash = path.find('/', 1);
  const std::string token = path.size() > 1 && slash != std::string::npos ? path.substr(1, slash - 1) : std::string();
  std::shared_ptr<Link> link;
  {
    std::lock_guard lock(mutex);
    const auto found = links.find(token);
    if (found != links.end()) link = found->second;
  }
  if (!link) { reply(fd, 404, "Not Found"); return false; }
  const unsigned seen = ++link->requests;
  link->last = ticks();
  touched = ticks();
  const std::string range = header(request, "range");
  std::string wants = header(request, "connection");
  for (auto& c : wants) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  const bool keep = wants != "close";
  // The token is the link's only secret: its first eight characters are enough to tell links apart.
  const std::string name = token.substr(0, 8);
  if (seen <= kLoggedRequests) log(name + " request " + std::to_string(seen) + ": " + method + (range.empty() ? "" : " " + range));
  if (method != "GET" && method != "HEAD") { reply(fd, 405, "Method Not Allowed"); return false; }

  std::uint64_t first_byte = 0, last = link->total - 1;
  const bool ranged = !range.empty() && parse_range(range, link->total, first_byte, last);
  if (!range.empty() && !ranged && range.find(',') == std::string::npos && range.find("=-") == std::string::npos) {
    char extra[80];
    std::snprintf(extra, sizeof extra, "Content-Range: bytes */%llu\r\n", static_cast<unsigned long long>(link->total));
    reply(fd, 416, "Range Not Satisfiable", extra);
    return false;
  }
  const char* connection_header = keep ? "Connection: keep-alive\r\n" : "Connection: close\r\n";
  char head[560];
  const int head_size = ranged
    ? std::snprintf(head, sizeof head, "HTTP/1.1 206 Partial Content\r\nContent-Type: application/pkg\r\n%s%s"
                    "Content-Range: bytes %llu-%llu/%llu\r\nContent-Length: %llu\r\n\r\n", kCommon, connection_header,
                    static_cast<unsigned long long>(first_byte), static_cast<unsigned long long>(last),
                    static_cast<unsigned long long>(link->total), static_cast<unsigned long long>(last - first_byte + 1))
    : std::snprintf(head, sizeof head, "HTTP/1.1 200 OK\r\nContent-Type: application/pkg\r\n%s%sContent-Length: %llu\r\n\r\n",
                    kCommon, connection_header, static_cast<unsigned long long>(link->total));
  // The HEAD the origin would refuse is answered here, from the size the app read with a GET.
  if (method == "HEAD") return send_all(fd, head, static_cast<std::size_t>(head_size)) && keep;

  ++link->gets;
  link->asked += last - first_byte + 1;
  // Ranges are fetched ahead by several origin connections and handed over whole; whatever the
  // ring cannot serve goes to the origin exactly as before.
  if (ranged) {
    const int from_ring = serve_from_ring(link, fd, head, static_cast<std::size_t>(head_size), first_byte, last);
    if (from_ring < 0) return false;
    if (from_ring > 0) return keep;
  }
  if (curl) curl_easy_reset(curl);
  else curl = curl_easy_init();
  if (!curl) { reply(fd, 503, "Service Unavailable", "Retry-After: 1\r\n"); return false; }
  Forward forward;
  forward.fd = fd;
  forward.curl = curl;
  forward.link = link.get();
  forward.head.assign(head, static_cast<std::size_t>(head_size));
  forward.ranged = ranged;
  char span[64];
  std::snprintf(span, sizeof span, "%llu-%llu", static_cast<unsigned long long>(first_byte), static_cast<unsigned long long>(last));
  bool ok = network::configure_transport(curl, link->url, true);
  if (CURLSH* pool = origin_pool()) ok = ok && curl_easy_setopt(curl, CURLOPT_SHARE, pool) == CURLE_OK;
  ok = ok && curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, forward_body) == CURLE_OK;
  ok = ok && curl_easy_setopt(curl, CURLOPT_WRITEDATA, &forward) == CURLE_OK;
  // Asked as a range even for the whole file: an origin that answers 200 to it is caught above.
  ok = ok && curl_easy_setopt(curl, CURLOPT_RANGE, span) == CURLE_OK;
  // An origin that has gone quiet does not hold the app's exit for the 30 s of the low-speed limit.
  ok = ok && curl_easy_setopt(curl, CURLOPT_NOPROGRESS, 0L) == CURLE_OK;
  ok = ok && curl_easy_setopt(curl, CURLOPT_XFERINFOFUNCTION, +[](void*, curl_off_t, curl_off_t, curl_off_t, curl_off_t) -> int { return stopping ? 1 : 0; }) == CURLE_OK;
  const CURLcode result = ok ? curl_easy_perform(curl) : CURLE_FAILED_INIT;
  if (forward.started) {
    if (result != CURLE_OK && !stopping && seen <= kLoggedRequests) log(name + " request " + std::to_string(seen) + " ended early: " + curl_easy_strerror(result));
    // A range cut short leaves the console short of its Content-Length: only a whole one keeps it open.
    return result == CURLE_OK && keep;
  }
  // Nothing went to the console yet: it hears what the origin said, so its own error names it. An
  // expired signed link answers 403 here, which app.log says in so many words.
  if (forward.refused || forward.status >= 400) {
    log(name + " request " + std::to_string(seen) + ": the origin answered HTTP " + std::to_string(forward.status));
    if (forward.status == 403) reply(fd, 403, "Forbidden");
    else if (forward.status == 404 || forward.status == 410) reply(fd, 404, "Not Found");
    else reply(fd, 502, "Bad Gateway");
    return false;
  }
  log(name + " request " + std::to_string(seen) + " failed: " + curl_easy_strerror(result));
  reply(fd, 502, "Bad Gateway");
  return false;
}

void serve_connection(Connection& connection) {
  name_thread("pkg-proxy");
  std::string pending;
  CURL* curl = nullptr;
  for (bool first = true; !stopping && serve_request(connection, pending, curl, first); first = false) {}
  if (curl) curl_easy_cleanup(curl);
}

// Joins the connections that have finished; the caller holds `mutex`.
void reap() {
  for (auto it = connections.begin(); it != connections.end();) {
    if ((*it)->done) { (*it)->thread.join(); it = connections.erase(it); }
    else ++it;
  }
}

void accept_loop() {
  name_thread("pkg-proxy-accept");
  while (!stopping) {
    pollfd ready{listener, POLLIN, 0};
    if (poll(&ready, 1, 250) <= 0) continue;
    sockaddr_in peer{};
    socklen_t peer_length = sizeof peer;
    const int fd = accept(listener, reinterpret_cast<sockaddr*>(&peer), &peer_length);
    if (fd < 0) continue;
#ifdef SO_NOSIGPIPE
    const int on = 1;
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
#endif
    std::lock_guard lock(mutex);
    reap();
    // A full house is asked to come back in a second, as a busy origin would.
    if (stopping || connections.size() >= kMaxConnections) { reply(fd, 503, "Service Unavailable", "Retry-After: 1\r\n"); close(fd); continue; }
    auto connection = std::make_unique<Connection>();
    connection->fd = fd;
    connection->loopback = peer.sin_family == AF_INET && (ntohl(peer.sin_addr.s_addr) >> 24) == 127;
    Connection* raw = connection.get();
    // TLS to the origin and libcurl's resolver want more than the console's small default stack.
    if (!raw->thread.start([raw] { serve_connection(*raw); shutdown(raw->fd, SHUT_RDWR); close(raw->fd); raw->done = true; }, 1024 * 1024)) {
      reply(fd, 503, "Service Unavailable", "Retry-After: 1\r\n");
      close(fd);
      continue;
    }
    connections.push_back(std::move(connection));
  }
}

// Binds every interface, on `wanted` when it is free (the port an earlier session's links name) or a
// port the system picks; the caller holds `mutex`.
bool listen_on(std::uint16_t wanted, std::string& error) {
  if (listener >= 0) return true;
  const int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) { error = std::string("socket: ") + std::strerror(errno); return false; }
  const int on = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on);
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_ANY);
  bool bound = false;
  for (const std::uint16_t candidate : {wanted, std::uint16_t(0)}) {
    if (candidate == 0 && bound) break;
    address.sin_port = htons(candidate);
    if (bind(fd, reinterpret_cast<sockaddr*>(&address), sizeof address) == 0) { bound = true; break; }
    if (candidate) log("port " + std::to_string(candidate) + " is taken (" + std::strerror(errno) + "); links from before cannot reconnect");
  }
  socklen_t length = sizeof address;
  if (!bound || listen(fd, 16) != 0 || getsockname(fd, reinterpret_cast<sockaddr*>(&address), &length) != 0) {
    error = std::string("listen: ") + std::strerror(errno);
    close(fd);
    return false;
  }
  listener = fd;
  port = ntohs(address.sin_port);
  stopping = false;
  touched = ticks();
  if (!acceptor.start(accept_loop, 256 * 1024)) {
    error = "Cannot start the proxy thread.";
    close(fd);
    listener = -1;
    return false;
  }
  log("listening on port " + std::to_string(port));
  return true;
}

// The console's address on its network: the one a UDP socket "connected" to a public address would
// send from. Nothing is sent; empty when the console has no route out.
std::string lan_address() {
  const int fd = socket(AF_INET, SOCK_DGRAM, 0);
  if (fd < 0) return {};
  sockaddr_in to{};
  to.sin_family = AF_INET;
  to.sin_port = htons(53);
  inet_pton(AF_INET, "1.1.1.1", &to.sin_addr);
  sockaddr_in local{};
  socklen_t length = sizeof local;
  std::string out;
  if (connect(fd, reinterpret_cast<sockaddr*>(&to), sizeof to) == 0 &&
      getsockname(fd, reinterpret_cast<sockaddr*>(&local), &length) == 0 && local.sin_addr.s_addr != htonl(INADDR_ANY)) {
    char text[INET_ADDRSTRLEN] = {};
    if (inet_ntop(AF_INET, &local.sin_addr, text, sizeof text) && std::strncmp(text, "127.", 4)) out = text;
  }
  close(fd);
  return out;
}

// 32 random bytes as 64 hex digits: the server answers anyone on the network, and a link is only as
// private as its token.
bool new_token(std::string& out) {
  unsigned char bytes[32];
#ifdef __APPLE__
  arc4random_buf(bytes, sizeof bytes);
#else
  if (RAND_bytes(bytes, sizeof bytes) != 1) return false;
#endif
  static const char digits[] = "0123456789abcdef";
  out.clear();
  for (unsigned char byte : bytes) { out.push_back(digits[byte >> 4]); out.push_back(digits[byte & 15]); }
  return true;
}

bool valid_token(const std::string& token) {
  if (token.size() != 64) return false;
  for (char c : token) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  return true;
}

// A name the console shows and its parser reads: letters, digits, dot, dash, underscore.
std::string plain(const std::string& file) {
  std::string out;
  for (char c : file) out.push_back((std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '-' || c == '_') ? c : '-');
  if (out.size() > 80) out.resize(80);
  if (out.empty()) out = "package";
  if (out.size() < 4 || out.compare(out.size() - 4, 4, ".pkg")) out += ".pkg";
  return out;
}
}

bool serve(const Request& request, Served& out, std::string& error) {
  if (!request.total) { error = "the package size is unknown"; return false; }
  std::lock_guard lock(mutex);
  if (!listen_on(request.port, error)) return false;
  return add_locked(request, out, error);
}

bool start(std::uint16_t wanted, const std::string& secret, std::uint16_t& bound, std::string& error) {
  std::lock_guard lock(mutex);
  control = secret;
  if (!listen_on(wanted, error)) return false;
  bound = port;
  return true;
}

std::uint64_t idle_ms() {
  return static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::duration(ticks() - touched)).count());
}

std::vector<Stats> stats() {
  std::lock_guard lock(mutex);
  std::vector<Stats> out;
  const auto now = ticks();
  for (const auto& [token, link] : links) {
    Stats item;
    item.token = token;
    item.total = link->total;
    item.delivered = link->delivered;
    item.requests = link->requests;
    item.gets = link->gets;
    item.asked = link->asked;
    item.idle_ms = static_cast<std::uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(Clock::duration(now - link->last)).count());
    out.push_back(std::move(item));
  }
  return out;
}

void remove(const std::string& token) {
  std::lock_guard lock(mutex);
  links.erase(token);
}

void stop() {
  {
    std::lock_guard lock(mutex);
    if (listener < 0) return;
    stopping = true;
    for (auto& connection : connections) if (!connection->done) shutdown(connection->fd, SHUT_RDWR);
  }
  acceptor.join();
  std::lock_guard lock(mutex);
  for (auto& connection : connections) connection->thread.join();
  connections.clear();
  close(listener);
  listener = -1;
  links.clear();
}
}
