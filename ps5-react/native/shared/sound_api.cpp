// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "baked_sounds.h"
#include "video_audio.hpp"
#include "audio/mixer.hpp"
#include <cstdint>
#include <cstring>
#include <ctime>
#include <vector>

namespace {
struct Sound {
  const char* name;
  std::vector<float> samples; // interleaved stereo, the layout the mixer reads
  hui::audio::Clip clip;
  float pitch;                // the baked rate over the mixer's
  std::int64_t duration_us;
  std::int64_t busy_until_us = 0;
};

// play() only posts a command to this mixer; the platform's audio thread renders it.
hui::audio::Mixer mixer;
std::vector<Sound> sounds;
bool audio = false;

std::int64_t now_us() {
  timespec now = {};
  clock_gettime(CLOCK_MONOTONIC, &now);
  return static_cast<std::int64_t>(now.tv_sec) * 1000000 + now.tv_nsec / 1000;
}

double clamp(double value, double low, double high) {
  // Written so NaN collapses to `low`.
  return value > low ? (value < high ? value : high) : low;
}

JSValue play(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  if (argc < 3) return JS_ThrowTypeError(ctx, "sound.play: expected name, volume and pan");
  double volume = 0, pan = 0;
  if (JS_ToFloat64(ctx, &volume, argv[1]) || JS_ToFloat64(ctx, &pan, argv[2])) return JS_EXCEPTION;
  const char* name = JS_ToCString(ctx, argv[0]);
  if (!name) return JS_EXCEPTION;
  Sound* sound = nullptr;
  for (Sound& candidate : sounds) if (!std::strcmp(candidate.name, name)) sound = &candidate;
  if (!sound) {
    const JSValue error = JS_ThrowPlainError(ctx, "sound.play %s: no imported .wav has this name", name);
    JS_FreeCString(ctx, name);
    return error;
  }
  JS_FreeCString(ctx, name);
  // One voice per sound: a held D-pad repeats the focus tick instead of stacking it.
  const std::int64_t now = now_us();
  if (!audio || now < sound->busy_until_us) return JS_NewBool(ctx, false);
  hui::audio::PlayParams params;
  params.gain = static_cast<float>(clamp(volume, 0, 1));
  params.pan = static_cast<float>(clamp(pan, -1, 1));
  params.pitch = sound->pitch;
  params.bus = hui::audio::Bus::ui;
  if (!mixer.play_clip(&sound->clip, params)) return JS_NewBool(ctx, false);
  sound->busy_until_us = now + sound->duration_us;
  return JS_NewBool(ctx, true);
}

JSValue set_volume(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  double volume = 0;
  if (!argc) return JS_ThrowTypeError(ctx, "sound.setVolume: expected a volume");
  if (JS_ToFloat64(ctx, &volume, argv[0])) return JS_EXCEPTION;
  mixer.set_master_gain(static_cast<float>(clamp(volume, 0, 1)));
  return JS_UNDEFINED;
}
} // namespace

namespace video_audio {
constexpr std::size_t kSlot = 0;

bool start() {
  if (!audio) audio = host::start_audio(mixer);
  return audio;
}

void route(hui::audio::StreamRing* ring) {
  if (audio) mixer.swap_stream(kSlot, ring);
}

void set_gain(float gain) {
  if (audio) mixer.set_stream_gain(kSlot, gain, 0.0f);
}
} // namespace video_audio

bool ps5_react_start_sound() {
  // Apps without sounds open no audio device and start no audio thread, until a video plays.
  if (!ps5_react_sound_count) return false;
  sounds.reserve(ps5_react_sound_count);
  for (std::uint32_t i = 0; i < ps5_react_sound_count; ++i) {
    const BakedSound& baked = ps5_react_sounds[i];
    Sound& sound = sounds.emplace_back();
    sound.name = baked.name;
    sound.samples.resize(static_cast<std::size_t>(baked.frames) * 2);
    for (std::uint32_t frame = 0; frame < baked.frames; ++frame)
      for (std::uint32_t channel = 0; channel < 2; ++channel)
        sound.samples[frame * 2 + channel] =
          baked.samples[frame * baked.channels + (baked.channels == 2 ? channel : 0)] / 32768.0f;
    sound.clip = {sound.samples.data(), baked.frames};
    sound.pitch = static_cast<float>(baked.rate) / hui::audio::kSampleRate;
    sound.duration_us = static_cast<std::int64_t>(baked.frames) * 1000000 / baked.rate;
  }
  audio = host::start_audio(mixer);
  return audio;
}

void ps5_react_stop_sound() {
  if (audio) host::stop_audio();
  audio = false;
  sounds.clear();
}

JSValue ps5_react_sound_api(JSContext* ctx) {
  JSValue out = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, out, "play", JS_NewCFunction(ctx, play, "play", 3));
  JS_SetPropertyStr(ctx, out, "setVolume", JS_NewCFunction(ctx, set_volume, "setVolume", 1));
  return out;
}
