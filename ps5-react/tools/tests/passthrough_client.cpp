// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// tools/test_passthrough.py: the IEC 61937 packer and the EDID audio parser, driven from Python.
//   pack ac3|eac3|dts <in> <out> <piece bytes>   writes the bursts as the sink receives them (little-endian)
//   edid <file>                                   prints the capabilities as JSON
#include "audio_sink.hpp"
#include "iec61937.hpp"

#include <cstdio>
#include <cstring>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

namespace host {
bool sink_edid(std::vector<std::uint8_t>&) { return false; }
} // namespace host

namespace {
std::vector<std::uint8_t> read(const char* path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

int pack(const char* format, const char* in, const char* out, std::size_t piece) {
  const iec61937::Codec codec = !std::strcmp(format, "eac3") ? iec61937::Codec::eac3
                              : !std::strcmp(format, "dts") ? iec61937::Codec::dts : iec61937::Codec::ac3;
  const std::vector<std::uint8_t> stream = read(in);
  std::vector<std::uint8_t> bytes;
  const auto consume = [&](const std::uint16_t* words, std::size_t frames, std::int64_t) {
    for (std::size_t i = 0; i < frames * 2; ++i) {
      bytes.push_back(static_cast<std::uint8_t>(words[i] & 0xff));
      bytes.push_back(static_cast<std::uint8_t>(words[i] >> 8));
    }
  };
  static iec61937::Packer packer; // 64 KiB of buffers
  packer.reset(codec);
  for (std::size_t at = 0; at < stream.size(); at += piece)
    packer.feed(stream.data() + at, std::min(piece, stream.size() - at), static_cast<std::int64_t>(at), consume);
  packer.flush(consume);
  std::ofstream(out, std::ios::binary).write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  return 0;
}

std::string numbers(const std::vector<int>& values) {
  std::string out = "[";
  for (std::size_t i = 0; i < values.size(); ++i) out += (i ? "," : "") + std::to_string(values[i]);
  return out + "]";
}

int edid(const char* path) {
  const std::vector<std::uint8_t> data = read(path);
  const audio_sink::Capabilities caps = audio_sink::parse_edid(data.data(), data.size());
  std::printf("{\"known\":%s,\"name\":\"%s\",\"ac3\":%s,\"eac3\":%s,\"dts\":%s,\"pcmChannels\":%d,\"formats\":[",
              caps.known ? "true" : "false", caps.name.c_str(), caps.ac3 ? "true" : "false", caps.eac3 ? "true" : "false",
              caps.dts ? "true" : "false", caps.pcm_channels);
  for (std::size_t i = 0; i < caps.formats.size(); ++i) {
    const audio_sink::Format& f = caps.formats[i];
    std::printf("%s{\"codec\":\"%s\",\"channels\":%d,\"sampleRates\":%s,\"bitDepths\":%s,\"maxBitrate\":%d}", i ? "," : "",
                f.codec.c_str(), f.channels, numbers(f.rates).c_str(), numbers(f.bit_depths).c_str(), f.max_bitrate);
  }
  std::printf("]}\n");
  return 0;
}
} // namespace

int main(int argc, char** argv) {
  if (argc == 6 && !std::strcmp(argv[1], "pack")) return pack(argv[2], argv[3], argv[4], std::stoul(argv[5]));
  if (argc == 3 && !std::strcmp(argv[1], "edid")) return edid(argv[2]);
  std::fprintf(stderr, "usage: %s pack ac3|eac3|dts in out piece | edid file\n", argv[0]);
  return 2;
}
