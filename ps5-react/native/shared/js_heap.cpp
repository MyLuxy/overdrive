// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "js_heap.hpp"

#include <algorithm>
#include <cstdio>

extern "C" {
#include "er_js_alloc.h"
}

namespace {
const JSMallocFunctions* inner = nullptr;
std::size_t live = 0;

void* counted(void* ptr) {
  if (ptr) live += inner->js_malloc_usable_size(ptr);
  return ptr;
}

void* js_calloc(void* opaque, std::size_t count, std::size_t size) { return counted(inner->js_calloc(opaque, count, size)); }
void* js_malloc(void* opaque, std::size_t size) { return counted(inner->js_malloc(opaque, size)); }

void js_free(void* opaque, void* ptr) {
  if (ptr) live -= inner->js_malloc_usable_size(ptr);
  inner->js_free(opaque, ptr);
}

void* js_realloc(void* opaque, void* ptr, std::size_t size) {
  const std::size_t before = ptr ? inner->js_malloc_usable_size(ptr) : 0;
  void* moved = inner->js_realloc(opaque, ptr, size);
  // A failed realloc leaves the block as it was; a zero size frees it.
  if (moved || size == 0) live = live - before + (moved ? inner->js_malloc_usable_size(moved) : 0);
  return moved;
}

std::size_t usable_size(const void* ptr) { return inner->js_malloc_usable_size(ptr); }

JSMallocFunctions functions = {js_calloc, js_malloc, js_free, js_realloc, usable_size};

// No idle collection right after input: the focus scroll it started is still moving.
constexpr std::int64_t kIdleUs = 500000;
// Below this much garbage a collection is not worth a frame.
constexpr std::size_t kMinGarbage = 512 * 1024;
// Still frames before an idle collection (GcScheduler::wait_for_still). A focus ring's sweep repaints
// its edges every frame and stays under the bound.
constexpr int kStillFrames = 3;
// The room after a collection: QuickJS's 1.5 times what survived, but at least this much, so a burst of
// input (React allocates on every key) does not reach the threshold before an idle frame comes.
constexpr std::size_t kMinRoom = 8 * 1024 * 1024;

constexpr std::size_t kCeiling = kJsMemoryLimit - kJsMemoryLimit / 8;

double mib(std::size_t bytes) { return bytes / (1024.0 * 1024.0); }
} // namespace

const JSMallocFunctions* js_heap_functions() {
  inner = er_js_default_malloc_functions();
  return &functions;
}

const char* GcScheduler::frame(JSRuntime* runtime, std::int64_t now_us, std::size_t repainted_px,
                               std::size_t screen_px) {
  still_frames_ = repainted_px * 50 < screen_px ? still_frames_ + 1 : 0;
  const std::size_t threshold = JS_GetGCThreshold(runtime);
  if (threshold != threshold_) {
    // QuickJS collected while the frame ran and moved its threshold to 1.5 times what survived.
    const bool first = threshold_ == 0;
    threshold_ = std::min(std::max(threshold, live + kMinRoom), kCeiling);
    if (threshold_ != threshold) JS_SetGCThreshold(runtime, threshold_);
    live_after_gc_ = live;
    if (first) return nullptr;
    std::snprintf(line_, sizeof line_, "gc: automatic, %.1f MiB live, next at %.1f MiB", mib(live), mib(threshold_));
    return line_;
  }
  const std::size_t room = threshold > live_after_gc_ ? threshold - live_after_gc_ : 0;
  const std::size_t garbage = live > live_after_gc_ ? live - live_after_gc_ : 0;
  if (now_us - last_input_us_ < kIdleUs || garbage < kMinGarbage || garbage < room / 3) return nullptr;
  // Waiting for a still screen stops once three quarters of the room is garbage: QuickJS would soon
  // collect inside an allocation anyway, likely in the frame that handles the next key.
  if (wait_for_still_ && still_frames_ < kStillFrames && garbage < room / 4 * 3) return nullptr;
  const std::size_t before = live;
  const std::int64_t start = clock_();
  JS_RunGC(runtime);
  live_after_gc_ = live;
  // QuickJS's own rule after a collection, with the room's floor.
  threshold_ = std::min(live + std::max(live / 2, kMinRoom), kCeiling);
  JS_SetGCThreshold(runtime, threshold_);
  std::snprintf(line_, sizeof line_, "gc: idle, %.1f ms, %.1f -> %.1f MiB live", (clock_() - start) / 1000.0,
                mib(before), mib(live));
  return line_;
}
