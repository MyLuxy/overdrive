// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "video_subtitles.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
}

#include <algorithm>

namespace video {

namespace {
constexpr AVRational kMicroseconds = {1, 1000000};
// A cue without an end shows this long, or until the next one starts.
constexpr std::int64_t kOpenEndedUs = 5'000'000;

// The Text field of an ASS Dialogue event ("ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text"),
// without override blocks, with its line breaks as newlines.
std::string ass_text(const char* line) {
  const char* text = line;
  for (int commas = 0; *text && commas < 8; ++text)
    if (*text == ',') ++commas;
  std::string out;
  for (const char* p = text; *p; ++p) {
    if (*p == '{') {
      while (*p && *p != '}') ++p;
      if (!*p) break;
    } else if (*p == '\\' && (p[1] == 'N' || p[1] == 'n')) {
      out += '\n';
      ++p;
    } else if (*p == '\\' && p[1] == 'h') {
      out += ' ';
      ++p;
    } else {
      out += *p;
    }
  }
  // Trailing line breaks and spaces carry nothing.
  while (!out.empty() && (out.back() == '\n' || out.back() == ' ' || out.back() == '\r')) out.pop_back();
  return out;
}

void insert_sorted(std::vector<Cue>& cues, Cue cue) {
  const auto at = std::upper_bound(cues.begin(), cues.end(), cue.start_us,
                                   [](std::int64_t t, const Cue& c) { return t < c.start_us; });
  cues.insert(at, std::move(cue));
}
} // namespace

bool is_text_subtitle(const AVCodecParameters* p) {
  if (!p || p->codec_type != AVMEDIA_TYPE_SUBTITLE) return false;
  const AVCodecDescriptor* descriptor = avcodec_descriptor_get(p->codec_id);
  return descriptor && (descriptor->props & AV_CODEC_PROP_TEXT_SUB) && avcodec_find_decoder(p->codec_id);
}

SubtitleDecoder::SubtitleDecoder(const AVCodecParameters* parameters, int time_base_num, int time_base_den)
    : time_base_num_(time_base_num), time_base_den_(time_base_den) {
  const AVCodec* codec = avcodec_find_decoder(parameters->codec_id);
  if (!codec || !(context_ = avcodec_alloc_context3(codec))) return;
  avcodec_parameters_to_context(context_, parameters);
  context_->pkt_timebase = {time_base_num, time_base_den};
  if (avcodec_open2(context_, codec, nullptr) < 0) avcodec_free_context(&context_);
}

SubtitleDecoder::~SubtitleDecoder() { avcodec_free_context(&context_); }

void SubtitleDecoder::decode(AVPacket* packet, std::int64_t start_us, std::vector<Cue>& out) {
  if (!context_ || !packet) return;
  AVSubtitle subtitle{};
  int got = 0;
  if (avcodec_decode_subtitle2(context_, &subtitle, &got, packet) < 0 || !got) return;
  const AVRational base = {time_base_num_, time_base_den_};
  const std::int64_t pts = packet->pts != AV_NOPTS_VALUE ? av_rescale_q(packet->pts, base, kMicroseconds) - start_us
                         : subtitle.pts != AV_NOPTS_VALUE ? subtitle.pts - start_us : 0;
  Cue cue;
  cue.start_us = pts + subtitle.start_display_time * 1000;
  if (subtitle.end_display_time && subtitle.end_display_time != UINT32_MAX)
    cue.end_us = pts + static_cast<std::int64_t>(subtitle.end_display_time) * 1000;
  else if (packet->duration > 0)
    cue.end_us = pts + av_rescale_q(packet->duration, base, kMicroseconds);
  else
    cue.end_us = cue.start_us + kOpenEndedUs;
  for (unsigned i = 0; i < subtitle.num_rects; ++i) {
    const AVSubtitleRect* rect = subtitle.rects[i];
    const std::string text = rect->type == SUBTITLE_ASS && rect->ass ? ass_text(rect->ass)
                           : rect->type == SUBTITLE_TEXT && rect->text ? rect->text : "";
    if (text.empty()) continue;
    if (!cue.text.empty()) cue.text += '\n';
    cue.text += text;
  }
  avsubtitle_free(&subtitle);
  if (!cue.text.empty() && cue.end_us > cue.start_us) insert_sorted(out, std::move(cue));
}

bool load_subtitle_file(const std::string& url, const std::vector<std::string>& headers, std::vector<Cue>& cues,
                        std::string& error) {
  AVFormatContext* format = nullptr;
  AVDictionary* settings = nullptr;
  std::string joined;
  for (const std::string& header : headers) joined += header + "\r\n";
  if (!joined.empty()) av_dict_set(&settings, "headers", joined.c_str(), 0);
  av_dict_set(&settings, "rw_timeout", "15000000", 0);
  int result = avformat_open_input(&format, url.c_str(), nullptr, &settings);
  av_dict_free(&settings);
  if (result >= 0) result = avformat_find_stream_info(format, nullptr);
  int index = -1;
  for (unsigned i = 0; result >= 0 && i < format->nb_streams; ++i)
    if (is_text_subtitle(format->streams[i]->codecpar)) {
      index = static_cast<int>(i);
      break;
    }
  if (result < 0 || index < 0) {
    char text[AV_ERROR_MAX_STRING_SIZE] = {};
    if (result < 0) av_strerror(result, text, sizeof text);
    error = "video.addSubtitle " + url + ": " + (result < 0 ? text : "no text subtitles in it");
    avformat_close_input(&format);
    return false;
  }
  const AVStream* stream = format->streams[index];
  SubtitleDecoder decoder(stream->codecpar, stream->time_base.num, stream->time_base.den);
  AVPacket* packet = av_packet_alloc();
  const std::int64_t start_us = format->start_time != AV_NOPTS_VALUE ? format->start_time : 0;
  while (decoder.ok() && av_read_frame(format, packet) >= 0) {
    if (packet->stream_index == index) decoder.decode(packet, start_us, cues);
    av_packet_unref(packet);
  }
  av_packet_free(&packet);
  avformat_close_input(&format);
  if (!decoder.ok()) error = "video.addSubtitle " + url + ": no decoder for its subtitles";
  return decoder.ok();
}

std::string cue_text(const std::vector<Cue>& cues, std::int64_t at_us) {
  std::string out;
  // Cues starting after `at_us` cannot show; earlier ones are checked back to the longest a cue lasts.
  auto end = std::upper_bound(cues.begin(), cues.end(), at_us, [](std::int64_t t, const Cue& c) { return t < c.start_us; });
  for (auto it = cues.begin(); it != end; ++it) {
    if (it->end_us <= at_us) continue;
    if (!out.empty()) out += '\n';
    out += it->text;
  }
  return out;
}

} // namespace video
