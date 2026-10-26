// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Unit tests for the peer wire helpers and the tracker URL/answer decoding. No sockets, no JS.
#include "torrent_bencode.hpp"
#include "torrent_peer.hpp"
#include "torrent_tracker.hpp"
#include <cstdio>
#include <string>
#include <vector>

namespace {
int failures = 0;

void check(bool condition, int line, const char* text) {
  if (condition) return;
  std::fprintf(stderr, "line %d: %s\n", line, text);
  ++failures;
}
#define CHECK(condition) check((condition), __LINE__, #condition)

std::string bytes(const std::vector<int>& values) {
  std::string out;
  for (const int value : values) out.push_back(static_cast<char>(value));
  return out;
}

void handshakes() {
  const std::string hash(20, 'a'), id(20, 'b');
  const std::string bytes_out = torrent::handshake(hash, id, true);
  CHECK(bytes_out.size() == torrent::kHandshakeSize);
  CHECK(bytes_out[0] == 19);
  CHECK(bytes_out.substr(1, 19) == torrent::kProtocol);
  CHECK(bytes_out[25] == 0x10);
  std::string parsed_hash, parsed_id, error;
  bool extensions = false;
  std::size_t used = 0;
  CHECK(torrent::parse_handshake(bytes_out, parsed_hash, parsed_id, extensions, error, used));
  CHECK(parsed_hash == hash && parsed_id == id && extensions && used == 68);
  CHECK(torrent::parse_handshake(bytes_out.substr(0, 67), parsed_hash, parsed_id, extensions, error, used) == false);
  std::string broken = bytes_out;
  broken[5] = 'X';
  CHECK(!torrent::parse_handshake(broken, parsed_hash, parsed_id, extensions, error, used));
  CHECK(error.find("BitTorrent handshake") != std::string::npos);
  CHECK(!torrent::handshake(hash, id, false).empty() && torrent::handshake(hash, id, false)[25] == 0);
}

void frames() {
  torrent::Reader reader;
  torrent::Frame frame;
  const std::string request = torrent::request_frame(3, 16384, 16384);
  CHECK(reader.feed(request.data(), 2) && !reader.next(frame) && !reader.failed());
  CHECK(reader.feed(request.data() + 2, request.size() - 2));
  CHECK(reader.next(frame) && frame.id == torrent::Message::Request && frame.payload.size() == 12);
  CHECK(static_cast<unsigned char>(frame.payload[3]) == 3);
  CHECK(static_cast<unsigned char>(frame.payload[6]) == 0x40); // 16384 = 0x4000

  torrent::Reader many;
  std::string stream = std::string(4, '\0') + torrent::frame(torrent::Message::Interested) +
                       torrent::have_frame(7) + torrent::piece_frame(1, 0, "hello");
  CHECK(many.feed(stream.data(), stream.size()));
  CHECK(many.next(frame) && frame.id == torrent::Message::KeepAlive && frame.payload.empty());
  CHECK(many.next(frame) && frame.id == torrent::Message::Interested);
  CHECK(many.next(frame) && frame.id == torrent::Message::Have && frame.payload.size() == 4);
  CHECK(static_cast<unsigned char>(frame.payload[3]) == 7);
  CHECK(many.next(frame) && frame.id == torrent::Message::Piece && frame.payload.size() == 13);
  CHECK(frame.payload.substr(8) == "hello");
  CHECK(!many.next(frame) && !many.failed());

  // An id this engine does not use is skipped by its own length, not treated as corruption.
  torrent::Reader unknown;
  const std::string skipped = torrent::frame(static_cast<torrent::Message>(99), "xyz");
  CHECK(unknown.feed(skipped.data(), skipped.size()));
  CHECK(unknown.next(frame) && frame.id == torrent::Message::KeepAlive && !unknown.next(frame));

  torrent::Reader oversized;
  const std::string huge = bytes({0, 0x50, 0, 1}); // 5 MiB + 1
  CHECK(oversized.feed(huge.data(), huge.size()));
  CHECK(!oversized.next(frame) && oversized.failed());
  CHECK(oversized.error().find("2 MiB") != std::string::npos);

  torrent::Reader flooded;
  const std::string lot(9u << 20, '\0');
  CHECK(!flooded.feed(lot.data(), lot.size()) && flooded.failed());
}

void bitfields() {
  const std::vector<std::uint8_t> pieces{1, 0, 1, 0, 0, 0, 0, 1, 1};
  const std::string field = torrent::build_bitfield(pieces);
  CHECK(field.size() == 2);
  CHECK(static_cast<unsigned char>(field[0]) == 0xA1);
  CHECK(static_cast<unsigned char>(field[1]) == 0x80);
  std::vector<std::uint8_t> merged(10, 0);
  torrent::merge_bitfield(field, merged);
  CHECK((merged == std::vector<std::uint8_t>{1, 0, 1, 0, 0, 0, 0, 1, 1, 0}));
  CHECK(torrent::bitfield_has(field, 7) && torrent::bitfield_has(field, 8) && !torrent::bitfield_has(field, 1) &&
        !torrent::bitfield_has(field, 99));
}

void extensions() {
  torrent::ExtendedHandshake handshake;
  std::string error;
  const std::string message = "d1:md11:ut_metadatai3e6:ut_pexi2ee13:metadata_sizei1234e1:v11:Test Cliente";
  CHECK(torrent::parse_extended_handshake(message, handshake, error));
  CHECK(handshake.ut_metadata == 3 && handshake.ut_pex == 2 && handshake.metadata_size == 1234);
  CHECK(handshake.client == "Test Client");
  CHECK(!torrent::parse_extended_handshake("not bencode", handshake, error));
  CHECK(!torrent::parse_extended_handshake("i1e", handshake, error));

  const std::string header = "d8:msg_typei1e5:piecei0e10:total_sizei100ee";
  const std::string payload = header + "abc";
  torrent::MetadataMessage metadata;
  CHECK(torrent::parse_metadata_message(payload, metadata, error));
  CHECK(metadata.msg_type == 1 && metadata.piece == 0 && metadata.total_size == 100 && metadata.data == "abc");
  torrent::MetadataMessage request;
  CHECK(torrent::parse_metadata_message(torrent::metadata_request(2), request, error));
  CHECK(request.msg_type == 0 && request.piece == 2);

  const std::string pex = std::string("d5:added6:") + bytes({1, 2, 3, 4, 0x1A, 0xE1}) + "e";
  std::vector<std::pair<std::string, std::uint16_t>> peers;
  CHECK(torrent::parse_pex(pex, peers, error));
  CHECK(peers.size() == 1 && peers[0].first == "1.2.3.4" && peers[0].second == 6881);
  CHECK(!torrent::parse_pex("5:hello", peers, error));
}

void trackers() {
  const std::string hash = bytes({0x12, 0x34, 0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0, 0x12, 0x34,
                                  0x56, 0x78, 0x9A, 0xBC, 0xDE, 0xF0, 0x12, 0x34, 0x56, 0x78});
  CHECK(torrent::query_escape("aA0-_.~") == "aA0-_.~");
  CHECK(torrent::query_escape(hash) == "%124Vx%9A%BC%DE%F0%124Vx%9A%BC%DE%F0%124Vx");

  torrent::Announce announce;
  announce.info_hash = hash;
  announce.peer_id = std::string(20, 'p');
  announce.port = 6881;
  announce.uploaded = 1;
  announce.downloaded = 2;
  announce.left = 3;
  announce.event = "started";
  const std::string url = torrent::announce_url("http://t.example/announce", announce);
  CHECK(url.starts_with("http://t.example/announce?info_hash=%124Vx"));
  CHECK(url.find("&peer_id=" + torrent::query_escape(announce.peer_id)) != std::string::npos);
  CHECK(url.find("&port=6881&uploaded=1&downloaded=2&left=3&compact=1&numwant=80&event=started") !=
        std::string::npos);
  CHECK(torrent::announce_url("http://t.example/announce?passkey=x", announce)
            .starts_with("http://t.example/announce?passkey=x&info_hash="));

  torrent::AnnounceResult result;
  std::string error;
  const std::string compact = std::string("d8:intervali1800e8:completei5e10:incompletei7e5:peers6:") +
                              bytes({1, 2, 3, 4, 0x1A, 0xE1}) + "e";
  CHECK(torrent::decode_announce(compact, result, error));
  CHECK(result.interval == 1800 && result.seeds == 5 && result.leechers == 7);
  CHECK(result.peers.size() == 1 && result.peers[0].host == "1.2.3.4" && result.peers[0].port == 6881);

  result = {};
  const std::string listed = "d5:peersld2:ip7:9.8.7.64:porti6881eeee";
  CHECK(torrent::decode_announce(listed, result, error));
  CHECK(result.peers.size() == 1 && result.peers[0].host == "9.8.7.6" && result.peers[0].port == 6881);

  result = {};
  CHECK(!torrent::decode_announce("d14:failure reason12:unregisterede", result, error));
  CHECK(error == "unregistered");
  CHECK(!torrent::decode_announce("nonsense", result, error));
  CHECK(!torrent::decode_announce("i1e", result, error));
}

void bencode_prefix() {
  torrent::Node node;
  std::size_t used = 0;
  std::string error;
  CHECK(torrent::decode_prefix("d1:ai1eeXYZ", node, used, error));
  CHECK(used == 8 && node.kind == torrent::Kind::Dictionary && node.get("a")->number == 1);
  CHECK(!torrent::decode("d1:ai1eeXYZ", node, error));
}
} // namespace

int main() {
  handshakes();
  frames();
  bitfields();
  extensions();
  trackers();
  bencode_prefix();
  if (failures) {
    std::fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  std::puts("PASS: peer wire framing, bitfields, BEP 9 metadata/PEX, tracker URLs and answers");
  return 0;
}
