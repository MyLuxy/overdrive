// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "gl_presenter.hpp"
#include "video_api.hpp"

#ifdef __APPLE__
#include <OpenGL/gl3.h>
#elif defined(PROSPERO)
#include <GL/glcorearb.h>
#else
#define GL_GLEXT_PROTOTYPES
#include <SDL2/SDL_opengl.h>
#endif

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstring>

namespace {
// Oversized triangle: one draw, no vertex buffer, no seam through the image.
const char* vertex_source = R"(#version 410 core
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
)";
// Copies a rect staged in a buffer texture, `width` texels a row from `first`, into the bound target
// texture, whose rows are image rows.
// The buffer holds 0xAARRGGBB words, which little-endian storage puts in B,G,R,A order.
const char* stage_fragment_source = R"(#version 410 core
uniform samplerBuffer rows;
uniform int width;
uniform ivec2 first;
out vec4 color;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy) - first;
  color = texelFetch(rows, p.y * width + p.x).bgra;
}
)";
// The screen in one pass: up to four layers bottom first, then the framebuffer over them, all
// premultiplied. `view` is the viewport showing the framebuffer; layer rects are framebuffer pixels
// (x0 y0 x1 y1), their src rects image pixels, their radii (tl tr br bl) the corner squares left to the
// framebuffer. The first pass composites over black, opaque; more layers take earlier passes, blended
// under the last.
const char* composite_fragment_source = R"(#version 410 core
uniform sampler2D frame;
uniform sampler2D images[4];
uniform int layer_count;
uniform bool with_frame;
uniform bool opaque;
uniform vec4 view;
uniform vec2 size;
uniform vec4 clip[4];
uniform vec4 dst[4];
uniform vec4 src[4];
uniform vec2 image[4];
uniform float alpha[4];
uniform vec4 radii[4];
out vec4 color;
void main() {
  vec2 p = vec2(gl_FragCoord.x - view.x, view.y + view.w - gl_FragCoord.y) * size / view.zw;
  vec4 c = vec4(0.0);
  for (int i = 0; i < 4; ++i) {
    if (i >= layer_count) break;
    if (any(lessThan(p, max(clip[i].xy, dst[i].xy))) || any(greaterThanEqual(p, min(clip[i].zw, dst[i].zw)))) continue;
    vec2 q = p - dst[i].xy, e = dst[i].zw - p;
    vec4 r = radii[i];
    if ((q.x < r.x && q.y < r.x) || (e.x <= r.y && q.y < r.y) || (e.x <= r.z && e.y <= r.z) ||
        (q.x < r.w && e.y <= r.w)) continue;
    vec2 at = mix(src[i].xy, src[i].zw, (p - dst[i].xy) / (dst[i].zw - dst[i].xy));
    vec4 l = textureLod(images[i], at / image[i], 0.0) * alpha[i];
    c = l + c * (1.0 - l.a);
  }
  if (with_frame) {
    vec4 f = textureLod(frame, p / size, 0.0);
    c = f + c * (1.0 - f.a);
  }
  color = opaque ? vec4(c.rgb, 1.0) : c;
}
)";

GLuint compile(GLenum type, const char* source) {
  GLuint shader = glCreateShader(type);
  glShaderSource(shader, 1, &source, nullptr);
  glCompileShader(shader);
  GLint ok = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[2048] = {};
    glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
    std::fprintf(stderr, "Shader compilation failed: %s\n", log);
    glDeleteShader(shader);
    return 0;
  }
  return shader;
}

GLuint link(GLuint vertex, GLuint fragment) {
  if (!vertex || !fragment) return 0;
  GLuint program = glCreateProgram();
  glAttachShader(program, vertex); glAttachShader(program, fragment);
  glLinkProgram(program);
  GLint linked = 0;
  glGetProgramiv(program, GL_LINK_STATUS, &linked);
  if (!linked) {
    char log[2048] = {};
    glGetProgramInfoLog(program, sizeof(log), nullptr, log);
    std::fprintf(stderr, "Shader link failed: %s\n", log);
    glDeleteProgram(program);
    return 0;
  }
  return program;
}

GLuint texture(int width, int height, GLenum filter) {
  GLuint id = 0;
  glGenTextures(1, &id);
  glBindTexture(GL_TEXTURE_2D, id);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, filter);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, filter);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
  return id;
}

GLuint framebuffer(GLuint target) {
  GLuint id = 0;
  glGenFramebuffers(1, &id);
  glBindFramebuffer(GL_FRAMEBUFFER, id);
  glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, target, 0);
  const bool complete = glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE;
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  if (!complete) glDeleteFramebuffers(1, &id);
  return complete ? id : 0;
}

std::uint32_t micros_since(std::chrono::steady_clock::time_point start) {
  return static_cast<std::uint32_t>(
    std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - start).count());
}
} // namespace

bool GlPresenter::init(int width, int height) {
  if (width <= 0 || height <= 0 || composite_program_) return false;
  width_ = width; height_ = height;
  synced_ = false;
  GLuint vertex = compile(GL_VERTEX_SHADER, vertex_source);
  GLuint composite = compile(GL_FRAGMENT_SHADER, composite_fragment_source);
  GLuint stage = compile(GL_FRAGMENT_SHADER, stage_fragment_source);
  composite_program_ = link(vertex, composite);
  stage_program_ = link(vertex, stage);
  for (GLuint shader : {vertex, composite, stage})
    if (shader) glDeleteShader(shader);
  if (!composite_program_) {
    release();
    return false;
  }
  glUseProgram(composite_program_);
  const GLint units[kPassLayers] = {1, 2, 3, 4};
  glUniform1i(glGetUniformLocation(composite_program_, "frame"), 0);
  glUniform1iv(glGetUniformLocation(composite_program_, "images"), kPassLayers, units);
  glUseProgram(0);
  glGenVertexArrays(1, &vao_);
  frame_ = texture(width, height, GL_LINEAR);
  frame_fbo_ = framebuffer(frame_);
  if (glGetError() != GL_NO_ERROR || !frame_fbo_) {
    release();
    return false;
  }
  GLint max_texels = 0;
  glGetIntegerv(GL_MAX_TEXTURE_BUFFER_SIZE, &max_texels);
  max_texels_ = stage_program_ ? max_texels : 0;
  video_.init(true);
  return true;
}

bool GlPresenter::draw(const std::uint32_t* argb, int sw, int sh) {
  if (!composite_program_ || !argb || sw <= 0 || sh <= 0) return false;
  synced_ = false;
  upload_rows(frame_, frame_fbo_, width_, height_, argb, 0, height_);
  return present(sw, sh);
}

bool GlPresenter::draw(const std::uint32_t* argb, std::span<const ERRect> damage, std::span<const DamageMove> moves,
                       int sw, int sh) {
  if (!composite_program_ || !argb || sw <= 0 || sh <= 0) return false;
  timing_ = {};
  const auto start = std::chrono::steady_clock::now();
  bool full = !synced_;
  for (const DamageMove& m : moves)
    if (!full && !move(m)) full = true;
  if (full) {
    upload_rows(frame_, frame_fbo_, width_, height_, argb, 0, height_);
  } else {
    upload_damage(argb, damage);
  }
  synced_ = true;
  timing_.upload_us = micros_since(start);
  const auto drawing = std::chrono::steady_clock::now();
  const bool ok = present(sw, sh);
  timing_.draw_us = micros_since(drawing);
  return ok;
}

bool GlPresenter::unchanged(std::span<const ERRect> damage, std::span<const DamageMove> moves, int sw,
                            int sh) const {
  if (!damage.empty() || !moves.empty() || !synced_ || sw != surface_width_ || sh != surface_height_ ||
      layers_.size() != drawn_layers_.size())
    return false;
  for (std::size_t i = 0; i < layers_.size(); ++i) {
    const ERLayer& a = layers_[i];
    const ERLayer& b = drawn_layers_[i].layer;
    // A playing video changes without the engine knowing.
    if (video_layers::Layer playing; video_layers::find(a.image, playing)) return false;
    if (drawn_layers_[i].image != (a.image ? a.image : "") || a.pixels != b.pixels || a.src_x != b.src_x ||
        a.src_y != b.src_y || a.src_w != b.src_w || a.src_h != b.src_h || a.alpha != b.alpha ||
        a.radius_tl != b.radius_tl || a.radius_tr != b.radius_tr || a.radius_br != b.radius_br ||
        a.radius_bl != b.radius_bl ||
        std::memcmp(&a.dst, &b.dst, sizeof a.dst) || std::memcmp(&a.clip, &b.clip, sizeof a.clip))
      return false;
  }
  return true;
}

// Damage close in rows goes up as one band, as wide as its rects together.
void GlPresenter::upload_damage(const std::uint32_t* argb, std::span<const ERRect> damage) {
  ERRect rects[ER_DAMAGE_RECTS_MAX];
  int count = 0;
  for (const ERRect& r : damage) {
    const int x0 = std::max(r.x, 0), y0 = std::max(r.y, 0);
    const int x1 = std::min(r.x + r.w, width_), y1 = std::min(r.y + r.h, height_);
    if (count < ER_DAMAGE_RECTS_MAX && x1 > x0 && y1 > y0) rects[count++] = {x0, y0, x1 - x0, y1 - y0};
  }
  std::sort(rects, rects + count, [](const ERRect& a, const ERRect& b) { return a.y < b.y; });
  constexpr int gap = 16;
  for (int i = 0; i < count;) {
    int x0 = rects[i].x, x1 = rects[i].x + rects[i].w, y0 = rects[i].y, y1 = rects[i].y + rects[i].h;
    for (++i; i < count && rects[i].y <= y1 + gap; ++i) {
      x0 = std::min(x0, rects[i].x); x1 = std::max(x1, rects[i].x + rects[i].w);
      y1 = std::max(y1, rects[i].y + rects[i].h);
    }
    upload_rect(frame_, frame_fbo_, width_, height_, argb, {x0, y0, x1 - x0, y1 - y0});
  }
}

void GlPresenter::upload_rows(unsigned int target, unsigned int fbo, int width, int height,
                              const std::uint32_t* pixels, int y0, int y1) {
  upload_rect(target, fbo, width, height, pixels, {0, y0, width, y1 - y0});
}

// `rect` of `pixels` (`width` words a row) into the texture behind `fbo`. It goes through buffer
// textures sized to it, drawn into the texture: a 2D texture upload converts the pixels on the CPU (on
// the PS5 about 15 ms for a million), and a draw costs CPU for every byte of the buffers it reads.
void GlPresenter::upload_rect(unsigned int target, unsigned int fbo, int width, int height,
                              const std::uint32_t* pixels, const ERRect& rect) {
  if (rect.w <= 0 || rect.h <= 0) return;
  const GLsizeiptr row = static_cast<GLsizeiptr>(rect.w) * 4;
  timing_.upload_bytes += static_cast<std::uint64_t>(rect.h) * row;
  const int chunk = max_texels_ / rect.w;
  if (chunk < 1) {
    glBindTexture(GL_TEXTURE_2D, target);
    glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
    glPixelStorei(GL_UNPACK_ROW_LENGTH, width);
    glTexSubImage2D(GL_TEXTURE_2D, 0, rect.x, rect.y, rect.w, rect.h, GL_BGRA, GL_UNSIGNED_BYTE,
                    pixels + static_cast<std::size_t>(rect.y) * width + rect.x);
    glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
    return;
  }
  glBindFramebuffer(GL_FRAMEBUFFER, fbo);
  glViewport(0, 0, width, height);
  glDisable(GL_BLEND);
  glEnable(GL_SCISSOR_TEST);
  glBindVertexArray(vao_);
  glUseProgram(stage_program_);
  glUniform1i(glGetUniformLocation(stage_program_, "rows"), 0);
  glUniform1i(glGetUniformLocation(stage_program_, "width"), rect.w);
  const GLint first = glGetUniformLocation(stage_program_, "first");
  // The target stays unbound while drawn into.
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, 0);
  for (int a = rect.y, y1 = rect.y + rect.h; a < y1; a += chunk) {
    const int b = std::min(a + chunk, y1);
    if (staged_ == staging_.size()) {
      Staging s;
      glGenBuffers(1, &s.buffer);
      glGenTextures(1, &s.texture);
      staging_.push_back(s);
    }
    const Staging& s = staging_[staged_++];
    // Respecifying the store each time spares waiting for the GPU to finish reading the last rows.
    glBindBuffer(GL_TEXTURE_BUFFER, s.buffer);
    const std::uint32_t* source = pixels + static_cast<std::size_t>(a) * width + rect.x;
    if (rect.w != width) {
      // Narrower than the image: the rows are packed first.
      packed_.resize(static_cast<std::size_t>(b - a) * rect.w);
      for (int y = a; y < b; ++y)
        std::memcpy(&packed_[static_cast<std::size_t>(y - a) * rect.w],
                    pixels + static_cast<std::size_t>(y) * width + rect.x, row);
      source = packed_.data();
    }
    glBufferData(GL_TEXTURE_BUFFER, (b - a) * row, source, GL_STREAM_DRAW);
    glBindTexture(GL_TEXTURE_BUFFER, s.texture);
    glTexBuffer(GL_TEXTURE_BUFFER, GL_RGBA8, s.buffer);
    glUniform2i(first, rect.x, a);
    glScissor(rect.x, a, rect.w, b - a);
    glDrawArrays(GL_TRIANGLES, 0, 3);
  }
  glBindBuffer(GL_TEXTURE_BUFFER, 0);
  glBindTexture(GL_TEXTURE_BUFFER, 0);
  glDisable(GL_SCISSOR_TEST);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
}

// Texture rows are framebuffer rows, so framebuffer coordinates address both blits directly. GL
// cannot blit a texture onto itself, hence the scratch copy.
bool GlPresenter::move(const DamageMove& m) {
  if (!scratch_) {
    scratch_ = texture(width_, height_, GL_NEAREST);
    scratch_fbo_ = framebuffer(scratch_);
    if (!scratch_fbo_) return false;
  }
  const ERRect& r = m.src;
  glBindFramebuffer(GL_READ_FRAMEBUFFER, frame_fbo_);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, scratch_fbo_);
  glBlitFramebuffer(r.x, r.y, r.x + r.w, r.y + r.h, r.x, r.y, r.x + r.w, r.y + r.h, GL_COLOR_BUFFER_BIT, GL_NEAREST);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, scratch_fbo_);
  glBindFramebuffer(GL_DRAW_FRAMEBUFFER, frame_fbo_);
  glBlitFramebuffer(r.x, r.y, r.x + r.w, r.y + r.h, r.x + m.dx, r.y + m.dy, r.x + m.dx + r.w, r.y + m.dy + r.h,
                    GL_COLOR_BUFFER_BIT, GL_NEAREST);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  return glGetError() == GL_NO_ERROR;
}

const GlPresenter::LayerImage* GlPresenter::layer_image(const ERLayer& layer) {
  for (LayerImage& image : layer_images_)
    if (image.name == layer.image) {
      image.drawn = presents_;
      return &image;
    }
  GLint max_size = 0;
  glGetIntegerv(GL_MAX_TEXTURE_SIZE, &max_size);
  if (!layer.pixels || layer.image_w <= 0 || layer.image_h <= 0 || layer.image_w > max_size ||
      layer.image_h > max_size)
    return nullptr;
  LayerImage image{layer.image, layer.image_w, layer.image_h, texture(layer.image_w, layer.image_h, GL_LINEAR), 0,
                   presents_};
  if (max_texels_ / layer.image_w > 0) image.fbo = framebuffer(image.texture);
  upload_rows(image.texture, image.fbo, image.width, image.height, layer.pixels, 0, image.height);
  // The texture keeps the pixels; its framebuffer is only for the upload.
  if (image.fbo) glDeleteFramebuffers(1, &image.fbo);
  image.fbo = 0;
  layer_images_.push_back(std::move(image));
  return &layer_images_.back();
}

// Frees the least recently drawn images until at most `keep` that this present did not draw remain.
void GlPresenter::free_layer_images(std::size_t keep) {
  std::sort(layer_images_.begin(), layer_images_.end(),
            [](const LayerImage& a, const LayerImage& b) { return a.drawn > b.drawn; });
  std::size_t idle = 0;
  std::erase_if(layer_images_, [&](LayerImage& image) {
    if (image.drawn == presents_ || ++idle <= keep) return false;
    glDeleteTextures(1, &image.texture);
    return true;
  });
}

// The screen: layers bottom first, then the framebuffer over them, all premultiplied; `x, y, w, h` is
// the viewport that shows the framebuffer. Image layers composite four to a draw; a <Video> layer is
// drawn by the player's renderer between the groups of image layers below and above it.
void GlPresenter::composite(int x, int y, int w, int h) {
  std::vector<Drawn>& drawn = drawn_now_;
  drawn.clear();
  for (const ERLayer& layer : layers_) {
    if (layer.clip.w <= 0 || layer.clip.h <= 0 || layer.dst.w <= 0 || layer.dst.h <= 0 || layer.alpha == 0) continue;
    if (video_layers::Layer playing; video_layers::find(layer.image, playing)) {
      if (playing.frame) drawn.push_back({&layer, nullptr, true});
    } else if (layer_image(layer)) {
      drawn.push_back({&layer, nullptr, false});
    }
  }
  // Creating an image can move the others, so the pointers are taken once all exist.
  for (Drawn& d : drawn)
    if (!d.video) d.image = layer_image(*d.layer);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glViewport(x, y, w, h);
  bool covered = false;
  std::size_t begin = 0;
  for (std::size_t i = 0; i < drawn.size(); ++i) {
    if (!drawn[i].video) continue;
    composite_group(begin, i, !covered, false, x, y, w, h);
    covered = covered || i > begin;
    video_layers::Layer playing;
    video_layers::find(drawn[i].layer->image, playing);
    const ERLayer& l = *drawn[i].layer;
    if (!covered) {
      glDisable(GL_SCISSOR_TEST);
      glClearColor(0, 0, 0, 1);
      glClear(GL_COLOR_BUFFER_BIT);
    }
    glEnable(GL_BLEND);
    glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    const GlVideo::Target target{l.dst.x, l.dst.y, l.dst.x + l.dst.w, l.dst.y + l.dst.h, l.clip.x, l.clip.y,
                                 l.clip.x + l.clip.w, l.clip.y + l.clip.h, l.alpha / 255.0f};
    video_.draw(playing.id, *playing.frame, playing.fit, target, x, y, w, h, width_, height_, playing.upscale,
                playing.compare);
    glDisable(GL_SCISSOR_TEST);
    covered = true;
    begin = i + 1;
  }
  composite_group(begin, drawn.size(), !covered, true, x, y, w, h);
  glDisable(GL_BLEND);
  glActiveTexture(GL_TEXTURE0);
  free_layer_images(kKeptLayerImages);
}

// Image layers drawn[begin, end), four to a draw, the framebuffer over the last with `with_frame`. With
// `opaque` the first draw replaces what is there (over black); later ones, and all without it, blend.
void GlPresenter::composite_group(std::size_t begin, std::size_t end, bool opaque, bool with_frame, int x, int y,
                                  int w, int h) {
  const std::vector<Drawn>& drawn = drawn_now_;
  const int passes = std::max<int>(with_frame ? 1 : 0, (int(end - begin) + kPassLayers - 1) / kPassLayers);
  if (!passes) return;
  glDisable(GL_SCISSOR_TEST);
  glBindFramebuffer(GL_FRAMEBUFFER, 0);
  glViewport(x, y, w, h);
  glBindVertexArray(vao_);
  glUseProgram(composite_program_);
  const auto at = [&](const char* name) { return glGetUniformLocation(composite_program_, name); };
  glUniform4f(at("view"), float(x), float(y), float(w), float(h));
  glUniform2f(at("size"), float(width_), float(height_));
  glActiveTexture(GL_TEXTURE0);
  glBindTexture(GL_TEXTURE_2D, frame_);
  glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
  for (int pass = 0; pass < passes; ++pass) {
    float clip[4 * kPassLayers] = {}, dst[4 * kPassLayers] = {}, src[4 * kPassLayers] = {};
    float size[2 * kPassLayers] = {}, alpha[kPassLayers] = {}, radii[4 * kPassLayers] = {};
    int count = 0;
    for (std::size_t i = begin + std::size_t(pass) * kPassLayers; i < end && count < kPassLayers; ++i, ++count) {
      const ERLayer& l = *drawn[i].layer;
      const float c[] = {float(l.clip.x), float(l.clip.y), float(l.clip.x + l.clip.w), float(l.clip.y + l.clip.h)};
      const float d[] = {float(l.dst.x), float(l.dst.y), float(l.dst.x + l.dst.w), float(l.dst.y + l.dst.h)};
      const float s[] = {float(l.src_x), float(l.src_y), float(l.src_x + l.src_w), float(l.src_y + l.src_h)};
      std::memcpy(clip + 4 * count, c, sizeof c);
      std::memcpy(dst + 4 * count, d, sizeof d);
      std::memcpy(src + 4 * count, s, sizeof s);
      const float r[] = {float(l.radius_tl), float(l.radius_tr), float(l.radius_br), float(l.radius_bl)};
      std::memcpy(radii + 4 * count, r, sizeof r);
      size[2 * count] = float(drawn[i].image->width);
      size[2 * count + 1] = float(drawn[i].image->height);
      alpha[count] = l.alpha / 255.0f;
      glActiveTexture(GL_TEXTURE1 + count);
      glBindTexture(GL_TEXTURE_2D, drawn[i].image->texture);
    }
    glUniform1i(at("layer_count"), count);
    if (count) {
      glUniform4fv(at("clip"), count, clip);
      glUniform4fv(at("dst"), count, dst);
      glUniform4fv(at("src"), count, src);
      glUniform2fv(at("image"), count, size);
      glUniform1fv(at("alpha"), count, alpha);
      glUniform4fv(at("radii"), count, radii);
    }
    glUniform1i(at("with_frame"), with_frame && pass == passes - 1);
    glUniform1i(at("opaque"), opaque && pass == 0);
    if (opaque && pass == 0) glDisable(GL_BLEND); else glEnable(GL_BLEND);
    glDrawArrays(GL_TRIANGLES, 0, 3);
  }
}

bool GlPresenter::present(int sw, int sh) {
  drawn_layers_.resize(layers_.size());
  for (std::size_t i = 0; i < layers_.size(); ++i)
    drawn_layers_[i] = {layers_[i].image ? layers_[i].image : "", layers_[i]};
  surface_width_ = sw; surface_height_ = sh;
  struct VideoDone {
    GlVideo& video;
    ~VideoDone() { video.end_present(); }
  } video_done{video_};
  ++presents_;
  glDisable(GL_DEPTH_TEST);
  glDisable(GL_FRAMEBUFFER_SRGB);
  if (sw == width_ && sh == height_) {
    composite(0, 0, sw, sh);
  } else {
    const float scale = std::min(float(sw) / width_, float(sh) / height_);
    const int vw = int(width_ * scale), vh = int(height_ * scale);
    glBindFramebuffer(GL_FRAMEBUFFER, 0);
    glViewport(0, 0, sw, sh);
    glDisable(GL_SCISSOR_TEST);
    glClearColor(0, 0, 0, 1); glClear(GL_COLOR_BUFFER_BIT);
    composite((sw - vw) / 2, (sh - vh) / 2, vw, vh);
  }
  staged_ = 0;
  return glGetError() == GL_NO_ERROR;
}

void GlPresenter::release() {
  video_.release();
  for (const LayerImage& image : layer_images_) glDeleteTextures(1, &image.texture);
  layer_images_.clear();
  for (const Staging& s : staging_) {
    glDeleteTextures(1, &s.texture);
    glDeleteBuffers(1, &s.buffer);
  }
  staging_.clear();
  layers_ = {};
  for (unsigned int* fbo : {&frame_fbo_, &scratch_fbo_})
    if (*fbo) glDeleteFramebuffers(1, fbo);
  for (unsigned int* tex : {&frame_, &scratch_})
    if (*tex) glDeleteTextures(1, tex);
  for (unsigned int* program : {&composite_program_, &stage_program_})
    if (*program) glDeleteProgram(*program);
  if (vao_) glDeleteVertexArrays(1, &vao_);
  frame_ = frame_fbo_ = scratch_ = scratch_fbo_ = composite_program_ = stage_program_ = vao_ = 0;
  max_texels_ = 0;
  synced_ = false;
}
