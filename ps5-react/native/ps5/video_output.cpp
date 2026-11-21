// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.

#include "video_output.hpp"
#include "async_log.hpp"
#include <cstdint>

extern "C" int sceVideoOutGetCurrentOutputMode_(std::uint64_t bus, void* mode);

namespace {
// libSceAvSetting's id for the main output. A VideoOut port handle fails with 0x80290018.
constexpr std::uint64_t kMainOutput = 0x7000;

// Layout read from the call on firmware 13.60; the console fills in `size`.
struct OutputMode {
  std::uint32_t size;
  std::uint8_t encoding, range, colorimetry, depth;
  std::uint64_t refresh;    // 0x03 = 59.94 Hz, 0x0d = 119.88 Hz
  std::uint64_t resolution;
  std::uint64_t reserved;
};
static_assert(sizeof(OutputMode) == 32);

int lines(std::uint64_t resolution) {
  switch (resolution) {
  case 0x09: return 720;
  case 0x0a: return 1080; // 1080i
  case 0x0b: return 1080;
  case 0x0f: return 1440;
  case 0x0c: return 2160;
  default: return 0;
  }
}
}

namespace video_output {
int output_lines() {
  OutputMode mode = {};
  const int result = sceVideoOutGetCurrentOutputMode_(kMainOutput, &mode);
  if (result != 0) {
    async_log::write("[PS5-REACT] output mode unavailable: 0x%08x", static_cast<unsigned>(result));
    return 0;
  }
  async_log::write("[PS5-REACT] output mode resolution=0x%02x refresh=0x%02x", static_cast<unsigned>(mode.resolution),
                   static_cast<unsigned>(mode.refresh));
  return lines(mode.resolution);
}
}
