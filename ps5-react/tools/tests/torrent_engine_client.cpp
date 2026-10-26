// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Runs one torrent job and reports each snapshot, for test_torrent_engine.py's local tracker and
// peers. Arguments: <torrent|magnet> <source> <destination> <wanted> <seeding 0|1>
//                     [cancel after this many verified bytes] [run this long after completing, ms]
#include "network.hpp"
#include "torrent_engine.hpp"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>

namespace {
using Clock = std::chrono::steady_clock;

void print(const torrent::Snapshot& snapshot) {
  std::printf("task id=%u state=%s error=%s name=%s file=%s infoHash=%s metadata=%d seeding=%d "
              "size=%llu total=%llu downloaded=%llu verified=%llu uploaded=%llu bps=%.1f pieces=%u "
              "piecesDone=%u peers=%u seeds=%u leechers=%u swarmSeeds=%u swarmLeechers=%u listenPort=%u\n",
              snapshot.id, snapshot.state.c_str(), snapshot.error.c_str(), snapshot.name.c_str(),
              snapshot.file.c_str(), snapshot.info_hash.c_str(), snapshot.metadata ? 1 : 0,
              snapshot.seeding ? 1 : 0, static_cast<unsigned long long>(snapshot.size),
              static_cast<unsigned long long>(snapshot.total),
              static_cast<unsigned long long>(snapshot.downloaded),
              static_cast<unsigned long long>(snapshot.verified),
              static_cast<unsigned long long>(snapshot.uploaded), snapshot.bytes_per_second,
              snapshot.pieces, snapshot.pieces_done, snapshot.peers, snapshot.seeds, snapshot.leechers,
              snapshot.swarm_seeds, snapshot.swarm_leechers, snapshot.listen_port);
  std::fflush(stdout);
}
} // namespace

int main(int argc, char** argv) {
  if (argc < 6 || (std::string(argv[1]) != "torrent" && std::string(argv[1]) != "magnet")) {
    std::puts("usage: engine-client <torrent|magnet> <source> <destination> <wanted> <seeding 0|1>");
    return 2;
  }
  const std::string kind = argv[1], source = argv[2], destination = argv[3], wanted = argv[4];
  const bool seeding = std::string(argv[5]) != "0";
  const long long cancel_after = argc > 6 ? std::atoll(argv[6]) : -1;
  const long long run_for = argc > 7 ? std::atoll(argv[7]) : -1;
  if (!network::start()) {
    std::printf("error=the network did not start\n");
    return 1;
  }
  torrent::set_seeding(seeding);
  torrent::Config config;
  if (kind == "torrent") config.torrent_path = source;
  else config.magnet = source;
  config.destination = destination;
  config.wanted = wanted;
  config.seeding = seeding;
  std::string error;
  const std::uint32_t id = torrent::start(std::move(config), error);
  if (!id) {
    std::printf("error=%s\n", error.c_str());
    network::stop();
    return 1;
  }

  const auto started = Clock::now();
  auto completed_at = started;
  bool seen = false, completed = false, cancel_sent = false, failed = false;
  for (;;) {
    const auto now = Clock::now();
    bool found = false;
    for (const auto& snapshot : torrent::poll()) {
      if (snapshot.id != id) continue;
      found = true;
      seen = true;
      print(snapshot);
      if (snapshot.state == "failed") {
        failed = true;
        goto done;
      }
      if (snapshot.state == "cancelled") goto done;
      if (snapshot.state == "completed" && !completed) {
        completed = true;
        completed_at = now;
      }
      if (cancel_after >= 0 && !cancel_sent &&
          snapshot.verified >= static_cast<std::uint64_t>(cancel_after)) {
        torrent::cancel(id);
        cancel_sent = true;
      }
    }
    if (seen && !found && !completed) goto done;
    if (completed && !seeding && !found) goto done;
    if (completed && seeding && run_for >= 0 &&
        std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - completed_at).count() >= run_for)
      goto done;
    if (std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - started).count() > 120000) {
      failed = true;
      goto done;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
done:
  torrent::stop();
  network::stop();
  return failed ? 1 : 0;
}
