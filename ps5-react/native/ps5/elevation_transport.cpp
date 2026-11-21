// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "app_config.hpp"
#if PS5_REACT_CONSOLE_FILESYSTEM
#include "platform/ps5/system.hpp"
#include <cstddef>
#include <cstdint>

extern "C" {
int* sceNetErrnoLoc(void);
int __real_sceNetSocket(const char*, int, int, int);
int __real_sceNetSetsockopt(int, int, int, const void*, std::uint32_t);
int __real_sceNetConnect(int, const void*, std::uint32_t);
int __real_sceNetSend(int, const void*, std::size_t, int);
int __real_sceNetRecv(int, void*, std::size_t, int);
}

namespace {
void report(const char* operation, int result, int detail = 0) {
  const int* error = result < 0 ? sceNetErrnoLoc() : nullptr;
  hui::sys::log("[PS5-REACT] helper %s result=%d detail=0x%x net_error=0x%08x",
                operation, result, detail, error ? static_cast<unsigned>(*error) : 0);
}
}

extern "C" int __wrap_sceNetSocket(const char* name, int family, int type, int protocol) {
  const int result = __real_sceNetSocket(name, family, type, protocol);
  report("socket", result);
  return result;
}
extern "C" int __wrap_sceNetSetsockopt(int fd, int level, int option, const void* value, std::uint32_t size) {
  const int result = __real_sceNetSetsockopt(fd, level, option, value, size);
  report("setsockopt", result, option);
  return result;
}
extern "C" int __wrap_sceNetConnect(int fd, const void* address, std::uint32_t size) {
  const int result = __real_sceNetConnect(fd, address, size);
  report("connect", result);
  return result;
}
extern "C" int __wrap_sceNetSend(int fd, const void* data, std::size_t size, int flags) {
  const int result = __real_sceNetSend(fd, data, size, flags);
  if (result <= 0) report("send", result);
  return result;
}
extern "C" int __wrap_sceNetRecv(int fd, void* data, std::size_t size, int flags) {
  const int result = __real_sceNetRecv(fd, data, size, flags);
  // A receive timeout (EAGAIN, 35) is how the RAR worker's stream is polled, several times a second.
  if (result < 0 && *sceNetErrnoLoc() == 35) return result;
  if (result <= 0) report("recv", result);
  return result;
}
#endif
