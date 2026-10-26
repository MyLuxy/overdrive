// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Metainfo (a .torrent's info dictionary, BEP 3) and magnet links (BEP 9): the facts the engine
// needs to fetch pieces and name the finished file. Nothing here touches the network or the disk.
#pragma once
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace torrent {
struct FileEntry {
  std::string path; // '/'-joined in-torrent path; no component is empty, "." or ".."
  std::uint64_t length = 0;
  std::uint64_t offset = 0; // in the torrent's byte space
  std::uint32_t first_piece = 0, last_piece = 0; // inclusive, from 0
  bool padding = false; // BEP 47: bytes a creator inserted to align files, not content
};

struct MetaInfo {
  std::string name;
  std::string info_hash; // 40 lowercase hex digits
  std::uint64_t piece_length = 0, total_length = 0;
  std::uint32_t piece_count = 0;
  std::string pieces; // piece_count SHA-1 digests, 20 bytes each, in torrent order
  std::string raw_info; // the exact bencoded info dictionary, so peers can fetch it (BEP 9)
  bool multi_file = false;
  std::vector<FileEntry> files; // one entry for a single-file torrent too
  std::vector<std::string> trackers, web_seeds; // supported schemes, deduplicated
  std::string comment, created_by;
};

struct Magnet {
  std::string info_hash; // 40 lowercase hex digits
  std::string name;      // dn, reduced to a safe file name; may be empty
  std::vector<std::string> trackers, web_seeds, peers; // peers as "host:port"
  std::uint64_t exact_length = 0; // xl, 0 when absent
};

inline constexpr std::uint64_t kMaxPieceLength = 64u << 20;
inline constexpr std::uint64_t kMaxTotalLength = 1ull << 50;
inline constexpr std::uint32_t kMaxPieces = 1u << 20;

// Both fail with a message that names the field that could not be trusted.
bool parse_metainfo(std::string_view bytes, MetaInfo& out, std::string& error);
// An info dictionary alone, as a magnet's BEP 9 metadata exchange delivers it.
bool parse_info(std::string_view bytes, MetaInfo& out, std::string& error);
bool parse_magnet(std::string_view uri, Magnet& out, std::string& error);

// The largest file that is not padding; nullptr when every file is empty or padding.
const FileEntry* largest_file(const MetaInfo& info);
// True for a tracker or web seed URL this engine can speak to (HTTP, HTTPS and UDP trackers).
bool supported_url(std::string_view url);
} // namespace torrent
