// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Video audio through the sound mixer (sound_api.cpp): one stream slot plays the ring of the player
// that owns audio output. Render thread only: the mixer takes commands from one thread.
#pragma once

namespace hui::audio {
class StreamRing;
}
class BurstRing;
namespace iec61937 {
enum class Codec : unsigned char;
}

namespace video_audio {
// Opens the audio output if no sound did yet; false leaves video silent.
bool start();
// Plays `ring` from now on, or nothing (null): the mixer then stops reading the previous ring within a
// grain, but may read it until then.
void route(hui::audio::StreamRing* ring);
void set_gain(float gain);

// Passthrough (audio_output_api.cpp): bursts of AC-3, E-AC-3 or DTS go to the sink undecoded, past the
// mixer. Opening switches the HDMI audio mode and blocks, so a player's audio thread does it; `owner` is
// that player, and a close by anyone else is ignored. Opening another codec reopens the output.
bool open_bitstream(iec61937::Codec codec, const void* owner);
void close_bitstream(const void* owner);
// Render thread, as route(): the output plays `ring` from now on, or zeros (null), and may read the
// previous ring for a grain more.
void route_bitstream(BurstRing* ring);
// Muted, zeros reach the sink while the ring is still read. A bitstream has no volume: the sink's is it.
void set_bitstream_muted(bool muted);
} // namespace video_audio
