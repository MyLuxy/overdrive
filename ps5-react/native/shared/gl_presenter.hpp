// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include "damage_tracker.hpp"
#include "gl_video.hpp"
#include "er_scene.h"
#include <cstdint>
#include <span>
#include <string>
#include <vector>

// Presents the software framebuffer, over the engine's layers (er_get_layers) when it lists any.
// The caller owns the GL context.
// No components, fonts, layout, platform calls or dependencies on the UI kit.
class GlPresenter {
public:
  GlPresenter() = default;
  GlPresenter(const GlPresenter&) = delete;
  GlPresenter& operator=(const GlPresenter&) = delete;
  bool init(int width, int height);
  // Uploads the whole buffer. Afterwards the GPU copy no longer mirrors the
  // engine framebuffer, so the next damage draw uploads everything again.
  bool draw(const std::uint32_t* argb, int surface_width, int surface_height);
  // Uploads what changed (damage_tracker's contract): `moves` are replayed on the GPU copy of the
  // framebuffer, then the bands of `damage` uploaded. The first draw after the other overload, or
  // after a move that fails, uploads everything.
  bool draw(const std::uint32_t* argb, std::span<const ERRect> damage, std::span<const DamageMove> moves,
            int surface_width, int surface_height);
  // Whether set_layers() can draw: hosts enable engine layers only then (er_set_layers_enabled).
  bool layers_supported() const { return composite_program_ != 0; }
  // Video layers (video_api.hpp) upload through storage buffers when GL has them, else textures.
  void set_video_upload(bool storage) { video_.init(storage); }
  GlVideo& video() { return video_; }
  // The layers the next present draws beneath the framebuffer, bottom first; valid until that present.
  void set_layers(std::span<const ERLayer> layers) { layers_ = layers; }
  // Whether the screen already shows this frame: nothing damaged or moved, the layers as last drawn,
  // and the same surface. A host can then skip draw() and the swap, and wait for the next vblank itself;
  // on the PS5 a present costs the render thread about 2 ms of CPU even when nothing changed.
  bool unchanged(std::span<const ERRect> damage, std::span<const DamageMove> moves, int surface_width,
                 int surface_height) const;
  void release();
  // Where the last draw spent its CPU time: copying pixels to the GPU (framebuffer rows and new layer
  // images, which can block until the GPU is done with the previous frame's buffers), and issuing the
  // draws. Bytes count what was handed to GL.
  struct Timing { std::uint32_t upload_us = 0, draw_us = 0; std::uint64_t upload_bytes = 0; };
  const Timing& last_timing() const { return timing_; }

private:
  // The framebuffer lives in a texture the screen is drawn from, changed rows and moves applied
  // to it on the GPU. On the PS5 a draw costs the render thread about 25 us of CPU plus about 15 us
  // per MiB of the buffer textures it reads, and a glClear 120 us: what the presenter draws from
  // stays in 2D textures, and buffer textures carry only the rows being uploaded.
  unsigned int frame_ = 0, frame_fbo_ = 0, vao_ = 0;
  unsigned int composite_program_ = 0, stage_program_ = 0;
  // A copy of the framebuffer texture, created on the first move: GL cannot blit a texture onto itself.
  unsigned int scratch_ = 0, scratch_fbo_ = 0;
  int width_ = 0, height_ = 0, surface_width_ = 0, surface_height_ = 0;
  // Whether the framebuffer texture mirrors the engine framebuffer.
  bool synced_ = false;
  // Texels per buffer texture (1048576 on the PS5); 0 uploads with glTexSubImage2D instead.
  int max_texels_ = 0;
  // Buffer textures for uploads, reused each present, respecified to the size of their rows.
  struct Staging { unsigned int buffer = 0, texture = 0; };
  std::vector<Staging> staging_;
  std::size_t staged_ = 0;
  std::vector<std::uint32_t> packed_;
  // Layer images by engine image name, which the engine never reuses for other pixels, uploaded once.
  // Images no layer drew are kept, least recently drawn freed first past kKeptLayerImages, so a page
  // shown again does not upload its backdrop again.
  struct LayerImage {
    std::string name;
    int width = 0, height = 0;
    unsigned int texture = 0, fbo = 0;
    std::uint64_t drawn = 0;
  };
  static constexpr int kKeptLayerImages = 4;
  static constexpr int kPassLayers = 4;
  std::vector<LayerImage> layer_images_;
  std::uint64_t presents_ = 0;
  std::span<const ERLayer> layers_;
  // A layer to draw: an image, or (image null) a <Video> element's placeholder the player fills.
  // A layer to draw: an image, or a <Video> element's placeholder the player's picture replaces.
  struct Drawn { const ERLayer* layer; const LayerImage* image; bool video; };
  std::vector<Drawn> drawn_now_;
  // What the last present drew of layers_, image names copied: theirs are valid only until a commit.
  struct DrawnLayer {
    std::string image;
    ERLayer layer;
  };
  std::vector<DrawnLayer> drawn_layers_;
  GlVideo video_;
  Timing timing_;

  void upload_damage(const std::uint32_t* argb, std::span<const ERRect> damage);
  void upload_rows(unsigned int target, unsigned int fbo, int width, int height, const std::uint32_t* pixels,
                   int y0, int y1);
  void upload_rect(unsigned int target, unsigned int fbo, int width, int height, const std::uint32_t* pixels,
                   const ERRect& rect);
  bool move(const DamageMove& move);
  bool present(int surface_width, int surface_height);
  const LayerImage* layer_image(const ERLayer& layer);
  void free_layer_images(std::size_t keep);
  void composite(int x, int y, int w, int h);
  void composite_group(std::size_t begin, std::size_t end, bool opaque, bool with_frame, int x, int y, int w, int h);
};
