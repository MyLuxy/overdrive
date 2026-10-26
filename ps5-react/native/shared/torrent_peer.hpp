// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// The peer wire protocol (BEP 3) and the two extensions this engine uses: BEP 10/BEP 9 metadata
// exchange and ut_pex peer discovery. Framing is separate from sockets so it can be tested without
// a network, and every length is bounded before it is trusted.
#pragma once
#include <cstdint>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace torrent {
inline constexpr std::size_t kBlockSize = 16 * 1024;
inline constexpr std::uint32_t kMaxFrame = 2u * 1024 * 1024 + 8; // metadata pieces and slack
inline constexpr std::size_t kHandshakeSize = 68;
inline constexpr std::string_view kProtocol = "BitTorrent protocol";

enum class Message : std::uint8_t {
  Choke = 0, Unchoke = 1, Interested = 2, NotInterested = 3, Have = 4, Bitfield = 5, Request = 6,
  Piece = 7, Cancel = 8, Port = 9, Extended = 20, KeepAlive = 255,
};

struct Frame {
  Message id = Message::KeepAlive;
  std::string_view payload; // valid until the next call to next()
};

// Frames the bytes a peer sent. `next()` returns false while a whole message is still missing, or
// once `failed()` is true (a length beyond kMaxFrame, an unknown id, or too much unread data).
class Reader {
public:
  bool feed(const char* bytes, std::size_t size);
  bool next(Frame& out);
  bool failed() const { return !error_.empty(); }
  const std::string& error() const { return error_; }
  std::size_t buffered() const { return buffer_.size() - at_; }

private:
  std::string buffer_;
  std::size_t at_ = 0;
  std::string error_;
};

std::string handshake(std::string_view info_hash, std::string_view peer_id, bool extensions);
// Consumes one handshake from the front of `buffer`; `used` is 68 on success.
bool parse_handshake(std::string_view buffer, std::string& info_hash, std::string& peer_id, bool& extensions,
                     std::string& error, std::size_t& used);

std::string frame(Message id, std::string_view payload = {});
std::string request_frame(std::uint32_t index, std::uint32_t begin, std::uint32_t length);
std::string piece_frame(std::uint32_t index, std::uint32_t begin, std::string_view block);
std::string have_frame(std::uint32_t index);
std::string extended_frame(std::uint8_t id, std::string_view payload);

struct ExtendedHandshake {
  std::string client;
  unsigned metadata_size = 0;
  int ut_metadata = 0, ut_pex = 0;
};
bool parse_extended_handshake(std::string_view payload, ExtendedHandshake& out, std::string& error);

// The bencoded payload (not a frame): the caller wraps it with the ut_metadata id this peer chose.
std::string metadata_request(unsigned piece);
struct MetadataMessage {
  int msg_type = 0; // 0 request, 1 data, 2 reject
  unsigned piece = 0, total_size = 0;
  std::string_view data; // the raw metadata that followed the bencoded header
};
bool parse_metadata_message(std::string_view payload, MetadataMessage& out, std::string& error);

bool parse_pex(std::string_view payload, std::vector<std::pair<std::string, std::uint16_t>>& added,
               std::string& error);

std::string build_bitfield(const std::vector<std::uint8_t>& pieces);
bool bitfield_has(std::string_view bitfield, std::uint32_t index);
void merge_bitfield(std::string_view bitfield, std::vector<std::uint8_t>& pieces);
} // namespace torrent
