// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstdint>

extern "C" {
#include "er_perf.h"
}

// Wall-clock frame split, summarised once per window. The host supplies a
// monotonic microsecond clock; nothing here allocates. Beside it, the POSIX CPU
// clocks give the cores the whole process kept busy and the render thread's own
// CPU time, so a wait that spins shows up as CPU time in present or swap.
// It also opens and closes the engine's er_perf frame, so the summary adds the
// engine's js/layout/raster split when ER_PERF_STATS is compiled in.
class FrameStats {
public:
  enum Phase { input, update, present, swap, phase_count };

  // Starts a frame. Returns the summary line when the previous frame closed a
  // window, otherwise nullptr. The line stays valid until the next call.
  const char* start_frame(std::int64_t now_us);
  // Attributes the time since the previous start_frame()/lap() to `phase`.
  void lap(Phase phase, std::int64_t now_us);
  // Closes the engine's frame. Returns its breakdown when it took longer than
  // slow_us (at most a few per window), otherwise nullptr.
  const char* end_frame(std::uint32_t slow_us);
  // The presenter's split of the present phase for this frame (GlPresenter::last_timing).
  void note_present(std::uint32_t upload_us, std::uint32_t draw_us, std::uint64_t upload_bytes) {
    upload_us_ = upload_us; draw_us_ = draw_us;
    upload_sum_ += upload_us; draw_sum_ += draw_us; upload_bytes_sum_ += upload_bytes;
  }
  // How many slow frames a window reports (default 8).
  void set_slow_line_limit(std::uint32_t limit) { slow_line_limit_ = limit; }

private:
  static constexpr std::int64_t window_us = 2000000;
  // Holds a full window up to 512 Hz; beyond that p95 covers the latest frames.
  static constexpr int capacity = 1024;
  std::uint32_t slow_line_limit_ = 8;

  std::uint32_t totals_[capacity] = {}, scratch_[capacity] = {};
  std::uint64_t phase_sum_[phase_count] = {}, total_sum_ = 0;
  std::uint32_t total_max_ = 0, frames_ = 0;
  std::int64_t window_start_ = 0, frame_start_ = 0, mark_ = 0;
  // er_perf sums over the window; perf_frames_ stays 0 when ER_PERF_STATS is off.
  std::uint64_t engine_sum_[ER_PERF_PHASE_COUNT] = {}, js_sub_sum_[ER_PERF_JS_COUNT] = {},
                raster_sub_sum_[ER_PERF_RASTER_COUNT] = {}, dirty_px_sum_ = 0, blit_px_sum_ = 0;
  std::uint32_t perf_frames_ = 0, slow_lines_ = 0, parallel_frames_ = 0, parallel_seen_ = 0;
  std::uint64_t upload_sum_ = 0, draw_sum_ = 0, upload_bytes_sum_ = 0;
  std::uint32_t upload_us_ = 0, draw_us_ = 0;
  std::uint64_t process_cpu_start_ = 0, thread_cpu_start_ = 0, thread_cpu_mark_ = 0, thread_cpu_sum_[phase_count] = {};
  char line_[512] = {}, slow_line_[352] = {};
};
