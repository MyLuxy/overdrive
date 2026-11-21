// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "frame_stats.hpp"
#include "render_workers.hpp"

#include <algorithm>
#include <cstdio>
#include <iterator>
#include <sys/resource.h>
#include <time.h>

namespace {
// Integer tenths keep the line independent of the libc's floating-point printf.
struct Tenths { unsigned whole, tenth; };

Tenths tenths(std::uint64_t value, std::uint64_t divisor) {
  const std::uint64_t t = (value * 10 + divisor / 2) / divisor;
  return {static_cast<unsigned>(t / 10), static_cast<unsigned>(t % 10)};
}

#define MS(t) (t).whole, (t).tenth

// CLOCK_PROCESS_CPUTIME_ID advances with the wall clock on the PS5, so the process total comes
// from getrusage.
std::uint64_t process_cpu_us() {
  rusage usage{};
  if (getrusage(RUSAGE_SELF, &usage)) return 0;
  const auto us = [](const timeval& t) {
    return static_cast<std::uint64_t>(t.tv_sec) * 1000000 + static_cast<std::uint64_t>(t.tv_usec);
  };
  return us(usage.ru_utime) + us(usage.ru_stime);
}

std::uint64_t cpu_us(clockid_t clock) {
  timespec t{};
  if (clock_gettime(clock, &t)) return 0;
  return static_cast<std::uint64_t>(t.tv_sec) * 1000000 + static_cast<std::uint64_t>(t.tv_nsec) / 1000;
}
} // namespace

const char* FrameStats::start_frame(std::int64_t now_us) {
  const char* summary = nullptr;
  if (frame_start_) {
    const auto total = static_cast<std::uint32_t>(std::max<std::int64_t>(now_us - frame_start_, 0));
    totals_[frames_ % capacity] = total;
    total_sum_ += total;
    total_max_ = std::max(total_max_, total);
    ++frames_;
  } else {
    window_start_ = now_us;
    process_cpu_start_ = process_cpu_us();
    thread_cpu_start_ = cpu_us(CLOCK_THREAD_CPUTIME_ID);
  }
  frame_start_ = mark_ = now_us;
  thread_cpu_mark_ = cpu_us(CLOCK_THREAD_CPUTIME_ID);

  const std::int64_t elapsed = now_us - window_start_;
  if (frames_ && elapsed >= window_us) {
    const int count = static_cast<int>(std::min<std::uint32_t>(frames_, capacity));
    std::copy(totals_, totals_ + count, scratch_);
    std::uint32_t* p95 = scratch_ + std::min(count - 1, count * 95 / 100);
    std::nth_element(scratch_, p95, scratch_ + count);
    // Times are microseconds; dividing by 1000 * frames gives per-frame milliseconds.
    const Tenths fps = tenths(std::uint64_t{frames_} * 1000000, static_cast<std::uint64_t>(elapsed));
    const Tenths avg = tenths(total_sum_, std::uint64_t{frames_} * 1000), p = tenths(*p95, 1000),
                 max = tenths(total_max_, 1000);
    Tenths phase[phase_count];
    for (int i = 0; i < phase_count; ++i) phase[i] = tenths(phase_sum_[i], std::uint64_t{frames_} * 1000);
    // Cores busy: process CPU time over wall time. `main` is the render thread's CPU ms per frame,
    // then its part in present and in swap.
    const std::uint64_t process_cpu = process_cpu_us();
    const std::uint64_t thread_cpu = thread_cpu_mark_ - thread_cpu_start_;
    const Tenths cores = tenths(process_cpu - process_cpu_start_, static_cast<std::uint64_t>(elapsed));
    const int length = std::snprintf(line_, sizeof line_,
                  "frame: fps=%u.%u total avg=%u.%ums p95=%u.%u max=%u.%u | input=%u.%u update=%u.%u present=%u.%u"
                  " (upload=%u.%u draw=%u.%u up=%lluKB) swap=%u.%u | cpu=%u.%u cores (main=%u.%u present=%u.%u swap=%u.%u)",
                  MS(fps), MS(avg), MS(p), MS(max), MS(phase[input]), MS(phase[update]), MS(phase[present]),
                  MS(tenths(upload_sum_, std::uint64_t{frames_} * 1000)), MS(tenths(draw_sum_, std::uint64_t{frames_} * 1000)),
                  static_cast<unsigned long long>(upload_bytes_sum_ / frames_ / 1024), MS(phase[swap]), MS(cores),
                  MS(tenths(thread_cpu, std::uint64_t{frames_} * 1000)),
                  MS(tenths(thread_cpu_sum_[present], std::uint64_t{frames_} * 1000)),
                  MS(tenths(thread_cpu_sum_[swap], std::uint64_t{frames_} * 1000)));
    if (perf_frames_ && length > 0 && length < static_cast<int>(sizeof line_)) {
      const std::uint64_t ms = std::uint64_t{perf_frames_} * 1000;
      // Mean ms per frame, and mean kilopixels repainted (dirty) and written (blit) per frame.
      std::snprintf(line_ + length, sizeof line_ - length,
                    " | js=%u.%u (dispatch=%u.%u react=%u.%u marshal=%u.%u) layout=%u.%u raster=%u.%u"
                    " (prepass=%u.%u render=%u.%u blit=%u.%u) dirty=%llukpx blit=%llukpx parallel=%u",
                    MS(tenths(engine_sum_[ER_PERF_PHASE_JS], ms)), MS(tenths(js_sub_sum_[ER_PERF_JS_DISPATCH], ms)),
                    MS(tenths(js_sub_sum_[ER_PERF_JS_RECONCILE], ms)), MS(tenths(js_sub_sum_[ER_PERF_JS_MARSHAL], ms)),
                    MS(tenths(engine_sum_[ER_PERF_PHASE_LAYOUT], ms)), MS(tenths(engine_sum_[ER_PERF_PHASE_RASTER], ms)),
                    MS(tenths(raster_sub_sum_[ER_PERF_RASTER_PREPASS], ms)),
                    MS(tenths(raster_sub_sum_[ER_PERF_RASTER_RENDER], ms)),
                    MS(tenths(raster_sub_sum_[ER_PERF_RASTER_BLIT], ms)),
                    static_cast<unsigned long long>(dirty_px_sum_ / ms),
                    static_cast<unsigned long long>(blit_px_sum_ / ms), parallel_frames_);
    }
    summary = line_;
    std::fill(std::begin(phase_sum_), std::end(phase_sum_), 0);
    total_sum_ = 0; total_max_ = 0; frames_ = 0;
    upload_sum_ = draw_sum_ = upload_bytes_sum_ = 0;
    std::fill(std::begin(thread_cpu_sum_), std::end(thread_cpu_sum_), 0);
    process_cpu_start_ = process_cpu;
    thread_cpu_start_ = thread_cpu_mark_;
    std::fill(std::begin(engine_sum_), std::end(engine_sum_), 0);
    std::fill(std::begin(js_sub_sum_), std::end(js_sub_sum_), 0);
    std::fill(std::begin(raster_sub_sum_), std::end(raster_sub_sum_), 0);
    dirty_px_sum_ = blit_px_sum_ = 0;
    perf_frames_ = slow_lines_ = parallel_frames_ = 0;
    window_start_ = now_us;
  }
  er_perf_frame_begin();
  return summary;
}

void FrameStats::lap(Phase phase, std::int64_t now_us) {
  phase_sum_[phase] += static_cast<std::uint64_t>(std::max<std::int64_t>(now_us - mark_, 0));
  mark_ = now_us;
  const std::uint64_t thread_cpu = cpu_us(CLOCK_THREAD_CPUTIME_ID);
  thread_cpu_sum_[phase] += thread_cpu > thread_cpu_mark_ ? thread_cpu - thread_cpu_mark_ : 0;
  thread_cpu_mark_ = thread_cpu;
}

const char* FrameStats::end_frame(std::uint32_t slow_us) {
  er_perf_frame_end();
  ERPerfFrame f;
  if (!er_perf_get_last(&f)) return nullptr;
  for (int i = 0; i < ER_PERF_PHASE_COUNT; ++i) engine_sum_[i] += f.phase_us[i];
  for (int i = 0; i < ER_PERF_JS_COUNT; ++i) js_sub_sum_[i] += f.js_us[i];
  for (int i = 0; i < ER_PERF_RASTER_COUNT; ++i) raster_sub_sum_[i] += f.raster_us[i];
  dirty_px_sum_ += f.dirty_px;
  blit_px_sum_ += f.blit_px;
  ++perf_frames_;
  // Commits whose repaint the engine forked across render workers.
  const std::uint32_t forks = render_workers::forked_commits(), forked = forks - parallel_seen_;
  parallel_seen_ = forks;
  if (forked) ++parallel_frames_;
  if (f.frame_us <= slow_us || slow_lines_ >= slow_line_limit_) return nullptr;
  ++slow_lines_;
  // `other` is host work outside js/layout/raster/present: input polling, swap, the animation tick.
  std::snprintf(slow_line_, sizeof slow_line_,
                "slow frame: %u.%ums | js=%u.%u (dispatch=%u.%u react=%u.%u marshal=%u.%u) layout=%u.%u"
                " raster=%u.%u (prepass=%u.%u render=%u.%u blit=%u.%u sweep=%u.%u) present=%u.%u (upload=%u.%u draw=%u.%u)"
                " other=%u.%u"
                " | dirty=%dx%d@%d,%d %ukpx blit=%ukpx%s",
                MS(tenths(f.frame_us, 1000)), MS(tenths(f.phase_us[ER_PERF_PHASE_JS], 1000)),
                MS(tenths(f.js_us[ER_PERF_JS_DISPATCH], 1000)), MS(tenths(f.js_us[ER_PERF_JS_RECONCILE], 1000)),
                MS(tenths(f.js_us[ER_PERF_JS_MARSHAL], 1000)), MS(tenths(f.phase_us[ER_PERF_PHASE_LAYOUT], 1000)),
                MS(tenths(f.phase_us[ER_PERF_PHASE_RASTER], 1000)), MS(tenths(f.raster_us[ER_PERF_RASTER_PREPASS], 1000)),
                MS(tenths(f.raster_us[ER_PERF_RASTER_RENDER], 1000)), MS(tenths(f.raster_us[ER_PERF_RASTER_BLIT], 1000)),
                MS(tenths(f.raster_us[ER_PERF_RASTER_SWEEP], 1000)), MS(tenths(f.phase_us[ER_PERF_PHASE_PRESENT], 1000)),
                MS(tenths(upload_us_, 1000)), MS(tenths(draw_us_, 1000)),
                MS(tenths(f.other_us, 1000)),
                static_cast<int>(f.dirty_w), static_cast<int>(f.dirty_h), static_cast<int>(f.dirty_x),
                static_cast<int>(f.dirty_y), static_cast<unsigned>(f.dirty_px / 1000),
                static_cast<unsigned>(f.blit_px / 1000), forked ? " parallel" : "");
  return slow_line_;
}
