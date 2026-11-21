// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "payload_loader.hpp"
#include "host_api.hpp"
#include <climits>
#include <cstdint>
#include <fcntl.h>
#include <unistd.h>

extern "C" {
int sceNetSocket(const char* name, int domain, int type, int protocol);
int sceNetSocketClose(int socket);
int sceNetConnect(int socket, const void* address, std::uint32_t length);
int sceNetSend(int socket, const void* data, std::size_t length, int flags);
int sceNetRecv(int socket, void* data, std::size_t length, int flags);
int sceNetSetsockopt(int socket, int level, int option, const void* value, std::uint32_t size);
}

namespace payload_loader {
namespace {
struct NetAddress { std::uint8_t length, family; std::uint16_t port; std::uint32_t address; std::uint16_t virtual_port; std::uint8_t zero[6]; };

bool send_all(int socket, const char* data, std::size_t size) {
  while (size) {
    const int count = sceNetSend(socket, data, size, 0);
    if (count <= 0) return false;
    data += count; size -= static_cast<std::size_t>(count);
  }
  return true;
}
}

int send(const char* program, const std::string& request, int timeout_us, const char* what, std::string& error) {
  char path[PATH_MAX];
  const std::string logical = std::string("/app0/") + program;
  const int file = host::resolve_path(logical.c_str(), path, sizeof path) ? open(path, O_RDONLY) : -1;
  if (file < 0) { error = std::string(what) + ": " + program + " is missing from the app folder"; return -1; }
  const int socket = sceNetSocket("ps5-react-payload", 2, 1, 6);
  constexpr int connect_us = 5'000'000, level = 0xffff;
  const NetAddress address{sizeof(NetAddress), 2, static_cast<std::uint16_t>((9021 << 8) | (9021 >> 8)), 0x0100007f, 0, {}};
  bool ok = socket >= 0 && sceNetSetsockopt(socket, level, 0x1105, &timeout_us, sizeof timeout_us) >= 0 &&
            sceNetSetsockopt(socket, level, 0x1106, &timeout_us, sizeof timeout_us) >= 0 &&
            sceNetSetsockopt(socket, level, 0x1109, &connect_us, sizeof connect_us) >= 0 &&
            sceNetConnect(socket, &address, sizeof address) >= 0;
  if (!ok) error = std::string(what) + ": the payload loader on port 9021 did not answer; load an ELF loader and retry";
  char buffer[65536];
  for (ssize_t count; ok && (count = read(file, buffer, sizeof buffer)) != 0;)
    ok = count > 0 && send_all(socket, buffer, static_cast<std::size_t>(count));
  ::close(file);
  if (ok && !send_all(socket, request.data(), request.size())) { ok = false; error = std::string(what) + ": " + program + " could not be sent"; }
  if (!ok) { if (socket >= 0) sceNetSocketClose(socket); return -1; }
  return socket;
}

int receive(int socket, char* data, std::size_t size) { return sceNetRecv(socket, data, size, 0); }

bool write(int socket, const char* data, std::size_t size) { return send_all(socket, data, size); }

void receive_timeout(int socket, int timeout_us) { sceNetSetsockopt(socket, 0xffff, 0x1106, &timeout_us, sizeof timeout_us); }

void close(int socket) { sceNetSocketClose(socket); }
}
