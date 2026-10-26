// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "torrent_meta.hpp"
#include "digest.hpp"
#include "torrent_bencode.hpp"
#include <charconv>
#include <system_error>
#include <utility>

namespace torrent {
namespace {
constexpr std::size_t kMaxText = 4096, kMaxPath = 4096;

bool safe_component(std::string_view part) {
  return !part.empty() && part != "." && part != ".." && part.find('/') == std::string_view::npos &&
         part.find('\\') == std::string_view::npos && part.find('\0') == std::string_view::npos;
}

bool field_string(const Node& dict, std::string_view key, std::string_view& out) {
  const Node* node = dict.get(key);
  if (!node || node->kind != Kind::String) return false;
  out = node->text;
  return true;
}

void copy_text(const Node& dict, std::string_view key, std::string& out) {
  std::string_view text;
  if (field_string(dict, key, text) && text.size() <= kMaxText)
    out.assign(text.data(), text.size());
}

// Tracker lists arrive as one string or as tiers of strings (announce-list), and url-list as one
// string or a flat list; the same walk handles all three. Unsupported schemes are dropped instead of
// failing the torrent over a tracker the engine would never call.
void add_url(std::vector<std::string>& list, std::string_view url) {
  if (!supported_url(url)) return;
  for (const auto& seen : list)
    if (seen == url) return;
  list.emplace_back(url);
}

void add_url_node(std::vector<std::string>& list, const Node& node) {
  if (node.kind == Kind::String) {
    add_url(list, node.text);
    return;
  }
  if (node.kind == Kind::List)
    for (const auto& child : node.children) add_url_node(list, child);
}

void add_trackers(const Node& root, MetaInfo& out) {
  if (const Node* list = root.get("announce-list")) add_url_node(out.trackers, *list);
  if (const Node* announce = root.get("announce")) add_url_node(out.trackers, *announce);
  if (const Node* seeds = root.get("url-list")) add_url_node(out.web_seeds, *seeds);
}

bool fill_info(const Node& info, std::string_view raw, MetaInfo& out, std::string& error) {
  integrity::Hash hash(true);
  if (!hash.update(raw.data(), raw.size())) {
    error = "could not hash the info dictionary";
    return false;
  }
  out.info_hash = hash.finish();
  if (out.info_hash.size() != 40) {
    error = "could not hash the info dictionary";
    return false;
  }
  out.raw_info.assign(raw.data(), raw.size());

  std::string_view name;
  if (!field_string(info, "name.utf-8", name) && !field_string(info, "name", name)) {
    error = "the info dictionary has no name";
    return false;
  }
  if (!safe_component(name)) {
    error = "the torrent name is not a plain file name";
    return false;
  }
  out.name.assign(name.data(), name.size());

  const Node* piece_length = info.get("piece length");
  if (!piece_length || piece_length->kind != Kind::Integer || piece_length->number <= 0) {
    error = "the info dictionary has no usable piece length";
    return false;
  }
  if (static_cast<std::uint64_t>(piece_length->number) > kMaxPieceLength) {
    error = "the piece length is larger than 64 MiB";
    return false;
  }
  out.piece_length = static_cast<std::uint64_t>(piece_length->number);

  const Node* pieces = info.get("pieces");
  if (!pieces || pieces->kind != Kind::String || pieces->text.size() % 20 != 0 ||
      pieces->text.size() / 20 > kMaxPieces) {
    error = "the info dictionary has no usable piece hashes";
    return false;
  }

  std::uint64_t total = 0;
  const Node* files = info.get("files");
  if (files) {
    if (files->kind != Kind::List || files->children.empty()) {
      error = "the files list is not a list of files";
      return false;
    }
    for (const Node& file : files->children) {
      if (file.kind != Kind::Dictionary) {
        error = "a file entry is not a dictionary";
        return false;
      }
      const Node* length = file.get("length");
      if (!length || length->kind != Kind::Integer || length->number < 0) {
        error = "a file entry has no usable length";
        return false;
      }
      const auto bytes = static_cast<std::uint64_t>(length->number);
      if (bytes > kMaxTotalLength - total) {
        error = "the torrent's files add up to more than 1 PiB";
        return false;
      }
      const Node* path = file.get("path.utf-8");
      if (!path || path->kind != Kind::List) path = file.get("path");
      if (!path || path->kind != Kind::List || path->children.empty()) {
        error = "a file entry has no path";
        return false;
      }
      std::string joined;
      for (const Node& part : path->children) {
        if (part.kind != Kind::String || !safe_component(part.text)) {
          error = "a file path contains an unsafe component";
          return false;
        }
        if (joined.size() + part.text.size() + 1 > kMaxPath) {
          error = "a file path is longer than 4096 bytes";
          return false;
        }
        if (!joined.empty()) joined.push_back('/');
        joined.append(part.text.data(), part.text.size());
      }
      const Node* attr = file.get("attr");
      FileEntry entry;
      entry.path = std::move(joined);
      entry.length = bytes;
      entry.offset = total;
      entry.padding = attr && attr->kind == Kind::String && attr->text.find('p') != std::string_view::npos;
      out.files.push_back(std::move(entry));
      total += bytes;
    }
    out.multi_file = true;
  } else {
    const Node* length = info.get("length");
    if (!length || length->kind != Kind::Integer || length->number <= 0 ||
        static_cast<std::uint64_t>(length->number) > kMaxTotalLength) {
      error = "the info dictionary has no usable length";
      return false;
    }
    FileEntry entry;
    entry.path = out.name;
    entry.length = static_cast<std::uint64_t>(length->number);
    out.files.push_back(std::move(entry));
    total = entry.length;
  }

  if (total == 0) {
    error = "the torrent contains no data";
    return false;
  }
  const std::uint64_t count = (total + out.piece_length - 1) / out.piece_length;
  if (count > kMaxPieces) {
    error = "the torrent has more than 1048576 pieces";
    return false;
  }
  const auto piece_count = static_cast<std::uint32_t>(count);
  if (pieces->text.size() != static_cast<std::size_t>(piece_count) * 20) {
    error = "the piece hashes do not match the file sizes (" + std::to_string(pieces->text.size() / 20) +
            " hashes for " + std::to_string(piece_count) + " pieces)";
    return false;
  }
  out.piece_count = piece_count;
  out.total_length = total;
  out.pieces.assign(pieces->text.data(), pieces->text.size());
  for (auto& file : out.files) {
    file.first_piece = static_cast<std::uint32_t>(file.offset / out.piece_length);
    file.last_piece = file.length ? static_cast<std::uint32_t>((file.offset + file.length - 1) / out.piece_length)
                                  : file.first_piece;
  }
  return true;
}

int hex_digit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

std::string hex20(const std::string& bytes) {
  constexpr char digits[] = "0123456789abcdef";
  std::string out;
  out.reserve(40);
  for (const unsigned char byte : bytes) {
    out.push_back(digits[byte >> 4]);
    out.push_back(digits[byte & 15]);
  }
  return out;
}

bool decode_hex20(std::string_view text, std::string& out) {
  if (text.size() != 40) return false;
  out.clear();
  out.reserve(20);
  for (std::size_t i = 0; i < 40; i += 2) {
    const int high = hex_digit(text[i]), low = hex_digit(text[i + 1]);
    if (high < 0 || low < 0) return false;
    out.push_back(static_cast<char>((high << 4) | low));
  }
  return true;
}

// Base32 (RFC 4648) for the older magnet form: 32 characters hold exactly 160 bits.
bool decode_base32(std::string_view text, std::string& out) {
  while (!text.empty() && text.back() == '=') text.remove_suffix(1);
  if (text.size() != 32) return false;
  out.clear();
  out.reserve(20);
  unsigned buffer = 0, bits = 0;
  for (const char c : text) {
    int value = -1;
    if (c >= 'A' && c <= 'Z') value = c - 'A';
    else if (c >= 'a' && c <= 'z') value = c - 'a';
    else if (c >= '2' && c <= '7') value = c - '2' + 26;
    if (value < 0) return false;
    buffer = (buffer << 5) | static_cast<unsigned>(value);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push_back(static_cast<char>((buffer >> bits) & 0xFF));
    }
  }
  return out.size() == 20;
}

bool percent_decode(std::string_view in, std::string& out) {
  out.clear();
  out.reserve(in.size());
  for (std::size_t i = 0; i < in.size(); ++i) {
    if (in[i] != '%') {
      out.push_back(in[i]);
      continue;
    }
    if (i + 2 >= in.size()) return false;
    const int high = hex_digit(in[i + 1]), low = hex_digit(in[i + 2]);
    if (high < 0 || low < 0) return false;
    out.push_back(static_cast<char>((high << 4) | low));
    i += 2;
  }
  return true;
}

// `dn` is display text first, but the app may also offer it as a file name: keep only a basename.
std::string safe_name(std::string_view text) {
  const auto separator = text.find_last_of("/\\");
  if (separator != std::string_view::npos) text.remove_prefix(separator + 1);
  return safe_component(text) ? std::string(text) : std::string();
}

bool valid_peer(std::string_view peer) {
  const auto colon = peer.rfind(':');
  if (colon == std::string_view::npos || colon == 0 || peer.size() - colon - 1 > 5) return false;
  if (colon > 255) return false;
  unsigned port = 0;
  const auto result = std::from_chars(peer.data() + colon + 1, peer.data() + peer.size(), port);
  return result.ec == std::errc() && result.ptr == peer.data() + peer.size() && port > 0 && port <= 65535;
}
} // namespace

const FileEntry* largest_file(const MetaInfo& info) {
  const FileEntry* best = nullptr;
  for (const auto& file : info.files)
    if (!file.padding && file.length > 0 && (!best || file.length > best->length)) best = &file;
  return best;
}

bool supported_url(std::string_view url) {
  return url.starts_with("http://") || url.starts_with("https://") || url.starts_with("udp://");
}

bool parse_metainfo(std::string_view bytes, MetaInfo& out, std::string& error) {
  Node root;
  if (!decode(bytes, root, error)) {
    error = "the .torrent is not valid bencode: " + error;
    return false;
  }
  if (root.kind != Kind::Dictionary) {
    error = "the .torrent is not a dictionary";
    return false;
  }
  const Node* info = root.get("info");
  if (!info || info->kind != Kind::Dictionary) {
    error = "the .torrent has no info dictionary";
    return false;
  }
  if (!fill_info(*info, bytes.substr(info->begin, info->end - info->begin), out, error)) return false;
  add_trackers(root, out);
  copy_text(root, "comment", out.comment);
  copy_text(root, "created by", out.created_by);
  return true;
}

bool parse_info(std::string_view bytes, MetaInfo& out, std::string& error) {
  Node root;
  if (!decode(bytes, root, error)) {
    error = "the metadata is not valid bencode: " + error;
    return false;
  }
  if (root.kind != Kind::Dictionary) {
    error = "the metadata is not an info dictionary";
    return false;
  }
  return fill_info(root, bytes, out, error);
}

bool parse_magnet(std::string_view uri, Magnet& out, std::string& error) {
  constexpr std::string_view prefix = "magnet:?";
  if (uri.size() <= prefix.size() || uri.substr(0, prefix.size()) != prefix) {
    error = "not a magnet link (it does not start with magnet:?)";
    return false;
  }
  bool hashed = false;
  std::string_view query = uri.substr(prefix.size());
  while (!query.empty()) {
    const auto ampersand = query.find('&');
    const std::string_view pair = query.substr(0, ampersand);
    query = ampersand == std::string_view::npos ? std::string_view() : query.substr(ampersand + 1);
    const auto equals = pair.find('=');
    if (equals == std::string_view::npos) continue;
    const std::string_view key = pair.substr(0, equals);
    std::string value;
    if (!percent_decode(pair.substr(equals + 1), value)) {
      error = "the magnet link has a malformed percent escape";
      return false;
    }
    if (key == "xt") {
      constexpr std::string_view urn = "urn:btih:";
      if (value.size() <= urn.size() || value.compare(0, urn.size(), urn) != 0) continue;
      const std::string_view text = std::string_view(value).substr(urn.size());
      std::string bytes;
      if (decode_hex20(text, bytes) || decode_base32(text, bytes)) {
        out.info_hash = hex20(bytes);
        hashed = true;
      }
    } else if (key == "dn") {
      out.name = safe_name(value);
    } else if (key == "tr") {
      add_url(out.trackers, value);
    } else if (key == "ws") {
      add_url(out.web_seeds, value);
    } else if (key == "x.pe") {
      if (valid_peer(value)) out.peers.push_back(value);
    } else if (key == "xl") {
      std::uint64_t length = 0;
      const auto result = std::from_chars(value.data(), value.data() + value.size(), length);
      if (result.ec == std::errc() && result.ptr == value.data() + value.size() && length <= kMaxTotalLength)
        out.exact_length = length;
    }
  }
  if (!hashed) {
    error = "the magnet link has no urn:btih info hash";
    return false;
  }
  return true;
}
} // namespace torrent
