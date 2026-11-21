// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// The PS4 has no app-install service to call: PKGs are installed by the console's own HEN
// tooling outside of Overdrive. Every request fails like a refused one, with an honest message.
#include "packages.hpp"
#include <mutex>

namespace packages {
namespace {
std::mutex guard;
std::vector<Snapshot> pending;
std::uint32_t next_id = 1;
}
std::uint32_t install(std::string, std::string, std::string, std::string&) {
  std::lock_guard lock(guard);
  Snapshot snapshot;
  snapshot.id = next_id++;
  snapshot.state = "failed";
  snapshot.error = "Installing a PKG needs the console's HEN installer; Overdrive on PS4 downloads files only.";
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
std::uint32_t start_helper(std::uint32_t, std::string, std::string, std::string& error) {
  error = "The package helper runs on a PS5 only.";
  return 0;
}
std::vector<HelperSnapshot> poll_helper() { return {}; }
}
