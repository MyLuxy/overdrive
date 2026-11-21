// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// What the connected audio sink (a TV or AV receiver on HDMI) takes, read from its EDID: the Short Audio
// Descriptors of each CTA-861 extension block. Parsing is shared and host-tested; reading the EDID is the
// platform's (host::sink_edid).
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace audio_sink {

struct Format {
  std::string codec;           // 'pcm', 'ac3', 'eac3', 'dts', 'dtshd', 'truehd', 'aac', 'mp3', ...
  int channels = 0;            // most channels this codec carries to the sink
  std::vector<int> rates;      // sample rates in Hz
  std::vector<int> bit_depths; // PCM only: 16, 20, 24
  int max_bitrate = 0;         // bits per second, for AC-3, DTS, AAC, MP3 and MPEG audio; 0 when not stated
};

struct Capabilities {
  bool known = false;  // an EDID was read
  std::string name;    // the display descriptor's name ('' when none)
  std::vector<Format> formats;
  // Codecs sent undecoded to this sink: AC-3, E-AC-3 and DTS (core), where it lists them.
  bool ac3 = false, eac3 = false, dts = false;
  int pcm_channels = 2; // most PCM channels it takes
};

// Parses an EDID (the base block and its extensions, 128 bytes each). Unknown or malformed blocks are
// skipped rather than refused: a sink with a wrong checksum still plays.
Capabilities parse_edid(const std::uint8_t* edid, std::size_t size);

// The connected sink's capabilities, read now (host::sink_edid). Any thread.
Capabilities current();

} // namespace audio_sink

namespace host {
// Per platform: the EDID of the display or receiver the console outputs to (PS5: the HDMI sink's, through
// sceVideoOutGetHdmiRawEdid_); false when there is none to read (the desktop preview). Any thread.
bool sink_edid(std::vector<std::uint8_t>& edid);
} // namespace host
