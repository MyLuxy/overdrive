// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstdint>

namespace hui::ps5 {
class Pad;
}

// The pad that host::set_light_bar/reset_light_bar/vibrate drive. The host sets
// it after Pad::open() and clears it (nullptr) before Pad::close().
void host_platform_set_pad(hui::ps5::Pad* pad);
// The touchpad's first finger, 0..1 across the pad in x and y, read once per frame; false when
// nothing touches it. Beside Pad::read, which drains the sample queue and keeps buttons and sticks.
bool host_platform_read_touch(float* x, float* y);
// Once per frame: ticks the system power timer every 30 s while host::keep_awake is on.
void host_platform_tick(std::int64_t now_us);
// Resolve optional native API modules before a helper changes the process root.
void host_platform_prepare_filesystem_access();
