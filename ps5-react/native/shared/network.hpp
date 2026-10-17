// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <cstdint>
#include <string>
#include <utility>
#include <vector>

namespace network {
struct Piece {
  std::string url, sha1;
  std::uint64_t offset = 0, size = 0;
};
struct Request {
  std::string url, destination, storage_root, method = "GET", body, sha256;
  std::vector<std::string> headers;
  std::vector<Piece> pieces;
  // Other URLs serving the same bytes; ranges are spread across them and `url`.
  std::vector<std::string> mirrors;
  std::uint64_t expected_bytes = 0;
  std::uint64_t max_bytes = 1024 * 1024, range_bytes = 32 * 1024 * 1024;
  unsigned connections = 8;
  bool resume = true, adaptive = true, recover_completed = false;
  bool follow_redirects = true, reject_html = false;
  // Exempt from set_rate_limit (an app's own update).
  bool unlimited = false;
};
struct Snapshot {
  std::uint32_t id = 0;
  std::string state = "queued", error, body, destination;
  std::string url;
  std::vector<std::pair<std::string, std::string>> headers;
  std::uint64_t received = 0, written = 0, completed_bytes = 0, total = 0, buffered = 0;
  double bytes_per_second = 0;
  unsigned connections = 0, retries = 0;
  int status = 0;
  bool total_known = false;
};
// No JavaScript is accessed by either native worker. Only the caller polls JS.
bool start();
void stop();
std::uint32_t enqueue(Request request, std::string& error);
void cancel(std::uint32_t id);
std::vector<Snapshot> poll();
// Caps what file downloads receive together, in bytes per second; 0 lifts the cap. It applies at once,
// to downloads already running too, except those marked unlimited.
void set_rate_limit(std::uint64_t bytes_per_second);
// True while a download to a file runs; image loading yields connections and memory to it.
bool downloading();
// True once start() succeeded: the platform's network stack (PS5: libSceNet) is up.
bool running();
const char* version();
// Applies the transport policy every request shares (protocols, redirects, TLS trust, timeouts,
// identity encoding and the PS5 socket options) to a libcurl easy handle.
bool configure_transport(void* curl, const std::string& url, bool follow_redirects);
// Platform owns libSceNet lifecycle and the trust-store path; desktop uses defaults.
bool platform_start(std::string& error);
void platform_stop();
const char* ca_path();
void platform_log(const char* line);
} // namespace network
