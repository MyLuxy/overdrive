// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "crash_log.hpp"
#include <atomic>
#include <csignal>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <initializer_list>
#include <sys/stat.h>
#include <sys/ucontext.h>
#include <time.h>
#include <unistd.h>

extern "C" int __real_sceKernelDebugOutText(int channel, const char* text);
extern "C" {
struct ModuleSegment { void* address; std::uint32_t size; std::int32_t prot; };
struct ModuleInfo { std::size_t size; char name[256]; ModuleSegment segments[4]; std::uint32_t segment_count; std::uint8_t fingerprint[20]; };
int sceKernelGetModuleList(int* handles, std::size_t count, std::size_t* actual);
int sceKernelGetModuleInfo(int handle, ModuleInfo* info);
}

namespace {
std::atomic<int> log_fd{-1};
// A session that logs in a loop stops here rather than filling the drive.
constexpr long kMaxBytes = 8L * 1024 * 1024;
// app.log keeps up to this many sessions, each opened by a "session" line, then becomes app.prev.log;
// a bigger file than kRotateBytes goes too, whatever its count: both files stay under ~20 MB.
constexpr int kSessions = 5;
constexpr off_t kRotateBytes = 10L * 1024 * 1024;
constexpr char kSessionMark[] = "[PS5-REACT] session ";
std::atomic<long> written{0};

// Lines from before start(), such as how filesystem access chose the folder app.log lives in, wait
// here until start() opens it.
char early[16 * 1024];
std::atomic<std::size_t> early_size{0};
std::atomic<bool> started{false};

void append(const char* text, std::size_t size) {
  if (!started.load(std::memory_order_acquire)) {
    std::size_t at = early_size.load();
    do {
      if (at + size > sizeof early) return;
    } while (!early_size.compare_exchange_weak(at, at + size));
    std::memcpy(early + at, text, size);
    return;
  }
  const int fd = log_fd.load(std::memory_order_relaxed);
  if (fd < 0 || written.fetch_add(static_cast<long>(size)) > kMaxBytes) return;
  (void)!::write(fd, text, size);
}

// Async-signal-safe: no stdio, no allocation.
char* hex(char* out, std::uint64_t value) {
  *out++ = '0'; *out++ = 'x';
  for (int shift = 60; shift >= 0; shift -= 4) *out++ = "0123456789abcdef"[(value >> shift) & 0xf];
  return out;
}

void fatal(int signal, siginfo_t* info, void* context) {
  char line[160];
  char* at = line;
  const char prefix[] = "[PS5-REACT] fatal signal ";
  std::memcpy(at, prefix, sizeof prefix - 1); at += sizeof prefix - 1;
  if (signal >= 10) *at++ = static_cast<char>('0' + signal / 10);
  *at++ = static_cast<char>('0' + signal % 10);
  const char address[] = " address "; std::memcpy(at, address, sizeof address - 1); at += sizeof address - 1;
  at = hex(at, reinterpret_cast<std::uintptr_t>(info ? info->si_addr : nullptr));
  const auto* uc = static_cast<const ucontext_t*>(context);
  const char rip[] = " rip "; std::memcpy(at, rip, sizeof rip - 1); at += sizeof rip - 1;
  at = hex(at, uc ? static_cast<std::uint64_t>(uc->uc_mcontext.mc_rip) : 0);
  const char rsp[] = " rsp "; std::memcpy(at, rsp, sizeof rsp - 1); at += sizeof rsp - 1;
  at = hex(at, uc ? static_cast<std::uint64_t>(uc->uc_mcontext.mc_rsp) : 0);
  *at++ = '\n';
  append(line, static_cast<std::size_t>(at - line));
  __real_sceKernelDebugOutText(0, line);
  ::signal(signal, SIG_DFL);
  ::raise(signal);
}
}

// Linked with --wrap=sceKernelDebugOutText: every klog line of the title, from any library.
extern "C" int __wrap_sceKernelDebugOutText(int channel, const char* text) {
  if (text) append(text, std::strlen(text));
  return __real_sceKernelDebugOutText(channel, text);
}

namespace {
// Where every loaded module sits, so a fault's rip maps to a module and an offset in it.
void log_modules() {
  int handles[256];
  std::size_t count = 0;
  if (sceKernelGetModuleList(handles, 256, &count) != 0) return;
  for (std::size_t i = 0; i < count && i < 256; ++i) {
    ModuleInfo info {};
    info.size = sizeof info;
    if (sceKernelGetModuleInfo(handles[i], &info) != 0) continue;
    char line[400];
    const int n = std::snprintf(line, sizeof line, "[PS5-REACT] module %s text=%p+0x%x\n", info.name,
                                info.segment_count ? info.segments[0].address : nullptr, info.segment_count ? info.segments[0].size : 0u);
    if (n > 0) { append(line, static_cast<std::size_t>(n)); __real_sceKernelDebugOutText(0, line); }
  }
}

// The sessions app.log already holds: its "session" lines at the start of a line. A file that can't
// be read counts as full, so it moves aside rather than blocking anything.
int sessions_in(const char* path) {
  const int fd = ::open(path, O_RDONLY);
  if (fd < 0) return 0;
  struct stat info {};
  if (::fstat(fd, &info) != 0 || info.st_size > kRotateBytes) { ::close(fd); return kSessions; }
  constexpr std::size_t mark = sizeof kSessionMark - 1;
  char buffer[64 * 1024 + mark + 1];
  std::size_t kept = 1;
  buffer[0] = '\n';  // the file's first line starts a line too
  int count = 0;
  for (;;) {
    const ssize_t got = ::read(fd, buffer + kept, sizeof buffer - kept);
    if (got < 0) { count = kSessions; break; }
    if (got == 0) break;
    const std::size_t size = kept + static_cast<std::size_t>(got);
    for (std::size_t at = 0; at + 1 + mark <= size; ++at)
      if (buffer[at] == '\n' && !std::memcmp(buffer + at + 1, kSessionMark, mark)) ++count;
    // The tail that could still begin a mark goes on to the next read.
    kept = size < mark ? size : mark;
    std::memmove(buffer, buffer + size - kept, kept);
    if (count >= kSessions) break;
  }
  ::close(fd);
  return count;
}
}

namespace crash_log {
void start(const char* directory) {
  char current[320], previous[320];
  std::snprintf(current, sizeof current, "%s/app.log", directory);
  std::snprintf(previous, sizeof previous, "%s/app.prev.log", directory);
  if (sessions_in(current) >= kSessions) ::rename(current, previous);
  log_fd = ::open(current, O_WRONLY | O_CREAT | O_APPEND, 0644);
  started.store(true, std::memory_order_release);
  if (log_fd >= 0) {
    // When this session began, so a file of several sessions shows which one is which.
    char line[96];
    const time_t now = ::time(nullptr);
    struct tm local {};
    const int n = localtime_r(&now, &local)
      ? std::snprintf(line, sizeof line, "\n%s%04d-%02d-%02d %02d:%02d:%02d\n", kSessionMark, local.tm_year + 1900,
                      local.tm_mon + 1, local.tm_mday, local.tm_hour, local.tm_min, local.tm_sec)
      : std::snprintf(line, sizeof line, "\n%s(time unknown)\n", kSessionMark);
    if (n > 0) append(line, static_cast<std::size_t>(n));
    append(early, early_size.load());
  }
  struct sigaction action {};
  action.sa_sigaction = fatal;
  action.sa_flags = SA_SIGINFO | SA_RESETHAND;
  sigemptyset(&action.sa_mask);
  for (int signal : {SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGABRT, SIGTRAP}) sigaction(signal, &action, nullptr);
  log_modules();
}
}
