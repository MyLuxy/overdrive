// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// UDP broadcast queries on the local network (service discovery: "who is JellyfinServer?" to 7359,
// which every server answers). Each query runs on a worker of its own for a bounded time; the render
// thread only submits, cancels and polls.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace lan {
inline constexpr std::size_t kMaxMessageBytes = 1024, kMaxReplyBytes = 4096;
inline constexpr unsigned kMaxReplies = 64, kMaxTasks = 4;
inline constexpr int kMinTimeoutMs = 100, kMaxTimeoutMs = 10000;

struct Reply {
  std::string address; // the sender's IPv4 address, dotted
  std::uint16_t port = 0;
  std::string body;
};
struct Snapshot {
  std::uint32_t id = 0;
  std::string state, error; // 'completed' | 'failed' | 'cancelled'
  std::vector<Reply> replies;
};

// Sends `message` to 255.255.255.255:`port` and gathers replies for `timeout_ms` or until
// `max_replies`. 0 with `error` set when it cannot start.
std::uint32_t broadcast(std::uint16_t port, std::string message, int timeout_ms, unsigned max_replies,
                        std::string& error);
void cancel(std::uint32_t id);
// Finished queries since the last poll.
std::vector<Snapshot> poll();
// Cancels running queries and joins their workers.
void stop();
} // namespace lan
