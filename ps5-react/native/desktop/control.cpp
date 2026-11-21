// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include <csignal>
#include "control.hpp"
#include <cerrno>
#include <cstdio>
#include <cstring>
#include <fcntl.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/un.h>
#include <unistd.h>

Control::~Control() {
  if (listener_ >= 0) { close(listener_); unlink(path_.c_str()); }
  if (terminal_ >= 0) {
    // Restoring stdout and stderr closes the pipe's last writers, which ends the reader.
    std::fflush(stdout); std::fflush(stderr);
    dup2(terminal_, STDOUT_FILENO); dup2(terminal_, STDERR_FILENO);
    if (reader_.joinable()) reader_.join();
    close(terminal_);
  }
}

bool Control::start(const char* path) {
  // A client that hangs up before its reply would otherwise end the preview with SIGPIPE.
  std::signal(SIGPIPE, SIG_IGN);
  sockaddr_un address{};
  if (std::strlen(path) >= sizeof address.sun_path) return false;
  address.sun_family = AF_UNIX;
  std::strcpy(address.sun_path, path);
  unlink(path);
  listener_ = socket(AF_UNIX, SOCK_STREAM, 0);
  if (listener_ < 0 || bind(listener_, reinterpret_cast<sockaddr*>(&address), sizeof address) != 0 ||
      listen(listener_, 8) != 0 || fcntl(listener_, F_SETFL, O_NONBLOCK) != 0) return false;
  path_ = path;
  capture();
  return true;
}

void Control::capture() {
  int ends[2];
  if (pipe(ends) != 0) return;
  std::fflush(stdout); std::fflush(stderr);
  terminal_ = dup(STDOUT_FILENO);
  dup2(ends[1], STDOUT_FILENO); dup2(ends[1], STDERR_FILENO);
  close(ends[1]);
  // A pipe makes stdout fully buffered; lines must reach the buffer as they are printed.
  setvbuf(stdout, nullptr, _IOLBF, 0);
  pipe_ = ends[0];
  reader_ = std::thread([this] {
    char chunk[4096];
    for (ssize_t read_bytes; (read_bytes = read(pipe_, chunk, sizeof chunk)) > 0;) {
      (void)!write(terminal_, chunk, static_cast<std::size_t>(read_bytes));
      std::lock_guard lock(mutex_);
      partial_.append(chunk, static_cast<std::size_t>(read_bytes));
      for (std::size_t end; (end = partial_.find('\n')) != std::string::npos; partial_.erase(0, end + 1)) {
        lines_.push_back(partial_.substr(0, end));
        if (lines_.size() > kMaxLines) lines_.pop_front();
      }
    }
    close(pipe_);
  });
}

std::string Control::next(int& client) {
  client = listener_ < 0 ? -1 : accept(listener_, nullptr, nullptr);
  if (client < 0) return {};
  // macOS hands accepted sockets the listener's O_NONBLOCK, which cut long replies at the send buffer.
  fcntl(client, F_SETFL, fcntl(client, F_GETFL) & ~O_NONBLOCK);
  // The tool writes its whole line at once; the timeouts only bound a misbehaving client.
  timeval timeout{0, 200000};
  setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof timeout);
  timeval send_timeout{2, 0};
  setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &send_timeout, sizeof send_timeout);
  std::string line;
  char c;
  while (line.size() < 4096 && read(client, &c, 1) == 1 && c != '\n') line += c;
  if (line.empty()) { close(client); client = -1; }
  return line;
}

void Control::reply(int client, const std::string& text) {
  const std::string out = text + "\n";
  for (std::size_t sent = 0; sent < out.size();) {
    const ssize_t n = write(client, out.data() + sent, out.size() - sent);
    if (n <= 0) break;
    sent += static_cast<std::size_t>(n);
  }
  close(client);
}

std::string Control::take_logs() {
  std::lock_guard lock(mutex_);
  std::string out;
  for (const std::string& line : lines_) out += line + "\n";
  lines_.clear();
  return out;
}
