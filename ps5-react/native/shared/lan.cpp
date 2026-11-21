// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "lan.hpp"
#include "network.hpp"
#include "thread_name.hpp"
#include "worker_thread.hpp"
#include <arpa/inet.h>
#include <atomic>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <map>
#include <memory>
#include <mutex>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>

namespace lan {
namespace {
using Clock = std::chrono::steady_clock;
// A cancelled query notices within this long: the wait for replies is sliced, never spun.
constexpr int kSliceMs = 100;

struct Task {
  std::uint16_t port = 0;
  std::string message;
  int timeout_ms = 0;
  unsigned max_replies = 0;
  std::atomic<bool> cancelled{false}, done{false};
  Snapshot result; // written by the worker until `done`, then read by poll
  WorkerThread thread;
};

std::mutex mutex;
std::map<std::uint32_t, std::shared_ptr<Task>> tasks;
std::uint32_t next_id = 1;

void run(Task& task) {
  name_thread("lan-query");
  Snapshot& out = task.result;
  const int fd = socket(AF_INET, SOCK_DGRAM, 0);
  if (fd < 0) {
    out.state = "failed";
    out.error = std::string("socket: ") + std::strerror(errno);
    return;
  }
  const int on = 1;
  sockaddr_in to{};
  to.sin_family = AF_INET;
  to.sin_port = htons(task.port);
  to.sin_addr.s_addr = htonl(INADDR_BROADCAST);
  if (setsockopt(fd, SOL_SOCKET, SO_BROADCAST, &on, sizeof on) != 0 ||
      sendto(fd, task.message.data(), task.message.size(), 0, reinterpret_cast<const sockaddr*>(&to), sizeof to) < 0) {
    out.state = "failed";
    out.error = std::string("sendto: ") + std::strerror(errno);
    close(fd);
    return;
  }
  const auto end = Clock::now() + std::chrono::milliseconds(task.timeout_ms);
  char buffer[kMaxReplyBytes];
  while (!task.cancelled && out.replies.size() < task.max_replies) {
    const auto left = std::chrono::duration_cast<std::chrono::milliseconds>(end - Clock::now()).count();
    if (left <= 0) break;
    pollfd waiting{fd, POLLIN, 0};
    const int ready = ::poll(&waiting, 1, static_cast<int>(left < kSliceMs ? left : kSliceMs));
    if (ready < 0 && errno != EINTR) break;
    if (ready <= 0) continue;
    sockaddr_in from{};
    socklen_t from_size = sizeof from;
    const ssize_t received = recvfrom(fd, buffer, sizeof buffer, 0, reinterpret_cast<sockaddr*>(&from), &from_size);
    if (received < 0 || from.sin_family != AF_INET) continue;
    char address[INET_ADDRSTRLEN] = {};
    inet_ntop(AF_INET, &from.sin_addr, address, sizeof address);
    out.replies.push_back({address, ntohs(from.sin_port), std::string(buffer, static_cast<std::size_t>(received))});
  }
  close(fd);
  out.state = task.cancelled ? "cancelled" : "completed";
}
} // namespace

std::uint32_t broadcast(std::uint16_t port, std::string message, int timeout_ms, unsigned max_replies,
                        std::string& error) {
  if (!network::running()) {
    error = "enable networking: true and filesystemAccess: console in app.json";
    return 0;
  }
  std::lock_guard lock(mutex);
  unsigned running = 0;
  for (const auto& [id, task] : tasks) running += !task->done;
  if (running >= kMaxTasks) {
    error = "too many broadcasts running (4); wait for one to finish";
    return 0;
  }
  auto task = std::make_shared<Task>();
  task->port = port;
  task->message = std::move(message);
  task->timeout_ms = timeout_ms;
  task->max_replies = max_replies;
  const std::uint32_t id = next_id++;
  task->result.id = id;
  Task* raw = task.get();
  if (!task->thread.start([raw] { run(*raw); raw->done = true; }, 256 * 1024)) {
    error = "could not start the broadcast worker";
    return 0;
  }
  tasks.emplace(id, std::move(task));
  return id;
}

void cancel(std::uint32_t id) {
  std::lock_guard lock(mutex);
  if (const auto found = tasks.find(id); found != tasks.end()) found->second->cancelled = true;
}

std::vector<Snapshot> poll() {
  std::vector<Snapshot> out;
  std::lock_guard lock(mutex);
  for (auto it = tasks.begin(); it != tasks.end();) {
    if (!it->second->done) {
      ++it;
      continue;
    }
    it->second->thread.join();
    out.push_back(std::move(it->second->result));
    it = tasks.erase(it);
  }
  return out;
}

void stop() {
  std::map<std::uint32_t, std::shared_ptr<Task>> stopping;
  {
    std::lock_guard lock(mutex);
    stopping.swap(tasks);
  }
  for (auto& [id, task] : stopping) task->cancelled = true;
  for (auto& [id, task] : stopping) task->thread.join();
}
} // namespace lan
