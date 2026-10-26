// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Bounded bencode decoding (BEP 3). A torrent is attacker-supplied data: every length, count and
// nesting level is checked against the bytes actually present and against fixed limits, and strings
// stay views into the source so a .torrent is not copied once per field.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace torrent {
enum class Kind { Integer, String, List, Dictionary };

struct Node {
  Kind kind = Kind::Integer;
  std::int64_t number = 0;
  std::string_view text;      // String payload
  std::size_t begin = 0, end = 0; // byte range of this value in the decoded input
  std::vector<Node> children; // List items, or Dictionary values
  std::vector<std::string_view> keys; // Dictionary keys, parallel to `children`
  // The value of `key` in a dictionary, or nullptr.
  const Node* get(std::string_view key) const;
};

struct DecodeLimits {
  unsigned max_depth = 32;
  std::size_t max_nodes = 65536;
  std::size_t max_string = 128u << 20; // a large torrent's piece hashes stay well below this
};

// Decodes exactly one value spanning `input`. `error` names the byte offset that failed.
bool decode(std::string_view input, Node& out, std::string& error, DecodeLimits limits = {});
// Decodes one value from the front of `input` and reports how many bytes it used, for the BEP 9
// metadata messages where a bencoded header is followed by raw bytes.
bool decode_prefix(std::string_view input, Node& out, std::size_t& used, std::string& error,
                   DecodeLimits limits = {});
} // namespace torrent
