// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "damage_tracker.hpp"

#include "render_workers.hpp"

#include <algorithm>
#include <cstdint>
#include <iterator>

extern "C" {
#include "native_renderer.h"
// Engine-internal (engine/core/renderer_internal.h), exported by the pinned revision.
const EmbeddedRenderBackend* er_backend(void);
}

namespace {
#ifndef ERUI_RENDER_WORKERS
#define ERUI_RENDER_WORKERS 1
#endif
EmbeddedRenderBackend inner, wrapper;
int fb_width = 0, fb_height = 0;
DamageMove moves[4];
int move_count = 0;

ERRect unite(const ERRect& a, const ERRect& b) {
  const int x = std::min(a.x, b.x), y = std::min(a.y, b.y);
  return {x, y, std::max(a.x + a.w, b.x + b.w) - x, std::max(a.y + a.h, b.y + b.h) - y};
}

// Overlapping or edge-adjacent, so merging wastes no area for row-by-row blits.
bool touches(const ERRect& a, const ERRect& b) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

long long area(const ERRect& r) { return static_cast<long long>(r.w) * r.h; }

// Uploads may overlap, so two rects merge only when their bounding box is almost all their own pixels
// (the engine's damage set uses the same rule):
// a full-width scroll strip and a card overlapping one end of it are uploaded separately.
bool cheap(const ERRect& a, const ERRect& b) {
  const long long waste = area(unite(a, b)) - area(a) - area(b);
  return touches(a, b) && (waste * 4 <= area(unite(a, b)) || waste <= 4096);
}

struct Damage {
  ERRect rects[ER_DAMAGE_RECTS_MAX];
  int count = 0, last = 0;

  void note(const ERRect& r) {
    if (count && cheap(rects[last], r)) { rects[last] = unite(rects[last], r); return; }
    for (int i = 0; i < count; ++i)
      if (cheap(rects[i], r)) { rects[last = i] = unite(rects[i], r); return; }
    if (count < ER_DAMAGE_RECTS_MAX) { rects[last = count++] = r; return; }
    // Budget exhausted: grow whichever rect wastes the least area.
    int best = 0;
    long long best_growth = -1;
    for (int i = 0; i < count; ++i) {
      const long long growth = area(unite(rects[i], r)) - area(rects[i]);
      if (best_growth < 0 || growth < best_growth) { best = i; best_growth = growth; }
    }
    rects[last = best] = unite(rects[best], r);
  }
};

// One set per render worker, so the threads of a parallel commit never share one; folded into the
// render thread's set when the host reads it after the commit.
Damage damage[ERUI_RENDER_WORKERS];

void note(int x, int y, int w, int h) {
  const int x0 = std::max(x, 0), y0 = std::max(y, 0);
  const int x1 = std::min(x + w, fb_width), y1 = std::min(y + h, fb_height);
  if (x1 <= x0 || y1 <= y0) return;
  damage[render_workers::current()].note({x0, y0, x1 - x0, y1 - y0});
}

void fold() {
  for (int k = 1; k < ERUI_RENDER_WORKERS; ++k) {
    for (int i = 0; i < damage[k].count; ++i) damage[0].note(damage[k].rects[i]);
    damage[k].count = damage[k].last = 0;
  }
}

void fill(std::uint32_t argb, int x, int y, int w, int h, void* ctx) {
  inner.fill_rect(argb, x, y, w, h, ctx);
  note(x, y, w, h);
}

void copy(const void* src, int stride, int x, int y, int w, int h, void* ctx) {
  inner.copy_rect(src, stride, x, y, w, h, ctx);
  note(x, y, w, h);
}

void blend(const void* src, int stride, std::uint8_t alpha, int x, int y, int w, int h, void* ctx) {
  inner.blend_rect(src, stride, alpha, x, y, w, h, ctx);
  note(x, y, w, h);
}

void add(const void* src, int stride, std::uint8_t alpha, int x, int y, int w, int h, void* ctx) {
  inner.add_rect(src, stride, alpha, x, y, w, h, ctx);
  note(x, y, w, h);
}

void clear(int x, int y, int w, int h, void* ctx) {
  inner.clear_rect(x, y, w, h, ctx);
  note(x, y, w, h);
}

void move(int src_x, int src_y, int w, int h, int dst_x, int dst_y, void* ctx) {
  inner.move_rect(src_x, src_y, w, h, dst_x, dst_y, ctx);
  if (move_count == static_cast<int>(std::size(moves))) {
    note(dst_x, dst_y, w, h); // Out of slots: upload the moved pixels instead.
    return;
  }
  // Pixels painted earlier in this frame travel with the move, so the moved copy is damage too.
  // Moves happen before the commit renders, on the render thread.
  fold();
  ERRect painted[ER_DAMAGE_RECTS_MAX];
  const int painted_count = damage[0].count;
  std::copy(damage[0].rects, damage[0].rects + painted_count, painted);
  for (int i = 0; i < painted_count; ++i) {
    const ERRect& r = painted[i];
    const int x0 = std::max(r.x, src_x), y0 = std::max(r.y, src_y);
    const int x1 = std::min(r.x + r.w, src_x + w), y1 = std::min(r.y + r.h, src_y + h);
    if (x1 > x0 && y1 > y0) note(x0 + dst_x - src_x, y0 + dst_y - src_y, x1 - x0, y1 - y0);
  }
  moves[move_count++] = {{src_x, src_y, w, h}, dst_x - src_x, dst_y - src_y};
}
} // namespace

bool damage_tracker_install(int width, int height) {
  const EmbeddedRenderBackend* active = er_backend();
  // Banded and format-aware paths write pixels this wrapper would not see.
  if (!active || !active->fill_rect || !active->copy_rect || !active->blend_rect ||
      active->band_height || active->copy_rect_fmt) return false;
  inner = wrapper = *active;
  wrapper.fill_rect = fill;
  wrapper.copy_rect = copy;
  wrapper.blend_rect = blend;
  if (inner.move_rect) wrapper.move_rect = move;
  if (inner.clear_rect) wrapper.clear_rect = clear;
  if (inner.add_rect) wrapper.add_rect = add;
  fb_width = width; fb_height = height;
  damage_tracker_clear();
  embedded_renderer_set_backend(&wrapper);
  return true;
}

std::span<const ERRect> damage_tracker_rects() {
  fold();
  return {damage[0].rects, static_cast<std::size_t>(damage[0].count)};
}

std::span<const DamageMove> damage_tracker_moves() { return {moves, static_cast<std::size_t>(move_count)}; }

std::size_t damage_tracker_area() {
  std::size_t area = 0;
  for (const ERRect& r : damage_tracker_rects()) area += static_cast<std::size_t>(r.w) * r.h;
  for (const DamageMove& m : damage_tracker_moves()) area += static_cast<std::size_t>(m.src.w) * m.src.h;
  return area;
}

void damage_tracker_clear() {
  for (Damage& set : damage) set.count = set.last = 0;
  move_count = 0;
}
