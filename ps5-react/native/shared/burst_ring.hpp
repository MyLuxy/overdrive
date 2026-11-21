// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// IEC 61937 bursts (iec61937.hpp) waiting for the bitstream output: one producer (a player's audio
// thread), one consumer (the output thread). Frames are carrier frames, two 16-bit words each. Unlike
// PCM, nothing may scale, mix or resample them.
#pragma once

#include <algorithm>
#include <atomic>
#include <cstddef>
#include <cstdint>
#include <vector>

class BurstRing {
public:
  explicit BurstRing(std::size_t frames) : words_(frames * 2), capacity_(frames) {}

  std::size_t capacity() const { return capacity_; }
  std::size_t available() const { return head_.load(std::memory_order_acquire) - tail_.load(std::memory_order_acquire); }

  // Producer: copies up to `frames` frames; returns how many fit.
  std::size_t write(const std::uint16_t* words, std::size_t frames) {
    const std::size_t head = head_.load(std::memory_order_relaxed);
    const std::size_t count = std::min(frames, capacity_ - (head - tail_.load(std::memory_order_acquire)));
    for (std::size_t i = 0; i < count; ++i) {
      const std::size_t at = ((head + i) % capacity_) * 2;
      words_[at] = words[i * 2];
      words_[at + 1] = words[i * 2 + 1];
    }
    head_.store(head + count, std::memory_order_release);
    return count;
  }

  // Consumer: copies up to `frames` frames; returns how many there were.
  std::size_t read(std::uint16_t* words, std::size_t frames) {
    const std::size_t tail = tail_.load(std::memory_order_relaxed);
    const std::size_t count = std::min(frames, head_.load(std::memory_order_acquire) - tail);
    for (std::size_t i = 0; i < count; ++i) {
      const std::size_t at = ((tail + i) % capacity_) * 2;
      words[i * 2] = words_[at];
      words[i * 2 + 1] = words_[at + 1];
    }
    tail_.store(tail + count, std::memory_order_release);
    return count;
  }

private:
  std::vector<std::uint16_t> words_;
  std::size_t capacity_;
  std::atomic<std::size_t> head_{0}, tail_{0}; // frames written and read, ever
};
