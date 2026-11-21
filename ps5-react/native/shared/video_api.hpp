// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// The players behind <Video> (ABI v10 `video.*`), for the hosts and the presenter.
#pragma once

#include "gl_video.hpp"
#include "video_frame.hpp"

#include <cstdint>
#include <string>

namespace video_layers {
// A video the presenter draws for a layer whose image is a player's placeholder.
struct Layer {
  std::uint64_t id = 0;
  const video::Frame* frame = nullptr; // null until the first frame
  GlVideo::Fit fit = GlVideo::Fit::contain;
  int upscale = upscalers::kNone; // upscalers::find
  GlVideo::Compare compare;
};
bool find(const char* image_name, Layer& layer);
// For screenshots: the colour the presenter draws at framebuffer pixel (x, y) of a video layer, as the
// GPU computes it, nearest sample. False when the layer is not a video's.
bool sample(const char* image_name, int dst_x, int dst_y, int dst_w, int dst_h, int x, int y, unsigned rgb[3]);

// Hosts call this once per frame before presenting, with the time and the display's frame interval.
void update(std::int64_t now_us, std::int64_t frame_us);
// Closes every player; before the sound output stops.
void stop();
// One line per open player for the host's log ("" without players): state, position, decoder, frames.
std::string summary();
} // namespace video_layers
