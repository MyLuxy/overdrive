// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "video_frame.hpp"
#include <cstdint>

// The preview decodes with FFmpeg; it is a correctness host, not a performance one.
void video::preload_platform_decoder() {}
std::int64_t video::software_pixel_limit() { return INT64_MAX; }
std::unique_ptr<video::Decoder> video::make_platform_decoder(const AVCodecParameters*, int, int) { return nullptr; }
