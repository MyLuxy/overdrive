// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Text subtitles for video_player: cues from a stream of the video (SubRip, ASS/SSA, mov_text, WebVTT)
// or from a separate file, as plain text with line breaks. Bitmap subtitles (PGS, DVD) are not read.
#pragma once

#include <cstdint>
#include <string>
#include <vector>

struct AVCodecContext;
struct AVCodecParameters;
struct AVPacket;

namespace video {

struct Cue {
  std::int64_t start_us = 0, end_us = 0; // media time
  std::string text;
};

// Whether a stream with these parameters holds text this module reads.
bool is_text_subtitle(const AVCodecParameters* parameters);

class SubtitleDecoder {
public:
  SubtitleDecoder(const AVCodecParameters* parameters, int time_base_num, int time_base_den);
  ~SubtitleDecoder();
  SubtitleDecoder(const SubtitleDecoder&) = delete;
  SubtitleDecoder& operator=(const SubtitleDecoder&) = delete;
  bool ok() const { return context_ != nullptr; }
  // Adds the cues of one packet; `start_us` is the container's first timestamp, subtracted.
  void decode(AVPacket* packet, std::int64_t start_us, std::vector<Cue>& out);

private:
  AVCodecContext* context_ = nullptr;
  int time_base_num_ = 1, time_base_den_ = 1;
};

// Reads every cue of the first text subtitle stream in `url` (a path or http(s) URL); false with `error`.
bool load_subtitle_file(const std::string& url, const std::vector<std::string>& headers, std::vector<Cue>& cues,
                        std::string& error);

// The text of the cues showing at `at_us`, joined by line breaks; "" for none. `cues` is sorted by start.
std::string cue_text(const std::vector<Cue>& cues, std::int64_t at_us);

} // namespace video
