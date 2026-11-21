// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Video playback: one Player per <Video>. FFmpeg demuxes on one thread, video and audio decode on two
// more; the render thread picks the frame due at each present by the audio clock (gl_video.hpp draws it)
// and the sound mixer plays the audio.
#pragma once

#include "video_frame.hpp"
#include "video_subtitles.hpp"

#include <algorithm>
#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <deque>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

struct AVPacket;
struct AVFormatContext;

namespace video {

enum class State : std::uint8_t { loading, ready, buffering, ended, failed };

// Where the audio track goes. pcm: decoded, mixed down to the mixer's 48 kHz stereo. automatic: AC-3,
// E-AC-3 and DTS at 48 kHz go undecoded to a sink whose EDID lists them (audio_sink.hpp), the rest is
// decoded. passthrough: those three go undecoded whatever the EDID says; decoded only if the output refuses.
enum class AudioOutput : std::uint8_t { pcm, automatic, passthrough };

struct Track {
  int index = 0; // stream index in the file; an added subtitle file's is kExternalSubtitle and up
  std::string language, title, codec;
  int channels = 0;
  bool external = false;
};
constexpr int kExternalSubtitle = 1000;

// What JavaScript polls, copied out under the lock.
struct Status {
  State state = State::loading;
  bool paused = true, seeking = false;
  double position = 0, duration = 0, buffered = 0; // seconds
  int width = 0, height = 0;
  float aspect = 1;                                // pixel aspect ratio
  std::string error, video_codec, audio_codec, decoder;
  std::vector<Track> audio_tracks, subtitle_tracks;
  int audio_track = -1, subtitle_track = -1;
  std::string subtitle; // the subtitle text showing now, its lines separated by newlines
  std::uint64_t shown_frames = 0, dropped_frames = 0;
  // How far the clock had passed each newly shown frame's time, smoothed: positive means late. With
  // audio as the clock this is the picture's lag behind the sound.
  double late_ms = 0;
  bool audio_clock = false;
  bool audio_passthrough = false;  // the track goes to the sink undecoded
  int queued_frames = 0, queued_packets = 0; // decoded frames waiting, video packets waiting
  int starved_updates = 0;                   // frames presented while the next picture was not decoded yet
};

struct Options {
  bool paused = false, muted = false, loop = false;
  bool audio = true;                // decode audio for the mixer (set_audio_output)
  AudioOutput audio_output = AudioOutput::pcm;
  float volume = 1;
  double start = 0;                 // seconds
  std::vector<std::string> headers; // "Name: value" request headers for http(s)
};

class AudioRing;

class Player {
public:
  Player(std::string url, const Options& options);
  ~Player();
  Player(const Player&) = delete;
  Player& operator=(const Player&) = delete;

  // Control, on the render thread.
  void set_paused(bool paused, std::int64_t now_us);
  void seek(double seconds);
  void set_volume(float volume);
  void set_muted(bool muted);
  void set_loop(bool loop) { loop_ = loop; }
  // Plays the sound this much later than the picture (negative: earlier), to match a TV's delay.
  void set_audio_delay(double seconds) { audio_delay_us_ = static_cast<std::int64_t>(std::clamp(seconds, -2.0, 2.0) * 1e6); }
  void select_audio_track(int index); // a Track::index, or -1 for none
  void select_subtitle_track(int index); // a subtitle Track::index, or -1 for none
  // Loads a subtitle file (path or URL) on a thread of its own; returns its track index.
  int add_subtitle_file(const std::string& url, const std::string& language, const std::string& title);
  // Whether this player's audio goes to the mixer; one player at a time does.
  void set_audio_output(bool on);
  // Decoded or passed through; a change reads the track again from the playhead.
  void set_audio_mode(AudioOutput mode);

  // Stops playing audio and returns what the mixer may still read for a grain, to keep alive that long:
  // the player may then be destroyed on another thread.
  std::vector<std::shared_ptr<void>> detach_audio();

  // Once per frame, before presenting: advances the clock to `now_us`, picks the frame due then,
  // routes audio and settles the state.
  // `frame_us` is the display's frame interval: a picture is due within half of it.
  void update(std::int64_t now_us, std::int64_t frame_us);
  // The frame due now, or null before the first; valid until the next update().
  const Frame* frame() const { return shown_.planes[0] ? &shown_ : nullptr; }
  Status status() const;

private:
  struct Packet {
    AVPacket* packet = nullptr; // null: end of stream
    std::uint64_t serial = 0;
  };
  using PacketQueue = std::deque<Packet>;

  void demux_main();
  void video_main();
  void audio_main();
  void clear(PacketQueue& queue);
  std::int64_t media_now(std::int64_t now_us) const;
  void route(const std::shared_ptr<AudioRing>& ring, std::int64_t now_us);
  void apply_gain();
  double playhead_seconds() const;

  const std::string url_;
  const Options options_;
  bool loop_ = false;

  // Shared with the threads, under mutex_.
  mutable std::mutex mutex_;
  std::condition_variable wake_;
  std::atomic<bool> quit_{false};
  Status status_;
  PacketQueue video_packets_, audio_packets_;
  std::size_t queued_bytes_ = 0;
  std::deque<Frame> frames_;
  std::uint64_t serial_ = 1;            // bumped by every seek and audio track change
  std::int64_t seek_target_us_ = -1;    // demuxer seek pending, media time
  std::int64_t trim_before_us_ = 0;     // decoders drop output before this after a seek
  bool demux_eof_ = false, video_eof_ = false, audio_eof_ = false;
  bool opened_ = false, has_video_ = false;
  int audio_index_ = -1;                // the audio stream decoded, -1 for none
  bool decode_audio_ = false;           // set_audio_output
  AudioOutput audio_mode_ = AudioOutput::pcm;
  std::int64_t demuxed_us_ = 0;         // media time of the newest packet read
  std::int64_t playhead_us_ = 0;        // the clock at the last update, for read-ahead
  std::shared_ptr<AudioRing> filling_;  // the ring the audio thread writes for serial_
  std::uint64_t frame_sequence_ = 0;

  // Set by the demux thread before it starts the decoders; read-only afterwards.
  AVFormatContext* format_ = nullptr;
  int video_index_ = -1;
  std::int64_t start_us_ = 0;           // the container's first timestamp
  bool network_ = false;

  // Render thread.
  Frame shown_;
  std::uint64_t shown_serial_ = 0;
  std::int64_t heard_us_ = 0, heard_at_us_ = 0; // the audio clock's last step, and when it was seen
  std::int64_t first_shown_us_ = 0;
  std::shared_ptr<AudioRing> clock_ring_; // the ring timing the current serial, routed or not
  bool routed_ = false, routed_bitstream_ = false; // a ring is routed, and to the bitstream output
  bool audio_finished_ = false; // the clock ring ran out before the picture: the wall clock carries on
  std::vector<std::pair<std::shared_ptr<AudioRing>, std::int64_t>> retired_; // freed after the time
  bool audio_output_ = false, playing_ = false, muted_ = false;
  float volume_ = 1;
  std::int64_t audio_delay_us_ = 0;
  std::int64_t wall_anchor_us_ = 0, media_anchor_us_ = 0; // the clock without audio
  bool wall_running_ = false;

  // Subtitles, under mutex_: the selected track, its cues, and the files added.
  struct SubtitleFile {
    std::string url;
    std::vector<Cue> cues;
  };
  int subtitle_index_ = -1;
  bool subtitle_changed_ = false;
  std::vector<Cue> cues_;
  std::vector<SubtitleFile> subtitle_files_;
  std::vector<std::thread> subtitle_loaders_;

  std::thread demux_thread_, video_thread_, audio_thread_;
};

} // namespace video
