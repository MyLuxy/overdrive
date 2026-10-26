// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Prints what torrent_meta.cpp made of a .torrent, an info dictionary or a magnet link, one fact per
// line, so test_torrent_meta.py can assert on real bytes instead of on the parser's source.
#include "torrent_meta.hpp"
#include <fstream>
#include <iostream>
#include <sstream>

namespace {
std::string read(const char* path) {
  std::ifstream file(path, std::ios::binary);
  std::ostringstream bytes;
  bytes << file.rdbuf();
  return bytes.str();
}

void print_info(const torrent::MetaInfo& info) {
  std::cout << "name=" << info.name << "\n";
  std::cout << "hash=" << info.info_hash << "\n";
  std::cout << "pieceLength=" << info.piece_length << "\n";
  std::cout << "pieces=" << info.piece_count << "\n";
  std::cout << "total=" << info.total_length << "\n";
  std::cout << "multi=" << (info.multi_file ? 1 : 0) << "\n";
  for (const auto& file : info.files)
    std::cout << "file=" << file.path << '|' << file.length << '|' << file.offset << '|' << file.first_piece << '|'
              << file.last_piece << '|' << (file.padding ? 1 : 0) << "\n";
  for (const auto& tracker : info.trackers) std::cout << "tracker=" << tracker << "\n";
  for (const auto& seed : info.web_seeds) std::cout << "seed=" << seed << "\n";
  if (!info.comment.empty()) std::cout << "comment=" << info.comment << "\n";
  if (!info.created_by.empty()) std::cout << "createdBy=" << info.created_by << "\n";
  if (const auto* file = torrent::largest_file(info)) std::cout << "largest=" << file->path << '|' << file->length << "\n";
}
} // namespace

int main(int argc, char** argv) {
  if (argc < 3) {
    std::cout << "error=usage: torrent_meta_client metainfo|info|magnet <path or link>\n";
    return 2;
  }
  const std::string command = argv[1];
  std::string error;
  if (command == "magnet") {
    torrent::Magnet magnet;
    if (!torrent::parse_magnet(argv[2], magnet, error)) {
      std::cout << "error=" << error << "\n";
      return 1;
    }
    std::cout << "hash=" << magnet.info_hash << "\n";
    std::cout << "name=" << magnet.name << "\n";
    std::cout << "exactLength=" << magnet.exact_length << "\n";
    for (const auto& tracker : magnet.trackers) std::cout << "tracker=" << tracker << "\n";
    for (const auto& seed : magnet.web_seeds) std::cout << "seed=" << seed << "\n";
    for (const auto& peer : magnet.peers) std::cout << "peer=" << peer << "\n";
    return 0;
  }
  torrent::MetaInfo info;
  const std::string bytes = read(argv[2]);
  const bool ok = command == "info" ? torrent::parse_info(bytes, info, error)
                                    : torrent::parse_metainfo(bytes, info, error);
  if (!ok) {
    std::cout << "error=" << error << "\n";
    return 1;
  }
  print_info(info);
  return 0;
}
