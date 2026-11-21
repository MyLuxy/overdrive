// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstddef>

// Input actions (input protocol v5, see runtime/js/input.js): what hosts pass to
// globalThis.__ps5ReactDispatch and input scripts accept. runtime/js/input.js names the same actions
// for JavaScript. Options reaches the app as `options`; the PS button leaves.
enum class HostAction : unsigned char { up, down, left, right, confirm, back, l1, r1, l2, r2, triangle, square, options };

inline constexpr const char* kActionNames[] = {
  "up", "down", "left", "right", "confirm", "back", "l1", "r1", "l2", "r2", "triangle", "square", "options",
};

constexpr const char* action_name(HostAction action) { return kActionNames[static_cast<std::size_t>(action)]; }

// Directions repeat while held; the other buttons act once per press.
constexpr bool repeats(HostAction action) { return action <= HostAction::right; }
