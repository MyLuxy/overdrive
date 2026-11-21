// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstdint>
#include <memory>

struct AVPacket;
struct AVCodecParameters;

namespace video {

// The pixel layouts the presenter draws: 4:2:0 with planar or interleaved chroma, 8 or 10 bits. 10-bit
// samples sit in 16-bit words, low-aligned in planar frames (FFmpeg's yuv420p10le) and in the PS5
// decoder's interleaved ones (nv12_10), high in P010.
enum class Format : std::uint8_t { i420, nv12, i420_10, p010, nv12_10 };

inline bool deep(Format format) { return format == Format::i420_10 || format == Format::p010 || format == Format::nv12_10; }
inline bool interleaved(Format format) { return format == Format::nv12 || format == Format::p010 || format == Format::nv12_10; }
// What a 16-bit sample read as a fraction of 65535 is multiplied by to span 0..1.
inline float sample_scale(Format format) {
  return format == Format::i420_10 || format == Format::nv12_10 ? 65535.0f / 1023.0f : 1.0f;
}
enum class Matrix : std::uint8_t { bt601, bt709, bt2020 };
enum class Transfer : std::uint8_t { sdr, pq, hlg };

struct Frame {
  Format format = Format::i420;
  int width = 0, height = 0;          // displayed pixels
  const std::uint8_t* planes[3] = {}; // Y, then U and V, or the interleaved UV
  int pitch[3] = {};                  // bytes per row
  Matrix matrix = Matrix::bt709;
  bool full_range = false;
  Transfer transfer = Transfer::sdr;
  float aspect = 1;                   // pixel aspect ratio
  std::int64_t pts_us = 0;            // media time
  std::uint64_t serial = 0;           // seek generation
  std::uint64_t sequence = 0;         // unique per decoded frame, so it is uploaded once
  std::shared_ptr<void> owner;        // keeps the planes alive
};

// A video decoder. FFmpeg's serves every host; a platform may offer a hardware one first.
class Decoder {
public:
  virtual ~Decoder() = default;
  // Sends one packet, or null to drain at the end of the stream. False on a fatal error.
  virtual bool send(const AVPacket* packet) = 0;
  // Takes the next decoded frame; false when none is ready yet. Sets `ended` once drained.
  virtual bool receive(Frame& frame, bool& ended) = 0;
  // Drops everything in flight, for a seek.
  virtual void flush() = 0;
  virtual const char* name() const = 0;
};

// Loads what the platform decoder needs; the PS5 host calls it first thing in main(), before filesystem
// elevation, after which the console refuses to load the decoder module.
void preload_platform_decoder();
// The largest picture FFmpeg may decode on this host, in pixels: on the PS5 a 4K picture in software runs
// the app heap out of memory, so bigger streams need the hardware decoder.
std::int64_t software_pixel_limit();
// The platform's hardware decoder for this stream, or null to decode with FFmpeg (video_decoder.cpp of
// each host). `time_base_num/den` is the stream's: packet timestamps are in it.
std::unique_ptr<Decoder> make_platform_decoder(const AVCodecParameters* parameters, int time_base_num,
                                               int time_base_den);

} // namespace video
