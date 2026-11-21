// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
//
// On the desktop rar-extract runs as a child process, its standard input and output one socket.
#include "archives.hpp"
#include <cerrno>
#include <climits>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#endif

extern char** environ;

namespace {
std::mutex guard;
pid_t child = -1;

// PS5_REACT_RAR_WORKER, or rar-extract beside this executable.
std::string worker_path() {
  if (const char* path = std::getenv("PS5_REACT_RAR_WORKER")) return path;
  char self[PATH_MAX] = {};
#ifdef __APPLE__
  std::uint32_t size = sizeof self;
  if (_NSGetExecutablePath(self, &size)) return {};
#else
  if (readlink("/proc/self/exe", self, sizeof self - 1) < 0) return {};
#endif
  std::string path(self);
  return path.substr(0, path.rfind('/') + 1) + "rar-extract";
}

bool send_all(int stream, const char* data, std::size_t size) {
  while (size) {
    const auto count = send(stream, data, size, 0);
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    data += count;
    size -= count;
  }
  return true;
}
}

int archives::start_rar_worker(const std::string& request, std::string& error) {
  std::lock_guard lock(guard);
  const auto path = worker_path();
  if (path.empty() || access(path.c_str(), X_OK)) {
    error = "rar-extract is missing";
    return -1;
  }
  int pair[2];
  if (socketpair(AF_UNIX, SOCK_STREAM, 0, pair)) {
    error = std::strerror(errno);
    return -1;
  }
#ifdef SO_NOSIGPIPE
  const int on = 1;
  setsockopt(pair[0], SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
#endif
  posix_spawn_file_actions_t actions;
  posix_spawn_file_actions_init(&actions);
  posix_spawn_file_actions_adddup2(&actions, pair[1], STDIN_FILENO);
  posix_spawn_file_actions_adddup2(&actions, pair[1], STDOUT_FILENO);
  posix_spawn_file_actions_addclose(&actions, pair[0]);
  char* argv[] = {const_cast<char*>(path.c_str()), nullptr};
  const int spawned = posix_spawn(&child, path.c_str(), &actions, nullptr, argv, environ);
  posix_spawn_file_actions_destroy(&actions);
  close(pair[1]);
  if (spawned || !send_all(pair[0], request.data(), request.size())) {
    error = std::strerror(spawned ? spawned : errno);
    close(pair[0]);
    if (!spawned) waitpid(child, nullptr, 0);
    child = -1;
    return -1;
  }
  return pair[0];
}

long archives::read_rar_worker(int stream, char* data, std::size_t size) {
  pollfd ready{stream, POLLIN, 0};
  if (poll(&ready, 1, 250) <= 0) return -1;
  const auto count = recv(stream, data, size, 0);
  return count < 0 ? -1 : count;
}

void archives::cancel_rar_worker(int stream) { send_all(stream, "cancel\n", 7); }

// The worker stops when its input closes. One stuck in a write past five seconds is killed, so it
// cannot outlive the extraction whose staging is about to be removed.
void archives::close_rar_worker(int stream) {
  std::lock_guard lock(guard);
  close(stream);
  for (int wait = 0; child > 0 && !waitpid(child, nullptr, WNOHANG); ++wait) {
    if (wait == 100) {
      kill(child, SIGKILL);
      waitpid(child, nullptr, 0);
      break;
    }
    usleep(50'000);
  }
  child = -1;
}
