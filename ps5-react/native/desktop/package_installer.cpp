// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "packages.hpp"
#include <mutex>

// The preview has no console to install into: each request fails on its first poll, as a refused one would.
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
  snapshot.error = "Installing a PKG requires a PS5.";
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
// The preview serves packages from the app itself (pkg_proxy.cpp): there is no payload loader here.
std::uint32_t start_helper(std::uint32_t, std::string, std::string, std::string& error) {
  error = "The package helper runs on a PS5 only.";
  return 0;
}
std::vector<HelperSnapshot> poll_helper() { return {}; }
}
