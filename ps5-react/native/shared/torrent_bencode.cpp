// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "torrent_bencode.hpp"
#include <charconv>
#include <string>
#include <system_error>
#include <utility>

namespace torrent {
const Node* Node::get(std::string_view key) const {
  for (std::size_t i = 0; i < keys.size() && i < children.size(); ++i)
    if (keys[i] == key) return &children[i];
  return nullptr;
}

namespace {
// BEP 3 requires canonical integers and lengths ("i0e", "3:abc"), no leading zeros, and no
// negative zero. Real torrents follow it, and being strict here keeps malformed input from
// reaching the arithmetic in torrent_meta.cpp.
class Decoder {
public:
  Decoder(std::string_view input, DecodeLimits limits) : in_(input), limits_(limits) {}

  bool parse(Node& node) {
    if (in_.empty()) return fail(0, "empty input");
    if (!value(node, 0)) return false;
    if (at_ != in_.size()) return fail(at_, "trailing bytes after the value");
    return true;
  }
  bool parse_prefix(Node& node, std::size_t& used) {
    if (in_.empty()) return fail(0, "empty input");
    if (!value(node, 0)) return false;
    used = at_;
    return true;
  }
  std::string error;

private:
  bool fail(std::size_t at, const std::string& what) {
    if (error.empty()) error = what + " at byte " + std::to_string(at);
    return false;
  }

  bool value(Node& node, unsigned depth) {
    if (depth > limits_.max_depth)
      return fail(at_, "nesting is deeper than " + std::to_string(limits_.max_depth) + " levels");
    if (++nodes_ > limits_.max_nodes)
      return fail(at_, "more than " + std::to_string(limits_.max_nodes) + " values");
    if (at_ >= in_.size()) return fail(at_, "unexpected end of input");
    node.begin = at_;
    bool ok = false;
    switch (in_[at_]) {
    case 'i': ok = integer(node); break;
    case 'l': ok = list(node, depth); break;
    case 'd': ok = dictionary(node, depth); break;
    default: ok = string(node); break;
    }
    if (ok) node.end = at_;
    return ok;
  }

  bool integer(Node& node) {
    const std::size_t start = at_++;
    const std::size_t close = in_.find('e', at_);
    if (close == std::string_view::npos) return fail(start, "unterminated integer");
    const std::string_view digits = in_.substr(at_, close - at_);
    if (digits.empty()) return fail(start, "integer has no digits");
    const bool negative = digits.front() == '-';
    const std::string_view magnitude = negative ? digits.substr(1) : digits;
    if (magnitude.empty()) return fail(start, "integer has no digits");
    if (magnitude.size() > 1 && magnitude.front() == '0')
      return fail(start, "integer has a leading zero");
    if (negative && magnitude == "0") return fail(start, "integer is negative zero");
    std::int64_t number = 0;
    const auto result = std::from_chars(digits.data(), digits.data() + digits.size(), number);
    if (result.ec != std::errc() || result.ptr != digits.data() + digits.size())
      return fail(start, "integer is not a number");
    node.kind = Kind::Integer;
    node.number = number;
    at_ = close + 1;
    return true;
  }

  bool string(Node& node) {
    const std::size_t start = at_;
    const std::size_t colon = in_.find(':', at_);
    if (colon == std::string_view::npos) return fail(start, "string has no length prefix");
    const std::string_view digits = in_.substr(at_, colon - at_);
    if (digits.empty()) return fail(start, "string has an empty length");
    if (digits.size() > 1 && digits.front() == '0')
      return fail(start, "string length has a leading zero");
    std::size_t size = 0;
    const auto result = std::from_chars(digits.data(), digits.data() + digits.size(), size);
    if (result.ec != std::errc() || result.ptr != digits.data() + digits.size())
      return fail(start, "string length is not a number");
    if (size > limits_.max_string) return fail(start, "string is longer than " + std::to_string(limits_.max_string) + " bytes");
    if (size > in_.size() - (colon + 1)) return fail(start, "string runs past the end of the input");
    node.kind = Kind::String;
    node.text = in_.substr(colon + 1, size);
    at_ = colon + 1 + size;
    return true;
  }

  bool list(Node& node, unsigned depth) {
    node.kind = Kind::List;
    const std::size_t start = at_++;
    while (true) {
      if (at_ >= in_.size()) return fail(start, "unterminated list");
      if (in_[at_] == 'e') {
        ++at_;
        return true;
      }
      Node child;
      if (!value(child, depth + 1)) return false;
      node.children.push_back(std::move(child));
    }
  }

  bool dictionary(Node& node, unsigned depth) {
    node.kind = Kind::Dictionary;
    const std::size_t start = at_++;
    while (true) {
      if (at_ >= in_.size()) return fail(start, "unterminated dictionary");
      if (in_[at_] == 'e') {
        ++at_;
        return true;
      }
      if (in_[at_] < '0' || in_[at_] > '9') return fail(at_, "dictionary key is not a string");
      Node key;
      if (!string(key)) return false;
      Node child;
      if (!value(child, depth + 1)) return false;
      node.keys.push_back(key.text);
      node.children.push_back(std::move(child));
    }
  }

  std::string_view in_;
  DecodeLimits limits_;
  std::size_t at_ = 0, nodes_ = 0;
};
} // namespace

bool decode(std::string_view input, Node& out, std::string& error, DecodeLimits limits) {
  Decoder decoder(input, limits);
  Node node;
  if (!decoder.parse(node)) {
    error = std::move(decoder.error);
    return false;
  }
  out = std::move(node);
  return true;
}

bool decode_prefix(std::string_view input, Node& out, std::size_t& used, std::string& error, DecodeLimits limits) {
  Decoder decoder(input, limits);
  Node node;
  if (!decoder.parse_prefix(node, used)) {
    error = std::move(decoder.error);
    return false;
  }
  out = std::move(node);
  return true;
}
} // namespace torrent
