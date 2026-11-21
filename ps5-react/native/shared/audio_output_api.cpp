// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// The bitstream (passthrough) output slot video players route their bursts to, and
// audioOutput.capabilities(): what the connected sink takes.
#include "host_api.hpp"
#include "audio_sink.hpp"
#include "burst_ring.hpp"
#include "iec61937.hpp"
#include "video_audio.hpp"

#include <algorithm>
#include <atomic>
#include <cstring>
#include <mutex>

namespace {
std::mutex bitstream_mutex; // open and close, from players' audio threads
const void* bitstream_owner = nullptr;
bool bitstream_open = false;
iec61937::Codec bitstream_codec = iec61937::Codec::ac3;
std::atomic<BurstRing*> bitstream_ring{nullptr};
std::atomic<bool> bitstream_muted{false};

// On the output's thread, a grain at a time. Muted, the ring is still read, so the clock keeps going.
void fill(std::uint16_t* words, std::size_t frames) {
  std::size_t read = 0;
  if (BurstRing* ring = bitstream_ring.load(std::memory_order_acquire)) read = ring->read(words, frames);
  if (bitstream_muted.load(std::memory_order_relaxed)) read = 0;
  std::memset(words + read * 2, 0, (frames - read) * 2 * sizeof *words);
}

JSValue capabilities(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  const audio_sink::Capabilities caps = audio_sink::current();
  const auto numbers = [&](const std::vector<int>& values) {
    JSValue out = JS_NewArray(ctx);
    for (std::uint32_t i = 0; i < values.size(); ++i) JS_SetPropertyUint32(ctx, out, i, JS_NewInt32(ctx, values[i]));
    return out;
  };
  JSValue out = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, out, "known", JS_NewBool(ctx, caps.known));
  JS_SetPropertyStr(ctx, out, "name", JS_NewString(ctx, caps.name.c_str()));
  JSValue formats = JS_NewArray(ctx);
  for (std::uint32_t i = 0; i < caps.formats.size(); ++i) {
    const audio_sink::Format& format = caps.formats[i];
    JSValue item = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, item, "codec", JS_NewString(ctx, format.codec.c_str()));
    JS_SetPropertyStr(ctx, item, "channels", JS_NewInt32(ctx, format.channels));
    JS_SetPropertyStr(ctx, item, "sampleRates", numbers(format.rates));
    if (!format.bit_depths.empty()) JS_SetPropertyStr(ctx, item, "bitDepths", numbers(format.bit_depths));
    if (format.max_bitrate) JS_SetPropertyStr(ctx, item, "maxBitrate", JS_NewInt32(ctx, format.max_bitrate));
    JS_SetPropertyUint32(ctx, formats, i, item);
  }
  JS_SetPropertyStr(ctx, out, "formats", formats);
  // What a <Video audioOutput="auto"> sends undecoded here: the codecs both the sink and the host take.
  JSValue passthrough = JS_NewArray(ctx);
  std::uint32_t count = 0;
  if (host::has_bitstream()) {
    if (caps.ac3) JS_SetPropertyUint32(ctx, passthrough, count++, JS_NewString(ctx, "ac3"));
    if (caps.eac3) JS_SetPropertyUint32(ctx, passthrough, count++, JS_NewString(ctx, "eac3"));
    if (caps.dts) JS_SetPropertyUint32(ctx, passthrough, count++, JS_NewString(ctx, "dts"));
  }
  JS_SetPropertyStr(ctx, out, "passthrough", passthrough);
  JS_SetPropertyStr(ctx, out, "pcmChannels", JS_NewInt32(ctx, caps.pcm_channels));
  return out;
}
} // namespace

namespace video_audio {
bool open_bitstream(iec61937::Codec codec, const void* owner) {
  std::lock_guard lock(bitstream_mutex);
  if (bitstream_open && bitstream_codec != codec) {
    host::close_bitstream();
    bitstream_open = false;
  }
  if (!bitstream_open) bitstream_open = host::open_bitstream(codec, fill);
  bitstream_codec = codec;
  bitstream_owner = bitstream_open ? owner : nullptr;
  return bitstream_open;
}

void close_bitstream(const void* owner) {
  std::lock_guard lock(bitstream_mutex);
  if (!bitstream_open || owner != bitstream_owner) return;
  host::close_bitstream();
  bitstream_open = false;
  bitstream_owner = nullptr;
}

void route_bitstream(BurstRing* ring) { bitstream_ring.store(ring, std::memory_order_release); }

void set_bitstream_muted(bool muted) { bitstream_muted.store(muted, std::memory_order_relaxed); }
} // namespace video_audio

JSValue ps5_react_audio_output_api(JSContext* ctx) {
  JSValue out = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, out, "capabilities", JS_NewCFunction(ctx, capabilities, "capabilities", 0));
  return out;
}
