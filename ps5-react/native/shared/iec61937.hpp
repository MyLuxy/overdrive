// Copyright (C) 2026 half144 and PS5 React contributors
// Copyright (C) 2026 Brett (SlopFin)
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// IEC 61937 packing, for HDMI bitstream audio: an AV receiver or TV decodes AC-3, E-AC-3 and DTS itself
// when they arrive as S/PDIF carries compressed audio. A burst looks like stereo 16-bit PCM: the preamble
// F872 4E1F, a data type and a length, the frame with each pair of bytes swapped, then zeros up to the
// codec's repetition period. Ported from SlopFin's src/iec61937.hpp (GPL-3.0-or-later), which follows the
// layout FFmpeg's spdif muxer writes (libavformat/spdifenc.c); tools/test_passthrough.py checks the output
// byte for byte against that muxer's. Words are native 16-bit values, so on a little-endian CPU the bytes
// land as the muxer writes them.
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>

namespace iec61937 {

enum class Codec : std::uint8_t {
  ac3,  // 48 kHz stereo carrier, a burst per 1536-sample frame
  eac3, // 192 kHz carrier, a burst per six audio blocks
  dts,  // 48 kHz carrier, the core only, a burst per 512, 1024 or 2048-sample frame
};

constexpr std::int64_t kNoTime = INT64_MIN; // AV_NOPTS_VALUE
constexpr std::size_t kMaxBurstBytes = 24576;

// Stereo frames per second of the carrier the bursts play at.
constexpr int carrier_rate(Codec codec) { return codec == Codec::eac3 ? 192000 : 48000; }

namespace detail {
constexpr std::uint16_t kSync1 = 0xf872, kSync2 = 0x4e1f;
constexpr std::uint16_t kTypeAc3 = 0x01, kTypeDts1 = 0x0b, kTypeEac3 = 0x15;
constexpr std::size_t kHeaderBytes = 8;

// Bytes in a 48 kHz AC-3 syncframe (bsid 8 or less), 0 when this is not one.
inline std::size_t ac3_frame_bytes(const std::uint8_t* data, std::size_t bytes) {
  if (bytes < 7 || data[0] != 0x0b || data[1] != 0x77 || (data[4] >> 6) != 0 || (data[5] >> 3) > 8) return 0;
  constexpr unsigned kRates[] = {32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 448, 512, 576, 640};
  const unsigned code = data[4] & 63;
  return code < 38 ? kRates[code / 2] * 4 : 0;
}

// Bytes in an E-AC-3 syncframe (or an AC-3 one inside the stream), 0 when this is not one.
inline std::size_t eac3_frame_bytes(const std::uint8_t* data, std::size_t bytes) {
  if (bytes < 6 || data[0] != 0x0b || data[1] != 0x77) return 0;
  const unsigned bsid = data[5] >> 3;
  if (bsid <= 8) return ac3_frame_bytes(data, bytes);
  if (bsid < 11 || bsid > 16) return 0;
  return ((((static_cast<std::size_t>(data[2]) & 7) << 8) | data[3]) + 1) * 2;
}

// A dependent substream belongs to the independent frame before it.
inline bool eac3_dependent(const std::uint8_t* data) { return (data[5] >> 3) > 10 && (data[2] >> 6) == 1; }

// How many syncframes make the six audio blocks one burst carries.
inline unsigned eac3_repeat(const std::uint8_t* data) {
  constexpr unsigned kRepeat[4] = {6, 3, 2, 1};
  if ((data[5] >> 3) <= 10 || (data[4] & 0xc0) == 0xc0) return 1;
  return kRepeat[(data[4] >> 4) & 3];
}

struct DtsCore {
  std::size_t bytes = 0;     // the core frame alone
  std::uint32_t samples = 0; // 512, 1024 or 2048
};

// A 48 kHz, 16-bit big-endian DTS core frame header: what MKV, MP4 and TS carry.
inline DtsCore dts_core(const std::uint8_t* data, std::size_t bytes) {
  if (bytes < 9 || data[0] != 0x7f || data[1] != 0xfe || data[2] != 0x80 || data[3] != 0x01) return {};
  const unsigned blocks = ((((unsigned{data[4]} << 8) | data[5]) >> 2) & 0x7f) + 1;
  const std::size_t size = ((((std::size_t{data[5]} << 16) | (std::size_t{data[6]} << 8) | data[7]) >> 4) & 0x3fff) + 1;
  const unsigned rate_code = (data[8] >> 2) & 0x0f;
  const std::uint32_t samples = blocks << 5;
  if (rate_code != 13 || size < 96 || (samples != 512 && samples != 1024 && samples != 2048)) return {};
  return {size, samples};
}

// Bytes of the DTS-HD extension substream at `data`, 0 when there is none.
inline std::size_t dts_substream_bytes(const std::uint8_t* data, std::size_t bytes) {
  if (bytes < 11 || data[0] != 0x64 || data[1] != 0x58 || data[2] != 0x20 || data[3] != 0x25) return 0;
  // After the sync: 8 user bits, 2 index bits, 1 size-type bit, then the header and frame sizes,
  // 8 + 16 bits or 12 + 20 bits wide.
  std::uint64_t bits = 0;
  for (int i = 4; i < 11; ++i) bits = (bits << 8) | data[i];
  const bool wide = (bits >> (56 - 11)) & 1;
  const unsigned header_bits = wide ? 12 : 8, frame_bits = wide ? 20 : 16;
  return ((bits >> (56 - 11 - header_bits - frame_bits)) & ((1u << frame_bits) - 1)) + 1;
}
} // namespace detail

// Assembles frames arriving in pieces of any size into whole bursts. The consumer is called with
// `consume(words, frames, time)`: the burst as native 16-bit words, its length in carrier frames (two
// words each) and the time given with the data its first frame started in (kNoTime when none was).
class Packer {
public:
  void reset(Codec codec) {
    codec_ = codec;
    used_ = expected_ = skip_ = pending_ = 0;
    pending_frames_ = 0;
    pending_repeat_ = 1;
    pending_time_ = frame_time_ = kNoTime;
  }

  // Bytes skipped because they did not parse as a frame of the codec, since the packer was made.
  std::uint64_t dropped() const { return dropped_; }

  template <typename Consumer>
  void feed(const std::uint8_t* data, std::size_t bytes, std::int64_t time, Consumer&& consume) {
    while (bytes > 0) {
      if (skip_ > 0) {
        const std::size_t take = bytes < skip_ ? bytes : skip_;
        skip_ -= take;
        data += take;
        bytes -= take;
        continue;
      }
      if (used_ == 0) frame_time_ = time;
      // Only what the frame being assembled still needs, so the rest is scanned afresh.
      const std::size_t want = expected_ ? expected_ - used_ : kProbe - used_;
      const std::size_t step = bytes < want ? bytes : want;
      std::memcpy(frame_.data() + used_, data, step);
      used_ += step;
      data += step;
      bytes -= step;
      time = kNoTime;
      advance(consume);
    }
  }

  // At the end of the stream: emits the E-AC-3 frames still gathered for a burst.
  template <typename Consumer> void flush(Consumer&& consume) {
    if (codec_ == Codec::eac3 && pending_ > 0)
      emit(consume, detail::kTypeEac3, pending_data_.data(), pending_, kMaxBurstBytes, pending_time_, false);
    pending_ = 0;
    pending_frames_ = 0;
  }

private:
  static constexpr std::size_t kProbe = 12;

  template <typename Consumer> void advance(Consumer& consume) {
    while (used_ >= kProbe || (expected_ && used_ >= expected_)) {
      if (!expected_) {
        bool extension = false;
        expected_ = measure(extension);
        if (!expected_ || expected_ < used_ || expected_ > frame_.size()) {
          // Not a frame: slide on by a byte.
          expected_ = 0;
          std::memmove(frame_.data(), frame_.data() + 1, --used_);
          ++dropped_;
          frame_time_ = kNoTime;
          continue;
        }
        if (extension) {
          // A DTS-HD extension follows the core in the same access unit; the sink gets the core.
          skip_ = expected_ - used_;
          used_ = expected_ = 0;
          return;
        }
      }
      if (used_ < expected_) return;
      complete(consume);
      std::memmove(frame_.data(), frame_.data() + expected_, used_ - expected_);
      used_ -= expected_;
      expected_ = 0;
      frame_time_ = kNoTime;
    }
  }

  std::size_t measure(bool& extension) const {
    if (codec_ == Codec::dts) {
      if (const std::size_t hd = detail::dts_substream_bytes(frame_.data(), used_)) {
        extension = true;
        return hd;
      }
      return detail::dts_core(frame_.data(), used_).bytes;
    }
    if (codec_ == Codec::ac3) return detail::ac3_frame_bytes(frame_.data(), used_);
    return detail::eac3_frame_bytes(frame_.data(), used_);
  }

  template <typename Consumer> void complete(Consumer& consume) {
    const std::uint8_t* frame = frame_.data();
    if (codec_ == Codec::ac3) {
      emit(consume, static_cast<std::uint16_t>(detail::kTypeAc3 | ((frame[5] & 7) << 8)), frame, expected_, 1536 * 4,
           frame_time_, true);
      return;
    }
    if (codec_ == Codec::dts) {
      const detail::DtsCore core = detail::dts_core(frame, expected_);
      const auto type = static_cast<std::uint16_t>(detail::kTypeDts1 + (core.samples == 1024 ? 1 : core.samples == 2048 ? 2 : 0));
      emit(consume, type, frame, core.bytes, core.samples * 4, frame_time_, true);
      return;
    }
    // E-AC-3: a burst holds six audio blocks' worth of independent frames, each followed by its dependent
    // substreams. It closes when the next independent frame would start a seventh block.
    if (!detail::eac3_dependent(frame)) {
      if (pending_frames_ >= pending_repeat_ && pending_ > 0) {
        emit(consume, detail::kTypeEac3, pending_data_.data(), pending_, kMaxBurstBytes, pending_time_, false);
        pending_ = 0;
        pending_frames_ = 0;
      }
      if (pending_frames_ == 0) {
        pending_repeat_ = detail::eac3_repeat(frame);
        pending_time_ = frame_time_;
      }
      ++pending_frames_;
    } else if (pending_frames_ == 0) {
      ++dropped_; // a dependent frame with nothing to belong to
      return;
    }
    if (pending_ + expected_ > pending_data_.size() - detail::kHeaderBytes) {
      ++dropped_;
      pending_ = 0;
      pending_frames_ = 0;
      return;
    }
    std::memcpy(pending_data_.data() + pending_, frame, expected_);
    pending_ += expected_;
  }

  template <typename Consumer>
  void emit(Consumer& consume, std::uint16_t type, const std::uint8_t* payload, std::size_t bytes, std::size_t period,
            std::int64_t time, bool length_in_bits) {
    const std::size_t aligned = (bytes + 1) & ~std::size_t{1};
    if (period > kMaxBurstBytes || aligned + detail::kHeaderBytes > period) {
      ++dropped_;
      return;
    }
    std::uint16_t* out = burst_.data();
    out[0] = detail::kSync1;
    out[1] = detail::kSync2;
    out[2] = type;
    out[3] = static_cast<std::uint16_t>(length_in_bits ? aligned << 3 : bytes);
    std::size_t word = 4;
    for (std::size_t i = 0; i + 1 < bytes; i += 2) out[word++] = static_cast<std::uint16_t>((payload[i] << 8) | payload[i + 1]);
    if (bytes & 1) out[word++] = static_cast<std::uint16_t>(payload[bytes - 1] << 8);
    for (; word < period / 2; ++word) out[word] = 0;
    consume(static_cast<const std::uint16_t*>(burst_.data()), period / 4, time);
  }

  Codec codec_ = Codec::ac3;
  std::array<std::uint8_t, 16384> frame_{};
  std::size_t used_ = 0, expected_ = 0, skip_ = 0;
  std::array<std::uint8_t, kMaxBurstBytes> pending_data_{};
  std::size_t pending_ = 0;
  unsigned pending_frames_ = 0, pending_repeat_ = 1;
  std::int64_t pending_time_ = kNoTime, frame_time_ = kNoTime;
  std::array<std::uint16_t, kMaxBurstBytes / 2> burst_{};
  std::uint64_t dropped_ = 0;
};

} // namespace iec61937
