// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include "gl_upscale.hpp"
#include "video_frame.hpp"

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

// Draws decoded video frames for the presenter: YUV to RGB in a shader, HDR tone-mapped to SDR. Frames
// go up either as plane textures, or (GL 4.3 and later, the PS5's default) as one storage buffer the
// shader reads bytes from, which avoids the PS5's slow 2D texture uploads. The caller owns the context.
class GlVideo {
public:
  enum class Upload : std::uint8_t { textures, storage };
  enum class Fit : std::uint8_t { contain, cover, stretch };

  bool init(bool storage_allowed);
  void release();
  Upload upload_mode() const { return mode_; }

  struct Target {
    int x0, y0, x1, y1;          // the element's box, in framebuffer pixels
    int clip_x0, clip_y0, clip_x1, clip_y1;
    float alpha;
  };
  // Draws `frame` of video `id` into the target, in the viewport (x, y, w, h) that shows the
  // framebuffer of `fb_w` x `fb_h` pixels. Uploads a frame once however often it is drawn. With an
  // `upscale` model (upscalers::find), a picture shown bigger than the model's threshold is doubled first
  // (storage uploads only, as those come with compute shaders). Its passes are split over two display
  // frames, so each picture shows one display frame late. One upscaled video at a time.
  // With `compare` on, the picture right of `compare.split` (0..1 across the picture) goes through
  // `compare.model` instead (kNone: as it comes), run whole in the display frame its picture shows in.
  struct Compare {
    bool on = false;
    int model = upscalers::kNone;
    float split = 0.5f;
  };
  void draw(std::uint64_t id, const video::Frame& frame, Fit fit, const Target& target, int x, int y, int w, int h,
            int fb_w, int fb_h, int upscale, const Compare& compare);
  // Frees what no video drew since the last call.
  void end_present();

  // Bytes uploaded and microseconds spent uploading since the last call, for the frame log.
  std::uint64_t take_upload_bytes() { return std::exchange(upload_bytes_, 0); }
  std::uint32_t take_upload_us() { return std::exchange(upload_us_, 0); }
  // One line per upscaler that ran since the last call ("" for none): runs and GPU time.
  std::string take_upscale_log();
  // Dumps every upscaler's input and output at its `run`th run (GlUpscale::dump_at).
  void dump_upscale_at(const std::string& prefix, std::uint64_t run);

private:
  // One uploaded picture, and the upscaler result that goes with it.
  struct Planes {
    bool valid = false;
    std::uint64_t sequence = 0;
    video::Format format = video::Format::i420;
    int width = 0, height = 0;
    unsigned int buffer = 0;
    int offsets[3] = {}, pitches[3] = {};
    int model = upscalers::kNone;    // whose result in the slot of the same index belongs to it
    int tried = upscalers::kNone;    // the model a run on it last started with, done or not
    std::uint64_t generation = 0;
  };
  // An upscaler's input: the luma, or the picture as R'G'B'.
  struct Source {
    unsigned int texture = 0;
    int w = 0, h = 0;
    bool rgb = false;
  };
  struct Entry {
    std::uint64_t id = 0;
    bool drawn = false;
    unsigned int textures[3] = {};   // texture uploads, described by planes[0]
    // Storage uploads: the picture shown, and the next one while it is upscaled.
    Planes planes[2];
    int shown = 0;
    int job_model = upscalers::kNone; // upscaling planes[1 - shown]
    Source source;
    // The compare model's run: its own input, and the picture (by sequence) its result is of.
    Source compare_source;
    int compare_model = upscalers::kNone;
    std::uint64_t compare_sequence = 0, compare_generation = 0;
  };
  Entry& entry(std::uint64_t id);
  void upload_textures(Entry& entry, const video::Frame& frame);
  void upload_storage(Planes& planes, const video::Frame& frame);
  void free_entry(Entry& entry);
  GlUpscale* upscaler(int model);
  void extract(Source& source, const Planes& planes, const video::Frame& frame, bool rgb);
  bool start_upscale(Entry& entry, GlUpscale& upscaler, int model, const video::Frame& frame);
  void finish_upscale(Entry& entry, GlUpscale& upscaler);

  Upload mode_ = Upload::textures;
  unsigned int texture_program_ = 0, storage_program_ = 0, vao_ = 0;
  unsigned int extract_luma_ = 0, extract_rgb_ = 0;
  std::vector<GlUpscale> upscalers_;   // by model, initialized on first use
  std::vector<bool> upscaler_tried_;
  std::vector<Entry> entries_;
  std::uint64_t upload_bytes_ = 0;
  std::uint32_t upload_us_ = 0;
};
