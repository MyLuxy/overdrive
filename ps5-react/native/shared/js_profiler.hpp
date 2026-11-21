// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstdint>
#include <string>
#include <unordered_map>
#include <vector>

extern "C" {
#include "quickjs.h"
}

// A sampling profiler for JavaScript, off unless started. QuickJS calls its interrupt handler every
// few thousand operations; about once per interval the profiler records the running stack
// (JS_SampleStack, patches/quickjs-sample-stack.patch) and charges it the time since the previous
// sample, at most two intervals, so time outside JavaScript is not counted. Time inside a native
// call shows up in the first sample after it returns, so bridge and engine calls are undercounted.
// write() saves folded stacks: one line per stack, outermost frame first, frames as name@line
// (the line where the function's definition starts; native functions have no line), then the
// microseconds charged to it. Flame-graph tools read the format.
class JsProfiler {
public:
  explicit JsProfiler(std::int64_t (*clock)()) : clock_(clock) {}
  void start(JSRuntime* runtime, std::int64_t interval_us);
  void stop();
  bool running() const { return runtime_ != nullptr; }
  bool write(const char* path) const;
  std::uint64_t samples() const { return samples_; }

private:
  static int interrupt(JSRuntime* runtime, void* opaque);
  static void visit(void* opaque, const char* name, int line);
  void sample(std::int64_t now_us);

  std::int64_t (*clock_)();
  JSRuntime* runtime_ = nullptr;
  std::int64_t interval_us_ = 1000, last_us_ = 0;
  std::uint64_t samples_ = 0;
  std::vector<std::string> frames_;
  std::string key_;
  std::unordered_map<std::string, std::uint64_t> stacks_;
};
