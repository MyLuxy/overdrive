// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

namespace video_output {
// Visible lines of the console's current HDMI output (720, 1080, 1440 or 2160), or 0 when the mode
// cannot be read or is not one of those. Logs the raw mode codes.
int output_lines();
}
