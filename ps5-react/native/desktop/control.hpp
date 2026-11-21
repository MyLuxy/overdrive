// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstddef>
#include <deque>
#include <mutex>
#include <string>
#include <thread>

// The desktop preview's control channel for tools/ps5_drive.py: one line-based command per Unix
// socket connection, read without blocking once a frame on the render thread, so commands reach JS
// on the thread that owns it. It also tees stdout and stderr into a bounded buffer for `logs`.
class Control {
public:
  ~Control();
  bool start(const char* path);
  // A waiting command and its connection, or an empty string; reply() closes the connection.
  std::string next(int& client);
  static void reply(int client, const std::string& text);
  std::string take_logs();

private:
  void capture();
  int listener_ = -1, pipe_ = -1, terminal_ = -1;
  std::string path_;
  std::thread reader_;
  std::mutex mutex_;
  std::deque<std::string> lines_;
  std::string partial_;
  static constexpr std::size_t kMaxLines = 2000;
};
