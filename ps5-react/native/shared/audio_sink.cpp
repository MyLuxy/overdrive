// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "audio_sink.hpp"

#include <algorithm>

namespace audio_sink {

namespace {
constexpr std::size_t kBlock = 128;
constexpr int kRates[7] = {32000, 44100, 48000, 88200, 96000, 176400, 192000};

// CTA-861 audio format codes, by the names FFmpeg and media servers use; '' for reserved.
const char* codec_name(int code, int extension) {
  constexpr const char* kCodes[16] = {"", "pcm", "ac3", "mp2", "mp3", "mp2", "aac", "dts", "atrac", "dsd",
                                      "eac3", "dtshd", "truehd", "dst", "wmapro", ""};
  if (code != 15) return kCodes[code];
  switch (extension) {
    case 4: case 5: case 6: case 8: case 10: return "aac"; // HE-AAC, HE-AACv2, MPEG-4 AAC LC, with MPEG Surround
    case 7: return "dra";
    case 11: return "mpegh";
    case 12: return "ac4";
    case 13: return "pcm"; // L-PCM 3D audio
    default: return "";
  }
}

void add(Capabilities& caps, Format format) {
  for (Format& known : caps.formats) {
    if (known.codec != format.codec) continue;
    // A sink may list a codec twice (one entry per channel count): one entry with the most of each.
    known.channels = std::max(known.channels, format.channels);
    known.max_bitrate = std::max(known.max_bitrate, format.max_bitrate);
    for (int rate : format.rates)
      if (std::find(known.rates.begin(), known.rates.end(), rate) == known.rates.end()) known.rates.push_back(rate);
    for (int depth : format.bit_depths)
      if (std::find(known.bit_depths.begin(), known.bit_depths.end(), depth) == known.bit_depths.end())
        known.bit_depths.push_back(depth);
    std::sort(known.rates.begin(), known.rates.end());
    std::sort(known.bit_depths.begin(), known.bit_depths.end());
    return;
  }
  caps.formats.push_back(std::move(format));
}

// One Short Audio Descriptor: three bytes.
void read_descriptor(Capabilities& caps, const std::uint8_t* sad) {
  const int code = (sad[0] >> 3) & 15, extension = sad[2] >> 3;
  const char* name = codec_name(code, extension);
  if (!*name) return;
  Format format;
  format.codec = name;
  format.channels = (sad[0] & 7) + 1;
  if (code == 15 && extension == 13) format.channels = ((sad[0] & 7) | ((sad[1] & 0x80) >> 4) | ((sad[2] & 0x80) >> 3)) + 1;
  for (int bit = 0; bit < 7; ++bit)
    if (sad[1] & (1 << bit)) format.rates.push_back(kRates[bit]);
  if (code == 1) {
    constexpr int kDepths[3] = {16, 20, 24};
    for (int bit = 0; bit < 3; ++bit)
      if (sad[2] & (1 << bit)) format.bit_depths.push_back(kDepths[bit]);
  } else if (code >= 2 && code <= 8) {
    format.max_bitrate = sad[2] * 8000;
  }
  add(caps, std::move(format));
}

void read_cta(Capabilities& caps, const std::uint8_t* block) {
  // Revision 1 has no data blocks; byte 2 is where the detailed timings start, and the data blocks end.
  const std::size_t end = std::min<std::size_t>(block[2], kBlock - 1);
  bool basic_audio = block[1] >= 2 && (block[3] & 0x40);
  for (std::size_t at = 4; block[1] >= 3 && at < end;) {
    const int tag = block[at] >> 5, length = block[at] & 31;
    if (at + 1 + length > end) break;
    if (tag == 1)
      for (int i = 0; i + 3 <= length; i += 3) read_descriptor(caps, block + at + 1 + i);
    at += 1 + length;
  }
  // Basic audio: two-channel PCM at 32, 44.1 and 48 kHz, 16-bit, even with no descriptor saying so.
  if (basic_audio) add(caps, {"pcm", 2, {32000, 44100, 48000}, {16}, 0});
}

bool takes(const Capabilities& caps, const char* codec) {
  for (const Format& format : caps.formats)
    if (format.codec == codec)
      return format.rates.empty() || std::find(format.rates.begin(), format.rates.end(), 48000) != format.rates.end();
  return false;
}
} // namespace

Capabilities parse_edid(const std::uint8_t* edid, std::size_t size) {
  Capabilities caps;
  if (!edid || size < kBlock) return caps;
  caps.known = true;
  for (int i = 0; i < 4; ++i) {
    const std::uint8_t* descriptor = edid + 54 + 18 * i;
    if (descriptor[0] || descriptor[1] || descriptor[2] || descriptor[3] != 0xfc) continue;
    for (int c = 5; c < 18 && descriptor[c] != 0x0a; ++c) caps.name += static_cast<char>(descriptor[c]);
    while (!caps.name.empty() && caps.name.back() == ' ') caps.name.pop_back();
  }
  const std::size_t blocks = std::min<std::size_t>(size / kBlock, 1u + edid[126]);
  for (std::size_t b = 1; b < blocks; ++b)
    if (edid[b * kBlock] == 0x02) read_cta(caps, edid + b * kBlock);
  // An E-AC-3 decoder decodes AC-3 too, and a DTS-HD one the DTS core.
  caps.ac3 = takes(caps, "ac3") || takes(caps, "eac3");
  caps.eac3 = takes(caps, "eac3");
  caps.dts = takes(caps, "dts") || takes(caps, "dtshd");
  for (const Format& format : caps.formats)
    if (format.codec == "pcm") caps.pcm_channels = std::max(caps.pcm_channels, format.channels);
  return caps;
}

Capabilities current() {
  std::vector<std::uint8_t> edid;
  return host::sink_edid(edid) ? parse_edid(edid.data(), edid.size()) : Capabilities{};
}

} // namespace audio_sink
