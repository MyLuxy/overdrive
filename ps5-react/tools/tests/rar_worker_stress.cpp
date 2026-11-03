// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
//
// Cancels RAR extractions at random moments, then extracts once more. Each cancel must end promptly as
// "cancelled", remove staging, reap the worker process and leave no descriptor open; stop() during an
// extraction must return just as promptly.
// Usage: rar_worker_stress <destination> <rounds> <volumes...> (PS5_REACT_RAR_WORKER names rar-extract).
#include "archives.hpp"
#include <cassert>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <dirent.h>
#include <fcntl.h>
#include <random>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

void archives::trace(const char*, const char*) {}
bool archives::downloading() { return false; }
std::size_t archives::pipeline_bytes(std::uint64_t, bool) { return 32u << 20; }
bool archives::hold_memory(bool, std::uint64_t, bool) { return true; }
bool archives::list_directory(const char* path, void (*visit)(const char*, void*), void* user) {
  DIR* directory = opendir(path);
  if (!directory) return false;
  while (auto* entry = readdir(directory)) visit(entry->d_name, user);
  closedir(directory);
  return true;
}

namespace {
using clock_type = std::chrono::steady_clock;
int open_descriptors() {
  int count = 0;
  for (int fd = 0; fd < 1024; ++fd) count += fcntl(fd, F_GETFD) != -1;
  return count;
}
bool worker_running() { return !std::system("pgrep -x rar-extract >/dev/null"); }
archives::Snapshot wait(std::chrono::seconds limit) {
  const auto until = clock_type::now() + limit;
  while (clock_type::now() < until) {
    for (const auto& s : archives::poll())
      if (s.state == "completed" || s.state == "failed" || s.state == "cancelled") return s;
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  std::fprintf(stderr, "hang\n");
  std::abort();
}
std::uint32_t start(const std::string& destination, int argc, char** argv) {
  archives::Request request;
  request.destination = destination;
  for (int i = 3; i < argc; ++i) request.sources.emplace_back(argv[i]);
  std::string error;
  const auto id = archives::enqueue(std::move(request), error);
  assert(id);
  return id;
}
}

int main(int argc, char** argv) {
  const std::string destination = argv[1];
  const int rounds = std::atoi(argv[2]);
  std::mt19937 rng(7);
  const int before = open_descriptors();
  struct stat st;
  for (int round = 0; round < rounds; ++round) {
    const auto id = start(destination, argc, argv);
    std::this_thread::sleep_for(std::chrono::milliseconds(rng() % 1500));
    const auto cancelled_at = clock_type::now();
    archives::cancel(id);
    const auto s = wait(std::chrono::seconds(15));
    const auto took = std::chrono::duration_cast<std::chrono::milliseconds>(clock_type::now() - cancelled_at).count();
    std::printf("round %d: %s after %lld ms\n", round, s.state.c_str(), static_cast<long long>(took));
    // A cancel that lands after completion leaves a finished extraction; it is removed for the next round.
    if (s.state == "completed") std::system(("rm -rf '" + destination + "'").c_str());
    else assert(s.state == "cancelled");
    assert(took < 5000);
    assert(lstat((destination + ".extracting").c_str(), &st) && lstat(destination.c_str(), &st));
    assert(!worker_running());
    assert(open_descriptors() == before);
  }
  start(destination, argc, argv);
  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  const auto stopping = clock_type::now();
  archives::stop();
  assert(clock_type::now() - stopping < std::chrono::seconds(5) && !worker_running());
  std::system(("rm -rf '" + destination + "' '" + destination + ".extracting'").c_str());
  start(destination, argc, argv);
  const auto s = wait(std::chrono::seconds(300));
  std::printf("final %s %llu %s\n", s.state.c_str(), static_cast<unsigned long long>(s.written), s.error.c_str());
  assert(s.state == "completed" && open_descriptors() == before);
  archives::stop();
  std::puts("PASS: random cancels and stop end promptly, remove staging, reap the worker and leak no descriptor");
}
