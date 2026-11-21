// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Runtime text for what the baked bitmap fonts cannot draw (docs/TEXT.md): CJK, Devanagari, Bengali
// and Arabic from subset Noto fonts, shaped by HarfBuzz, ordered by the Unicode bidi algorithm
// (SheenBidi) and rasterized on demand into a bounded glyph cache, with CJK line breaking.
// Installed into Embedded React as its ERTextShaper; render thread only.
#pragma once

#include <utility>
#include <vector>

namespace text_shaper {
// Installs the shaper with the fonts in `font_dir`, a real directory holding the files the app
// packaged (any may be absent). Fonts load the first time text needs them. Call after
// er_register_assets(); `log` receives one line per font load or failure.
void install(const char* font_dir, void (*log)(const char* line));
// BCP 47 language of the interface ("ja", "zh-Hans", ...): picks Japanese or Chinese Han glyphs and
// the shaping language. Text laid out before the call keeps its layout until it changes.
void set_language(const char* tag);
// Removes the shaper and frees its fonts and caches.
void shutdown();
// The [start, end) byte range of each line `text` breaks into at `max_w` pixels, trailing spaces
// excluded, as layout and drawing break it: for tools/test_text.py.
std::vector<std::pair<int, int>> lines(const char* text, const char* font_family, int font_size, int max_w);
}  // namespace text_shaper
