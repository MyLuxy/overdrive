// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstdint>
#include <string>
#include <utility>
#include <vector>

// Doublers for video: mpv user shaders (ArtCNN, Anime4K) run as GL compute passes, their fragment passes
// included. Needs GL 4.3 compute shaders; the caller owns the context.
namespace upscalers {
constexpr int kNone = -1;
// The models by name ("artcnn", "anime4k-s" ...), kNone for an unknown one.
int find(const char* name);
const char* name(int model);
int count();
// "artcnn, anime4k-s, ..." for error messages.
std::string names();
} // namespace upscalers

class GlUpscale {
public:
  // False without compute shaders, or when a pass fails to compile.
  bool init(int model);
  void release();
  bool ready() const { return !passes_.empty(); }
  // The plane the network reads: the luma (red channel of an R16F texture, 0..1 as mpv's LUMA) or the
  // picture as non-linear R'G'B' (an RGBA16F texture, as mpv's MAIN). Its output replaces that plane.
  bool reads_rgb() const { return rgb_; }
  // How much bigger than its source a picture must be shown to be doubled (the shader's WHEN).
  float threshold() const { return threshold_; }

  // A run on `source` (w x h) into result `slot` (0 or 1), so one result can be shown while the next
  // is computed. False when the textures could not be had.
  bool start(unsigned int source, int w, int h, int slot);
  // Runs passes until `share` (0..1) of the run's estimated GPU work is done; true once it is finished.
  bool step(float share);
  bool running() const { return next_pass_ < passes_.size(); }
  // The 2w x 2h output of the last run finished in `slot`; 0 if the slot has none or was reallocated.
  unsigned int result(int slot, std::uint64_t generation) const;
  // Changes whenever the textures are reallocated, invalidating earlier results.
  std::uint64_t generation() const { return generation_; }

  // Writes the input and output of the `run`th run (from 1) as 8-bit PGM files `<prefix>-in.pgm` and
  // `<prefix>-out.pgm` (their red channel), for comparing with a reference.
  void dump_at(std::string prefix, std::uint64_t run) {
    dump_prefix_ = std::move(prefix);
    dump_run_ = run;
  }

  // Finished runs and the GPU time of the steps whose timer results arrived since the last call.
  struct Stats {
    std::uint32_t runs = 0, steps = 0;
    std::uint64_t gpu_ns = 0, max_step_ns = 0;
  };
  Stats take_stats();

private:
  struct Pass {
    unsigned int program = 0;
    int block_w = 1, block_h = 1;  // output pixels per work group
    float scale = 1;               // output size over the source's
    double cost = 0;               // estimated work, for splitting a run
    std::vector<std::string> binds;
    std::string save;              // "" for the last pass, whose output is the result
    int last_use = 0;              // the last pass that reads `save`
  };
  struct Texture {
    unsigned int id = 0;
    int w = 0, h = 0;
    int free_after = -1;           // the pass after which nothing reads it
  };
  bool allocate(int w, int h);
  void free_textures();
  void run_pass(std::size_t index);
  void dump(unsigned int texture, int w, int h, const std::string& path) const;
  void collect_timers();

  std::vector<Pass> passes_;
  std::string hook_;
  bool rgb_ = false;
  float threshold_ = 1.3f;
  std::vector<Texture> pool_;
  std::vector<int> outputs_;       // pool index each pass writes; -1 for the last, which writes a result
  Texture results_[2];
  bool result_ready_[2] = {};
  int width_ = 0, height_ = 0;
  std::uint64_t generation_ = 0;

  // The run in progress.
  unsigned int source_ = 0;
  int slot_ = 0;
  std::size_t next_pass_ = 0;
  [[maybe_unused]] double done_cost_ = 0, total_cost_ = 0;
  bool dumping_ = false;

  std::string dump_prefix_;
  // Unused where GL has no compute shaders, as the timers.
  [[maybe_unused]] std::uint64_t dump_run_ = 0, total_runs_ = 0;

  static constexpr int kTimers = 8;
  [[maybe_unused]] unsigned int timers_[kTimers] = {};
  bool timer_pending_[kTimers] = {};
  [[maybe_unused]] int next_timer_ = 0;
  bool timing_ = false;
  Stats stats_;
};
