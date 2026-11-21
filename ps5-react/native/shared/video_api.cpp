// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "app_config.hpp"
#include "video_api.hpp"

#if PS5_REACT_VIDEO
#include "video_audio.hpp"
#include "video_player.hpp"

extern "C" {
#include "er_scene.h"
}

#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {
struct Entry {
  std::uint32_t id = 0;
  std::unique_ptr<video::Player> player;
  std::string name; // the placeholder image the <Video> element draws, and the presenter replaces
  GlVideo::Fit fit = GlVideo::Fit::contain;
  int upscale = upscalers::kNone;
  GlVideo::Compare compare;
  bool audio = true;
};

// Oldest first: the newest player with audio owns the mixer's video slot.
std::vector<Entry> players;
std::uint32_t next_id = 1;
std::vector<std::string> unload_names;
std::vector<std::pair<std::shared_ptr<void>, std::int64_t>> kept_rings;
std::int64_t last_now_us = 0;

// Every placeholder is the same opaque black tile: an <Image layer> qualifies only with opaque pixels.
constexpr int kTile = 16;
std::uint32_t tile[kTile * kTile];

Entry* find(std::uint32_t id) {
  for (Entry& entry : players)
    if (entry.id == id) return &entry;
  return nullptr;
}

void assign_audio() {
  Entry* owner = nullptr;
  for (Entry& entry : players)
    if (entry.audio) owner = &entry;
  for (Entry& entry : players) entry.player->set_audio_output(&entry == owner);
}

// Joining a player's threads can take a decode's length; it is done off the render thread.
void dispose(Entry& entry) {
  for (auto& ring : entry.player->detach_audio()) kept_rings.emplace_back(std::move(ring), last_now_us + 300'000);
  unload_names.push_back(entry.name);
  std::thread([player = std::move(entry.player)]() mutable { player.reset(); }).detach();
}

bool get_bool(JSContext* ctx, JSValueConst object, const char* key, bool fallback) {
  JSValue value = JS_GetPropertyStr(ctx, object, key);
  const bool result = JS_IsUndefined(value) ? fallback : JS_ToBool(ctx, value) > 0;
  JS_FreeValue(ctx, value);
  return result;
}

double get_number(JSContext* ctx, JSValueConst object, const char* key, double fallback) {
  JSValue value = JS_GetPropertyStr(ctx, object, key);
  double result = fallback;
  if (JS_IsNumber(value)) JS_ToFloat64(ctx, &result, value);
  JS_FreeValue(ctx, value);
  return std::isfinite(result) ? result : fallback;
}

// 'pcm', 'auto' or 'passthrough'; false for anything else.
bool audio_output_mode(JSContext* ctx, JSValueConst value, video::AudioOutput& mode) {
  const char* name = JS_ToCString(ctx, value);
  if (!name) return false;
  const bool known = !std::strcmp(name, "pcm") || !std::strcmp(name, "auto") || !std::strcmp(name, "passthrough");
  mode = !std::strcmp(name, "auto") ? video::AudioOutput::automatic
       : !std::strcmp(name, "passthrough") ? video::AudioOutput::passthrough : video::AudioOutput::pcm;
  JS_FreeCString(ctx, name);
  return known;
}

Entry* entry_arg(JSContext* ctx, JSValueConst value, const char* call) {
  std::uint32_t id = 0;
  if (JS_ToUint32(ctx, &id, value)) return nullptr;
  Entry* entry = find(id);
  if (!entry) JS_ThrowRangeError(ctx, "%s: no open video %u", call, id);
  return entry;
}

JSValue open(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  const char* url = argc ? JS_ToCString(ctx, argv[0]) : nullptr;
  if (!url) return JS_ThrowTypeError(ctx, "video.open: expected a URL or path");
  std::string source = url;
  JS_FreeCString(ctx, url);
  if (source.empty()) return JS_ThrowTypeError(ctx, "video.open: expected a URL or path");
  if (!PS5_REACT_NETWORKING && source.find("://") != std::string::npos)
    return JS_ThrowPlainError(ctx, "video.open %s: streaming needs \"networking\": true in app.json", source.c_str());
  // App paths (/app0, /download0, ...) map to real paths as the filesystem does; URLs pass through.
  if (source.find("://") == std::string::npos) {
    char path[1024];
    if (!host::resolve_path(source.c_str(), path, sizeof path))
      return JS_ThrowPlainError(ctx, "video.open %s: not an app path or URL", source.c_str());
    source = path;
  }
  video::Options options;
  JSValueConst settings = argc > 1 ? argv[1] : JS_UNDEFINED;
  if (JS_IsObject(settings)) {
    options.paused = get_bool(ctx, settings, "paused", false);
    options.muted = get_bool(ctx, settings, "muted", false);
    options.loop = get_bool(ctx, settings, "loop", false);
    options.audio = get_bool(ctx, settings, "audio", true);
    options.volume = static_cast<float>(get_number(ctx, settings, "volume", 1));
    options.start = get_number(ctx, settings, "start", 0);
    JSValue output = JS_GetPropertyStr(ctx, settings, "audioOutput");
    const bool known = JS_IsUndefined(output) || audio_output_mode(ctx, output, options.audio_output);
    JS_FreeValue(ctx, output);
    if (!known) return JS_ThrowRangeError(ctx, "video.open %s: audioOutput is 'pcm', 'auto' or 'passthrough'", source.c_str());
    JSValue headers = JS_GetPropertyStr(ctx, settings, "headers");
    if (JS_IsObject(headers)) {
      JSPropertyEnum* names = nullptr;
      std::uint32_t count = 0;
      if (!JS_GetOwnPropertyNames(ctx, &names, &count, headers, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY)) {
        for (std::uint32_t i = 0; i < count; ++i) {
          const char* name = JS_AtomToCString(ctx, names[i].atom);
          JSValue value = JS_GetProperty(ctx, headers, names[i].atom);
          const char* text = JS_ToCString(ctx, value);
          if (name && text && !std::strpbrk(name, "\r\n:") && !std::strpbrk(text, "\r\n"))
            options.headers.push_back(std::string(name) + ": " + text);
          if (text) JS_FreeCString(ctx, text);
          if (name) JS_FreeCString(ctx, name);
          JS_FreeValue(ctx, value);
          JS_FreeAtom(ctx, names[i].atom);
        }
        js_free(ctx, names);
      }
    }
    JS_FreeValue(ctx, headers);
  }
  if (options.audio) video_audio::start();
  Entry entry;
  entry.id = next_id++;
  entry.name = "video:" + std::to_string(entry.id);
  entry.audio = options.audio;
  if (!er_image_load_argb(entry.name.c_str(), tile, kTile, kTile, true))
    return JS_ThrowPlainError(ctx, "video.open %s: the image registry is full", source.c_str());
  // The newest player gets the audio; the one that had it goes quiet.
  for (Entry& other : players)
    if (options.audio) other.player->set_audio_output(false);
  entry.player = std::make_unique<video::Player>(source, options);
  players.push_back(std::move(entry));
  JSValue out = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, out, "id", JS_NewUint32(ctx, players.back().id));
  JS_SetPropertyStr(ctx, out, "name", JS_NewString(ctx, players.back().name.c_str()));
  return out;
}

JSValue close(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t id = 0;
  if (!argc || JS_ToUint32(ctx, &id, argv[0])) return JS_ThrowTypeError(ctx, "video.close: expected a video id");
  for (auto it = players.begin(); it != players.end(); ++it) {
    if (it->id != id) continue;
    dispose(*it);
    players.erase(it);
    assign_audio();
    break;
  }
  return JS_UNDEFINED;
}

JSValue set_paused(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.setPaused") : nullptr;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.setPaused: expected id and paused");
  entry->player->set_paused(JS_ToBool(ctx, argv[1]) > 0, last_now_us);
  return JS_UNDEFINED;
}

JSValue seek(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.seek") : nullptr;
  double seconds = 0;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.seek: expected id and seconds");
  if (JS_ToFloat64(ctx, &seconds, argv[1]) || !std::isfinite(seconds))
    return JS_ThrowTypeError(ctx, "video.seek: seconds must be a number");
  entry->player->seek(seconds);
  return JS_UNDEFINED;
}

JSValue set_volume(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.setVolume") : nullptr;
  double volume = 1;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.setVolume: expected id and volume");
  if (JS_ToFloat64(ctx, &volume, argv[1])) return JS_EXCEPTION;
  entry->player->set_volume(static_cast<float>(volume));
  return JS_UNDEFINED;
}

JSValue set_muted(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.setMuted") : nullptr;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.setMuted: expected id and muted");
  entry->player->set_muted(JS_ToBool(ctx, argv[1]) > 0);
  return JS_UNDEFINED;
}

JSValue set_loop(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.setLoop") : nullptr;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.setLoop: expected id and loop");
  entry->player->set_loop(JS_ToBool(ctx, argv[1]) > 0);
  return JS_UNDEFINED;
}

JSValue set_audio_delay(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.setAudioDelay") : nullptr;
  double seconds = 0;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.setAudioDelay: expected id and seconds");
  if (JS_ToFloat64(ctx, &seconds, argv[1])) return JS_EXCEPTION;
  entry->player->set_audio_delay(seconds);
  return JS_UNDEFINED;
}

JSValue set_fit(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.setResizeMode") : nullptr;
  std::int32_t fit = 0;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.setResizeMode: expected id and mode");
  if (JS_ToInt32(ctx, &fit, argv[1]) || fit < 0 || fit > 2)
    return JS_ThrowRangeError(ctx, "video.setResizeMode: 0 contain, 1 cover or 2 stretch");
  entry->fit = static_cast<GlVideo::Fit>(fit);
  return JS_UNDEFINED;
}

JSValue set_upscale(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.setUpscale") : nullptr;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.setUpscale: expected id and model");
  const char* name = JS_ToCString(ctx, argv[1]);
  if (!name) return JS_EXCEPTION;
  const int model = *name ? upscalers::find(name) : upscalers::kNone;
  const bool known = !*name || model != upscalers::kNone;
  JS_FreeCString(ctx, name);
  if (!known) return JS_ThrowRangeError(ctx, "video.setUpscale: '' for none, or %s", upscalers::names().c_str());
  entry->upscale = model;
  return JS_UNDEFINED;
}

// setCompare(id, model, split): right of `split` (0..1 across the picture) the picture goes through
// `model` ('' for none) instead; a null model ends the comparison.
JSValue set_compare(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 3 ? entry_arg(ctx, argv[0], "video.setCompare") : nullptr;
  if (!entry) return argc >= 3 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.setCompare: expected id, model and split");
  if (JS_IsNull(argv[1]) || JS_IsUndefined(argv[1])) {
    entry->compare = {};
    return JS_UNDEFINED;
  }
  double split = 0.5;
  if (JS_ToFloat64(ctx, &split, argv[2])) return JS_EXCEPTION;
  const char* name = JS_ToCString(ctx, argv[1]);
  if (!name) return JS_EXCEPTION;
  const int model = *name ? upscalers::find(name) : upscalers::kNone;
  const bool known = !*name || model != upscalers::kNone;
  JS_FreeCString(ctx, name);
  if (!known) return JS_ThrowRangeError(ctx, "video.setCompare: null, '' for none, or %s", upscalers::names().c_str());
  entry->compare = {true, model, float(std::clamp(split, 0.0, 1.0))};
  return JS_UNDEFINED;
}

JSValue set_audio_output(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.setAudioOutput") : nullptr;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.setAudioOutput: expected id and mode");
  video::AudioOutput mode;
  if (!audio_output_mode(ctx, argv[1], mode))
    return JS_ThrowRangeError(ctx, "video.setAudioOutput: 'pcm', 'auto' or 'passthrough'");
  entry->player->set_audio_mode(mode);
  return JS_UNDEFINED;
}

JSValue select_subtitle(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.selectSubtitleTrack") : nullptr;
  std::int32_t index = -1;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.selectSubtitleTrack: expected id and track");
  if (JS_ToInt32(ctx, &index, argv[1])) return JS_EXCEPTION;
  entry->player->select_subtitle_track(index);
  return JS_UNDEFINED;
}

JSValue add_subtitle(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.addSubtitle") : nullptr;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.addSubtitle: expected id and URL");
  const auto text = [&](int i) {
    std::string out;
    if (argc > i && JS_IsString(argv[i]))
      if (const char* value = JS_ToCString(ctx, argv[i])) {
        out = value;
        JS_FreeCString(ctx, value);
      }
    return out;
  };
  std::string source = text(1);
  if (source.empty()) return JS_ThrowTypeError(ctx, "video.addSubtitle: expected a URL or path");
  if (source.find("://") == std::string::npos) {
    char path[1024];
    if (!host::resolve_path(source.c_str(), path, sizeof path))
      return JS_ThrowPlainError(ctx, "video.addSubtitle %s: not an app path or URL", source.c_str());
    source = path;
  } else if (!PS5_REACT_NETWORKING) {
    return JS_ThrowPlainError(ctx, "video.addSubtitle %s: streaming needs \"networking\": true in app.json", source.c_str());
  }
  return JS_NewInt32(ctx, entry->player->add_subtitle_file(source, text(2), text(3)));
}

JSValue select_audio(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  Entry* entry = argc >= 2 ? entry_arg(ctx, argv[0], "video.selectAudioTrack") : nullptr;
  std::int32_t index = -1;
  if (!entry) return argc >= 2 ? JS_EXCEPTION : JS_ThrowTypeError(ctx, "video.selectAudioTrack: expected id and track");
  if (JS_ToInt32(ctx, &index, argv[1])) return JS_EXCEPTION;
  entry->player->select_audio_track(index);
  return JS_UNDEFINED;
}

const char* state_name(video::State state) {
  switch (state) {
    case video::State::loading: return "loading";
    case video::State::ready: return "ready";
    case video::State::buffering: return "buffering";
    case video::State::ended: return "ended";
    case video::State::failed: return "failed";
  }
  return "failed";
}

JSValue poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (const Entry& entry : players) {
    const video::Status status = entry.player->status();
    JSValue item = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, item, "id", JS_NewUint32(ctx, entry.id));
    JS_SetPropertyStr(ctx, item, "state", JS_NewString(ctx, state_name(status.state)));
    JS_SetPropertyStr(ctx, item, "paused", JS_NewBool(ctx, status.paused));
    JS_SetPropertyStr(ctx, item, "seeking", JS_NewBool(ctx, status.seeking));
    JS_SetPropertyStr(ctx, item, "position", JS_NewFloat64(ctx, status.position));
    JS_SetPropertyStr(ctx, item, "duration", JS_NewFloat64(ctx, status.duration));
    JS_SetPropertyStr(ctx, item, "buffered", JS_NewFloat64(ctx, status.buffered));
    JS_SetPropertyStr(ctx, item, "width", JS_NewInt32(ctx, status.width));
    JS_SetPropertyStr(ctx, item, "height", JS_NewInt32(ctx, status.height));
    JS_SetPropertyStr(ctx, item, "aspect", JS_NewFloat64(ctx, status.aspect));
    JS_SetPropertyStr(ctx, item, "error", JS_NewString(ctx, status.error.c_str()));
    JS_SetPropertyStr(ctx, item, "videoCodec", JS_NewString(ctx, status.video_codec.c_str()));
    JS_SetPropertyStr(ctx, item, "audioCodec", JS_NewString(ctx, status.audio_codec.c_str()));
    JS_SetPropertyStr(ctx, item, "decoder", JS_NewString(ctx, status.decoder.c_str()));
    JS_SetPropertyStr(ctx, item, "audioTrack", JS_NewInt32(ctx, status.audio_track));
    JS_SetPropertyStr(ctx, item, "shownFrames", JS_NewFloat64(ctx, static_cast<double>(status.shown_frames)));
    JS_SetPropertyStr(ctx, item, "droppedFrames", JS_NewFloat64(ctx, static_cast<double>(status.dropped_frames)));
    JS_SetPropertyStr(ctx, item, "lateMs", JS_NewFloat64(ctx, status.late_ms));
    JS_SetPropertyStr(ctx, item, "audioClock", JS_NewBool(ctx, status.audio_clock));
    JS_SetPropertyStr(ctx, item, "audioPassthrough", JS_NewBool(ctx, status.audio_passthrough));
    JSValue tracks = JS_NewArray(ctx);
    std::uint32_t at = 0;
    for (const video::Track& track : status.audio_tracks) {
      JSValue t = JS_NewObject(ctx);
      JS_SetPropertyStr(ctx, t, "index", JS_NewInt32(ctx, track.index));
      JS_SetPropertyStr(ctx, t, "language", JS_NewString(ctx, track.language.c_str()));
      JS_SetPropertyStr(ctx, t, "title", JS_NewString(ctx, track.title.c_str()));
      JS_SetPropertyStr(ctx, t, "codec", JS_NewString(ctx, track.codec.c_str()));
      JS_SetPropertyStr(ctx, t, "channels", JS_NewInt32(ctx, track.channels));
      JS_SetPropertyUint32(ctx, tracks, at++, t);
    }
    JS_SetPropertyStr(ctx, item, "audioTracks", tracks);
    JSValue subtitles = JS_NewArray(ctx);
    at = 0;
    for (const video::Track& track : status.subtitle_tracks) {
      JSValue t = JS_NewObject(ctx);
      JS_SetPropertyStr(ctx, t, "index", JS_NewInt32(ctx, track.index));
      JS_SetPropertyStr(ctx, t, "language", JS_NewString(ctx, track.language.c_str()));
      JS_SetPropertyStr(ctx, t, "title", JS_NewString(ctx, track.title.c_str()));
      JS_SetPropertyStr(ctx, t, "codec", JS_NewString(ctx, track.codec.c_str()));
      JS_SetPropertyStr(ctx, t, "external", JS_NewBool(ctx, track.external));
      JS_SetPropertyUint32(ctx, subtitles, at++, t);
    }
    JS_SetPropertyStr(ctx, item, "subtitleTracks", subtitles);
    JS_SetPropertyStr(ctx, item, "subtitleTrack", JS_NewInt32(ctx, status.subtitle_track));
    JS_SetPropertyStr(ctx, item, "subtitle", JS_NewString(ctx, status.subtitle.c_str()));
    JS_SetPropertyUint32(ctx, out, index++, item);
  }
  return out;
}
} // namespace

namespace video_layers {
bool find(const char* image_name, Layer& layer) {
  if (!image_name || std::strncmp(image_name, "video:", 6) != 0) return false;
  for (const Entry& entry : players) {
    if (entry.name != image_name) continue;
    layer.id = entry.id;
    layer.frame = entry.player->frame();
    layer.fit = entry.fit;
    layer.upscale = entry.upscale;
    layer.compare = entry.compare;
    return true;
  }
  return false;
}

namespace {
float sample_at(const video::Frame& frame, int plane, int x, int y, int second) {
  const bool wide = video::deep(frame.format);
  const bool pairs = video::interleaved(frame.format) && plane == 1;
  const int bytes = wide ? 2 : 1, step = bytes * (pairs ? 2 : 1);
  const std::uint8_t* at = frame.planes[plane] + static_cast<std::size_t>(y) * frame.pitch[plane] + x * step + second * bytes;
  if (!wide) return at[0] / 255.0f;
  const float value = (at[0] | (at[1] << 8)) / 65535.0f;
  return value * video::sample_scale(frame.format);
}

float pq_to_nits(float e) {
  const float m1 = 0.1593017578125f, m2 = 78.84375f, c1 = 0.8359375f, c2 = 18.8515625f, c3 = 18.6875f;
  const float p = std::pow(std::clamp(e, 0.0f, 1.0f), 1 / m2);
  return std::pow(std::max(p - c1, 0.0f) / (c2 - c3 * p), 1 / m1) * 10000;
}
} // namespace

bool sample(const char* image_name, int dst_x, int dst_y, int dst_w, int dst_h, int x, int y, unsigned rgb[3]) {
  Layer layer;
  if (!find(image_name, layer)) return false;
  rgb[0] = rgb[1] = rgb[2] = 0;
  const video::Frame* frame = layer.frame;
  if (!frame || dst_w <= 0 || dst_h <= 0) return true;
  // The same fit as GlVideo::draw.
  const float picture = frame->width * frame->aspect / frame->height, box = float(dst_w) / dst_h;
  float u = (x + 0.5f - dst_x) / dst_w, v = (y + 0.5f - dst_y) / dst_h;
  if (layer.fit == GlVideo::Fit::contain) {
    if (picture > box) v = (v - 0.5f) * box / picture + 0.5f;
    else u = (u - 0.5f) * picture / box + 0.5f;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return true;
  } else if (layer.fit == GlVideo::Fit::cover) {
    if (picture > box) u = (u - 0.5f) * box / picture + 0.5f;
    else v = (v - 0.5f) * picture / box + 0.5f;
  }
  const int px = std::clamp(int(u * frame->width), 0, frame->width - 1), py = std::clamp(int(v * frame->height), 0, frame->height - 1);
  const bool pairs = video::interleaved(frame->format);
  float yuv[3] = {sample_at(*frame, 0, px, py, 0), sample_at(*frame, 1, px / 2, py / 2, 0),
                  pairs ? sample_at(*frame, 1, px / 2, py / 2, 1) : sample_at(*frame, 2, px / 2, py / 2, 0)};
  const float kr[] = {0.299f, 0.2126f, 0.2627f}, kb[] = {0.114f, 0.0722f, 0.0593f};
  const int m = static_cast<int>(frame->matrix);
  const float r = kr[m], b = kb[m], g = 1 - r - b;
  float Y, cb, cr;
  if (frame->full_range) { Y = yuv[0]; cb = yuv[1] - 0.5f; cr = yuv[2] - 0.5f; }
  else { Y = (yuv[0] - 16 / 255.0f) * 255 / 219; cb = (yuv[1] - 128 / 255.0f) * 255 / 224; cr = (yuv[2] - 128 / 255.0f) * 255 / 224; }
  float out[3] = {Y + 2 * (1 - r) * cr, Y - 2 * (1 - b) * b / g * cb - 2 * (1 - r) * r / g * cr, Y + 2 * (1 - b) * cb};
  if (frame->transfer == video::Transfer::pq) {
    // As the shader: nits, BT.2020 to BT.709, reference white to 1, the soft shoulder, gamma 2.4.
    float n[3] = {pq_to_nits(out[0]) / 203, pq_to_nits(out[1]) / 203, pq_to_nits(out[2]) / 203};
    float c[3] = {1.6605f * n[0] - 0.5876f * n[1] - 0.0728f * n[2], -0.1246f * n[0] + 1.1329f * n[1] - 0.0083f * n[2],
                  -0.0182f * n[0] - 0.1006f * n[1] + 1.1187f * n[2]};
    const float peak = std::max({c[0], c[1], c[2], 0.0f}), knee = 0.75f;
    const float scale = peak > knee ? (knee + (1 - knee) * std::tanh((peak - knee) / (1 - knee))) / peak : 1;
    for (int i = 0; i < 3; ++i) out[i] = std::pow(std::max(c[i] * scale, 0.0f), 1 / 2.4f);
  }
  for (int i = 0; i < 3; ++i) rgb[2 - i] = static_cast<unsigned>(std::clamp(out[i], 0.0f, 1.0f) * 255 + 0.5f);
  return true;
}

void update(std::int64_t now_us, std::int64_t frame_us) {
  last_now_us = now_us;
  // Closed during this frame's JavaScript, before the commit that removed their elements painted.
  for (const std::string& name : unload_names) er_image_unload(name.c_str());
  unload_names.clear();
  std::erase_if(kept_rings, [&](const auto& kept) { return kept.second <= now_us; });
  for (Entry& entry : players) entry.player->update(now_us, frame_us);
}

std::string summary() {
  std::string out;
  for (const Entry& entry : players) {
    const video::Status s = entry.player->status();
    char line[384];
    std::snprintf(line, sizeof line, "%svideo %u %s %.1f/%.1fs buffered %.1fs %s %dx%d via %s shown=%llu dropped=%llu "
                  "late=%.1fms clock=%s%s queue=%d/%d starved=%d%s%s", out.empty() ? "" : "\n", entry.id, state_name(s.state), s.position,
                  s.duration, s.buffered, s.video_codec.c_str(), s.width, s.height, s.decoder.c_str(),
                  static_cast<unsigned long long>(s.shown_frames), static_cast<unsigned long long>(s.dropped_frames),
                  s.late_ms, s.audio_clock ? "audio" : "wall", s.audio_passthrough ? " passthrough" : "", s.queued_frames, s.queued_packets, s.starved_updates,
                  s.error.empty() ? "" : " error=", s.error.c_str());
    out += line;
  }
  return out;
}

void stop() {
  for (Entry& entry : players) {
    for (auto& ring : entry.player->detach_audio()) kept_rings.emplace_back(std::move(ring), 0);
    entry.player.reset();
  }
  players.clear();
  // The mixer reads a ring swapped out for at most a grain or two.
  std::this_thread::sleep_for(std::chrono::milliseconds(30));
  kept_rings.clear();
}
} // namespace video_layers

JSValue ps5_react_video_api(JSContext* ctx) {
  JSValue out = JS_NewObject(ctx);
  const struct { const char* name; JSCFunction* call; int length; } functions[] = {
    {"open", open, 2}, {"close", close, 1}, {"setPaused", set_paused, 2}, {"seek", seek, 2},
    {"setVolume", set_volume, 2}, {"setMuted", set_muted, 2}, {"setLoop", set_loop, 2},
    {"setAudioDelay", set_audio_delay, 2}, {"setAudioOutput", set_audio_output, 2},
    {"setResizeMode", set_fit, 2}, {"setUpscale", set_upscale, 2}, {"setCompare", set_compare, 3}, {"selectAudioTrack", select_audio, 2},
    {"selectSubtitleTrack", select_subtitle, 2}, {"addSubtitle", add_subtitle, 4}, {"poll", poll, 0},
  };
  for (const auto& function : functions)
    JS_SetPropertyStr(ctx, out, function.name, JS_NewCFunction(ctx, function.call, function.name, function.length));
  return out;
}

#else

// Without "video" in app.json the app links no FFmpeg; <Video> reports how to turn it on.
namespace video_layers {
bool find(const char*, Layer&) { return false; }
bool sample(const char*, int, int, int, int, int, int, unsigned*) { return false; }
void update(std::int64_t, std::int64_t) {}
void stop() {}
std::string summary() { return {}; }
} // namespace video_layers

namespace {
JSValue disabled(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  return JS_ThrowPlainError(ctx, "video.open: set \"video\": true in app.json to play video");
}
JSValue none(JSContext* ctx, JSValueConst, int, JSValueConst*) { return JS_NewArray(ctx); }
} // namespace

JSValue ps5_react_video_api(JSContext* ctx) {
  JSValue out = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, out, "open", JS_NewCFunction(ctx, disabled, "open", 2));
  JS_SetPropertyStr(ctx, out, "poll", JS_NewCFunction(ctx, none, "poll", 0));
  return out;
}

#endif
