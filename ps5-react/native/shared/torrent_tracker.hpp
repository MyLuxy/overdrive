// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// One tracker announce: HTTP(S) through the framework's curl transport, or BEP 15 over UDP. The
// caller runs this on its worker thread and keeps the peers; nothing here schedules repeats.
#pragma once
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace torrent {
struct PeerAddress {
  std::string host; // dotted IPv4
  std::uint16_t port = 0;
};

struct Announce {
  std::string info_hash; // exactly 20 raw bytes
  std::string peer_id;   // exactly 20 bytes
  std::uint16_t port = 0;
  std::uint64_t uploaded = 0, downloaded = 0, left = 0;
  std::string event; // "", "started", "completed", "stopped"
  unsigned num_want = 80;
};

struct AnnounceResult {
  std::vector<PeerAddress> peers;
  int interval = 0, min_interval = 0;
  unsigned seeds = 0, leechers = 0;
};

// Percent-encodes every byte outside [A-Za-z0-9-_.~], which is what info_hash and peer_id need.
std::string query_escape(std::string_view bytes);
// Appends this announce's parameters to a tracker URL, honouring an existing query string.
std::string announce_url(const std::string& url, const Announce& announce);
// Both return false with `error` set when the tracker could not be reached or refused. A refusal
// that came with a `failure reason` keeps that text.
bool announce_http(const std::string& url, const Announce& announce, AnnounceResult& result, std::string& error);
bool announce_udp(const std::string& url, const Announce& announce, AnnounceResult& result, std::string& error);
// Picks the transport by scheme; supported_urls() decides which links are worth retaining.
bool announce_tracker(const std::string& url, const Announce& announce, AnnounceResult& result, std::string& error);

// Exposed for the tests: the compact peer list from a tracker body, ignoring other keys.
bool decode_announce(std::string_view body, AnnounceResult& result, std::string& error);
} // namespace torrent
