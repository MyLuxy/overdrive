// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

// Saves the software framebuffer (the frame on screen until the next commit) as a 24-bit BMP, each
// pixel the average of a `step`×`step` block: 2 gives the logical size (the framebuffer is rendered at
// twice it), 1 the full framebuffer. A test-deploy tool: it writes on the calling thread.
bool save_screenshot(const char* path, int step = 2);
