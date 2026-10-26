// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "torrent_tracker.hpp"
#include "network.hpp"
#include "torrent_bencode.hpp"
#include <algorithm>
#include <arpa/inet.h>
#include <atomic>
#include <chrono>
#include <curl/curl.h>
#include <netinet/in.h>
#include <poll.h>
#include <string>
#include <sys/socket.h>
#include <unistd.h>

namespace torrent {
namespace {
constexpr std::size_t kMaxResponse = 1u << 20;
constexpr std::size_t kMaxPeers = 200;
constexpr std::uint64_t kUdpMagic = 0x41727101980ULL;

bool dotted_ipv4(std::string_view text) {
  in_addr address{};
  const std::string host(text);
  return inet_pton(AF_INET, host.c_str(), &address) == 1;
}

void add_compact(std::vector<PeerAddress>& peers, std::string_view compact) {
  for (std::size_t at = 0; at + 6 <= compact.size() && peers.size() < kMaxPeers; at += 6) {
    const auto* raw = reinterpret_cast<const unsigned char*>(compact.data() + at);
    const unsigned port = (static_cast<unsigned>(raw[4]) << 8) | raw[5];
    if (!port) continue;
    PeerAddress address;
    address.host = std::to_string(raw[0]) + "." + std::to_string(raw[1]) + "." + std::to_string(raw[2]) + "." +
                   std::to_string(raw[3]);
    address.port = static_cast<std::uint16_t>(port);
    peers.push_back(std::move(address));
  }
}

void add_peers(std::vector<PeerAddress>& peers, const Node& node) {
  if (node.kind == Kind::String) {
    if (node.text.size() % 6 == 0) add_compact(peers, node.text);
    return;
  }
  if (node.kind != Kind::List) return;
  for (const Node& item : node.children) {
    if (peers.size() >= kMaxPeers || item.kind != Kind::Dictionary) continue;
    const Node* ip = item.get("ip");
    const Node* port = item.get("port");
    if (!ip || ip->kind != Kind::String || !dotted_ipv4(ip->text)) continue;
    if (!port || port->kind != Kind::Integer || port->number <= 0 || port->number > 65535) continue;
    peers.push_back({std::string(ip->text), static_cast<std::uint16_t>(port->number)});
  }
}

void read_count(const Node& root, const char* key, unsigned& out) {
  if (const Node* node = root.get(key); node && node->kind == Kind::Integer && node->number >= 0)
    out = static_cast<unsigned>(node->number > 0xFFFFFFFFLL ? 0xFFFFFFFFLL : node->number);
}

void read_seconds(const Node& root, const char* key, int& out) {
  if (const Node* node = root.get(key); node && node->kind == Kind::Integer && node->number > 0)
    out = static_cast<int>(node->number > 7 * 86400 ? 7 * 86400 : node->number);
}

struct Body {
  std::string bytes;
  bool too_large = false;
};

size_t write_body(char* data, size_t size, size_t count, void* user) {
  auto& body = *static_cast<Body*>(user);
  const std::size_t bytes = size * count;
  if (bytes > kMaxResponse - body.bytes.size()) {
    body.too_large = true;
    return 0;
  }
  body.bytes.append(data, bytes);
  return bytes;
}

void put16(std::string& out, std::uint16_t value) {
  out.push_back(static_cast<char>(value >> 8));
  out.push_back(static_cast<char>(value & 0xFF));
}

void put32(std::string& out, std::uint32_t value) {
  for (int shift = 24; shift >= 0; shift -= 8) out.push_back(static_cast<char>((value >> shift) & 0xFF));
}

void put64(std::string& out, std::uint64_t value) {
  for (int shift = 56; shift >= 0; shift -= 8) out.push_back(static_cast<char>((value >> shift) & 0xFF));
}

std::uint32_t get32(std::string_view bytes, std::size_t at) {
  std::uint32_t value = 0;
  for (std::size_t i = 0; i < 4; ++i) value = (value << 8) | static_cast<unsigned char>(bytes[at + i]);
  return value;
}

std::uint64_t get64(std::string_view bytes, std::size_t at) {
  std::uint64_t value = 0;
  for (std::size_t i = 0; i < 8; ++i) value = (value << 8) | static_cast<unsigned char>(bytes[at + i]);
  return value;
}

std::uint32_t transaction_id() {
  static std::atomic<std::uint32_t> state{static_cast<std::uint32_t>(
      std::chrono::steady_clock::now().time_since_epoch().count())};
  return state.fetch_add(0x9E3779B9u) ^ 0x5A5A5A5Au;
}

bool udp_endpoint(const std::string& url, sockaddr_in& address, std::string& error) {
  std::string_view rest(url);
  rest.remove_prefix(6); // "udp://"
  if (const auto slash = rest.find('/'); slash != std::string_view::npos) rest = rest.substr(0, slash);
  if (!rest.empty() && rest.front() == '[') {
    error = "UDP trackers must use an IPv4 address";
    return false;
  }
  std::string host(rest);
  unsigned port = 6969;
  if (const auto colon = rest.rfind(':'); colon != std::string_view::npos) {
    host.assign(rest.substr(0, colon));
    port = 0;
    for (const char c : rest.substr(colon + 1)) {
      if (c < '0' || c > '9' || port > 65535) {
        error = "the UDP tracker URL has an invalid port";
        return false;
      }
      port = port * 10 + static_cast<unsigned>(c - '0');
    }
    if (!port || port > 65535) {
      error = "the UDP tracker URL has an invalid port";
      return false;
    }
  }
  address = {};
  address.sin_family = AF_INET;
  address.sin_port = htons(static_cast<std::uint16_t>(port));
  if (inet_pton(AF_INET, host.c_str(), &address.sin_addr) != 1) {
    error = "the UDP tracker host is not an IPv4 address";
    return false;
  }
  return true;
}

bool exchange(int fd, const std::string& request, std::string& response, int timeout_ms) {
  if (send(fd, request.data(), request.size(), 0) != static_cast<ssize_t>(request.size())) return false;
  pollfd ready{fd, POLLIN, 0};
  if (poll(&ready, 1, timeout_ms) <= 0) return false;
  char buffer[2048];
  const ssize_t size = recv(fd, buffer, sizeof buffer, 0);
  if (size <= 0) return false;
  response.assign(buffer, static_cast<std::size_t>(size));
  return true;
}

int event_code(const std::string& event) {
  if (event == "completed") return 1;
  if (event == "started") return 2;
  if (event == "stopped") return 3;
  return 0;
}
} // namespace

std::string query_escape(std::string_view bytes) {
  constexpr char digits[] = "0123456789ABCDEF";
  std::string out;
  out.reserve(bytes.size() * 3);
  for (const unsigned char byte : bytes) {
    const bool plain = (byte >= 'A' && byte <= 'Z') || (byte >= 'a' && byte <= 'z') || (byte >= '0' && byte <= '9') ||
                       byte == '-' || byte == '_' || byte == '.' || byte == '~';
    if (plain) {
      out.push_back(static_cast<char>(byte));
    } else {
      out.push_back('%');
      out.push_back(digits[byte >> 4]);
      out.push_back(digits[byte & 15]);
    }
  }
  return out;
}

std::string announce_url(const std::string& url, const Announce& announce) {
  std::string out = url;
  out += url.find('?') == std::string::npos ? '?' : '&';
  out += "info_hash=" + query_escape(announce.info_hash);
  out += "&peer_id=" + query_escape(announce.peer_id);
  out += "&port=" + std::to_string(announce.port);
  out += "&uploaded=" + std::to_string(announce.uploaded);
  out += "&downloaded=" + std::to_string(announce.downloaded);
  out += "&left=" + std::to_string(announce.left);
  out += "&compact=1&numwant=" + std::to_string(announce.num_want);
  if (!announce.event.empty()) out += "&event=" + announce.event;
  return out;
}

bool decode_announce(std::string_view body, AnnounceResult& result, std::string& error) {
  Node root;
  DecodeLimits limits;
  limits.max_nodes = 4096;
  limits.max_string = kMaxResponse;
  if (!decode(body, root, error, limits)) {
    error = "the tracker answered invalid bencode: " + error;
    return false;
  }
  if (root.kind != Kind::Dictionary) {
    error = "the tracker answer is not a dictionary";
    return false;
  }
  if (const Node* failure = root.get("failure reason"); failure && failure->kind == Kind::String) {
    error = std::string(failure->text);
    return false;
  }
  read_seconds(root, "interval", result.interval);
  read_seconds(root, "min interval", result.min_interval);
  read_count(root, "complete", result.seeds);
  read_count(root, "incomplete", result.leechers);
  if (const Node* peers = root.get("peers")) add_peers(result.peers, *peers);
  return true;
}

bool announce_http(const std::string& url, const Announce& announce, AnnounceResult& result, std::string& error) {
  if (!network::running()) {
    error = "the network is not running";
    return false;
  }
  if (announce.info_hash.size() != 20 || announce.peer_id.size() != 20) {
    error = "an announce needs a 20-byte info hash and peer id";
    return false;
  }
  CURL* curl = curl_easy_init();
  if (!curl) {
    error = "could not create a curl handle";
    return false;
  }
  const std::string target = announce_url(url, announce);
  Body body;
  bool ok = network::configure_transport(curl, target, true);
  if (!ok) {
    error = "the network transport is not available";
  } else {
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, write_body);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &body);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 20L);
    curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 8L);
    const CURLcode code = curl_easy_perform(curl);
    long status = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status);
    if (code != CURLE_OK) {
      error = std::string("the tracker did not answer: ") + curl_easy_strerror(code);
      ok = false;
    } else if (body.too_large) {
      error = "the tracker answer is larger than 1 MiB";
      ok = false;
    } else if (status < 200 || status >= 300) {
      error = "the tracker answered HTTP " + std::to_string(status);
      ok = false;
    } else {
      ok = decode_announce(body.bytes, result, error);
    }
  }
  curl_easy_cleanup(curl);
  return ok;
}

bool announce_udp(const std::string& url, const Announce& announce, AnnounceResult& result, std::string& error) {
  if (announce.info_hash.size() != 20 || announce.peer_id.size() != 20) {
    error = "an announce needs a 20-byte info hash and peer id";
    return false;
  }
  sockaddr_in address{};
  if (!udp_endpoint(url, address, error)) return false;
  const int fd = socket(AF_INET, SOCK_DGRAM, 0);
  if (fd < 0) {
    error = "could not open a UDP socket";
    return false;
  }
  if (connect(fd, reinterpret_cast<const sockaddr*>(&address), sizeof address) != 0) {
    error = "could not reach the UDP tracker";
    close(fd);
    return false;
  }
  bool ok = false;
  for (unsigned attempt = 0; attempt < 2 && !ok; ++attempt) {
    const std::uint32_t connect_id = transaction_id();
    std::string request;
    put64(request, kUdpMagic);
    put32(request, 0);
    put32(request, connect_id);
    std::string response;
    if (!exchange(fd, request, response, 5000) || response.size() < 16 || get32(response, 0) != 0 ||
        get32(response, 4) != connect_id) {
      error = "the UDP tracker did not answer the connect request";
      continue;
    }
    const std::uint64_t connection = get64(response, 8);
    const std::uint32_t announce_id = transaction_id();
    request.clear();
    put64(request, connection);
    put32(request, 1);
    put32(request, announce_id);
    request.append(announce.info_hash);
    request.append(announce.peer_id);
    put64(request, announce.downloaded);
    put64(request, announce.left);
    put64(request, announce.uploaded);
    put32(request, static_cast<std::uint32_t>(event_code(announce.event)));
    put32(request, 0);
    put32(request, transaction_id());
    put32(request, 0xFFFFFFFFu); // num_want -1
    put16(request, announce.port);
    response.clear();
    if (!exchange(fd, request, response, 10000) || response.size() < 8 || get32(response, 4) != announce_id) {
      error = "the UDP tracker did not answer the announce request";
      continue;
    }
    const std::uint32_t action = get32(response, 0);
    if (action == 3) {
      error.assign(response.data() + 8, response.size() - 8);
      if (error.empty()) error = "the UDP tracker refused the announce";
      ok = false;
      break;
    }
    if (action != 1 || response.size() < 20) {
      error = "the UDP tracker answered an unexpected action";
      continue;
    }
    result.interval = static_cast<int>(std::min<std::uint32_t>(get32(response, 8), 7 * 86400));
    result.leechers = get32(response, 12);
    result.seeds = get32(response, 16);
    result.peers.clear();
    add_compact(result.peers, std::string_view(response).substr(20));
    ok = true;
  }
  close(fd);
  return ok;
}

bool announce_tracker(const std::string& url, const Announce& announce, AnnounceResult& result, std::string& error) {
  if (url.starts_with("http://") || url.starts_with("https://")) return announce_http(url, announce, result, error);
  if (url.starts_with("udp://")) return announce_udp(url, announce, result, error);
  error = "unsupported tracker scheme";
  return false;
}
} // namespace torrent
