// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// HDMI bitstream output and the sink's EDID. The port is the one the console's disc player sends AC-3,
// E-AC-3 and DTS through: sceAudioOutExConfigureOutput switches the HDMI audio mode, sceAudioOutExOpen
// opens a stereo 16-bit port at the carrier's rate, and IEC 61937 bursts written to it reach the sink
// as they are. The calls, their arguments and the mode numbers are SlopFin's findings (src/audio.cpp,
// tools/bitstream/README.md, GPL-3.0-or-later): a payload is refused them, an application is not.
#include "audio_sink.hpp"
#include "async_log.hpp"
#include "host_api.hpp"
#include "iec61937.hpp"
#include "thread_name.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <thread>
#include <vector>

extern "C" {
int sceAudioOutInit(void);
int sceAudioOutOutput(int handle, const void* samples);
int sceAudioOutExConfigureOutput(int zero, long unused, int mode, int device, long unused2);
int sceAudioOutExOpen(int user, int mode);
int sceAudioOutExClose(int handle);
int sceVideoOutGetHdmiRawEdid_(void* buffer, unsigned long size);
}

namespace {
constexpr int kAlreadyInitialized = static_cast<int>(0x8026000e);
constexpr int kSystemUser = 0xff;
constexpr int kAnyDevice = 255, kDefaultMode = 255;

// sceAudioOutExConfigureOutput's modes: 0 AC-3 5.1, 2 DTS 5.1, 3 E-AC-3 7.1 (a 192 kHz port).
int mode(iec61937::Codec codec) {
  return codec == iec61937::Codec::eac3 ? 3 : codec == iec61937::Codec::dts ? 2 : 0;
}

const char* name(iec61937::Codec codec) {
  return codec == iec61937::Codec::eac3 ? "eac3" : codec == iec61937::Codec::dts ? "dts" : "ac3";
}

struct Output {
  int handle = -1;
  iec61937::Codec codec = iec61937::Codec::ac3;
  host::BitstreamFill fill = nullptr;
  std::thread thread;
  std::atomic<bool> stop{false};
  std::atomic<std::uint64_t> grains{0}, errors{0};
};
Output output;

// The port's own grain, the same 5.3 ms at either rate. sceAudioOutOutput blocks for each, which paces
// the thread.
void run(std::size_t grain) {
  name_thread("audio-bitstream");
  std::vector<std::uint16_t> words(grain * 2);
  while (!output.stop.load(std::memory_order_relaxed)) {
    output.fill(words.data(), grain);
    if (sceAudioOutOutput(output.handle, words.data()) < 0) {
      if (output.errors.fetch_add(1) == 0) async_log::write("[PS5-REACT] bitstream output failed");
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
      continue;
    }
    output.grains.fetch_add(1, std::memory_order_relaxed);
  }
  sceAudioOutOutput(output.handle, nullptr); // drain the queued grain
}
} // namespace

namespace host {
bool has_bitstream() { return true; }

bool open_bitstream(iec61937::Codec codec, BitstreamFill fill) {
  close_bitstream();
  const int init = sceAudioOutInit();
  if (init != 0 && init != kAlreadyInitialized) {
    async_log::write("[PS5-REACT] bitstream sceAudioOutInit=0x%08x", static_cast<unsigned>(init));
    return false;
  }
  const auto began = std::chrono::steady_clock::now();
  const int configured = sceAudioOutExConfigureOutput(0, 0, mode(codec), kAnyDevice, 0);
  const int handle = configured >= 0 ? sceAudioOutExOpen(kSystemUser, mode(codec)) : -1;
  const long long ms = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - began).count();
  async_log::write("[PS5-REACT] bitstream %s mode=%d configure=0x%08x open=0x%08x in %lldms", name(codec), mode(codec),
                   static_cast<unsigned>(configured), static_cast<unsigned>(handle), ms);
  if (handle < 0) {
    if (configured >= 0) sceAudioOutExConfigureOutput(0, 0, kDefaultMode, kAnyDevice, 0);
    return false;
  }
  output.handle = handle;
  output.codec = codec;
  output.fill = fill;
  output.stop = false;
  output.grains = 0;
  output.errors = 0;
  output.thread = std::thread(run, codec == iec61937::Codec::eac3 ? 1024 : 256);
  return true;
}

void close_bitstream() {
  if (output.handle < 0) return;
  output.stop = true;
  if (output.thread.joinable()) output.thread.join();
  const int closed = sceAudioOutExClose(output.handle);
  const int restored = sceAudioOutExConfigureOutput(0, 0, kDefaultMode, kAnyDevice, 0);
  async_log::write("[PS5-REACT] bitstream %s closed after %llu grains, %llu errors: close=0x%08x restore=0x%08x",
                   name(output.codec), static_cast<unsigned long long>(output.grains.load()),
                   static_cast<unsigned long long>(output.errors.load()), static_cast<unsigned>(closed),
                   static_cast<unsigned>(restored));
  output.handle = -1;
}

bool sink_edid(std::vector<std::uint8_t>& edid) {
  // A block count, then up to four 128-byte EDID blocks (firmware 13.60).
  std::uint8_t buffer[513] = {};
  const int result = sceVideoOutGetHdmiRawEdid_(buffer, sizeof buffer);
  if (result != 0 || buffer[0] == 0) return false;
  edid.assign(buffer + 1, buffer + 1 + std::min<std::size_t>(buffer[0], 4) * 128);
  return true;
}
} // namespace host
