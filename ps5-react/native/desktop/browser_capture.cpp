// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "browser_capture.hpp"
#include <mutex>

// The preview has no console to install into: each request fails on its first poll, as a refused one would.
namespace browser_capture {
namespace {
std::mutex guard;
std::vector<Snapshot> pending;
std::uint32_t next_id = 1;
}
std::uint32_t capture(std::string, std::string, int, std::vector<std::string>, bool, std::string&) {
  std::lock_guard lock(guard);
  Snapshot snapshot;
  snapshot.id = next_id++;
  snapshot.state = "failed";
  snapshot.error = "Browser capture requires a PS5 with an ELF loader on port 9021.";
  pending.push_back(snapshot);
  return snapshot.id;
}
void cancel(std::uint32_t) {}
std::vector<Snapshot> poll() {
  std::lock_guard lock(guard);
  std::vector<Snapshot> out;
  out.swap(pending);
  return out;
}
void stop() {}
}
