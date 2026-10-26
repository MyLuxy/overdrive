// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Announces once to a tracker and prints what came back, for test_torrent_tracker.py's local
// HTTP and UDP trackers.
#include "network.hpp"
#include "torrent_tracker.hpp"
#include <cstdio>
#include <cstdlib>
#include <string>

namespace {
bool unhex(const char* text, std::string& out) {
  out.clear();
  for (std::size_t i = 0; text[i] && text[i + 1]; i += 2) {
    unsigned byte = 0;
    if (std::sscanf(text + i, "%2x", &byte) != 1) return false;
    out.push_back(static_cast<char>(byte));
  }
  return out.size() == 20;
}
} // namespace

int main(int argc, char** argv) {
  if (argc < 6) {
    std::printf("ok=0\nerror=usage: announce <url> <40-hex info hash> <event> <port> <left>\n");
    return 2;
  }
  if (!network::start()) {
    std::printf("ok=0\nerror=the network did not start\n");
    return 1;
  }
  torrent::Announce announce;
  if (!unhex(argv[2], announce.info_hash)) {
    std::printf("ok=0\nerror=the info hash must be 40 hex digits\n");
    network::stop();
    return 2;
  }
  announce.peer_id = "-OV0001-0123456789AB";
  announce.event = argv[3];
  announce.port = static_cast<std::uint16_t>(std::atoi(argv[4]));
  announce.left = std::strtoull(argv[5], nullptr, 10);
  announce.downloaded = 100;
  announce.uploaded = 7;
  torrent::AnnounceResult result;
  std::string error;
  const bool ok = torrent::announce_tracker(argv[1], announce, result, error);
  std::printf("ok=%d\n", ok ? 1 : 0);
  if (!ok) {
    std::printf("error=%s\n", error.c_str());
  } else {
    std::printf("interval=%d\nminInterval=%d\nseeds=%u\nleechers=%u\n", result.interval, result.min_interval,
                result.seeds, result.leechers);
    for (const auto& peer : result.peers) std::printf("peer=%s:%u\n", peer.host.c_str(), peer.port);
  }
  network::stop();
  return ok ? 0 : 1;
}
