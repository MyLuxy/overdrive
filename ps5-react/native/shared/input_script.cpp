// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "input_script.hpp"

#include "actions.hpp"
#include "host_api.hpp"

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <iterator>
#include <string>
#include <string_view>

namespace {
constexpr std::uint32_t kRepeatMs = 110; // The desktop host's held-key repeat interval.
constexpr int kSwipeFrames = 16;         // A swipe's finger samples, one per frame.
constexpr std::size_t kL2 = 10, kR2 = 11;
static_assert(std::size(kButtonNames) == 16 && std::string_view(kButtonNames[kL2]) == "l2" &&
              std::string_view(kButtonNames[kR2]) == "r2");

struct PadStep { std::size_t button; float value; long ms; };

// "hold:BUTTON[:MS]", "release:BUTTON", "trigger:l2|r2:VALUE[:MS]".
bool parse_pad_step(const std::string& step, PadStep& out, char* error, std::size_t size) {
  std::vector<std::string> parts;
  for (std::size_t start = 0;;) {
    const std::size_t colon = std::min(step.find(':', start), step.size());
    parts.push_back(step.substr(start, colon - start));
    if (colon == step.size()) break;
    start = colon + 1;
  }
  const std::size_t count = parts.size();
  const std::string& verb = parts[0];
  const bool trigger = verb == "trigger";
  const std::size_t most = trigger ? 4 : verb == "hold" ? 3 : 2;
  const auto fail = [&](const char* reason) {
    std::snprintf(error, size, "bad %s '%s' (%s)", verb.c_str(), step.c_str(), reason);
    return false;
  };
  if (count < 2 || count > most || (trigger && count < 3))
    return fail(trigger ? "trigger:l2|r2:VALUE[:MS]" : verb == "hold" ? "hold:BUTTON[:MS]" : "release:BUTTON");
  out = {std::size(kButtonNames), 1, 0};
  for (std::size_t i = 0; i < std::size(kButtonNames); ++i)
    if (parts[1] == kButtonNames[i]) out.button = i;
  if (out.button == std::size(kButtonNames) || (trigger && out.button != kL2 && out.button != kR2))
    return fail(trigger ? "l2 or r2" : "a button: up, down, left, right, cross, circle, triangle, square, "
                                       "l1, r1, l2, r2, l3, r3, options, touchpad");
  char* rest = nullptr;
  if (trigger) {
    out.value = std::strtof(parts[2].c_str(), &rest);
    if (parts[2].empty() || *rest || !(out.value >= 0 && out.value <= 1)) return fail("VALUE 0..1");
  }
  if (verb == "release") out.value = 0;
  if (const std::size_t at = trigger ? 3 : 2; count > at) {
    const std::string& ms = parts[at];
    out.ms = std::strtol(ms.c_str(), &rest, 10);
    if (ms.empty() || *rest || out.ms < 1) return fail("MS a positive number of milliseconds");
  }
  return true;
}
} // namespace

bool InputScript::parse(const char* text, char* error, std::size_t size) {
  steps_.clear();
  index_ = 0;
  resume_ = 0;
  const std::string script(text);
  for (std::size_t start = 0; start < script.size();) {
    const std::size_t end = std::min(script.find_first_of(", \t\r\n", start), script.size());
    std::string token = script.substr(start, end - start);
    start = end + 1;
    if (token.empty()) continue;
    char* rest = nullptr;
    if (token.rfind("wait:", 0) == 0) {
      const long ms = std::strtol(token.c_str() + 5, &rest, 10);
      if (rest == token.c_str() + 5 || *rest || ms < 0) {
        std::snprintf(error, size, "bad wait '%s'", token.c_str());
        return false;
      }
      steps_.push_back({"", static_cast<std::uint32_t>(ms)});
      continue;
    }
    if (VirtualPad::is_step(token)) {
      if (!VirtualPad::check(token, error, size)) return false;
      steps_.push_back({token, 0});
      continue;
    }
    if (token.rfind("shot:", 0) == 0) {
      const std::string name = token.substr(5);
      if (name.empty() || name.size() > 32 || name.find_first_not_of(
            "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-") != std::string::npos) {
        std::snprintf(error, size, "bad shot '%s' (shot:NAME, 1-32 letters, digits, _ or -)", token.c_str());
        return false;
      }
      steps_.push_back({token, 0});
      continue;
    }
    if (token.rfind("swipe:", 0) == 0) {
      // swipe:DIRECTION:TRAVEL: a finger sliding TRAVEL (0..1 of the pad) from its middle, then lifting.
      const std::size_t colon = token.find(':', 6);
      const std::string direction = token.substr(6, colon == std::string::npos ? std::string::npos : colon - 6);
      const double travel = colon == std::string::npos ? -1 : std::strtod(token.c_str() + colon + 1, &rest);
      const double dx = direction == "right" ? 1 : direction == "left" ? -1 : 0;
      const double dy = direction == "down" ? 1 : direction == "up" ? -1 : 0;
      if ((!dx && !dy) || travel <= 0 || travel > 0.5 || *rest) {
        std::snprintf(error, size, "bad swipe '%s' (swipe:left|right|up|down:TRAVEL, TRAVEL 0..0.5 of the pad)", token.c_str());
        return false;
      }
      for (int frame = 0; frame <= kSwipeFrames; ++frame) {
        const double at = travel * frame / kSwipeFrames;
        char sample[48];
        std::snprintf(sample, sizeof sample, "touch:%.4f,%.4f", 0.5 + dx * at, 0.5 + dy * at);
        steps_.push_back({sample, 0});
      }
      steps_.push_back({"touch:up", 0});
      continue;
    }
    long count = 1;
    if (const std::size_t star = token.find('*'); star != std::string::npos) {
      count = std::strtol(token.c_str() + star + 1, &rest, 10);
      if (rest == token.c_str() + star + 1 || *rest || count < 1) {
        std::snprintf(error, size, "bad repeat in '%s'", token.c_str());
        return false;
      }
      token.resize(star);
    }
    const char* action = token == "quit" ? "quit" : nullptr;
    for (const char* known : kActionNames)
      if (token == known) action = known;
    if (!action) {
      std::string known;
      for (const char* name : kActionNames) known += std::string(name) + ", ";
      std::snprintf(error, size, "unknown action '%s' (use %squit, wait:MS, shot:NAME, swipe:DIRECTION:TRAVEL, hold:, release:, trigger:)",
                    token.c_str(), known.c_str());
      return false;
    }
    for (long i = 0; i < count; ++i) {
      if (i) steps_.push_back({"", kRepeatMs});
      steps_.push_back({action, 0});
    }
  }
  return true;
}

const char* InputScript::next(std::uint64_t now_ms) {
  while (index_ < steps_.size() && now_ms >= resume_) {
    const Step& step = steps_[index_++];
    if (step.action.empty()) {
      resume_ = now_ms + step.wait_ms;
      continue;
    }
    resume_ = now_ms + 1; // One action per frame.
    return step.action.c_str();
  }
  return nullptr;
}

bool VirtualPad::is_step(const std::string& step) {
  return step.starts_with("hold:") || step.starts_with("release:") || step.starts_with("trigger:");
}

bool VirtualPad::check(const std::string& step, char* error, std::size_t size) {
  PadStep parsed;
  return parse_pad_step(step, parsed, error, size);
}

bool VirtualPad::apply(const std::string& step, std::uint64_t now_ms, char* error, std::size_t size) {
  PadStep parsed;
  if (!parse_pad_step(step, parsed, error, size)) return false;
  holds_[parsed.button] = {parsed.value, parsed.ms ? now_ms + static_cast<std::uint64_t>(parsed.ms) : 0};
  return true;
}

std::uint32_t VirtualPad::merge(GamepadState& state, std::uint64_t now_ms) {
  std::uint32_t down = 0;
  for (std::size_t i = 0; i < std::size(holds_); ++i) {
    Hold& hold = holds_[i];
    if (hold.until && now_ms >= hold.until) hold = {};
    if (hold.value <= 0) continue;
    if (i == kL2) state.l2 = std::max(state.l2, hold.value);
    if (i == kR2) state.r2 = std::max(state.r2, hold.value);
    if ((i != kL2 && i != kR2) || hold.value > 0.5f) down |= 1u << i;
  }
  state.buttons |= down;
  const std::uint32_t pressed = down & ~down_;
  down_ = down;
  return pressed;
}

const char* VirtualPad::action(std::size_t index) {
  // Indexed like kButtonNames; nullptr for buttons without an action.
  constexpr const char* kActions[] = {
    "up", "down", "left", "right", "confirm", "back", "triangle", "square", "l1", "r1", "l2", "r2",
    nullptr, nullptr, "options", nullptr,
  };
  static_assert(std::size(kActions) == std::size(kButtonNames));
  return index < std::size(kActions) ? kActions[index] : nullptr;
}
