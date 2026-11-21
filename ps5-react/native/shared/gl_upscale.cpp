// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "gl_upscale.hpp"

#ifdef __APPLE__
#include <OpenGL/gl3.h>
#elif defined(PROSPERO)
#include <GL/glcorearb.h>
#else
#define GL_GLEXT_PROTOTYPES
#include <SDL2/SDL_opengl.h>
#endif

#include <algorithm>
#include <cerrno>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iterator>

namespace {
const char* const model_names[] = {"artcnn", "anime4k-s", "anime4k-m", "anime4k-l", "anime4k-vl", "anime4k-ul"};
} // namespace

namespace upscalers {
int find(const char* name) {
  for (int i = 0; i < count(); ++i)
    if (name && !std::strcmp(name, model_names[i])) return i;
  return kNone;
}
const char* name(int model) { return model >= 0 && model < count() ? model_names[model] : ""; }
int count() { return int(std::size(model_names)); }
std::string names() {
  std::string out;
  for (const char* name : model_names) out += (out.empty() ? "" : ", ") + std::string(name);
  return out;
}
} // namespace upscalers

// Without compute shaders (macOS's GL 4.1) there is nothing to run: init() fails.
#ifdef GL_COMPUTE_SHADER
namespace {
// In the order of model_names.
const char* const model_sources[] = {
#include "upscalers/ArtCNN_C4F16.glsl.inc"
  ,
#include "upscalers/Anime4K_Upscale_CNN_x2_S.glsl.inc"
  ,
#include "upscalers/Anime4K_Upscale_CNN_x2_M.glsl.inc"
  ,
#include "upscalers/Anime4K_Upscale_CNN_x2_L.glsl.inc"
  ,
#include "upscalers/Anime4K_Upscale_CNN_x2_VL.glsl.inc"
  ,
#include "upscalers/Anime4K_Upscale_CNN_x2_UL.glsl.inc"
};
static_assert(std::size(model_sources) == std::size(model_names));

// What libplacebo defines for a user shader pass, as far as these shaders use it. Reads outside a
// texture return zero, the padding the networks were trained with (GL leaves them undefined).
const char* prelude = R"(
uniform vec2 out_size;
vec4 fetch_zero(sampler2D s, ivec2 p, int lod) {
  return all(greaterThanEqual(p, ivec2(0))) && all(lessThan(p, textureSize(s, 0))) ? texelFetch(s, p, lod) : vec4(0.0);
}
)";
// A fragment pass (`vec4 hook()`) runs as a compute pass of one invocation per output pixel.
constexpr int kFragmentGroup = 16;
const char* fragment_main = R"(
void main() {
  ivec2 p = ivec2(gl_GlobalInvocationID.xy);
  if (any(greaterThanEqual(p, ivec2(out_size)))) return;
  imageStore(out_image, p, hook());
}
)";

unsigned int compile(const std::string& source, const std::string& name) {
  GLuint shader = glCreateShader(GL_COMPUTE_SHADER);
  const char* text = source.c_str();
  glShaderSource(shader, 1, &text, nullptr);
  glCompileShader(shader);
  GLint ok = 0;
  glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
  if (!ok) {
    char log[2048] = {};
    glGetShaderInfoLog(shader, sizeof log, nullptr, log);
    std::fprintf(stderr, "Upscale pass %s failed to compile: %s\n", name.c_str(), log);
    glDeleteShader(shader);
    return 0;
  }
  GLuint program = glCreateProgram();
  glAttachShader(program, shader);
  glLinkProgram(program);
  glDeleteShader(shader);
  glGetProgramiv(program, GL_LINK_STATUS, &ok);
  if (!ok) {
    char log[2048] = {};
    glGetProgramInfoLog(program, sizeof log, nullptr, log);
    std::fprintf(stderr, "Upscale pass %s failed to link: %s\n", name.c_str(), log);
    glDeleteProgram(program);
    return 0;
  }
  return program;
}

std::size_t occurrences(const std::string& text, const char* what) {
  std::size_t n = 0;
  for (std::size_t at = 0; (at = text.find(what, at)) != std::string::npos; at += std::strlen(what)) ++n;
  return n;
}
} // namespace
#endif

bool GlUpscale::init(int model) {
  release();
#ifdef GL_COMPUTE_SHADER
  if (model < 0 || model >= upscalers::count()) return false;
  GLint major = 0, minor = 0;
  glGetIntegerv(GL_MAJOR_VERSION, &major);
  glGetIntegerv(GL_MINOR_VERSION, &minor);
  if (major < 4 || (major == 4 && minor < 3)) return false;

  // One pass per run of "//!" directives followed by its body.
  struct Parsed {
    std::string desc, hook, save, body, width, height, when;
    std::vector<std::string> binds;
    int compute[4] = {};
  };
  std::vector<Parsed> parsed;
  bool in_body = true;
  for (const char* at = model_sources[model]; *at;) {
    const char* end = std::strchr(at, '\n');
    std::string line(at, end ? end : at + std::strlen(at));
    at = end ? end + 1 : at + line.size();
    if (line.rfind("//!", 0) == 0) {
      if (in_body) parsed.emplace_back();
      in_body = false;
      Parsed& pass = parsed.back();
      const std::size_t space = line.find(' ', 3), value = line.find_first_not_of(' ', space);
      const std::string key = line.substr(3, space == std::string::npos ? std::string::npos : space - 3);
      const std::string rest = value == std::string::npos ? "" : line.substr(value);
      if (key == "DESC") pass.desc = rest;
      else if (key == "HOOK") pass.hook = rest;
      else if (key == "BIND") pass.binds.push_back(rest);
      else if (key == "SAVE") pass.save = rest;
      else if (key == "WIDTH") pass.width = rest;
      else if (key == "HEIGHT") pass.height = rest;
      else if (key == "WHEN") pass.when = rest;
      else if (key == "COMPUTE") std::sscanf(rest.c_str(), "%d %d %d %d", &pass.compute[0], &pass.compute[1], &pass.compute[2], &pass.compute[3]);
      continue;
    }
    in_body = true;
    if (parsed.empty() || line.rfind("#extension", 0) == 0) continue; // before any non-preprocessor token
    for (std::size_t found = 0; (found = line.find("texelFetch(", found)) != std::string::npos; found += 11)
      line.replace(found, 11, "fetch_zero(");
    parsed.back().body += line + '\n';
  }
  if (parsed.empty()) return false;
  hook_ = parsed.front().hook;
  rgb_ = hook_ == "MAIN";
  // "OUTPUT.w MAIN.w / 1.200 > ...": the ratio a doubler waits for.
  if (float ratio = 0; std::sscanf(parsed.front().when.c_str(), "%*s %*s / %f", &ratio) == 1 && ratio > 1)
    threshold_ = ratio;

  // A size is "NAME.w" or "NAME.w k *": the named texture's size, times k. Sources are 1.
  auto factor = [&](const std::string& expression) -> float {
    char base[64] = {}, op[4] = {};
    float k = 1;
    const int fields = std::sscanf(expression.c_str(), "%63s %f %3s", base, &k, op);
    if (fields < 1 || (fields > 1 && (fields != 3 || std::strcmp(op, "*")))) return 0;
    std::string name(base);
    name = name.substr(0, name.rfind('.'));
    if (name == hook_) return fields == 3 ? k : 1;
    for (const Pass& pass : passes_)
      if (pass.save == name) return pass.scale * (fields == 3 ? k : 1);
    return 0;
  };
  for (std::size_t i = 0; i < parsed.size(); ++i) {
    const Parsed& p = parsed[i];
    const bool last = i + 1 == parsed.size();
    Pass pass;
    pass.scale = factor(p.width);
    pass.binds = p.binds;
    pass.save = p.save == hook_ ? "" : p.save; // a pass saving the hooked plane replaces it: the result
    if (p.hook != hook_ || pass.scale <= 0 || pass.scale != factor(p.height) || (pass.save.empty() && !last)) {
      std::fprintf(stderr, "Upscale pass %s: unsupported hook, size or output\n", p.desc.c_str());
      release();
      return false;
    }
    const bool compute = p.compute[0] > 0;
    const int lx = compute ? p.compute[2] : kFragmentGroup, ly = compute ? p.compute[3] : kFragmentGroup;
    pass.block_w = compute ? p.compute[0] : kFragmentGroup;
    pass.block_h = compute ? p.compute[1] : kFragmentGroup;
    // Multiply-adds per invocation times invocations per output pixel, per source pixel.
    const double per_pixel = double(lx) * ly / (double(pass.block_w) * pass.block_h);
    pass.cost = double(std::max<std::size_t>(occurrences(p.body, " += "), 1)) * per_pixel * pass.scale * pass.scale;
    // The result of a luma doubler is one channel; everything else keeps four.
    const char* format = last && !rgb_ ? "r16f" : "rgba16f";
    std::string source = "#version 430 core\nlayout(local_size_x = " + std::to_string(lx) + ", local_size_y = " +
                         std::to_string(ly) + ") in;\nlayout(" + format +
                         ", binding = 0) writeonly uniform image2D out_image;\n" + prelude;
    for (const std::string& name : p.binds) {
      source += "uniform sampler2D " + name + "_raw;\nuniform vec2 " + name + "_size;\n#define " + name + "_mul 1.0\n";
      source += "#define " + name + "_pt (vec2(1.0) / " + name + "_size)\n";
      source += "#define " + name + "_pos ((vec2(gl_GlobalInvocationID.xy) + 0.5) / out_size)\n";
      source += "#define " + name + "_tex(p) texture(" + name + "_raw, p)\n";
      source += "#define " + name + "_texOff(off) " + name + "_tex(" + name + "_pos + " + name + "_pt * (off))\n";
    }
    source += p.body + (compute ? "void main() { hook(); }\n" : fragment_main);
    pass.program = compile(source, p.desc);
    if (!pass.program) {
      release();
      return false;
    }
    passes_.push_back(std::move(pass));
  }
  for (std::size_t i = 0; i < passes_.size(); ++i)
    for (std::size_t j = i + 1; j < passes_.size(); ++j)
      if (!passes_[i].save.empty() && std::count(passes_[j].binds.begin(), passes_[j].binds.end(), passes_[i].save))
        passes_[i].last_use = int(j);
  total_cost_ = 0;
  for (const Pass& pass : passes_) total_cost_ += pass.cost;
  next_pass_ = passes_.size();

  glGenQueries(kTimers, timers_);
  timing_ = glGetError() == GL_NO_ERROR;
  return true;
#else
  (void)model;
  return false;
#endif
}

void GlUpscale::release() {
#ifdef GL_COMPUTE_SHADER
  for (Pass& pass : passes_) glDeleteProgram(pass.program);
  if (timing_) glDeleteQueries(kTimers, timers_);
#endif
  free_textures();
  passes_.clear();
  hook_.clear();
  rgb_ = false;
  threshold_ = 1.3f;
  next_pass_ = 0;
  std::fill(std::begin(timer_pending_), std::end(timer_pending_), false);
  timing_ = false;
}

void GlUpscale::free_textures() {
#ifdef GL_COMPUTE_SHADER
  for (Texture& texture : pool_) glDeleteTextures(1, &texture.id);
  for (Texture& texture : results_)
    if (texture.id) glDeleteTextures(1, &texture.id);
#endif
  pool_.clear();
  outputs_.clear();
  results_[0] = results_[1] = {};
  result_ready_[0] = result_ready_[1] = false;
  width_ = height_ = 0;
  ++generation_;
}

// A texture for each pass's output, shared by passes whose lifetimes do not overlap, and two results.
bool GlUpscale::allocate(int w, int h) {
#ifdef GL_COMPUTE_SHADER
  free_textures();
  auto make = [](int tw, int th, GLenum format) {
    Texture texture{0, tw, th, 0};
    glGenTextures(1, &texture.id);
    glBindTexture(GL_TEXTURE_2D, texture.id);
    glTexStorage2D(GL_TEXTURE_2D, 1, format, tw, th);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    return texture;
  };
  for (std::size_t i = 0; i < passes_.size(); ++i) {
    const int ow = int(std::lround(w * passes_[i].scale)), oh = int(std::lround(h * passes_[i].scale));
    if (passes_[i].save.empty()) {
      outputs_.push_back(-1);
      for (Texture& result : results_) result = make(ow, oh, rgb_ ? GL_RGBA16F : GL_R16F);
      continue;
    }
    int found = -1;
    for (std::size_t t = 0; t < pool_.size() && found < 0; ++t)
      if (pool_[t].w == ow && pool_[t].h == oh && pool_[t].free_after < int(i)) found = int(t);
    if (found < 0) {
      pool_.push_back(make(ow, oh, GL_RGBA16F));
      found = int(pool_.size()) - 1;
    }
    pool_[found].free_after = passes_[i].last_use;
    outputs_.push_back(found);
  }
  glBindTexture(GL_TEXTURE_2D, 0);
  if (glGetError() != GL_NO_ERROR) {
    std::fprintf(stderr, "Upscale: no textures for %dx%d\n", w, h);
    free_textures();
    return false;
  }
  width_ = w;
  height_ = h;
  return true;
#else
  (void)w;
  (void)h;
  return false;
#endif
}

bool GlUpscale::start(unsigned int source, int w, int h, int slot) {
  if (!ready()) return false;
  if ((w != width_ || h != height_) && !allocate(w, h)) return false;
  source_ = source;
  slot_ = slot & 1;
  result_ready_[slot_] = false;
  next_pass_ = 0;
  done_cost_ = 0;
  dumping_ = !dump_prefix_.empty() && ++total_runs_ == dump_run_;
  if (dumping_) dump(source, w, h, dump_prefix_ + "-in.pgm");
  return true;
}

void GlUpscale::run_pass(std::size_t index) {
#ifdef GL_COMPUTE_SHADER
  const Pass& pass = passes_[index];
  const Texture& out = outputs_[index] < 0 ? results_[slot_] : pool_[std::size_t(outputs_[index])];
  glUseProgram(pass.program);
  for (std::size_t b = 0; b < pass.binds.size(); ++b) {
    const std::string& name = pass.binds[b];
    unsigned int texture = source_;
    float tw = float(width_), th = float(height_);
    for (std::size_t j = index; j-- > 0;) {
      if (passes_[j].save != name) continue;
      const Texture& saved = pool_[std::size_t(outputs_[j])];
      texture = saved.id;
      tw = float(saved.w);
      th = float(saved.h);
      break;
    }
    glActiveTexture(GL_TEXTURE0 + GLenum(b));
    glBindTexture(GL_TEXTURE_2D, texture);
    glUniform1i(glGetUniformLocation(pass.program, (name + "_raw").c_str()), GLint(b));
    glUniform2f(glGetUniformLocation(pass.program, (name + "_size").c_str()), tw, th);
  }
  glUniform2f(glGetUniformLocation(pass.program, "out_size"), float(out.w), float(out.h));
  const GLenum format = outputs_[index] < 0 && !rgb_ ? GL_R16F : GL_RGBA16F;
  glBindImageTexture(0, out.id, 0, GL_FALSE, 0, GL_WRITE_ONLY, format);
  glDispatchCompute(GLuint((out.w + pass.block_w - 1) / pass.block_w), GLuint((out.h + pass.block_h - 1) / pass.block_h), 1);
  glMemoryBarrier(GL_TEXTURE_FETCH_BARRIER_BIT | GL_SHADER_IMAGE_ACCESS_BARRIER_BIT);
  for (std::size_t b = pass.binds.size(); b-- > 0;) {
    glActiveTexture(GL_TEXTURE0 + GLenum(b));
    glBindTexture(GL_TEXTURE_2D, 0);
  }
  glBindImageTexture(0, 0, 0, GL_FALSE, 0, GL_WRITE_ONLY, format);
#else
  (void)index;
#endif
}

bool GlUpscale::step(float share) {
  if (!running()) return true;
#ifdef GL_COMPUTE_SHADER
  collect_timers();
  const int timer = next_timer_;
  const bool timed = timing_ && !timer_pending_[timer];
  if (timed) glBeginQuery(GL_TIME_ELAPSED, timers_[timer]);
  do {
    run_pass(next_pass_);
    done_cost_ += passes_[next_pass_].cost;
    ++next_pass_;
  } while (running() && done_cost_ < share * total_cost_);
  if (timed) {
    glEndQuery(GL_TIME_ELAPSED);
    timer_pending_[timer] = true;
    next_timer_ = (timer + 1) % kTimers;
  }
#else
  (void)share;
#endif
  if (running()) return false;
  result_ready_[slot_] = true;
  ++stats_.runs;
  if (dumping_) {
    dump(results_[slot_].id, results_[slot_].w, results_[slot_].h, dump_prefix_ + "-out.pgm");
    dump_prefix_.clear();
    dumping_ = false;
  }
  return true;
}

unsigned int GlUpscale::result(int slot, std::uint64_t generation) const {
  slot &= 1;
  return generation == generation_ && result_ready_[slot] ? results_[slot].id : 0;
}

void GlUpscale::collect_timers() {
#ifdef GL_COMPUTE_SHADER
  for (int i = 0; i < kTimers; ++i) {
    if (!timer_pending_[i]) continue;
    GLint available = 0;
    glGetQueryObjectiv(timers_[i], GL_QUERY_RESULT_AVAILABLE, &available);
    if (!available) continue;
    GLuint64 ns = 0;
    glGetQueryObjectui64v(timers_[i], GL_QUERY_RESULT, &ns);
    stats_.gpu_ns += ns;
    stats_.max_step_ns = std::max<std::uint64_t>(stats_.max_step_ns, ns);
    ++stats_.steps;
    timer_pending_[i] = false;
  }
#endif
}

GlUpscale::Stats GlUpscale::take_stats() {
  collect_timers();
  return std::exchange(stats_, Stats{});
}

// The red channel, through a framebuffer: GL 4.3 core and the PS5's GL both read those back.
void GlUpscale::dump(unsigned int texture, int w, int h, const std::string& path) const {
#ifdef GL_COMPUTE_SHADER
  glMemoryBarrier(GL_FRAMEBUFFER_BARRIER_BIT | GL_PIXEL_BUFFER_BARRIER_BIT);
  GLint previous = 0;
  glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &previous);
  GLuint fbo = 0;
  glGenFramebuffers(1, &fbo);
  glBindFramebuffer(GL_READ_FRAMEBUFFER, fbo);
  glFramebufferTexture2D(GL_READ_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, texture, 0);
  std::vector<float> pixels(std::size_t(w) * h * 4);
  glPixelStorei(GL_PACK_ALIGNMENT, 4);
  glReadPixels(0, 0, w, h, GL_RGBA, GL_FLOAT, pixels.data());
  glBindFramebuffer(GL_READ_FRAMEBUFFER, GLuint(previous));
  glDeleteFramebuffers(1, &fbo);
  FILE* file = std::fopen(path.c_str(), "wb");
  if (!file) {
    std::fprintf(stderr, "Upscale dump %s: %s\n", path.c_str(), std::strerror(errno));
    return;
  }
  std::fprintf(file, "P5\n%d %d\n255\n", w, h);
  std::vector<unsigned char> row(static_cast<std::size_t>(w));
  for (int y = 0; y < h; ++y) {
    for (int x = 0; x < w; ++x)
      row[std::size_t(x)] = static_cast<unsigned char>(std::clamp(pixels[(std::size_t(y) * w + x) * 4], 0.0f, 1.0f) * 255 + 0.5f);
    std::fwrite(row.data(), 1, row.size(), file);
  }
  std::fclose(file);
#else
  (void)texture;
  (void)w;
  (void)h;
  (void)path;
#endif
}
