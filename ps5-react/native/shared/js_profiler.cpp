// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "js_profiler.hpp"

#include <algorithm>
#include <cstdio>

namespace {
// Deeper stacks keep their innermost frames; React's render recursion stays well under this.
constexpr int kMaxFrames = 192;
} // namespace

void JsProfiler::start(JSRuntime* runtime, std::int64_t interval_us) {
  runtime_ = runtime;
  interval_us_ = std::max<std::int64_t>(interval_us, 100);
  last_us_ = clock_();
  frames_.reserve(kMaxFrames);
  JS_SetInterruptHandler(runtime, interrupt, this);
}

void JsProfiler::stop() {
  if (runtime_) JS_SetInterruptHandler(runtime_, nullptr, nullptr);
  runtime_ = nullptr;
}

int JsProfiler::interrupt(JSRuntime*, void* opaque) {
  auto* self = static_cast<JsProfiler*>(opaque);
  const std::int64_t now = self->clock_();
  if (now - self->last_us_ >= self->interval_us_) self->sample(now);
  return 0;
}

void JsProfiler::visit(void* opaque, const char* name, int line) {
  auto* self = static_cast<JsProfiler*>(opaque);
  std::string frame = *name ? name : "(anonymous)";
  if (line >= 0) frame += "@" + std::to_string(line);
  self->frames_.push_back(std::move(frame));
}

void JsProfiler::sample(std::int64_t now_us) {
  const std::int64_t charged = std::min(now_us - last_us_, 2 * interval_us_);
  last_us_ = now_us;
  frames_.clear();
  JS_SampleStack(runtime_, visit, this, kMaxFrames);
  if (frames_.empty()) return;
  key_.clear();
  for (auto frame = frames_.rbegin(); frame != frames_.rend(); ++frame) {
    if (!key_.empty()) key_ += ';';
    key_ += *frame;
  }
  stacks_[key_] += static_cast<std::uint64_t>(charged);
  ++samples_;
}

bool JsProfiler::write(const char* path) const {
  FILE* file = std::fopen(path, "wb");
  if (!file) return false;
  for (const auto& [stack, us] : stacks_) std::fprintf(file, "%s %llu\n", stack.c_str(), static_cast<unsigned long long>(us));
  return std::fclose(file) == 0;
}
