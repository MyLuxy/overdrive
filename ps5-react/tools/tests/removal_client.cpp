// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Runs native/shared/removals.cpp for tools/test_removals.py: `wait <path>...` queues every path and
// polls until each ends; `stop <path>...` stops the worker right after queueing them. Prints the
// milliseconds the calls that queue took, then `<state>\t<error>` per path, in order.
#include "host_api.hpp"
#include "removals.hpp"
#include <dirent.h>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <map>
#include <thread>

bool host::read_dir(const char* real_path, void (*visit)(const char*, void*), void* user) {
  DIR* dir = opendir(real_path);
  if (!dir) return false;
  while (const dirent* item = readdir(dir))
    if (std::strcmp(item->d_name, ".") && std::strcmp(item->d_name, "..")) visit(item->d_name, user);
  closedir(dir);
  return true;
}

int main(int argc, char** argv) {
  if (argc < 3) return 2;
  const bool stop = !std::strcmp(argv[1], "stop");
  std::vector<std::uint32_t> ids;
  const auto started = std::chrono::steady_clock::now();
  for (int i = 2; i < argc; ++i) {
    std::string error;
    ids.push_back(removals::start(argv[i], error));
    if (!ids.back()) { std::fprintf(stderr, "%s\n", error.c_str()); return 1; }
  }
  std::printf("%lld\n", static_cast<long long>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - started).count()));
  if (stop) removals::stop();
  std::map<std::uint32_t, removals::Snapshot> ended;
  while (ended.size() < ids.size()) {
    for (const auto& snapshot : removals::poll())
      if (snapshot.state != "queued" && snapshot.state != "removing") ended[snapshot.id] = snapshot;
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  for (const auto id : ids) std::printf("%s\t%s\n", ended[id].state.c_str(), ended[id].error.c_str());
  removals::stop();
  return 0;
}
