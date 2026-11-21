// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "gl_video.hpp"

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
#include <cmath>
#include <cstdio>
#include <string>

namespace {
const char* vertex_source = R"(#version 410 core
uniform vec4 dst;   // framebuffer pixels: x0 y0 x1 y1
uniform vec4 src;   // the part of the picture drawn, 0..1: x0 y0 x1 y1; beyond it, `contain`'s black bars
uniform vec2 size;  // the framebuffer
out vec2 at;
void main() {
  vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  vec2 p = mix(dst.xy, dst.zw, corner);
  gl_Position = vec4(p.x / size.x * 2.0 - 1.0, 1.0 - p.y / size.y * 2.0, 0.0, 1.0);
  at = mix(src.xy, src.zw, corner);
}
)";

// YUV to display RGB, shared by both programs. `yuv` holds normalized samples.
const char* color_source = R"(
uniform mat3 matrix;     // Y'CbCr (range-expanded) to R'G'B'
uniform vec3 offset;     // subtracted first: black level and chroma zero
uniform vec3 gain;       // range expansion per component
uniform int transfer;    // 0 SDR, 1 PQ, 2 HLG
uniform float alpha;
out vec4 color;

vec3 pq_to_nits(vec3 e) {
  const float m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
  vec3 p = pow(clamp(e, 0.0, 1.0), vec3(1.0 / m2));
  return pow(max(p - c1, 0.0) / (c2 - c3 * p), vec3(1.0 / m1)) * 10000.0;
}
vec3 hlg_to_nits(vec3 e) {
  const float a = 0.17883277, b = 0.28466892, c = 0.55991073;
  vec3 lo = e * e / 3.0, hi = (exp((e - c) / a) + b) / 12.0;
  vec3 scene = mix(lo, hi, step(0.5, e));
  float luma = dot(scene, vec3(0.2627, 0.6780, 0.0593));
  return scene * pow(max(luma, 1e-6), 0.2) * 1000.0; // the BT.2100 OOTF for a 1000-nit display
}
// HDR to SDR: BT.2020 to BT.709 primaries, reference white (203 nits) to 1, a soft shoulder above 0.75
// on the brightest channel so hues hold, then the display's 2.4 gamma.
vec3 tone_map(vec3 nits) {
  const mat3 to709 = mat3(1.6605, -0.1246, -0.0182, -0.5876, 1.1329, -0.1006, -0.0728, -0.0083, 1.1187);
  vec3 rgb = max(to709 * (nits / 203.0), 0.0);
  float peak = max(max(rgb.r, rgb.g), rgb.b);
  const float knee = 0.75;
  if (peak > knee) rgb *= (knee + (1.0 - knee) * tanh((peak - knee) / (1.0 - knee))) / peak;
  return pow(rgb, vec3(1.0 / 2.4));
}
// From non-linear R'G'B' in the video's transfer.
void finish_rgb(vec3 rgb) {
  if (transfer == 1) rgb = tone_map(pq_to_nits(rgb));
  else if (transfer == 2) rgb = tone_map(hlg_to_nits(rgb));
  color = vec4(clamp(rgb, 0.0, 1.0), 1.0) * alpha;
}
void finish(vec3 yuv) { finish_rgb(matrix * ((yuv - offset) * gain)); }
// Paints a letterbox bar: true where `at` lies outside the picture.
bool bar(vec2 at) {
  if (all(greaterThanEqual(at, vec2(0.0))) && all(lessThanEqual(at, vec2(1.0)))) return false;
  color = vec4(0.0, 0.0, 0.0, alpha);
  return true;
}
)";

const char* texture_fragment = R"(#version 410 core
in vec2 at;
uniform sampler2D plane0, plane1, plane2;
uniform int interleaved;
uniform float scale;     // 10-bit samples low in 16-bit words: 65535 / 1023
)";
const char* texture_main = R"(
void main() {
  if (bar(at)) return;
  float y = texture(plane0, at).r;
  vec2 c = interleaved == 1 ? texture(plane1, at).rg : vec2(texture(plane1, at).r, texture(plane2, at).r);
  finish(vec3(y, c) * scale);
}
)";

// The PS5 path: the frame's planes, as uploaded, in one buffer the shader reads samples from.
[[maybe_unused]] const char* storage_planes = R"(
layout(std430, binding = 0) readonly buffer Planes { uint words[]; };
uniform int wide;        // 16-bit samples
uniform ivec3 offsets;   // byte offset of each plane
uniform ivec3 pitches;   // bytes per row
uniform ivec2 luma;      // plane sizes in samples
uniform ivec2 chroma;
uniform int interleaved;
uniform float scale;
float sample_at(int at) {
  uint word = words[at >> 2];
  if (wide == 1) return float((word >> uint((at & 2) * 8)) & 0xFFFFu) / 65535.0;
  return float((word >> uint((at & 3) * 8)) & 0xFFu) / 255.0;
}
// Bilinear between sample centres with clamped edges, as GL_LINEAR. `step` is bytes per sample pair
// position: 1 or 2 for a plane of its own, 2 or 4 for interleaved chroma, whose second component
// sits `second` bytes on.
float bilinear(int base, int pitch, ivec2 size, int step, int second, vec2 pos) {
  vec2 p = pos * vec2(size) - 0.5, f = floor(p), t = p - f;
  ivec2 a = clamp(ivec2(f), ivec2(0), size - 1), b = clamp(ivec2(f) + 1, ivec2(0), size - 1);
  float s00 = sample_at(base + a.y * pitch + a.x * step + second), s10 = sample_at(base + a.y * pitch + b.x * step + second);
  float s01 = sample_at(base + b.y * pitch + a.x * step + second), s11 = sample_at(base + b.y * pitch + b.x * step + second);
  return mix(mix(s00, s10, t.x), mix(s01, s11, t.x), t.y);
}
vec2 chroma_at(vec2 at) {
  int bytes = wide + 1;
  if (interleaved == 1)
    return vec2(bilinear(offsets.y, pitches.y, chroma, bytes * 2, 0, at), bilinear(offsets.y, pitches.y, chroma, bytes * 2, bytes, at));
  return vec2(bilinear(offsets.y, pitches.y, chroma, bytes, 0, at), bilinear(offsets.z, pitches.z, chroma, bytes, 0, at));
}
)";
[[maybe_unused]] const char* storage_main = R"(
in vec2 at;
uniform int upscaled;    // 1: the luma from `upscaled_plane`; 2: the picture from it, as R'G'B'
uniform sampler2D upscaled_plane;
void main() {
  if (bar(at)) return;
  if (upscaled == 2) {
    finish_rgb(texture(upscaled_plane, at).rgb);
    return;
  }
  vec3 yuv = vec3(upscaled == 1 ? 0.0 : bilinear(offsets.x, pitches.x, luma, wide + 1, 0, at), chroma_at(at)) * scale;
  if (upscaled == 1) yuv.x = texture(upscaled_plane, at).r;
  finish(yuv);
}
)";
// An upscaler's input out of the buffer, one invocation per luma sample: the luma, scaled as the
// picture shader scales it (mpv's LUMA), or with RGB defined the picture as R'G'B' (mpv's MAIN).
[[maybe_unused]] const char* extract_main = R"(
layout(local_size_x = 16, local_size_y = 16) in;
#ifdef RGB
layout(rgba16f, binding = 0) writeonly uniform image2D plane_out;
#else
layout(r16f, binding = 0) writeonly uniform image2D plane_out;
#endif
uniform mat3 matrix;
uniform vec3 offset, gain;
void main() {
  ivec2 p = ivec2(gl_GlobalInvocationID.xy);
  if (p.x >= luma.x || p.y >= luma.y) return;
  float y = sample_at(offsets.x + p.y * pitches.x + p.x * (wide + 1)) * scale;
#ifdef RGB
  vec3 yuv = vec3(y, chroma_at((vec2(p) + 0.5) / vec2(luma)) * scale);
  imageStore(plane_out, p, vec4(matrix * ((yuv - offset) * gain), 1.0));
#else
  imageStore(plane_out, p, vec4(y));
#endif
}
)";

GLuint compile(GLenum type, const std::string& source) {
  GLuint shader = glCreateShader(type);
  const char* text = source.c_str();
  glShaderSource(shader, 1, &text, nullptr);
  glCompileShader(shader);
  GLint ok = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[2048] = {};
    glGetShaderInfoLog(shader, sizeof log, nullptr, log);
    std::fprintf(stderr, "Video shader compilation failed: %s\n", log);
    glDeleteShader(shader);
    return 0;
  }
  return shader;
}

GLuint program(const std::string& fragment_source) {
  GLuint vertex = compile(GL_VERTEX_SHADER, vertex_source), fragment = compile(GL_FRAGMENT_SHADER, fragment_source);
  GLuint linked = 0;
  if (vertex && fragment) {
    linked = glCreateProgram();
    glAttachShader(linked, vertex);
    glAttachShader(linked, fragment);
    glLinkProgram(linked);
    GLint ok = 0;
    glGetProgramiv(linked, GL_LINK_STATUS, &ok);
    if (!ok) {
      char log[2048] = {};
      glGetProgramInfoLog(linked, sizeof log, nullptr, log);
      std::fprintf(stderr, "Video shader link failed: %s\n", log);
      glDeleteProgram(linked);
      linked = 0;
    }
  }
  if (vertex) glDeleteShader(vertex);
  if (fragment) glDeleteShader(fragment);
  return linked;
}

using video::interleaved;
bool wide(video::Format format) { return video::deep(format); }

std::uint32_t micros_since(std::chrono::steady_clock::time_point start) {
  return static_cast<std::uint32_t>(
    std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now() - start).count());
}

// Kr and Kb of each matrix (BT.601, BT.709, BT.2020).
void set_color(GLuint program, const video::Frame& frame, float alpha) {
  const float kr[] = {0.299f, 0.2126f, 0.2627f}, kb[] = {0.114f, 0.0722f, 0.0593f};
  const int m = static_cast<int>(frame.matrix);
  const float r = kr[m], b = kb[m], g = 1 - r - b;
  // Column-major: R' = Y + 2(1-Kr) Cr; B' = Y + 2(1-Kb) Cb; G' from the luma equation.
  const float matrix[9] = {1, 1, 1,
                           0, -2 * (1 - b) * b / g, 2 * (1 - b),
                           2 * (1 - r), -2 * (1 - r) * r / g, 0};
  glUniformMatrix3fv(glGetUniformLocation(program, "matrix"), 1, GL_FALSE, matrix);
  if (frame.full_range) {
    glUniform3f(glGetUniformLocation(program, "offset"), 0, 0.5f, 0.5f);
    glUniform3f(glGetUniformLocation(program, "gain"), 1, 1, 1);
  } else {
    glUniform3f(glGetUniformLocation(program, "offset"), 16 / 255.0f, 128 / 255.0f, 128 / 255.0f);
    glUniform3f(glGetUniformLocation(program, "gain"), 255 / 219.0f, 255 / 224.0f, 255 / 224.0f);
  }
  glUniform1i(glGetUniformLocation(program, "transfer"), static_cast<int>(frame.transfer));
  glUniform1f(glGetUniformLocation(program, "alpha"), alpha);
  glUniform1i(glGetUniformLocation(program, "interleaved"), interleaved(frame.format) ? 1 : 0);
  glUniform1f(glGetUniformLocation(program, "scale"), video::sample_scale(frame.format));
}
#ifdef GL_COMPUTE_SHADER
GLuint compute_program(const std::string& source) {
  GLuint shader = compile(GL_COMPUTE_SHADER, source), linked = 0;
  if (!shader) return 0;
  linked = glCreateProgram();
  glAttachShader(linked, shader);
  glLinkProgram(linked);
  glDeleteShader(shader);
  GLint ok = 0;
  glGetProgramiv(linked, GL_LINK_STATUS, &ok);
  if (!ok) {
    glDeleteProgram(linked);
    return 0;
  }
  return linked;
}
#endif

// The planes' layout in the buffer, for a program that includes storage_planes.
[[maybe_unused]] void set_planes(GLuint program, const video::Frame& frame, const int offsets[3], const int pitches[3]) {
  glUniform3i(glGetUniformLocation(program, "offsets"), offsets[0], offsets[1], offsets[2]);
  glUniform3i(glGetUniformLocation(program, "pitches"), pitches[0], pitches[1], pitches[2]);
  glUniform2i(glGetUniformLocation(program, "luma"), frame.width, frame.height);
  glUniform2i(glGetUniformLocation(program, "chroma"), (frame.width + 1) / 2, (frame.height + 1) / 2);
  glUniform1i(glGetUniformLocation(program, "wide"), wide(frame.format) ? 1 : 0);
}
} // namespace

bool GlVideo::init(bool storage_allowed) {
  release();
  texture_program_ = program(std::string(texture_fragment) + color_source + texture_main);
#ifdef GL_SHADER_STORAGE_BUFFER
  GLint major = 0, minor = 0;
  glGetIntegerv(GL_MAJOR_VERSION, &major);
  glGetIntegerv(GL_MINOR_VERSION, &minor);
  if (storage_allowed && (major > 4 || (major == 4 && minor >= 3)))
    storage_program_ = program(std::string("#version 430 core\n") + storage_planes + color_source + storage_main);
#else
  (void)storage_allowed;
#endif
  mode_ = storage_program_ ? Upload::storage : Upload::textures;
  upscalers_.resize(std::size_t(upscalers::count()));
  upscaler_tried_.assign(std::size_t(upscalers::count()), false);
  glGenVertexArrays(1, &vao_);
  while (glGetError() != GL_NO_ERROR) {}
  return texture_program_ || storage_program_;
}

void GlVideo::release() {
  for (Entry& entry : entries_) free_entry(entry);
  entries_.clear();
  for (unsigned int* program : {&texture_program_, &storage_program_, &extract_luma_, &extract_rgb_}) {
    if (*program) glDeleteProgram(*program);
    *program = 0;
  }
  if (vao_) glDeleteVertexArrays(1, &vao_);
  vao_ = 0;
  for (GlUpscale& upscaler : upscalers_) upscaler.release();
  upscaler_tried_.assign(upscaler_tried_.size(), false);
}

void GlVideo::free_entry(Entry& entry) {
  for (unsigned int& texture : entry.textures)
    if (texture) glDeleteTextures(1, &texture);
  for (Planes& planes : entry.planes)
    if (planes.buffer) glDeleteBuffers(1, &planes.buffer);
  for (const Source* source : {&entry.source, &entry.compare_source})
    if (source->texture) glDeleteTextures(1, &source->texture);
  entry = {};
}

GlVideo::Entry& GlVideo::entry(std::uint64_t id) {
  for (Entry& entry : entries_)
    if (entry.id == id) return entry;
  entries_.push_back({});
  entries_.back().id = id;
  return entries_.back();
}

void GlVideo::upload_textures(Entry& entry, const video::Frame& frame) {
  const bool deep = wide(frame.format), pairs = interleaved(frame.format);
  const int cw = (frame.width + 1) / 2, ch = (frame.height + 1) / 2;
  const int planes = pairs ? 2 : 3;
  Planes& described = entry.planes[0];
  if (described.format != frame.format || described.width != frame.width || described.height != frame.height ||
      !entry.textures[0]) {
    for (unsigned int& texture : entry.textures)
      if (texture) glDeleteTextures(1, &texture);
    glGenTextures(planes, entry.textures);
    for (int i = 0; i < planes; ++i) {
      glBindTexture(GL_TEXTURE_2D, entry.textures[i]);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
      glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
      const bool two = pairs && i == 1;
      const GLenum internal = deep ? (two ? GL_RG16 : GL_R16) : (two ? GL_RG8 : GL_R8);
      glTexImage2D(GL_TEXTURE_2D, 0, internal, i ? cw : frame.width, i ? ch : frame.height, 0, two ? GL_RG : GL_RED,
                   deep ? GL_UNSIGNED_SHORT : GL_UNSIGNED_BYTE, nullptr);
    }
    described.format = frame.format;
    described.width = frame.width;
    described.height = frame.height;
  }
  glPixelStorei(GL_UNPACK_ALIGNMENT, 1);
  for (int i = 0; i < planes; ++i) {
    const bool two = pairs && i == 1;
    const int element = (deep ? 2 : 1) * (two ? 2 : 1);
    glBindTexture(GL_TEXTURE_2D, entry.textures[i]);
    glPixelStorei(GL_UNPACK_ROW_LENGTH, frame.pitch[i] / element);
    const int w = i ? cw : frame.width, h = i ? ch : frame.height;
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, w, h, two ? GL_RG : GL_RED, deep ? GL_UNSIGNED_SHORT : GL_UNSIGNED_BYTE,
                    frame.planes[i]);
    upload_bytes_ += static_cast<std::uint64_t>(frame.pitch[i]) * h;
  }
  glPixelStorei(GL_UNPACK_ROW_LENGTH, 0);
  glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
  described.valid = true;
  described.sequence = frame.sequence;
}

void GlVideo::upload_storage(Planes& planes, const video::Frame& frame) {
#ifdef GL_SHADER_STORAGE_BUFFER
  const auto start = std::chrono::steady_clock::now();
  const int ch = (frame.height + 1) / 2;
  const int count = interleaved(frame.format) ? 2 : 3;
  std::size_t total = 0;
  for (int i = 0; i < count; ++i) {
    planes.offsets[i] = static_cast<int>(total);
    planes.pitches[i] = frame.pitch[i];
    total += (static_cast<std::size_t>(frame.pitch[i]) * (i ? ch : frame.height) + 3) & ~std::size_t(3);
  }
  if (!planes.buffer) glGenBuffers(1, &planes.buffer);
  glBindBuffer(GL_SHADER_STORAGE_BUFFER, planes.buffer);
  // A new store each frame: the GPU may still read the previous one.
  glBufferData(GL_SHADER_STORAGE_BUFFER, static_cast<GLsizeiptr>(total), nullptr, GL_STREAM_DRAW);
  for (int i = 0; i < count; ++i)
    glBufferSubData(GL_SHADER_STORAGE_BUFFER, planes.offsets[i],
                    static_cast<GLsizeiptr>(frame.pitch[i]) * (i ? ch : frame.height), frame.planes[i]);
  glBindBuffer(GL_SHADER_STORAGE_BUFFER, 0);
  planes.valid = true;
  planes.sequence = frame.sequence;
  planes.format = frame.format;
  planes.width = frame.width;
  planes.height = frame.height;
  planes.model = planes.tried = upscalers::kNone;
  upload_bytes_ += total;
  upload_us_ += micros_since(start);
#else
  (void)planes;
  (void)frame;
#endif
}

// The model's upscaler, compiled on first use; null where it cannot run.
GlUpscale* GlVideo::upscaler(int model) {
#ifdef GL_COMPUTE_SHADER
  if (model < 0 || model >= upscalers::count() || mode_ != Upload::storage) return nullptr;
  GlUpscale& upscaler = upscalers_[std::size_t(model)];
  if (!upscaler_tried_[std::size_t(model)]) {
    upscaler_tried_[std::size_t(model)] = true;
    const auto start = std::chrono::steady_clock::now();
    const std::string extract = std::string("#version 430 core\n") + storage_planes + extract_main;
    if (!extract_luma_) extract_luma_ = compute_program(extract);
    if (!extract_rgb_) extract_rgb_ = compute_program(std::string("#version 430 core\n#define RGB\n") + storage_planes + extract_main);
    const bool ready = extract_luma_ && extract_rgb_ && upscaler.init(model);
    std::fprintf(stderr, "Video upscale %s %s (%.1f ms to compile)\n", upscalers::name(model),
                 ready ? "ready" : "unavailable", micros_since(start) / 1000.0);
  }
  return upscaler.ready() && extract_luma_ && extract_rgb_ ? &upscaler : nullptr;
#else
  (void)model;
  return nullptr;
#endif
}

// The picture in `planes` (uploaded from a frame described by `frame`) into `source` as an upscaler reads it.
void GlVideo::extract(Source& source, const Planes& planes, const video::Frame& frame, bool rgb) {
#ifdef GL_COMPUTE_SHADER
  if (!source.texture || source.w != planes.width || source.h != planes.height || source.rgb != rgb) {
    if (source.texture) glDeleteTextures(1, &source.texture);
    glGenTextures(1, &source.texture);
    glBindTexture(GL_TEXTURE_2D, source.texture);
    glTexStorage2D(GL_TEXTURE_2D, 1, rgb ? GL_RGBA16F : GL_R16F, planes.width, planes.height);
    // Anime4K reads its source bilinearly at the output's size.
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glBindTexture(GL_TEXTURE_2D, 0);
    source.w = planes.width;
    source.h = planes.height;
    source.rgb = rgb;
  }
  const GLuint program = rgb ? extract_rgb_ : extract_luma_;
  glUseProgram(program);
  set_planes(program, frame, planes.offsets, planes.pitches);
  set_color(program, frame, 1);
  glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, planes.buffer);
  glBindImageTexture(0, source.texture, 0, GL_FALSE, 0, GL_WRITE_ONLY, rgb ? GL_RGBA16F : GL_R16F);
  glDispatchCompute(GLuint((planes.width + 15) / 16), GLuint((planes.height + 15) / 16), 1);
  glMemoryBarrier(GL_TEXTURE_FETCH_BARRIER_BIT | GL_SHADER_IMAGE_ACCESS_BARRIER_BIT);
  glBindImageTexture(0, 0, 0, GL_FALSE, 0, GL_WRITE_ONLY, rgb ? GL_RGBA16F : GL_R16F);
#else
  (void)source;
  (void)planes;
  (void)frame;
  (void)rgb;
#endif
}

// Turns the picture waiting in planes[1 - shown] into the upscaler's input and starts its run, a share
// of it now. False when it cannot run.
bool GlVideo::start_upscale(Entry& entry, GlUpscale& upscaler, int model, const video::Frame& frame) {
#ifdef GL_COMPUTE_SHADER
  const int back = 1 - entry.shown;
  const Planes& planes = entry.planes[back];
  extract(entry.source, planes, frame, upscaler.reads_rgb());
  entry.planes[back].tried = model;
  if (!upscaler.start(entry.source.texture, planes.width, planes.height, back)) return false;
  entry.job_model = model;
  // Half now, half at the next display frame: a 24 or 30 fps picture is due every two or three.
  if (upscaler.step(0.5f)) finish_upscale(entry, upscaler);
  return true;
#else
  (void)entry;
  (void)upscaler;
  (void)model;
  (void)frame;
  return false;
#endif
}

// The run is done: its picture is the one shown from now on.
void GlVideo::finish_upscale(Entry& entry, GlUpscale& upscaler) {
  entry.shown = 1 - entry.shown;
  entry.planes[entry.shown].model = entry.job_model;
  entry.planes[entry.shown].generation = upscaler.generation();
  entry.job_model = upscalers::kNone;
}

void GlVideo::draw(std::uint64_t id, const video::Frame& frame, Fit fit, const Target& target, int x, int y, int w,
                   int h, int fb_w, int fb_h, int upscale, const Compare& compare) {
  if (!frame.planes[0] || frame.width <= 0 || frame.height <= 0) return;
  Entry& e = entry(id);
  e.drawn = true;
  // The picture's shape, fitted into the element's box. `contain` still draws the whole box, its bars
  // black, so nothing under the element shows through them.
  const float bw = float(target.x1 - target.x0), bh = float(target.y1 - target.y0);
  if (bw <= 0 || bh <= 0) return;
  const float picture = frame.width * frame.aspect / frame.height, box = bw / bh;
  float dx0 = target.x0, dy0 = target.y0, dx1 = target.x1, dy1 = target.y1;
  float sx0 = 0, sy0 = 0, sx1 = 1, sy1 = 1;
  if (fit == Fit::contain) {
    if (picture > box) {
      const float part = picture / box;
      sy0 = 0.5f - part / 2;
      sy1 = 0.5f + part / 2;
    } else {
      const float part = box / picture;
      sx0 = 0.5f - part / 2;
      sx1 = 0.5f + part / 2;
    }
  } else if (fit == Fit::cover) {
    if (picture > box) {
      const float part = box / picture;
      sx0 = (1 - part) / 2;
      sx1 = sx0 + part;
    } else {
      const float part = picture / box;
      sy0 = (1 - part) / 2;
      sy1 = sy0 + part;
    }
  }

  // The picture's size on screen, in window pixels, against the model's condition for a doubler.
  const float shown_w = (dx1 - dx0) / (sx1 - sx0) * w / fb_w, shown_h = (dy1 - dy0) / (sy1 - sy0) * h / fb_h;
  GlUpscale* upscaling = upscaler(upscale);
  if (upscaling && !(shown_w > frame.width * upscaling->threshold() && shown_h > frame.height * upscaling->threshold()))
    upscaling = nullptr;
  if (mode_ == Upload::textures) {
    if (!e.planes[0].valid || e.planes[0].sequence != frame.sequence) {
      const auto start = std::chrono::steady_clock::now();
      upload_textures(e, frame);
      upload_us_ += micros_since(start);
    }
  } else if (!upscaling) {
    e.job_model = upscalers::kNone;
    Planes& shown = e.planes[e.shown];
    if (!shown.valid || shown.sequence != frame.sequence) upload_storage(shown, frame);
  } else {
    if (e.job_model != upscalers::kNone && e.job_model != upscale) e.job_model = upscalers::kNone;
    if (e.job_model != upscalers::kNone && upscaling->step(1.0f)) finish_upscale(e, *upscaling);
    const Planes &shown = e.planes[e.shown], &back = e.planes[1 - e.shown];
    const bool waiting = e.job_model != upscalers::kNone && back.sequence == frame.sequence;
    // A paused picture never changes: a model picked over it runs on it once, as a new picture would.
    const bool current = shown.valid && shown.sequence == frame.sequence && shown.tried == upscale;
    if (!waiting && !current) {
      // A picture due every display frame leaves no time to split a run: finish the last one now.
      if (e.job_model != upscalers::kNone) {
        upscaling->step(1.0f);
        finish_upscale(e, *upscaling);
      }
      upload_storage(e.planes[1 - e.shown], frame);
      if (!start_upscale(e, *upscaling, upscale, frame)) e.shown = 1 - e.shown; // plain, at once
    }
  }

  const Planes& planes = e.planes[mode_ == Upload::textures ? 0 : e.shown];
  if (!planes.valid) return;
  unsigned int upscaled = 0;
  if (upscaling && planes.model == upscale) upscaled = upscaling->result(e.shown, planes.generation);
  video::Frame described = frame;
  described.format = planes.format;
  described.width = planes.width;
  described.height = planes.height;

  // The other side of a comparison: the picture shown, through the compare model, once per picture.
  GlUpscale* comparing = nullptr;
  unsigned int compared = 0;
  if (compare.on && mode_ == Upload::storage) {
    comparing = upscaler(compare.model);
    if (comparing && !(shown_w > planes.width * comparing->threshold() && shown_h > planes.height * comparing->threshold()))
      comparing = nullptr;
    if (comparing == upscaling) {
      compared = upscaled;
    } else if (comparing) {
      if (e.compare_model != compare.model || e.compare_sequence != planes.sequence ||
          e.compare_generation != comparing->generation()) {
        extract(e.compare_source, planes, described, comparing->reads_rgb());
        if (comparing->start(e.compare_source.texture, planes.width, planes.height, 0)) comparing->step(1.0f);
        e.compare_model = compare.model;
        e.compare_sequence = planes.sequence;
        e.compare_generation = comparing->generation();
      }
      compared = comparing->result(0, e.compare_generation);
    }
  }

  const GLuint used = mode_ == Upload::storage ? storage_program_ : texture_program_;
  glUseProgram(used);
  glBindVertexArray(vao_);
  glUniform4f(glGetUniformLocation(used, "dst"), dx0, dy0, dx1, dy1);
  glUniform4f(glGetUniformLocation(used, "src"), sx0, sy0, sx1, sy1);
  glUniform2f(glGetUniformLocation(used, "size"), float(fb_w), float(fb_h));
  set_color(used, frame, target.alpha);
  if (mode_ == Upload::storage) {
#ifdef GL_SHADER_STORAGE_BUFFER
    set_planes(used, described, planes.offsets, planes.pitches);
    glUniform1i(glGetUniformLocation(used, "interleaved"), interleaved(planes.format) ? 1 : 0);
    glUniform1f(glGetUniformLocation(used, "scale"), video::sample_scale(planes.format));
    glUniform1i(glGetUniformLocation(used, "upscaled_plane"), 0);
    glBindBufferBase(GL_SHADER_STORAGE_BUFFER, 0, planes.buffer);
#endif
  } else {
    const int count = interleaved(frame.format) ? 2 : 3;
    for (int i = 0; i < count; ++i) {
      glActiveTexture(GL_TEXTURE0 + i);
      glBindTexture(GL_TEXTURE_2D, e.textures[i]);
    }
    glUniform1i(glGetUniformLocation(used, "plane0"), 0);
    glUniform1i(glGetUniformLocation(used, "plane1"), 1);
    glUniform1i(glGetUniformLocation(used, "plane2"), 2);
  }
  // GL counts scissor rows from the bottom of the window.
  const float sx = float(w) / fb_w, sy = float(h) / fb_h;
  const int cx0 = x + int(target.clip_x0 * sx + 0.5f), cx1 = x + int(target.clip_x1 * sx + 0.5f);
  const int cy0 = y + h - int(target.clip_y1 * sy + 0.5f), cy1 = y + h - int(target.clip_y0 * sy + 0.5f);
  glEnable(GL_SCISSOR_TEST);
  // The picture between window columns x0 and x1, from `result` of `by` (0: as it comes).
  const auto paint = [&](unsigned int result, const GlUpscale* by, int x0, int x1) {
    if (x1 <= x0) return;
    if (mode_ == Upload::storage) {
      glUniform1i(glGetUniformLocation(used, "upscaled"), !result ? 0 : by->reads_rgb() ? 2 : 1);
      glActiveTexture(GL_TEXTURE0);
      glBindTexture(GL_TEXTURE_2D, result);
    }
    glScissor(x0, cy0, x1 - x0, std::max(cy1 - cy0, 0));
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
  };
  if (!compare.on) {
    paint(upscaled, upscaling, cx0, cx1);
  } else {
    const float split = dx0 + (compare.split - sx0) / (sx1 - sx0) * (dx1 - dx0);
    const int at = std::clamp(x + int(split * sx + 0.5f), cx0, cx1);
    paint(upscaled, upscaling, cx0, at);
    paint(compared, comparing, at, cx1);
  }
  if (mode_ == Upload::storage) glBindTexture(GL_TEXTURE_2D, 0);
  if (mode_ == Upload::textures) {
    for (int i = 2; i >= 0; --i) {
      glActiveTexture(GL_TEXTURE0 + i);
      glBindTexture(GL_TEXTURE_2D, 0);
    }
  }
}

std::string GlVideo::take_upscale_log() {
  std::string out;
  for (int model = 0; model < int(upscalers_.size()); ++model) {
    const GlUpscale::Stats stats = upscalers_[std::size_t(model)].take_stats();
    if (!stats.runs && !stats.steps) continue;
    char line[160];
    std::snprintf(line, sizeof line, "%s%s: %u frames, gpu %.2f ms per frame, %.2f ms longest step (%u steps timed)",
                  out.empty() ? "" : "\n", upscalers::name(model), stats.runs,
                  stats.runs ? stats.gpu_ns / 1e6 / stats.runs : 0.0, stats.max_step_ns / 1e6, stats.steps);
    out += line;
  }
  return out;
}

void GlVideo::dump_upscale_at(const std::string& prefix, std::uint64_t run) {
  for (int model = 0; model < int(upscalers_.size()); ++model)
    upscalers_[std::size_t(model)].dump_at(prefix + "-" + upscalers::name(model), run);
}

void GlVideo::end_present() {
  std::erase_if(entries_, [&](Entry& entry) {
    if (entry.drawn) {
      entry.drawn = false;
      return false;
    }
    free_entry(entry);
    return true;
  });
}

