// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "video_player.hpp"
#include "audio_sink.hpp"
#include "burst_ring.hpp"
#include "iec61937.hpp"
#include "video_audio.hpp"
#include "thread_name.hpp"
#include "audio/stream_ring.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>
#include <libavutil/opt.h>
#include <libavutil/pixdesc.h>
#include <libswresample/swresample.h>
#include <libswscale/swscale.h>
}

#include <algorithm>
#include <chrono>
#include <cstring>
#include <optional>

namespace video {

namespace {
constexpr AVRational kMicroseconds = {1, 1000000};
constexpr int kAudioRate = 48000;
// The mixer has read a frame before the listener hears it: a grain plus the output's own buffer.
constexpr std::int64_t kAudioLatencyUs = 12000;
// Read ahead of the playhead: a network stream rides out stalls on more.
constexpr std::int64_t kNetworkReadAheadUs = 30'000'000, kLocalReadAheadUs = 4'000'000;
constexpr std::size_t kMaxQueuedBytes = 160u << 20;
// A stream that ran dry plays again with this much read ahead, not packet by packet.
constexpr std::int64_t kResumeReadAheadUs = 2'000'000;
// A stream FFmpeg's http gave up on is opened again at the packet it stopped at, this often, this long.
constexpr auto kReconnectInterval = std::chrono::seconds(2);
constexpr auto kReconnectFor = std::chrono::minutes(5);
// Decoded pictures queued ahead of the one shown: enough to ride out a 4K keyframe that holds the
// hardware decoder for several display frames.
constexpr std::size_t kMaxFrames = 8;
// Audio buffered before playback starts or resumes after a seek.
constexpr std::int64_t kAudioPrerollUs = 120'000;
// Late frames are skipped while a newer one is already due.
constexpr std::int64_t kNoPts = AV_NOPTS_VALUE;

std::string av_error(int code) {
  char text[AV_ERROR_MAX_STRING_SIZE] = {};
  av_strerror(code, text, sizeof text);
  return text;
}

std::string metadata(AVDictionary* dictionary, const char* key) {
  const AVDictionaryEntry* entry = av_dict_get(dictionary, key, nullptr, 0);
  return entry && entry->value ? entry->value : "";
}

Matrix frame_matrix(const AVFrame* frame) {
  switch (frame->colorspace) {
    case AVCOL_SPC_BT2020_NCL: case AVCOL_SPC_BT2020_CL: return Matrix::bt2020;
    case AVCOL_SPC_BT709: return Matrix::bt709;
    case AVCOL_SPC_BT470BG: case AVCOL_SPC_SMPTE170M: case AVCOL_SPC_FCC: return Matrix::bt601;
    default: return frame->height >= 720 ? Matrix::bt709 : Matrix::bt601; // untagged: by size, as players do
  }
}

Transfer frame_transfer(const AVFrame* frame) {
  return frame->color_trc == AVCOL_TRC_SMPTE2084 ? Transfer::pq
       : frame->color_trc == AVCOL_TRC_ARIB_STD_B67 ? Transfer::hlg : Transfer::sdr;
}

// FFmpeg's software decoder, for every codec FFmpeg knows. Frames in layouts the presenter does not
// draw are converted to the nearest 4:2:0 one.
class FfmpegDecoder final : public Decoder {
public:
  FfmpegDecoder(const AVCodecParameters* parameters, AVRational time_base, int threads) {
    const AVCodec* codec = avcodec_find_decoder(parameters->codec_id);
    if (!codec || !(context_ = avcodec_alloc_context3(codec))) return;
    avcodec_parameters_to_context(context_, parameters);
    context_->pkt_timebase = time_base;
    context_->thread_count = threads;
    context_->thread_type = FF_THREAD_FRAME | FF_THREAD_SLICE;
    if (avcodec_open2(context_, codec, nullptr) < 0) avcodec_free_context(&context_);
    frame_ = av_frame_alloc();
  }
  ~FfmpegDecoder() override {
    av_frame_free(&frame_);
    avcodec_free_context(&context_);
    sws_freeContext(scaler_);
  }
  bool ok() const { return context_ && frame_; }

  bool send(const AVPacket* packet) override {
    const int result = avcodec_send_packet(context_, packet);
    // A corrupt packet is skipped, as players do; EOF repeats are harmless.
    return result >= 0 || result == AVERROR_INVALIDDATA || result == AVERROR_EOF || result == AVERROR(EAGAIN);
  }

  bool receive(Frame& out, bool& ended) override {
    const int result = avcodec_receive_frame(context_, frame_);
    if (result == AVERROR_EOF) ended = true;
    if (result < 0) return false;
    Format format;
    AVFrame* kept = nullptr;
    switch (frame_->format) {
      case AV_PIX_FMT_YUV420P: case AV_PIX_FMT_YUVJ420P: format = Format::i420; break;
      case AV_PIX_FMT_NV12: format = Format::nv12; break;
      case AV_PIX_FMT_YUV420P10LE: format = Format::i420_10; break;
      case AV_PIX_FMT_P010LE: format = Format::p010; break;
      default: {
        const AVPixFmtDescriptor* descriptor = av_pix_fmt_desc_get(static_cast<AVPixelFormat>(frame_->format));
        const bool deep = descriptor && descriptor->comp[0].depth > 8;
        format = deep ? Format::i420_10 : Format::i420;
        kept = convert(frame_, deep ? AV_PIX_FMT_YUV420P10LE : AV_PIX_FMT_YUV420P);
      }
    }
    if (!kept) kept = av_frame_clone(frame_);
    av_frame_unref(frame_);
    if (!kept) return false;
    out.format = format;
    out.width = kept->width;
    out.height = kept->height;
    for (int i = 0; i < 3; ++i) {
      out.planes[i] = kept->data[i];
      out.pitch[i] = kept->linesize[i];
    }
    out.matrix = frame_matrix(kept);
    out.full_range = kept->color_range == AVCOL_RANGE_JPEG;
    out.transfer = frame_transfer(kept);
    out.aspect = kept->sample_aspect_ratio.num > 0 && kept->sample_aspect_ratio.den > 0
      ? static_cast<float>(av_q2d(kept->sample_aspect_ratio)) : 1.0f;
    const std::int64_t ts = kept->best_effort_timestamp != kNoPts ? kept->best_effort_timestamp : kept->pts;
    out.pts_us = ts == kNoPts ? kNoPts : av_rescale_q(ts, context_->pkt_timebase, kMicroseconds);
    out.owner = std::shared_ptr<void>(kept, [](void* frame) {
      AVFrame* f = static_cast<AVFrame*>(frame);
      av_frame_free(&f);
    });
    return true;
  }

  void flush() override { avcodec_flush_buffers(context_); }
  const char* name() const override { return "ffmpeg"; }

private:
  AVFrame* convert(const AVFrame* frame, AVPixelFormat to) {
    scaler_ = sws_getCachedContext(scaler_, frame->width, frame->height, static_cast<AVPixelFormat>(frame->format),
                                   frame->width, frame->height, to, SWS_BILINEAR, nullptr, nullptr, nullptr);
    AVFrame* out = av_frame_alloc();
    if (!scaler_ || !out) {
      av_frame_free(&out);
      return nullptr;
    }
    out->format = to;
    out->width = frame->width;
    out->height = frame->height;
    if (av_frame_get_buffer(out, 64) < 0 || av_frame_copy_props(out, frame) < 0) {
      av_frame_free(&out);
      return nullptr;
    }
    sws_scale(scaler_, frame->data, frame->linesize, 0, frame->height, out->data, out->linesize);
    return out;
  }

  AVCodecContext* context_ = nullptr;
  AVFrame* frame_ = nullptr;
  SwsContext* scaler_ = nullptr;
};

int decoder_threads() {
  const unsigned cpus = std::thread::hardware_concurrency();
  return static_cast<int>(std::clamp(cpus > 1 ? cpus - 1 : 4u, 2u, 6u));
}

int interrupted(void* opaque) { return static_cast<std::atomic<bool>*>(opaque)->load() ? 1 : 0; }

// The codecs a sink can be sent undecoded, at the 48 kHz their carriers are paced for. DTS Express has no
// core to send.
bool bitstream_codec(const AVCodecParameters* parameters, iec61937::Codec& codec) {
  if (parameters->sample_rate != 48000) return false;
  switch (parameters->codec_id) {
    case AV_CODEC_ID_AC3: codec = iec61937::Codec::ac3; return true;
    case AV_CODEC_ID_EAC3: codec = iec61937::Codec::eac3; return true;
    case AV_CODEC_ID_DTS: codec = iec61937::Codec::dts; return parameters->profile != AV_PROFILE_DTS_EXPRESS;
    default: return false;
  }
}

bool sink_takes(iec61937::Codec codec) {
  const audio_sink::Capabilities caps = audio_sink::current();
  return codec == iec61937::Codec::ac3 ? caps.ac3 : codec == iec61937::Codec::eac3 ? caps.eac3 : caps.dts;
}
} // namespace

// The audio of one serial, written by the audio thread and read while routed: stereo float PCM at 48 kHz
// by the mixer, or IEC 61937 bursts at their carrier's rate by the bitstream output.
class AudioRing {
public:
  AudioRing(std::uint64_t serial, int bitstream_rate) : serial(serial), rate(bitstream_rate ? bitstream_rate : kAudioRate) {
    // 0.68 s either way.
    if (bitstream_rate) burst = std::make_unique<BurstRing>(bitstream_rate > kAudioRate ? 1u << 17 : 1u << 15);
    else pcm = std::make_unique<hui::audio::StreamRing>(1u << 15);
  }
  const std::uint64_t serial;
  const int rate; // frames per second
  std::unique_ptr<hui::audio::StreamRing> pcm;
  std::unique_ptr<BurstRing> burst;
  std::atomic<std::int64_t> start_us{kNoPts};  // media time of the first frame
  std::atomic<std::uint64_t> written{0};
  std::atomic<bool> ended{false};              // the stream's last samples are in

  std::size_t available() const { return pcm ? pcm->available() : burst->available(); }
  // The media time the listener hears; it stands still while the ring is not read.
  std::int64_t heard_us() const {
    const std::uint64_t played = written.load() - available();
    return start_us.load() + static_cast<std::int64_t>(played) * 1000000 / rate - kAudioLatencyUs;
  }
  std::int64_t buffered_us() const { return static_cast<std::int64_t>(available()) * 1000000 / rate; }
  bool finished() const { return ended.load() && available() == 0; }
};

Player::Player(std::string url, const Options& options) : url_(std::move(url)), options_(options) {
  loop_ = options.loop;
  audio_output_ = decode_audio_ = options.audio;
  audio_mode_ = options.audio_output;
  muted_ = options.muted;
  volume_ = std::clamp(options.volume, 0.0f, 1.0f);
  playing_ = !options.paused;
  status_.paused = options.paused;
  if (options.start > 0) {
    seek_target_us_ = static_cast<std::int64_t>(options.start * 1e6);
    trim_before_us_ = seek_target_us_;
    media_anchor_us_ = seek_target_us_;
  }
  demux_thread_ = std::thread([this] { demux_main(); });
}

Player::~Player() {
  {
    std::lock_guard lock(mutex_);
    quit_ = true;
  }
  wake_.notify_all();
  if (demux_thread_.joinable()) demux_thread_.join();
  for (std::thread& loader : subtitle_loaders_) loader.join();
  if (video_thread_.joinable()) video_thread_.join();
  if (audio_thread_.joinable()) audio_thread_.join();
  clear(video_packets_);
  clear(audio_packets_);
  frames_.clear();
  avformat_close_input(&format_);
}

std::vector<std::shared_ptr<void>> Player::detach_audio() {
  if (routed_) route(nullptr, 0);
  std::vector<std::shared_ptr<void>> rings;
  if (clock_ring_) rings.push_back(clock_ring_);
  for (auto& [ring, until] : retired_) rings.push_back(ring);
  retired_.clear();
  return rings;
}

void Player::clear(PacketQueue& queue) {
  for (Packet& packet : queue) {
    if (packet.packet) queued_bytes_ -= packet.packet->size;
    av_packet_free(&packet.packet);
  }
  queue.clear();
}

// ---- demux thread ----

void Player::demux_main() {
  name_thread("video-demux");
  AVFormatContext* format = avformat_alloc_context();
  std::string error;
  if (format) {
    format->interrupt_callback = {interrupted, &quit_};
    AVDictionary* settings = nullptr;
    network_ = url_.rfind("http", 0) == 0;
    if (network_) {
      av_dict_set(&settings, "reconnect", "1", 0);
      av_dict_set(&settings, "reconnect_streamed", "1", 0);
      av_dict_set(&settings, "reconnect_on_network_error", "1", 0);
      av_dict_set(&settings, "reconnect_delay_max", "10", 0);
      av_dict_set(&settings, "rw_timeout", "15000000", 0);
      av_dict_set(&settings, "user_agent", "PS5React", 0);
      std::string headers;
      for (const std::string& header : options_.headers) headers += header + "\r\n";
      if (!headers.empty()) av_dict_set(&settings, "headers", headers.c_str(), 0);
    }
    int result = avformat_open_input(&format, url_.c_str(), nullptr, &settings);
    av_dict_free(&settings);
    if (result >= 0) result = avformat_find_stream_info(format, nullptr);
    if (result < 0) error = "video.open " + url_ + ": " + av_error(result);
  } else {
    error = "video.open " + url_ + ": out of memory";
  }
  const int video_index = error.empty() ? av_find_best_stream(format, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0) : -1;
  const int audio_index = error.empty() ? av_find_best_stream(format, AVMEDIA_TYPE_AUDIO, -1, video_index, nullptr, 0) : -1;
  if (error.empty() && video_index < 0 && audio_index < 0) error = "video.open " + url_ + ": no audio or video stream";
  {
    std::lock_guard lock(mutex_);
    if (!error.empty()) {
      status_.state = State::failed;
      status_.error = error;
      avformat_close_input(&format);
      return;
    }
    format_ = format;
    video_index_ = video_index;
    start_us_ = format->start_time != kNoPts ? format->start_time : 0;
    status_.duration = format->duration > 0 ? format->duration / 1e6 : 0;
    for (unsigned i = 0; i < format->nb_streams; ++i) {
      const AVStream* stream = format->streams[i];
      if (stream->codecpar->codec_type != AVMEDIA_TYPE_AUDIO) continue;
      Track track;
      track.index = static_cast<int>(i);
      track.language = metadata(stream->metadata, "language");
      track.title = metadata(stream->metadata, "title");
      track.codec = avcodec_get_name(stream->codecpar->codec_id);
      track.channels = stream->codecpar->ch_layout.nb_channels;
      status_.audio_tracks.push_back(track);
    }
    if (video_index >= 0) {
      AVStream* stream = format->streams[video_index];
      status_.width = stream->codecpar->width;
      status_.height = stream->codecpar->height;
      const AVRational sar = av_guess_sample_aspect_ratio(format, stream, nullptr);
      status_.aspect = sar.num > 0 && sar.den > 0 ? static_cast<float>(av_q2d(sar)) : 1.0f;
      status_.video_codec = avcodec_get_name(stream->codecpar->codec_id);
    }
    for (unsigned i = 0; i < format->nb_streams; ++i) {
      const AVStream* stream = format->streams[i];
      if (!is_text_subtitle(stream->codecpar)) continue;
      Track track;
      track.index = static_cast<int>(i);
      track.language = metadata(stream->metadata, "language");
      track.title = metadata(stream->metadata, "title");
      track.codec = avcodec_get_name(stream->codecpar->codec_id);
      // Files added before the open stay after the stream's own tracks.
      status_.subtitle_tracks.insert(std::find_if(status_.subtitle_tracks.begin(), status_.subtitle_tracks.end(),
                                                  [](const Track& t) { return t.external; }), track);
    }
    // An earlier select_audio_track wins over the demuxer's pick.
    if (status_.audio_track == -1 && audio_index_ == -1) audio_index_ = audio_index;
    status_.audio_track = audio_index_;
    if (audio_index_ >= 0) status_.audio_codec = avcodec_get_name(format->streams[audio_index_]->codecpar->codec_id);
    has_video_ = video_index >= 0;
    opened_ = true;
  }
  // Only the streams played are demuxed: the rest are skipped inside the demuxer.
  for (unsigned i = 0; i < format->nb_streams; ++i)
    if (static_cast<int>(i) != video_index && format->streams[i]->codecpar->codec_type != AVMEDIA_TYPE_AUDIO)
      format->streams[i]->discard = AVDISCARD_ALL;
  if (has_video_) video_thread_ = std::thread([this] { video_main(); });
  audio_thread_ = std::thread([this] { audio_main(); });

  std::unique_ptr<SubtitleDecoder> subtitles; // for the selected track of the file, if any
  int subtitle_stream = -1;
  std::vector<Cue> decoded_cues;
  AVPacket* packet = av_packet_alloc();
  int failures = 0;
  std::optional<std::chrono::steady_clock::time_point> broken_since;
  // The newest packet read of each stream: after reopening a broken stream, what is read again is skipped.
  std::vector<std::int64_t> last_read(format->nb_streams, kNoPts);
  bool rereading = false;
  const std::int64_t read_ahead = network_ ? kNetworkReadAheadUs : kLocalReadAheadUs;
  while (!quit_) {
    std::uint64_t serial;
    int audio_index;
    {
      std::unique_lock lock(mutex_);
      if (seek_target_us_ >= 0) {
        const std::int64_t target = seek_target_us_;
        seek_target_us_ = -1;
        lock.unlock();
        // Back to the keyframe at or before the target; the decoders trim up to it.
        const int sought = avformat_seek_file(format, -1, INT64_MIN, target + start_us_, target + start_us_, 0);
        lock.lock();
        if (sought < 0 && !quit_) status_.error = "video.seek: " + av_error(sought);
        demux_eof_ = false;
        demuxed_us_ = target;
        std::fill(last_read.begin(), last_read.end(), kNoPts);
        rereading = false;
        continue;
      }
      const bool full = queued_bytes_ >= kMaxQueuedBytes || demuxed_us_ - playhead_us_ >= read_ahead;
      if (demux_eof_ || full) {
        wake_.wait_for(lock, std::chrono::milliseconds(20));
        continue;
      }
      serial = serial_;
      audio_index = decode_audio_ ? audio_index_ : -1;
      if (subtitle_changed_) {
        subtitle_changed_ = false;
        subtitle_stream = subtitle_index_ >= 0 && subtitle_index_ < static_cast<int>(format->nb_streams) ? subtitle_index_ : -1;
        for (unsigned i = 0; i < format->nb_streams; ++i)
          if (format->streams[i]->codecpar->codec_type == AVMEDIA_TYPE_SUBTITLE)
            format->streams[i]->discard = static_cast<int>(i) == subtitle_stream ? AVDISCARD_DEFAULT : AVDISCARD_ALL;
        subtitles.reset();
        if (subtitle_stream >= 0) {
          const AVStream* stream = format->streams[subtitle_stream];
          subtitles = std::make_unique<SubtitleDecoder>(stream->codecpar, stream->time_base.num, stream->time_base.den);
        }
      }
    }
    const int result = av_read_frame(format, packet);
    std::unique_lock lock(mutex_);
    if (quit_) break;
    if (result < 0 && network_ && format->pb && format->pb->error < 0) {
      // FFmpeg's http stopped reconnecting: this is not the end. Open the stream again at the packets
      // it stopped at, until it reads, the player seeks or closes, or five minutes pass.
      const auto now = std::chrono::steady_clock::now();
      if (!broken_since) broken_since = now;
      if (now - *broken_since > kReconnectFor) {
        status_.state = State::failed;
        status_.error = "video read failed: " + av_error(format->pb->error);
        break;
      }
      wake_.wait_for(lock, kReconnectInterval, [&] { return quit_ || seek_target_us_ >= 0; });
      if (quit_ || seek_target_us_ >= 0) continue;
      const std::int64_t resume = demuxed_us_;
      lock.unlock();
      // Without what is buffered, the seek back reaches the server.
      format->pb->error = 0;
      avio_flush(format->pb);
      avformat_seek_file(format, -1, INT64_MIN, resume + start_us_, resume + start_us_, 0);
      rereading = true;
      continue;
    }
    if (result == AVERROR_EOF || (result < 0 && avio_feof(format->pb))) {
      // Null packets drain each decoder of the serial that reached the end.
      if (has_video_) video_packets_.push_back({nullptr, serial});
      audio_packets_.push_back({nullptr, serial});
      demux_eof_ = true;
      wake_.notify_all();
      continue;
    }
    if (result < 0) {
      // FFmpeg's http reconnects by itself; this is a stream that keeps failing.
      if (++failures > 50) {
        status_.state = State::failed;
        status_.error = "video read failed: " + av_error(result);
        break;
      }
      wake_.wait_for(lock, std::chrono::milliseconds(100));
      continue;
    }
    failures = 0;
    if (rereading) {
      // Back at a keyframe before where the stream broke: what was read already is skipped.
      std::int64_t& last = last_read[packet->stream_index];
      if (last != kNoPts && packet->dts != kNoPts && packet->dts <= last) {
        av_packet_unref(packet);
        continue;
      }
    }
    if (packet->dts != kNoPts) last_read[packet->stream_index] = packet->dts;
    broken_since.reset();
    if (packet->stream_index == subtitle_stream && subtitles) {
      // Cues are timed, so they outlast seeks; those well behind the playhead are dropped.
      decoded_cues.clear();
      lock.unlock();
      subtitles->decode(packet, start_us_, decoded_cues);
      lock.lock();
      for (Cue& cue : decoded_cues) {
        const auto at = std::upper_bound(cues_.begin(), cues_.end(), cue.start_us,
                                         [](std::int64_t t, const Cue& c) { return t < c.start_us; });
        if (at == cues_.begin() || std::prev(at)->start_us != cue.start_us || std::prev(at)->text != cue.text)
          cues_.insert(at, std::move(cue));
      }
      std::erase_if(cues_, [&](const Cue& c) { return c.end_us < playhead_us_ - 60'000'000; });
      av_packet_unref(packet);
      continue;
    }
    if (serial != serial_ || (packet->stream_index != video_index && packet->stream_index != audio_index)) {
      av_packet_unref(packet);
      continue;
    }
    AVStream* stream = format->streams[packet->stream_index];
    const std::int64_t ts = packet->pts != kNoPts ? packet->pts : packet->dts;
    if (ts != kNoPts) demuxed_us_ = std::max(demuxed_us_, av_rescale_q(ts, stream->time_base, kMicroseconds) - start_us_);
    AVPacket* queued = av_packet_alloc();
    av_packet_move_ref(queued, packet);
    queued_bytes_ += queued->size;
    (queued->stream_index == video_index ? video_packets_ : audio_packets_).push_back({queued, serial});
    wake_.notify_all();
  }
  av_packet_free(&packet);
}

// ---- video thread ----

void Player::video_main() {
  name_thread("video-decode");
  AVStream* stream = format_->streams[video_index_];
  std::unique_ptr<Decoder> decoder = make_platform_decoder(stream->codecpar, stream->time_base.num, stream->time_base.den);
  const std::int64_t pixels = static_cast<std::int64_t>(stream->codecpar->width) * stream->codecpar->height;
  if (!decoder && pixels <= software_pixel_limit()) {
    auto ffmpeg = std::make_unique<FfmpegDecoder>(stream->codecpar, stream->time_base, decoder_threads());
    if (ffmpeg->ok()) decoder = std::move(ffmpeg);
  }
  {
    std::lock_guard lock(mutex_);
    if (!decoder && pixels > software_pixel_limit()) {
      status_.state = State::failed;
      status_.error = "video.open " + url_ + ": " + status_.video_codec + " " + std::to_string(stream->codecpar->width) +
                      "x" + std::to_string(stream->codecpar->height) + " needs the hardware decoder, which does not take it";
      return;
    }
    if (!decoder) {
      status_.state = State::failed;
      status_.error = "video.open " + url_ + ": no decoder for " + status_.video_codec;
      return;
    }
    status_.decoder = decoder->name();
  }
  std::uint64_t serial = 0; // the serial whose frames the decoder holds
  while (true) {
    Packet packet;
    {
      std::unique_lock lock(mutex_);
      wake_.wait(lock, [&] {
        return quit_ || serial != serial_ || (!video_packets_.empty() && frames_.size() < kMaxFrames);
      });
      if (quit_) break;
      if (serial != serial_) {
        lock.unlock();
        decoder->flush();
        serial = serial_;
        continue;
      }
      packet = video_packets_.front();
      video_packets_.pop_front();
      if (packet.packet) queued_bytes_ -= packet.packet->size;
    }
    wake_.notify_all();
    if (packet.serial != serial) {
      av_packet_free(&packet.packet);
      continue;
    }
    const bool sent = decoder->send(packet.packet);
    av_packet_free(&packet.packet);
    if (!sent) {
      std::lock_guard lock(mutex_);
      status_.state = State::failed;
      status_.error = "video decode failed (" + status_.video_codec + ", " + decoder->name() + ")";
      break;
    }
    // Hand over every frame the packet completed.
    while (!quit_) {
      Frame frame;
      bool ended = false;
      const bool got = decoder->receive(frame, ended);
      std::lock_guard lock(mutex_);
      if (serial != serial_) break;
      if (!got) {
        if (ended) video_eof_ = true;
        break;
      }
      if (frame.pts_us != kNoPts) frame.pts_us -= start_us_;
      if (frame.pts_us != kNoPts && frame.pts_us < trim_before_us_) continue;
      frame.serial = serial;
      frame.sequence = ++frame_sequence_;
      frames_.push_back(std::move(frame));
    }
  }
}

// ---- audio thread ----

void Player::audio_main() {
  name_thread("video-audio");
  AVCodecContext* context = nullptr;
  SwrContext* resampler = nullptr;
  AVFrame* decoded = av_frame_alloc();
  std::vector<float> out;
  int stream_index = -1;
  AudioOutput stream_mode = AudioOutput::pcm;
  std::uint64_t serial = 0;
  std::shared_ptr<AudioRing> ring;
  // Passthrough: the packets are packed into bursts, not decoded.
  bool bitstream = false;
  iec61937::Codec codec = iec61937::Codec::ac3;
  std::unique_ptr<iec61937::Packer> packer;
  std::int64_t next_burst_us = kNoPts; // where the burst after the last one starts, for those with no time

  const auto open = [&](int index, AudioOutput mode) {
    avcodec_free_context(&context);
    swr_free(&resampler);
    stream_index = index;
    stream_mode = mode;
    const bool was_bitstream = bitstream;
    bitstream = false;
    if (index >= 0 && mode != AudioOutput::pcm && bitstream_codec(format_->streams[index]->codecpar, codec) &&
        (mode == AudioOutput::passthrough || sink_takes(codec)))
      bitstream = video_audio::open_bitstream(codec, this);
    if (was_bitstream && !bitstream) video_audio::close_bitstream(this);
    {
      std::lock_guard lock(mutex_);
      status_.audio_passthrough = bitstream;
    }
    if (bitstream) {
      if (!packer) packer = std::make_unique<iec61937::Packer>();
      packer->reset(codec);
      return;
    }
    if (index < 0) return;
    const AVStream* stream = format_->streams[index];
    const AVCodec* decoder = avcodec_find_decoder(stream->codecpar->codec_id);
    if (!decoder || !(context = avcodec_alloc_context3(decoder))) return;
    avcodec_parameters_to_context(context, stream->codecpar);
    context->pkt_timebase = stream->time_base;
    if (avcodec_open2(context, decoder, nullptr) < 0) avcodec_free_context(&context);
  };

  // Writes `frames` frames to the ring, waiting for room: the ring fills to its capacity, then waits for
  // the mixer or the bitstream output, which paces the thread. False when a seek or close came first.
  const auto fill = [&](const auto* data, std::size_t frames, auto write) {
    while (frames && !quit_) {
      const std::size_t wrote = write(data, frames);
      ring->written += wrote;
      data += wrote * 2;
      frames -= wrote;
      if (!frames) break;
      std::unique_lock lock(mutex_);
      if (serial != serial_) return false;
      wake_.wait_for(lock, std::chrono::milliseconds(5));
    }
    return !quit_;
  };

  // A burst from the packer: timed by its first frame's packet, or as following the previous burst.
  const auto burst = [&](const std::uint16_t* words, std::size_t frames, std::int64_t time) {
    const std::int64_t at = time != kNoPts ? time : next_burst_us;
    const std::int64_t length = static_cast<std::int64_t>(frames) * 1000000 / iec61937::carrier_rate(codec);
    next_burst_us = at == kNoPts ? kNoPts : at + length;
    std::int64_t trim;
    {
      std::lock_guard lock(mutex_);
      if (serial != serial_) return;
      trim = trim_before_us_;
      if (!ring) {
        ring = std::make_shared<AudioRing>(serial, iec61937::carrier_rate(codec));
        filling_ = ring;
      }
    }
    // A burst cannot be cut: the one the seek target falls in plays whole, the clock starting at its start.
    if (at != kNoPts && at + length <= trim) return;
    if (ring->start_us.load() == kNoPts) ring->start_us = at == kNoPts ? trim : at;
    fill(words, frames, [&](const std::uint16_t* data, std::size_t count) { return ring->burst->write(data, count); });
  };

  while (true) {
    Packet packet;
    {
      std::unique_lock lock(mutex_);
      wake_.wait(lock, [&] { return quit_ || serial != serial_ || !audio_packets_.empty(); });
      if (quit_) break;
      if (serial != serial_) {
        serial = serial_;
        ring.reset();
        const int index = decode_audio_ ? audio_index_ : -1;
        const AudioOutput mode = audio_mode_;
        lock.unlock();
        if (index != stream_index || mode != stream_mode || (!context && !bitstream)) open(index, mode);
        else if (context) avcodec_flush_buffers(context);
        else packer->reset(codec);
        if (resampler) swr_init(resampler);
        next_burst_us = kNoPts;
        continue;
      }
      packet = audio_packets_.front();
      audio_packets_.pop_front();
      if (packet.packet) queued_bytes_ -= packet.packet->size;
    }
    wake_.notify_all();
    if (packet.serial != serial || (!context && !bitstream)) {
      av_packet_free(&packet.packet);
      continue;
    }
    if (bitstream) {
      if (packet.packet) {
        const AVStream* stream = format_->streams[stream_index];
        const std::int64_t ts = packet.packet->pts != kNoPts ? packet.packet->pts : packet.packet->dts;
        const std::int64_t at = ts == kNoPts ? kNoPts : av_rescale_q(ts, stream->time_base, kMicroseconds) - start_us_;
        packer->feed(packet.packet->data, static_cast<std::size_t>(packet.packet->size), at, burst);
        av_packet_free(&packet.packet);
        continue;
      }
      packer->flush(burst);
      std::lock_guard lock(mutex_);
      if (serial == serial_) {
        audio_eof_ = true;
        if (ring) ring->ended = true;
      }
      continue;
    }
    if (avcodec_send_packet(context, packet.packet) < 0 && packet.packet) {
      av_packet_free(&packet.packet);
      continue; // a corrupt packet; the next one decodes
    }
    const bool draining = !packet.packet;
    av_packet_free(&packet.packet);
    while (!quit_) {
      const int result = avcodec_receive_frame(context, decoded);
      if (result < 0) {
        if (result == AVERROR_EOF && draining) {
          std::lock_guard lock(mutex_);
          if (serial == serial_) {
            audio_eof_ = true;
            if (ring) ring->ended = true;
          }
        }
        break;
      }
      // Any layout and rate in, stereo float at the mixer's 48 kHz out.
      if (!resampler) {
        AVChannelLayout stereo = AV_CHANNEL_LAYOUT_STEREO;
        // A stream that only says how many channels it has gets the usual layout for that count.
        AVChannelLayout input;
        if (decoded->ch_layout.order == AV_CHANNEL_ORDER_UNSPEC)
          av_channel_layout_default(&input, decoded->ch_layout.nb_channels);
        else
          av_channel_layout_copy(&input, &decoded->ch_layout);
        swr_alloc_set_opts2(&resampler, &stereo, AV_SAMPLE_FMT_FLT, kAudioRate, &input,
                            static_cast<AVSampleFormat>(decoded->format), decoded->sample_rate, 0, nullptr);
        av_channel_layout_uninit(&input);
        if (!resampler || swr_init(resampler) < 0) {
          swr_free(&resampler);
          av_frame_unref(decoded);
          break;
        }
      }
      const std::int64_t ts = decoded->best_effort_timestamp != kNoPts ? decoded->best_effort_timestamp : decoded->pts;
      std::int64_t pts_us = ts == kNoPts ? kNoPts : av_rescale_q(ts, context->pkt_timebase, kMicroseconds) - start_us_;
      const int capacity = swr_get_out_samples(resampler, decoded->nb_samples);
      out.resize(static_cast<std::size_t>(std::max(capacity, 0)) * 2);
      std::uint8_t* target = reinterpret_cast<std::uint8_t*>(out.data());
      int frames = swr_convert(resampler, &target, capacity, const_cast<const std::uint8_t**>(decoded->extended_data),
                               decoded->nb_samples);
      av_frame_unref(decoded);
      if (frames <= 0) continue;
      const float* samples = out.data();
      std::int64_t trim;
      {
        std::lock_guard lock(mutex_);
        if (serial != serial_) break;
        trim = trim_before_us_;
        if (!ring) {
          ring = std::make_shared<AudioRing>(serial, 0);
          filling_ = ring;
        }
      }
      // Samples before a seek target are dropped, so audio starts where the picture does.
      if (pts_us != kNoPts && pts_us < trim) {
        const std::int64_t skip = (trim - pts_us) * kAudioRate / 1000000;
        if (skip >= frames) continue;
        samples += skip * 2;
        frames -= static_cast<int>(skip);
        pts_us = trim;
      }
      if (ring->start_us.load() == kNoPts) ring->start_us = pts_us == kNoPts ? trim : pts_us;
      if (!fill(samples, static_cast<std::size_t>(frames), [&](const float* data, std::size_t count) {
            return ring->pcm->write(data, count);
          }))
        break;
    }
  }
  if (bitstream) video_audio::close_bitstream(this);
  av_frame_free(&decoded);
  avcodec_free_context(&context);
  swr_free(&resampler);
}

// ---- render thread ----

std::int64_t Player::media_now(std::int64_t now_us) const {
  if (clock_ring_ && clock_ring_->start_us.load() != kNoPts && !audio_finished_) return clock_ring_->heard_us();
  return wall_running_ ? media_anchor_us_ + (now_us - wall_anchor_us_) : media_anchor_us_;
}

void Player::route(const std::shared_ptr<AudioRing>& ring, std::int64_t now_us) {
  if (ring && routed_ && ring == clock_ring_) return;
  if (!ring && !routed_) return;
  // PCM goes to the mixer's slot, bursts to the bitstream output; whichever slot had the old ring lets go.
  const bool bitstream = ring ? static_cast<bool>(ring->burst) : routed_bitstream_;
  if (routed_ && routed_bitstream_ != bitstream) {
    if (routed_bitstream_) video_audio::route_bitstream(nullptr);
    else video_audio::route(nullptr);
  }
  if (bitstream) video_audio::route_bitstream(ring ? ring->burst.get() : nullptr);
  else video_audio::route(ring ? ring->pcm.get() : nullptr);
  routed_ = static_cast<bool>(ring);
  routed_bitstream_ = bitstream;
  // The mixer may read a ring swapped out for a few more grains; it stays alive until then.
  if (clock_ring_ && clock_ring_ != ring) retired_.emplace_back(clock_ring_, now_us + 200'000);
  if (ring && ring != clock_ring_) audio_finished_ = false;
  if (ring) clock_ring_ = ring;
  apply_gain();
}

void Player::apply_gain() {
  if (!routed_) return;
  if (routed_bitstream_) video_audio::set_bitstream_muted(muted_ || volume_ <= 0);
  else video_audio::set_gain(muted_ ? 0.0f : volume_);
}

void Player::set_audio_mode(AudioOutput mode) {
  {
    std::lock_guard lock(mutex_);
    if (mode == audio_mode_) return;
    audio_mode_ = mode;
  }
  if (audio_output_) seek(playhead_seconds());
}

void Player::set_audio_output(bool on) {
  if (on == audio_output_) return;
  audio_output_ = on;
  {
    std::lock_guard lock(mutex_);
    decode_audio_ = on;
  }
  if (!on) route(nullptr, 0);
  // Decoding audio starts or stops at the playhead: a seek there refills the queues with it.
  seek(playhead_seconds());
}

double Player::playhead_seconds() const {
  std::lock_guard lock(mutex_);
  return playhead_us_ / 1e6;
}

void Player::set_paused(bool paused, std::int64_t now_us) {
  if (paused == !playing_) return;
  if (paused) {
    media_anchor_us_ = media_now(now_us);
    wall_running_ = false;
    if (routed_) route(nullptr, now_us); // the ring stays the clock, frozen where the mixer stopped
  }
  playing_ = !paused;
  std::lock_guard lock(mutex_);
  status_.paused = paused;
}

void Player::seek(double seconds) {
  const std::int64_t target = std::max<std::int64_t>(0, static_cast<std::int64_t>(seconds * 1e6));
  {
    std::lock_guard lock(mutex_);
    ++serial_;
    seek_target_us_ = trim_before_us_ = target;
    clear(video_packets_);
    clear(audio_packets_);
    frames_.clear();
    demux_eof_ = video_eof_ = audio_eof_ = false;
    filling_.reset();
    playhead_us_ = demuxed_us_ = target;
    status_.seeking = true;
    if (status_.state == State::ended) status_.state = State::ready;
  }
  wake_.notify_all();
  // Until the new serial's audio is routed, the clock waits at the target.
  if (routed_) route(nullptr, 0);
  if (clock_ring_) retired_.emplace_back(clock_ring_, 0);
  clock_ring_.reset();
  audio_finished_ = false;
  media_anchor_us_ = target;
  wall_running_ = false;
}

void Player::set_volume(float volume) {
  volume_ = std::clamp(volume, 0.0f, 1.0f);
  apply_gain();
}

void Player::set_muted(bool muted) {
  muted_ = muted;
  apply_gain();
}

void Player::select_audio_track(int index) {
  {
    std::lock_guard lock(mutex_);
    if (index == audio_index_) return;
    audio_index_ = index;
    status_.audio_track = index;
    status_.audio_codec = index >= 0 && format_ && index < static_cast<int>(format_->nb_streams)
      ? avcodec_get_name(format_->streams[index]->codecpar->codec_id) : "";
  }
  if (audio_output_) seek(playhead_seconds());
}

void Player::select_subtitle_track(int index) {
  bool embedded, opened;
  {
    std::lock_guard lock(mutex_);
    opened = opened_;
    if (index == subtitle_index_) return;
    subtitle_index_ = index;
    status_.subtitle_track = index;
    subtitle_changed_ = true;
    cues_.clear();
    const int file = index - kExternalSubtitle;
    if (file >= 0 && file < static_cast<int>(subtitle_files_.size())) cues_ = subtitle_files_[file].cues;
    embedded = index >= 0 && index < kExternalSubtitle;
  }
  wake_.notify_all();
  // The cues of a track of the file come with its packets: read again from the playhead.
  if (embedded && opened) seek(playhead_seconds());
}

int Player::add_subtitle_file(const std::string& url, const std::string& language, const std::string& title) {
  std::lock_guard lock(mutex_);
  const int index = kExternalSubtitle + static_cast<int>(subtitle_files_.size());
  subtitle_files_.push_back({url, {}});
  Track track;
  track.index = index;
  track.language = language;
  track.title = title;
  track.codec = "file";
  track.external = true;
  status_.subtitle_tracks.push_back(track);
  subtitle_loaders_.emplace_back([this, url, index] {
    name_thread("video-subtitles");
    std::vector<Cue> cues;
    std::string error;
    const bool loaded = load_subtitle_file(url, options_.headers, cues, error);
    std::lock_guard lock(mutex_);
    if (!loaded) {
      status_.error = error;
      return;
    }
    subtitle_files_[index - kExternalSubtitle].cues = cues;
    if (subtitle_index_ == index) cues_ = std::move(cues);
  });
  return index;
}

void Player::update(std::int64_t now_us, std::int64_t frame_us) {
  std::erase_if(retired_, [&](const auto& entry) { return entry.second <= now_us; });
  std::unique_lock lock(mutex_);
  if (status_.state == State::failed) return;
  const std::uint64_t serial = serial_;
  const bool first = shown_serial_ != serial;

  // Audio of this serial starts once it has a little buffered and the picture is there to go with it.
  std::shared_ptr<AudioRing> filling = filling_ && filling_->serial == serial ? filling_ : nullptr;
  const bool picture = !has_video_ || !first || (!frames_.empty() && frames_.front().serial == serial);
  if (playing_ && audio_output_ && filling && !routed_ && picture && status_.state != State::buffering &&
      (filling->buffered_us() >= kAudioPrerollUs || filling->ended.load())) {
    lock.unlock();
    route(filling, now_us);
    lock.lock();
  }
  const bool audio_heard = clock_ring_ && clock_ring_->serial == serial && clock_ring_->start_us.load() != kNoPts;
  // Sound that ends before the picture leaves the clock to the wall clock, from where it stopped.
  if (audio_heard && has_video_ && !audio_finished_ && clock_ring_->finished()) {
    media_anchor_us_ = clock_ring_->heard_us();
    wall_running_ = false;
    audio_finished_ = true;
  }
  const bool audio_clock = audio_heard && !audio_finished_;
  // Without audio the wall clock runs from the first frame shown. With audio coming it waits for it,
  // so the picture does not run ahead and then skip back: half a second at most, for broken audio.
  const bool audio_coming = audio_output_ && audio_index_ >= 0 && !audio_eof_ && now_us - first_shown_us_ < 500'000;
  if (!audio_clock && !audio_coming && playing_ && !first && !wall_running_ && status_.state != State::buffering) {
    wall_anchor_us_ = now_us;
    wall_running_ = true;
  }
  std::int64_t media = media_now(now_us);
  // The mixer reads the ring a grain (about 5 ms) at a time, so the audio clock moves in steps; between
  // steps it advances with the wall clock, by at most a grain.
  if (audio_clock && routed_) {
    if (media != heard_us_) {
      heard_us_ = media;
      heard_at_us_ = now_us;
    } else {
      media += std::min<std::int64_t>(now_us - heard_at_us_, 6000);
    }
  }

  // The frame due by this display frame: within half a display frame, so the cadence holds against clock
  // jitter (a 60 fps video on a 60 Hz display shows each picture once). One new picture per display frame,
  // unless the next is a whole half frame late; skipped ones count as dropped.
  if (first) {
    if (!frames_.empty() && frames_.front().serial == serial) {
      shown_ = std::move(frames_.front());
      frames_.pop_front();
      shown_serial_ = serial;
      first_shown_us_ = now_us;
      ++status_.shown_frames;
      if (!audio_clock) media_anchor_us_ = shown_.pts_us != kNoPts ? shown_.pts_us : media_anchor_us_;
      status_.seeking = false;
      wake_.notify_all();
    }
  } else if (playing_) {
    // Paused, the picture stays; only a seek shows a new one (above), so scrubbing while paused works.
    const std::int64_t half = std::max<std::int64_t>(frame_us / 2, 1000);
    // Sound delayed against the picture: the picture is chosen for that much later.
    const std::int64_t due = audio_clock ? media + audio_delay_us_ : media;
    bool advanced = false;
    while (!frames_.empty()) {
      const std::int64_t pts = frames_.front().pts_us;
      if (pts != kNoPts && pts > due + half) break;
      if (advanced && pts != kNoPts && pts > due - half) break;
      if (advanced) ++status_.dropped_frames;
      shown_ = std::move(frames_.front());
      frames_.pop_front();
      advanced = true;
    }
    if (advanced) {
      ++status_.shown_frames;
      if (shown_.pts_us != kNoPts) status_.late_ms += ((due - shown_.pts_us) / 1000.0 - status_.late_ms) * 0.1;
      wake_.notify_all();
    }
  }
  if (!has_video_ && audio_clock) status_.seeking = false;

  // States.
  const bool started = has_video_ ? shown_serial_ == serial : audio_clock;
  const bool video_done = !has_video_ || (video_eof_ && frames_.empty());
  const bool audio_done = !audio_clock || clock_ring_->finished() ||
                          !audio_output_ || audio_index_ < 0;
  // A stream run dry: nothing read ahead, and the picture or the sound has nothing left to play.
  const bool dry = network_ && started && playing_ && !demux_eof_ && demuxed_us_ - playhead_us_ < 500'000 &&
                   ((has_video_ && frames_.empty() && video_packets_.empty() && !video_eof_) ||
                    (audio_clock && clock_ring_->available() == 0 && audio_packets_.empty() &&
                     !clock_ring_->ended.load()));
  const bool refilled = demux_eof_ || queued_bytes_ >= kMaxQueuedBytes || demuxed_us_ - playhead_us_ >= kResumeReadAheadUs;
  bool unroute = false;
  if (opened_ && started) {
    if (demux_eof_ && video_done && audio_done) {
      status_.state = State::ended;
    } else if (dry || (status_.state == State::buffering && !refilled)) {
      // The clock stops where it is; the sound stops with it and starts again once it is refilled.
      if (status_.state != State::buffering && wall_running_) {
        media_anchor_us_ = media;
        wall_running_ = false;
      }
      unroute = routed_;
      status_.state = State::buffering;
    } else {
      status_.state = State::ready;
    }
  }
  playhead_us_ = std::max<std::int64_t>(0, media);
  if (status_.state == State::ended && status_.duration > 0) playhead_us_ = static_cast<std::int64_t>(status_.duration * 1e6);
  status_.position = playhead_us_ / 1e6;
  status_.subtitle = cue_text(cues_, playhead_us_);
  status_.buffered = demuxed_us_ / 1e6;
  status_.paused = !playing_;
  status_.audio_clock = audio_clock;
  status_.queued_frames = static_cast<int>(frames_.size());
  status_.queued_packets = static_cast<int>(video_packets_.size());
  if (playing_ && started && frames_.empty() && !video_eof_ && status_.state != State::buffering) ++status_.starved_updates;
  const bool restart = status_.state == State::ended && loop_;
  lock.unlock();
  if (unroute) route(nullptr, now_us);
  if (restart) seek(0);
}

Status Player::status() const {
  std::lock_guard lock(mutex_);
  return status_;
}

} // namespace video
