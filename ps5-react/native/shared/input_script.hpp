// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

struct GamepadState;

// Scripted controller actions for unattended profiling, e.g. "wait:3000,right*3,confirm,quit".
// Steps are separated by commas or whitespace. An action takes one frame; `action*N` repeats it at
// the held-key repeat interval; `wait:MS` pauses for wall-clock milliseconds; `quit` asks the host
// to close; `shot:NAME` asks it to save the frame on screen as NAME.bmp; `swipe:DIRECTION:TRAVEL`
// slides a touchpad finger TRAVEL (0..0.5 of the pad) from its middle, one `touch:X,Y` sample per
// frame, then `touch:up`, which the host passes on as touchpad input. VirtualPad's steps hold
// buttons and triggers. The desktop reads PS5_REACT_INPUT_SCRIPT, the PS5 /app0/dev/input-script.txt.
class InputScript {
public:
  // Replaces the script. On a bad step returns false and describes it in `error`.
  bool parse(const char* text, char* error, std::size_t size);
  // The action due at `now_ms` (a monotonic clock), at most one per call, or nullptr. Valid until the
  // next parse().
  const char* next(std::uint64_t now_ms);
  // Whether every step has run.
  bool done() const { return index_ >= steps_.size(); }

private:
  struct Step { std::string action; std::uint32_t wait_ms; }; // empty action: a wait
  std::vector<Step> steps_;
  std::size_t index_ = 0;
  std::uint64_t resume_ = 0;
};

// Buttons and trigger travel a tool holds on top of the controller's, as script steps (the desktop
// control channel's `hold`, `release` and `trigger` take the same with spaces):
//   hold:BUTTON[:MS]          a GamepadState button (kButtonNames), for MS milliseconds or until released
//   release:BUTTON            ends a hold
//   trigger:l2|r2:VALUE[:MS]  L2 or R2 at VALUE (0..1) of the travel, held like the above; 0 lets go
// A step replaces the button's or trigger's previous one, and returns at once: follow it with wait:MS.
// Held L2 is full travel. A trigger counts as pressed past half travel, as the controller's does.
class VirtualPad {
public:
  // Whether `step` is a VirtualPad step, and whether it is valid (false describes it in `error`).
  static bool is_step(const std::string& step);
  static bool check(const std::string& step, char* error, std::size_t size);
  // Applies a step at `now_ms` (the clock merge() is given); false and `error` when it is not valid.
  bool apply(const std::string& step, std::uint64_t now_ms, char* error, std::size_t size);
  // Adds what is held at `now_ms` to `state`; returns the buttons that went down since the last call
  // (bit i: kButtonNames[i]), for the host to dispatch their actions.
  std::uint32_t merge(GamepadState& state, std::uint64_t now_ms);
  // The action a press of kButtonNames[index] dispatches, or nullptr: none for L3, R3 and the touchpad.
  static const char* action(std::size_t index);

private:
  struct Hold { float value = 0; std::uint64_t until = 0; }; // until 0: until changed
  Hold holds_[16];
  std::uint32_t down_ = 0;
};
