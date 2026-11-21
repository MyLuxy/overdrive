// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "network.hpp"
#include <algorithm>
#include <chrono>
#include <cstdio>
#include <csignal>
#include <sys/resource.h>
#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

std::string escaped(const std::string& value) {
  std::string out = "\"";
  for (unsigned char c : value) {
    if (c == '"' || c == '\\') { out += '\\'; out += static_cast<char>(c); }
    else if (c < 32) { char text[7]; std::snprintf(text, sizeof text, "\\u%04x", c); out += text; }
    else out += static_cast<char>(c);
  }
  return out+'"';
}

int main(int argc, char** argv) {
  if (argc < 3) return 2;
  if (argc > 8 && std::strtoull(argv[8], nullptr, 10)) {
    const rlim_t bytes = std::strtoull(argv[8], nullptr, 10);
    const rlimit limit{bytes, bytes};
    if (setrlimit(RLIMIT_FSIZE, &limit) != 0) return 5;
    std::signal(SIGXFSZ, SIG_IGN);
  }
  if (!network::start()) return 3;
  network::Request request;
  request.url = argv[1];
  if (std::string(argv[2]) != "-") request.destination = argv[2];
  request.adaptive = std::getenv("NETWORK_TEST_ADAPTIVE") != nullptr;
  request.reject_html = std::getenv("NETWORK_TEST_REJECT_HTML") != nullptr;
  request.follow_redirects = std::getenv("NETWORK_TEST_NO_REDIRECT") == nullptr;
  request.recover_completed = std::getenv("NETWORK_TEST_RECOVER") != nullptr;
  if (const char* mirrors = std::getenv("NETWORK_TEST_MIRRORS")) {
    for (std::string list = mirrors; !list.empty();) {
      const auto comma = list.find(',');
      request.mirrors.push_back(list.substr(0, comma));
      list = comma == std::string::npos ? "" : list.substr(comma+1);
    }
  }
  request.connections = argc > 3 ? static_cast<unsigned>(std::atoi(argv[3])) : 4;
  request.range_bytes = 1024*1024;
  if (const char* bytes = std::getenv("NETWORK_TEST_RANGE_BYTES")) request.range_bytes = std::strtoull(bytes, nullptr, 10);
  request.max_bytes = argc > 4 ? std::strtoull(argv[4], nullptr, 10) : 1024*1024;
  const unsigned cancel_ms = argc > 5 ? static_cast<unsigned>(std::atoi(argv[5])) : 0;
  const unsigned stop_ms = argc > 9 ? static_cast<unsigned>(std::atoi(argv[9])) : 0;
  if (argc > 6) request.sha256 = argv[6];
  if (argc > 7) request.method = argv[7];
  if (std::getenv("NETWORK_TEST_RANGE_PROBE")) request.headers.emplace_back("Range: bytes=0-0");
  if (argc > 10 && std::string(argv[10]) == "pieces") {
    const std::uint64_t sizes[] = {3*1024*1024+17, 5*1024*1024+31, 7*1024*1024+9};
    std::uint64_t offset = 0;
    for (unsigned i = 0; i < 3; ++i) {
      request.pieces.push_back({request.url+"/piece"+std::to_string(i), argc > 11+static_cast<int>(i) ? argv[11+i] : "", offset, sizes[i]});
      offset += sizes[i];
    }
    request.expected_bytes = offset;
  }
  std::string error;
  const auto id = network::enqueue(std::move(request), error);
  if (!id) { std::cerr << error << '\n'; network::stop(); return 4; }
  const char* deadline = std::getenv("NETWORK_TEST_DEADLINE_MS");
  const long long deadline_ms = deadline ? std::atoll(deadline) : 15000;
  const auto started = std::chrono::steady_clock::now();
  std::uint64_t peak_buffer = 0;
  unsigned peak_connections = 0;
  for (;;) {
    const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now()-started).count();
    if (stop_ms && elapsed >= stop_ms) {
      network::stop();
      std::cout << "{\"state\":\"stopped\",\"peakBuffer\":0,\"peakConnections\":0}\n";
      return 0;
    }
    if ((cancel_ms && elapsed >= cancel_ms) || elapsed > deadline_ms) network::cancel(id);
    for (const auto& result : network::poll()) {
      peak_buffer = std::max(peak_buffer, result.buffered);
      peak_connections = std::max(peak_connections, result.connections);
      if (result.state == "completed" || result.state == "failed" || result.state == "cancelled") {
        std::cout << "{\"state\":" << escaped(result.state) << ",\"error\":" << escaped(result.error)
          << ",\"body\":" << escaped(result.body) << ",\"written\":" << result.written
          << ",\"url\":" << escaped(result.url) << ",\"headers\":{";
        bool first = true;
        for (const auto& [name, value] : result.headers) {
          if (!first) std::cout << ",";
          first = false; std::cout << escaped(name) << ":" << escaped(value);
        }
        std::cout << "},\"retries\":" << result.retries
          << ",\"received\":" << result.received << ",\"status\":" << result.status
          << ",\"peakBuffer\":" << peak_buffer << ",\"peakConnections\":" << peak_connections
          << ",\"milliseconds\":" << elapsed << "}" << '\n';
        network::stop(); return result.state == "completed" ? 0 : 1;
      }
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
}
