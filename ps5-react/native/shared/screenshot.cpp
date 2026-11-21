// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "screenshot.hpp"
#include "video_api.hpp"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <vector>

extern "C" {
#include "software_backend.h"
}
#include "er_scene.h"

namespace {
// A layer's image at (x, y) of the framebuffer, filtered like the GPU's GL_LINEAR at texel centres.
void sample(const ERLayer& l, int x, int y, unsigned rgb[3]) {
  const double u = l.src_x + (x - l.dst.x + 0.5) * l.src_w / l.dst.w - 0.5;
  const double v = l.src_y + (y - l.dst.y + 0.5) * l.src_h / l.dst.h - 0.5;
  const int u0 = std::clamp(static_cast<int>(std::floor(u)), 0, l.image_w - 1);
  const int u1 = std::clamp(static_cast<int>(std::floor(u)) + 1, 0, l.image_w - 1);
  const int v0 = std::clamp(static_cast<int>(std::floor(v)), 0, l.image_h - 1);
  const int v1 = std::clamp(static_cast<int>(std::floor(v)) + 1, 0, l.image_h - 1);
  const double fu = std::clamp(u - std::floor(u), 0.0, 1.0), fv = std::clamp(v - std::floor(v), 0.0, 1.0);
  const auto at = [&](int px, int py) { return l.pixels[static_cast<std::size_t>(py) * l.image_w + px]; };
  const std::uint32_t a = at(u0, v0), b = at(u1, v0), c = at(u0, v1), d = at(u1, v1);
  for (int k = 0; k < 3; ++k) {
    const auto ch = [k](std::uint32_t p) { return double((p >> (8 * k)) & 0xFFu); };
    const double top = ch(a) + (ch(b) - ch(a)) * fu, bottom = ch(c) + (ch(d) - ch(c)) * fu;
    rgb[k] = static_cast<unsigned>(top + (bottom - top) * fv + 0.5);
  }
}

// Whether (x, y) is in a rounded corner's square, which the framebuffer draws instead of the layer.
bool in_corner(const ERLayer& l, int x, int y) {
  const int qx = x - l.dst.x, qy = y - l.dst.y, ex = l.dst.x + l.dst.w - x, ey = l.dst.y + l.dst.h - y;
  return (qx < l.radius_tl && qy < l.radius_tl) || (ex <= l.radius_tr && qy < l.radius_tr) ||
         (ex <= l.radius_br && ey <= l.radius_br) || (qx < l.radius_bl && ey <= l.radius_bl);
}

// The framebuffer pixel as presented: over the layers the GPU draws beneath it.
std::uint32_t presented(const std::uint32_t* pixels, int width, int x, int y, const ERLayer* layers, int count) {
  const std::uint32_t ui = pixels[static_cast<std::size_t>(y) * width + x];
  if (count == 0 || (ui >> 24) == 0xFFu) return ui;
  unsigned rgb[3] = {0, 0, 0};
  for (int i = 0; i < count; ++i) {
    const ERLayer& l = layers[i];
    if (x < l.clip.x || y < l.clip.y || x >= l.clip.x + l.clip.w || y >= l.clip.y + l.clip.h) continue;
    if (x < l.dst.x || y < l.dst.y || x >= l.dst.x + l.dst.w || y >= l.dst.y + l.dst.h) continue;
    if (in_corner(l, x, y)) continue;
    unsigned texel[3];
    if (!video_layers::sample(l.image, l.dst.x, l.dst.y, l.dst.w, l.dst.h, x, y, texel)) sample(l, x, y, texel);
    for (int c = 0; c < 3; ++c) rgb[c] = (texel[c] * l.alpha + rgb[c] * (255u - l.alpha) + 127u) / 255u;
  }
  const unsigned inverse = 255u - (ui >> 24);
  std::uint32_t out = 0xFF000000u;
  for (int c = 0; c < 3; ++c) out |= (((ui >> (8 * c)) & 0xFFu) + (rgb[c] * inverse + 127u) / 255u) << (8 * c);
  return out;
}
} // namespace

bool save_screenshot(const char* path, int step) {
  const std::uint32_t* pixels = er_software_framebuffer();
  const int source_width = er_software_fb_width(), source_height = er_software_fb_height();
  const int width = source_width / step, height = source_height / step, row = (width * 3 + 3) & ~3;
  if (!pixels || width <= 0 || height <= 0) return false;
  FILE* file = std::fopen(path, "wb");
  if (!file) return false;
  unsigned char header[54] = {'B', 'M'};
  const auto put = [&](int at, std::uint32_t value) {
    for (int i = 0; i < 4; ++i) header[at + i] = static_cast<unsigned char>(value >> (8 * i));
  };
  put(2, 54 + row * height); put(10, 54); put(14, 40); put(18, width); put(22, height);
  header[26] = 1; header[28] = 24;
  bool ok = std::fwrite(header, 1, sizeof header, file) == sizeof header;
  int layer_count = 0;
  const ERLayer* layers = er_get_layers(&layer_count);
  // Bottom-up rows; each output pixel averages a step×step block of 0xAARRGGBB words.
  std::vector<unsigned char> line(row, 0);
  for (int y = height - 1; y >= 0 && ok; --y) {
    for (int x = 0; x < width; ++x) {
      unsigned sum[3] = {0, 0, 0};
      for (int dy = 0; dy < step; ++dy)
        for (int dx = 0; dx < step; ++dx) {
          const std::uint32_t p = presented(pixels, source_width, step * x + dx, step * y + dy, layers, layer_count);
          for (int channel = 0; channel < 3; ++channel) sum[channel] += (p >> (8 * channel)) & 0xFFu;
        }
      for (int channel = 0; channel < 3; ++channel)
        line[x * 3 + channel] = static_cast<unsigned char>((sum[channel] + step * step / 2) / (step * step));
    }
    ok = std::fwrite(line.data(), 1, line.size(), file) == line.size();
  }
  return std::fclose(file) == 0 && ok;
}
