// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "torrent_peer.hpp"
#include "torrent_bencode.hpp"
#include <string_view>

namespace torrent {
namespace {
constexpr std::size_t kMaxBuffered = 8u << 20;
constexpr std::size_t kMaxMetadata = 32u << 20;

std::uint32_t get32(std::string_view bytes, std::size_t at) {
  std::uint32_t value = 0;
  for (std::size_t i = 0; i < 4; ++i) value = (value << 8) | static_cast<unsigned char>(bytes[at + i]);
  return value;
}

void put32(std::string& out, std::uint32_t value) {
  for (int shift = 24; shift >= 0; shift -= 8) out.push_back(static_cast<char>((value >> shift) & 0xFF));
}

int extension_id(const Node* node) {
  if (!node || node->kind != Kind::Integer || node->number < 1 || node->number > 255) return 0;
  return static_cast<int>(node->number);
}

void compact_peers(std::string_view bytes, std::vector<std::pair<std::string, std::uint16_t>>& added) {
  for (std::size_t at = 0; at + 6 <= bytes.size(); at += 6) {
    const auto* raw = reinterpret_cast<const unsigned char*>(bytes.data() + at);
    const unsigned port = (static_cast<unsigned>(raw[4]) << 8) | raw[5];
    if (!port) continue;
    added.emplace_back(std::to_string(raw[0]) + "." + std::to_string(raw[1]) + "." + std::to_string(raw[2]) + "." +
                           std::to_string(raw[3]),
                       static_cast<std::uint16_t>(port));
  }
}
} // namespace

bool Reader::feed(const char* bytes, std::size_t size) {
  if (!error_.empty()) return false;
  if (size > kMaxBuffered - (buffer_.size() - at_)) {
    error_ = "the peer sent more unread data than the reader holds";
    return false;
  }
  buffer_.append(bytes, size);
  return true;
}

bool Reader::next(Frame& out) {
  if (!error_.empty()) return false;
  // Drop what earlier calls consumed before handing out another view into the buffer.
  if (at_ && (at_ >= 65536 || at_ * 2 >= buffer_.size())) {
    buffer_.erase(0, at_);
    at_ = 0;
  }
  if (buffer_.size() - at_ < 4) return false;
  const std::uint32_t length = get32(buffer_, at_);
  if (length > kMaxFrame) {
    error_ = "peer message is larger than 2 MiB";
    return false;
  }
  if (length == 0) {
    out.id = Message::KeepAlive;
    out.payload = {};
    at_ += 4;
    return true;
  }
  if (buffer_.size() - at_ < 4 + length) return false;
  const auto id = static_cast<unsigned char>(buffer_[at_ + 4]);
  out.payload = std::string_view(buffer_).substr(at_ + 5, length - 1);
  switch (id) {
  case 0: out.id = Message::Choke; break;
  case 1: out.id = Message::Unchoke; break;
  case 2: out.id = Message::Interested; break;
  case 3: out.id = Message::NotInterested; break;
  case 4: out.id = Message::Have; break;
  case 5: out.id = Message::Bitfield; break;
  case 6: out.id = Message::Request; break;
  case 7: out.id = Message::Piece; break;
  case 8: out.id = Message::Cancel; break;
  case 9: out.id = Message::Port; break;
  case 20: out.id = Message::Extended; break;
  // A message this engine does not use is skipped by its own length, so a newer extension cannot
  // desynchronise the stream.
  default: out.id = Message::KeepAlive; out.payload = {}; break;
  }
  at_ += 4 + length;
  return true;
}

std::string handshake(std::string_view info_hash, std::string_view peer_id, bool extensions) {
  std::string out;
  out.reserve(kHandshakeSize);
  out.push_back(static_cast<char>(kProtocol.size()));
  out.append(kProtocol);
  for (int i = 0; i < 8; ++i) out.push_back(static_cast<char>(i == 5 && extensions ? 0x10 : 0));
  out.append(info_hash);
  out.append(peer_id);
  return out;
}

bool parse_handshake(std::string_view buffer, std::string& info_hash, std::string& peer_id, bool& extensions,
                     std::string& error, std::size_t& used) {
  if (buffer.size() < kHandshakeSize) return false;
  if (static_cast<unsigned char>(buffer[0]) != kProtocol.size() || buffer.substr(1, kProtocol.size()) != kProtocol) {
    error = "the peer did not send a BitTorrent handshake";
    return false;
  }
  const std::string_view reserved = buffer.substr(1 + kProtocol.size(), 8);
  extensions = (static_cast<unsigned char>(reserved[5]) & 0x10) != 0;
  info_hash.assign(buffer.substr(1 + kProtocol.size() + 8, 20));
  peer_id.assign(buffer.substr(1 + kProtocol.size() + 8 + 20, 20));
  used = kHandshakeSize;
  return true;
}

std::string frame(Message id, std::string_view payload) {
  std::string out;
  out.reserve(4 + 1 + payload.size());
  put32(out, static_cast<std::uint32_t>(payload.size() + 1));
  out.push_back(static_cast<char>(id));
  out.append(payload);
  return out;
}

std::string request_frame(std::uint32_t index, std::uint32_t begin, std::uint32_t length) {
  std::string payload;
  payload.reserve(12);
  put32(payload, index);
  put32(payload, begin);
  put32(payload, length);
  return frame(Message::Request, payload);
}

std::string piece_frame(std::uint32_t index, std::uint32_t begin, std::string_view block) {
  std::string payload;
  payload.reserve(8 + block.size());
  put32(payload, index);
  put32(payload, begin);
  payload.append(block);
  return frame(Message::Piece, payload);
}

std::string have_frame(std::uint32_t index) {
  std::string payload;
  put32(payload, index);
  return frame(Message::Have, payload);
}

std::string extended_frame(std::uint8_t id, std::string_view payload) {
  std::string bytes;
  bytes.reserve(1 + payload.size());
  bytes.push_back(static_cast<char>(id));
  bytes.append(payload);
  return frame(Message::Extended, bytes);
}

bool parse_extended_handshake(std::string_view payload, ExtendedHandshake& out, std::string& error) {
  Node root;
  DecodeLimits limits;
  limits.max_depth = 8;
  limits.max_nodes = 128;
  limits.max_string = 4096;
  if (!decode(payload, root, error, limits)) {
    error = "the extended handshake is not bencoded: " + error;
    return false;
  }
  if (root.kind != Kind::Dictionary) {
    error = "the extended handshake is not a dictionary";
    return false;
  }
  if (const Node* map = root.get("m"); map && map->kind == Kind::Dictionary) {
    out.ut_metadata = extension_id(map->get("ut_metadata"));
    out.ut_pex = extension_id(map->get("ut_pex"));
  }
  if (const Node* size = root.get("metadata_size");
      size && size->kind == Kind::Integer && size->number > 0 && size->number <= static_cast<std::int64_t>(kMaxMetadata))
    out.metadata_size = static_cast<unsigned>(size->number);
  if (const Node* client = root.get("v"); client && client->kind == Kind::String && client->text.size() <= 128)
    out.client.assign(client->text);
  return true;
}

std::string metadata_request(unsigned piece) {
  return "d8:msg_typei0e5:piecei" + std::to_string(piece) + "ee";
}

bool parse_metadata_message(std::string_view payload, MetadataMessage& out, std::string& error) {
  Node root;
  std::size_t used = 0;
  DecodeLimits limits;
  limits.max_depth = 8;
  limits.max_nodes = 128;
  limits.max_string = 4096;
  if (!decode_prefix(payload, root, used, error, limits)) {
    error = "the metadata message is not bencoded: " + error;
    return false;
  }
  if (root.kind != Kind::Dictionary) {
    error = "the metadata message is not a dictionary";
    return false;
  }
  const Node* type = root.get("msg_type");
  const Node* piece = root.get("piece");
  if (!type || type->kind != Kind::Integer || !piece || piece->kind != Kind::Integer || piece->number < 0) {
    error = "the metadata message has no type or piece";
    return false;
  }
  out.msg_type = static_cast<int>(type->number);
  out.piece = static_cast<unsigned>(piece->number);
  out.total_size = 0;
  if (const Node* size = root.get("total_size");
      size && size->kind == Kind::Integer && size->number > 0 && size->number <= static_cast<std::int64_t>(kMaxMetadata))
    out.total_size = static_cast<unsigned>(size->number);
  out.data = payload.substr(used);
  return true;
}

bool parse_pex(std::string_view payload, std::vector<std::pair<std::string, std::uint16_t>>& added,
               std::string& error) {
  Node root;
  DecodeLimits limits;
  limits.max_depth = 4;
  limits.max_nodes = 16;
  limits.max_string = 65536;
  if (!decode(payload, root, error, limits)) {
    error = "the PEX message is not bencoded: " + error;
    return false;
  }
  if (root.kind != Kind::Dictionary) {
    error = "the PEX message is not a dictionary";
    return false;
  }
  if (const Node* peers = root.get("added"); peers && peers->kind == Kind::String && peers->text.size() % 6 == 0)
    compact_peers(peers->text, added);
  return true;
}

std::string build_bitfield(const std::vector<std::uint8_t>& pieces) {
  std::string out((pieces.size() + 7) / 8, '\0');
  for (std::size_t i = 0; i < pieces.size(); ++i)
    if (pieces[i]) out[i / 8] = static_cast<char>(static_cast<unsigned char>(out[i / 8]) | (0x80 >> (i % 8)));
  return out;
}

bool bitfield_has(std::string_view bitfield, std::uint32_t index) {
  if (index / 8 >= bitfield.size()) return false;
  return (static_cast<unsigned char>(bitfield[index / 8]) & (0x80 >> (index % 8))) != 0;
}

void merge_bitfield(std::string_view bitfield, std::vector<std::uint8_t>& pieces) {
  for (std::size_t i = 0; i < pieces.size(); ++i)
    if (bitfield_has(bitfield, static_cast<std::uint32_t>(i))) pieces[i] = 1;
}
} // namespace torrent
