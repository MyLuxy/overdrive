// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstddef>
#include <cstdint>

extern "C" {
#include "quickjs.h"
}

// The bridge's default JS-heap allocator, counting the bytes it holds. Pass it as
// ErRuntimeConfig.malloc_functions; everything else runs on the render thread.
const JSMallocFunctions* js_heap_functions();

// ErRuntimeConfig.memory_limit on both hosts. 64 MiB of the title's 256 MiB heap: a store's catalog and
// a long download's state stay under 25 MiB live, and the rest leaves a collection room to run.
constexpr std::size_t kJsMemoryLimit = 64 * 1024 * 1024;

// QuickJS collects cycles when its heap grows past a threshold, in whichever
// allocation crosses it: a full mark-and-sweep of every live object (tens of
// milliseconds on the PS5 for a store's catalog) inside the frame that handles a
// key press. This collects in idle frames instead (half a second after the last
// input), once a third of the room before that threshold is garbage, so a burst
// of input starts with at least two thirds of it. The room is at least 8 MiB (more
// than QuickJS's 1.5 times what survived while that is under 16 MiB), so a burst of
// key presses does not reach the threshold before an idle frame comes.
// It also keeps the threshold an eighth of kJsMemoryLimit below the limit: QuickJS
// sets it to 1.5 times what survived a collection, and an allocation past the limit
// fails without collecting first, so with over 21 MiB live the garbage of a burst
// of input ran into the limit ("out of memory") before any collection.
class GcScheduler {
public:
  // `clock` is the host's monotonic microsecond clock, to time collections.
  explicit GcScheduler(std::int64_t (*clock)()) : clock_(clock) {}
  // Call when the host dispatches an input action.
  void input(std::int64_t now_us) { last_input_us_ = now_us; }
  // With `still` set, an idle collection also waits for kStillFrames frames in a row that repainted
  // under a fiftieth of the screen, so it does not land in a page slide that outlasts kIdleUs, until
  // three quarters of the room is garbage.
  void wait_for_still(bool still) { wait_for_still_ = still; }
  // Call once per frame, after it is presented, with the pixels the frame repainted and the screen's.
  // Returns a log line when a collection ran during the frame or here, otherwise nullptr.
  const char* frame(JSRuntime* runtime, std::int64_t now_us, std::size_t repainted_px, std::size_t screen_px);

private:
  std::int64_t (*clock_)();
  std::int64_t last_input_us_ = 0;
  bool wait_for_still_ = true;
  int still_frames_ = 0;
  std::size_t threshold_ = 0, live_after_gc_ = 0;
  char line_[160] = {};
};
