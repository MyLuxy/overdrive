// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// A BitTorrent download engine that lives inside the application: trackers (HTTP and BEP 15 UDP),
// peer wire, BEP 9 metadata from a magnet, PEX discovery, SHA-1 piece verification, resume and
// optional seeding while the application runs. Each download owns its socket loop on a worker; the
// render thread only starts, cancels and polls.
//
// Deliberate limits: no DHT or web seeds, IPv4 peers only, one file per job (the wanted in-torrent
// path or the largest file), and pieces that reach past that file's edges are fetched but not kept,
// so seeding serves only pieces that lie entirely inside the downloaded file.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace torrent {
inline constexpr unsigned kMaxJobs = 8;   // transfers in progress, starting or downloading
inline constexpr unsigned kMaxTasks = 16; // transfers plus finished jobs still seeding
inline constexpr unsigned kMaxConnections = 16;
inline constexpr std::size_t kMaxPieceBytes = 8u << 20;
inline constexpr std::size_t kMaxMetadataBytes = 16u << 20;

struct Config {
  std::string magnet;       // a magnet link; either this or torrent_path
  std::string torrent_path; // a .torrent on disk
  std::string destination;  // the file the wanted file is written to
  std::string wanted;       // the wanted file's in-torrent path; empty picks the largest file
  bool seeding = false;     // keep serving verified pieces while the application runs
  unsigned connections = kMaxConnections;
  std::uint16_t listen_port = 0; // 0 lets the system choose one
};

struct Snapshot {
  std::uint32_t id = 0;
  std::string state; // starting | metadata | downloading | completed | failed | cancelled
  std::string error, name, file, info_hash;
  bool metadata = false; // the torrent's info dictionary is known
  bool seeding = false;  // completed and serving pieces right now
  std::uint64_t size = 0;       // the wanted file's length
  std::uint64_t total = 0;      // the whole torrent's length
  std::uint64_t downloaded = 0; // bytes taken from peers
  std::uint64_t verified = 0;   // bytes of the wanted file verified and written
  std::uint64_t uploaded = 0;   // bytes served to peers
  double bytes_per_second = 0;
  unsigned pieces = 0, pieces_done = 0; // pieces needed for the wanted file
  unsigned peers = 0, seeds = 0, leechers = 0;
  unsigned swarm_seeds = 0, swarm_leechers = 0; // what the tracker last reported
  std::uint16_t listen_port = 0;
};

// 0 with `error` set when the job cannot start (networking down, a malformed magnet, too many jobs).
std::uint32_t start(Config config, std::string& error);
void cancel(std::uint32_t id);
// Every job's latest snapshot, running ones too; a finished job is reported once and then dropped.
std::vector<Snapshot> poll();
// Turns seeding on or off for every job, at once. Seeding only ever lasts while the app runs.
void set_seeding(bool enabled);
// Cancels all jobs and joins their workers. Resume data is kept.
void stop();
} // namespace torrent
