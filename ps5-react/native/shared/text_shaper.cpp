// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "text_shaper.hpp"

#include <SheenBidi/SheenBidi.h>
#include <hb-raster.h>
#include <hb.h>

#include "er_text_shaper.h"
#include "host_api.hpp"

#include <algorithm>
#include <cctype>
#include <climits>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <sys/stat.h>
#include <unordered_map>
#include <vector>

namespace {

// Rasterized glyphs kept for reuse, least recently drawn evicted first: about 7,000 CJK glyphs at
// 24 px. Fonts are loaded whole, on first use, and kept (docs/TEXT.md lists their sizes).
constexpr std::size_t kGlyphCacheBytes = 4u << 20;
// Shaped strings kept for reuse (layout measures a node, wraps it, then the compositor draws it):
// about 1 KB each for a typical label.
constexpr std::size_t kLayoutCacheEntries = 128;

enum class Script : std::uint8_t { kOther, kHan, kKana, kDevanagari, kBengali, kArabic };

struct FaceSpec {
  const char* file;
  Script script;
  // Line box over and under the baseline, in thousandths of an em, at most: CJK uses its em box,
  // Arabic its common letters rather than the stacked marks its hhea metrics make room for.
  int ascent, descent;
  // Joined scripts take no letter spacing or faux-bold advance, which would break their joins.
  bool joined;
};
constexpr FaceSpec kFaces[] = {
    {"NotoSansJP-Regular.otf", Script::kKana, 880, 120, false},
    {"NotoSansSC-Regular.otf", Script::kHan, 880, 120, false},
    {"NotoSansTC-Regular.otf", Script::kHan, 880, 120, false},
    {"NotoSansDevanagari-Regular.ttf", Script::kDevanagari, 1000, 450, true},
    {"NotoSansBengali-Regular.ttf", Script::kBengali, 1000, 450, true},
    {"NotoSansArabic-Regular.ttf", Script::kArabic, 1050, 500, true},
};
constexpr int kFaceCount = sizeof kFaces / sizeof kFaces[0];
constexpr int kJapanese = 0, kChinese = 1, kTraditional = 2;

struct Face {
  bool present = false, failed = false;
  hb_face_t* face = nullptr;
  hb_font_t* probe = nullptr;
  std::vector<std::pair<int, hb_font_t*>> sizes;
};

struct State {
  std::string font_dir;
  void (*log)(const char*) = nullptr;
  Face faces[kFaceCount];
  bool any_face = false;
  hb_language_t language = nullptr;
  bool prefer_japanese = false, prefer_traditional = false;
  unsigned serial = 0;
  hb_buffer_t* buffer = nullptr;
  hb_raster_draw_t* raster = nullptr;
};
State* state = nullptr;

void log_line(const char* format, const char* a, double b = 0) {
  if (!state->log) return;
  char line[256];
  std::snprintf(line, sizeof line, format, a, b);
  state->log(line);
}

// ---- Unicode --------------------------------------------------------------------------------

std::uint32_t next_codepoint(const char* text, std::size_t length, std::size_t& at) {
  const auto* p = reinterpret_cast<const unsigned char*>(text);
  const unsigned char b = p[at];
  int count = b < 0x80 ? 1 : (b & 0xE0) == 0xC0 ? 2 : (b & 0xF0) == 0xE0 ? 3 : (b & 0xF8) == 0xF0 ? 4 : 0;
  if (!count || at + count > length) {
    at++;
    return 0xFFFD;
  }
  std::uint32_t cp = count == 1 ? b : b & (0x7F >> count);
  for (int i = 1; i < count; i++) {
    if ((p[at + i] & 0xC0) != 0x80) {
      at += i;
      return 0xFFFD;
    }
    cp = (cp << 6) | (p[at + i] & 0x3F);
  }
  at += count;
  return cp;
}

Script script_of(std::uint32_t c) {
  if ((c >= 0x0900 && c <= 0x0963) || (c >= 0x0966 && c <= 0x097F) || (c >= 0xA8E0 && c <= 0xA8FF) ||
      (c >= 0x1CD0 && c <= 0x1CFF))
    return Script::kDevanagari;
  if (c >= 0x0980 && c <= 0x09FF) return Script::kBengali;
  if ((c >= 0x0600 && c <= 0x06FF) || (c >= 0x0750 && c <= 0x077F) || (c >= 0x0870 && c <= 0x08FF) ||
      (c >= 0xFB50 && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF))
    return Script::kArabic;
  if ((c >= 0x3040 && c <= 0x30FF) || (c >= 0x31F0 && c <= 0x31FF) || (c >= 0xFF66 && c <= 0xFF9F))
    return Script::kKana;
  if ((c >= 0x2E80 && c <= 0x2FDF) || (c >= 0x3000 && c <= 0x303F) || (c >= 0x3190 && c <= 0x33FF) ||
      (c >= 0x3400 && c <= 0x4DBF) || (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xF900 && c <= 0xFAFF) ||
      (c >= 0xFE30 && c <= 0xFE4F) || (c >= 0xFF00 && c <= 0xFFEF) || (c >= 0x20000 && c <= 0x3FFFF))
    return Script::kHan;
  return Script::kOther;
}

// Scripts that must be shaped (or reordered) even when a baked font has their characters: Hebrew to
// Myanmar, Khmer, Mongolian and the Arabic presentation forms.
bool needs_shaping(std::uint32_t c) {
  return (c >= 0x0590 && c <= 0x109F) || (c >= 0x1780 && c <= 0x18AF) || (c >= 0xFB1D && c <= 0xFDFF) ||
         (c >= 0xFE70 && c <= 0xFEFF);
}

// Strong right-to-left characters (Hebrew, Arabic, Syriac, Thaana, NKo and their extensions): text
// without any, and without a right-to-left direction, skips the bidi algorithm.
bool right_to_left(std::uint32_t c) {
  return (c >= 0x0590 && c <= 0x08FF) || (c >= 0xFB1D && c <= 0xFDFF) || (c >= 0xFE70 && c <= 0xFEFF) ||
         (c >= 0x10800 && c <= 0x10FFF) || (c >= 0x1E800 && c <= 0x1EFFF);
}

// Characters drawn as part of the one before them (combining marks, joiners, variation selectors).
bool extends(std::uint32_t c) {
  if (c == 0x200C || c == 0x200D || (c >= 0xFE00 && c <= 0xFE0F) || (c >= 0xE0100 && c <= 0xE01EF)) return true;
  const hb_unicode_general_category_t category = hb_unicode_general_category(hb_unicode_funcs_get_default(), c);
  return category == HB_UNICODE_GENERAL_CATEGORY_NON_SPACING_MARK ||
         category == HB_UNICODE_GENERAL_CATEGORY_SPACING_MARK ||
         category == HB_UNICODE_GENERAL_CATEGORY_ENCLOSING_MARK;
}

// Invisible formatting characters: never a reason to leave the bitmap path.
bool ignorable(std::uint32_t c) {
  return (c >= 0x200B && c <= 0x200F) || (c >= 0x2028 && c <= 0x202E) || (c >= 0x2060 && c <= 0x206F) ||
         (c >= 0xFE00 && c <= 0xFE0F) || c == 0xFEFF || c == 0x00AD;
}

bool is_space(std::uint32_t c) { return c == ' ' || c == '\t' || c == 0x3000; }

// Ideographic text breaks between any two characters (UAX #14 class ID and its neighbours). Other
// scripts, Devanagari, Bengali and Arabic among them, break only after spaces.
bool breaks_around(std::uint32_t c) {
  const Script script = script_of(c);
  return (script == Script::kHan || script == Script::kKana) && c != 0x3000;
}

// A virama or zero-width joiner joins the next consonant into one conjunct: never a line break.
bool joins_next(std::uint32_t c) {
  return c == 0x200D ||
         hb_unicode_combining_class(hb_unicode_funcs_get_default(), c) == HB_UNICODE_COMBINING_CLASS_VIRAMA;
}

// Kinsoku: characters that may not start a line (closing punctuation, small kana, iteration and
// prolonged-sound marks) or end one (opening brackets).
bool no_line_start(std::uint32_t c) {
  static constexpr char32_t kList[] =
      U"!),.:;?]}¢°’”‰′″℃、。〃々〆〉》」』】〕〗〙〟〻ゝゞァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖ"
      U"ーヽヾ・‥…‐゠–〜！％），．：；？］｝｡｣､･ｧｨｩｪｫｬｭｮｯｰﾞﾟ";
  for (char32_t x : kList)
    if (x == c) return true;
  return false;
}
bool no_line_end(std::uint32_t c) {
  static constexpr char32_t kList[] = U"([{£¥‘“〈《「『【〔〖〘〝（［｛｢＄￡￥";
  for (char32_t x : kList)
    if (x == c) return true;
  return false;
}

// ---- Fonts ----------------------------------------------------------------------------------

bool load(int index) {
  Face& face = state->faces[index];
  if (face.face) return true;
  if (!face.present || face.failed) return false;
  const std::string path = state->font_dir + "/" + kFaces[index].file;
  FILE* file = std::fopen(path.c_str(), "rb");
  long size = -1;
  if (file && std::fseek(file, 0, SEEK_END) == 0) size = std::ftell(file);
  char* data = size > 0 && std::fseek(file, 0, SEEK_SET) == 0 ? static_cast<char*>(std::malloc(size)) : nullptr;
  const bool ok = data && std::fread(data, 1, size, file) == static_cast<std::size_t>(size);
  if (file) std::fclose(file);
  if (!ok) {
    std::free(data);
    face.failed = true;
    log_line("text: cannot load %s", path.c_str());
    return false;
  }
  hb_blob_t* blob = hb_blob_create(data, static_cast<unsigned>(size), HB_MEMORY_MODE_READONLY, data, std::free);
  face.face = hb_face_create(blob, 0);
  hb_blob_destroy(blob);
  face.probe = hb_font_create(face.face);
  log_line("text: loaded %s (%.1f MB)", kFaces[index].file, size / 1048576.0);
  return true;
}

// The face at a pixel size: positions in 26.6 fixed point.
hb_font_t* font_at(int index, int px) {
  Face& face = state->faces[index];
  for (auto& [size, font] : face.sizes)
    if (size == px) return font;
  hb_font_t* font = hb_font_create(face.face);
  hb_font_set_scale(font, px * 64, px * 64);
  face.sizes.emplace_back(px, font);
  return font;
}

bool face_has(int index, std::uint32_t cp) {
  hb_codepoint_t glyph;
  return load(index) && hb_font_get_nominal_glyph(state->faces[index].probe, cp, &glyph);
}

// The face that draws `cp`: its script's faces first, then the face of the text around it.
int face_for(std::uint32_t cp, int previous) {
  int order[kFaceCount + 1];
  int count = 0;
  const Script script = script_of(cp);
  if (script == Script::kHan || script == Script::kKana) {
    // Han in the language's own forms first; a character its font lacks takes the nearest one that
    // has it (simplified and traditional Chinese share most characters, then Japanese kanji).
    const bool japanese = script == Script::kKana || state->prefer_japanese;
    const bool traditional = state->prefer_traditional && !japanese;
    if (japanese) order[count++] = kJapanese;
    order[count++] = traditional ? kTraditional : kChinese;
    order[count++] = traditional ? kChinese : kTraditional;
    if (!japanese) order[count++] = kJapanese;
  } else if (script != Script::kOther) {
    for (int i = 0; i < kFaceCount; i++)
      if (kFaces[i].script == script) order[count++] = i;
  } else {
    if (previous >= 0) order[count++] = previous;
    for (int i = 0; i < kFaceCount; i++) order[count++] = i;
  }
  for (int i = 0; i < count; i++)
    if (face_has(order[i], cp)) return order[i];
  return -1;
}

bool baked_has(const BitmapFont* font, std::uint32_t cp) {
  if (cp >= font->first && cp <= font->last) return true;
  std::uint32_t lo = 0, hi = font->extras_count;
  while (lo < hi) {
    const std::uint32_t mid = (lo + hi) / 2;
    if (font->extras[mid].codepoint == cp) return true;
    if (font->extras[mid].codepoint < cp) lo = mid + 1;
    else hi = mid;
  }
  return false;
}

// ---- Glyph cache ----------------------------------------------------------------------------

struct CachedGlyph {
  std::uint64_t key;
  CachedGlyph *newer, *older;
  int left, top;  // bitmap origin from the pen position and the baseline, in pixels (top is up)
  int width, height;
  std::uint8_t pixels[1];
};

struct GlyphCache {
  std::unordered_map<std::uint64_t, CachedGlyph*> map;
  CachedGlyph *newest = nullptr, *oldest = nullptr;
  std::size_t bytes = 0;

  void unlink(CachedGlyph* g) {
    (g->newer ? g->newer->older : newest) = g->older;
    (g->older ? g->older->newer : oldest) = g->newer;
  }
  void push(CachedGlyph* g) {
    g->newer = nullptr;
    g->older = newest;
    (newest ? newest->newer : oldest) = g;
    newest = g;
  }
  void clear() {
    while (oldest) {
      CachedGlyph* g = oldest;
      unlink(g);
      std::free(g);
    }
    map.clear();
    bytes = 0;
  }
};
GlyphCache* cache = nullptr;

const CachedGlyph* glyph_image(int face, int px, std::uint32_t glyph) {
  const std::uint64_t key = (static_cast<std::uint64_t>(face) << 40) | (static_cast<std::uint64_t>(px) << 32) | glyph;
  if (auto found = cache->map.find(key); found != cache->map.end()) {
    cache->unlink(found->second);
    cache->push(found->second);
    return found->second;
  }
  hb_raster_draw_glyph(state->raster, font_at(face, px), glyph);
  hb_raster_image_t* image = hb_raster_draw_render(state->raster);
  if (!image) return nullptr;
  hb_raster_extents_t extents;
  hb_raster_image_get_extents(image, &extents);
  const int width = extents.width <= 255 ? static_cast<int>(extents.width) : 0;
  const int height = extents.height <= 255 ? static_cast<int>(extents.height) : 0;
  const std::size_t size = sizeof(CachedGlyph) + static_cast<std::size_t>(width) * height;
  auto* entry = static_cast<CachedGlyph*>(std::malloc(size));
  if (!entry) {
    hb_raster_draw_recycle_image(state->raster, image);
    return nullptr;
  }
  entry->key = key;
  entry->left = extents.x_origin;
  entry->top = extents.y_origin + height;
  entry->width = width;
  entry->height = height;
  // The image's first row is its bottom (y grows upward in glyph space).
  const std::uint8_t* source = hb_raster_image_get_buffer(image);
  for (int row = 0; row < height; row++)
    std::memcpy(entry->pixels + static_cast<std::size_t>(row) * width,
                source + static_cast<std::size_t>(height - 1 - row) * extents.stride, width);
  hb_raster_draw_recycle_image(state->raster, image);
  cache->map.emplace(key, entry);
  cache->push(entry);
  cache->bytes += size;
  while (cache->bytes > kGlyphCacheBytes && cache->oldest != entry) {
    CachedGlyph* old = cache->oldest;
    cache->unlink(old);
    cache->map.erase(old->key);
    cache->bytes -= sizeof(CachedGlyph) + static_cast<std::size_t>(old->width) * old->height;
    std::free(old);
  }
  return entry;
}

// ---- Shaping --------------------------------------------------------------------------------

struct Glyph {
  std::uint32_t id;  // glyph ID in its face, or the codepoint for a baked glyph
  std::int32_t advance, dx, dy;  // 26.6
  std::uint32_t cluster;  // byte offset of the first character it draws
  std::int8_t face;  // -1: baked bitmap glyph
};

struct Run {
  std::uint32_t start, end;
  std::int8_t face;
  std::uint8_t level;  // bidi embedding level: odd runs are right to left
  std::uint32_t first_glyph = 0, glyph_count = 0;
};

struct Paragraph {
  std::uint32_t start;
  std::uint8_t level;  // base level: 1 for a right-to-left paragraph
};

// kClusterStart: a HarfBuzz cluster (a base and its marks) starts here. kGraphemeStart: a cluster
// that does not continue a conjunct, the only place a word too wide for its line may be cut.
enum : std::uint8_t { kClusterStart = 1, kBreakBefore = 2, kSpace = 4, kNewline = 8, kGraphemeStart = 16 };

struct Layout {
  std::string text, family;
  int px = 0, letter_spacing = 0, bold = 0, direction = 0;
  unsigned serial = 0;
  const BitmapFont* baked = nullptr;
  std::vector<Glyph> glyphs;
  std::vector<Run> runs;
  std::vector<Paragraph> paragraphs;
  std::vector<std::uint8_t> levels;   // per byte
  std::vector<std::int32_t> advance;  // per byte: the 26.6 advance of the cluster starting there
  std::vector<std::uint8_t> flags;    // per byte
  int ascent = 0, descent = 0, line_height = 0;  // pixels
};

struct LayoutCache {
  Layout entries[kLayoutCacheEntries];
  std::size_t next = 0;
};
LayoutCache* layouts = nullptr;

// Embedding levels per byte (Unicode bidirectional algorithm, one paragraph per line feed), and
// each paragraph's base level: from `direction`, else from its first strong character.
void resolve_levels(Layout& layout) {
  const char* text = layout.text.c_str();
  const std::size_t length = layout.text.size();
  const SBLevel base = layout.direction == ER_DIRECTION_RTL ? 1 : layout.direction == ER_DIRECTION_LTR ? 0
                                                                                                       : SBLevelDefaultLTR;
  layout.levels.assign(length + 1, 0);
  bool bidi = layout.direction == ER_DIRECTION_RTL;
  for (std::size_t at = 0; at < length && !bidi;) bidi = right_to_left(next_codepoint(text, length, at));
  if (!bidi) {
    layout.paragraphs.push_back({0, 0});
    return;
  }
  SBCodepointSequence sequence{SBStringEncodingUTF8, const_cast<char*>(text), length};
  SBAlgorithmRef algorithm = SBAlgorithmCreate(&sequence);
  for (SBUInteger offset = 0; algorithm && offset < length;) {
    SBParagraphRef paragraph = SBAlgorithmCreateParagraph(algorithm, offset, length - offset, base);
    if (!paragraph) break;
    const SBUInteger size = SBParagraphGetLength(paragraph);
    std::memcpy(layout.levels.data() + offset, SBParagraphGetLevelsPtr(paragraph), size);
    layout.paragraphs.push_back({static_cast<std::uint32_t>(offset), SBParagraphGetBaseLevel(paragraph)});
    SBParagraphRelease(paragraph);
    offset += size;
  }
  if (algorithm) SBAlgorithmRelease(algorithm);
  if (layout.paragraphs.empty()) layout.paragraphs.push_back({0, 0});
}

void itemize(Layout& layout) {
  const char* text = layout.text.c_str();
  const std::size_t length = layout.text.size();
  std::size_t at = 0;
  int previous_face = -1;
  while (at < length) {
    const std::size_t start = at;
    const std::uint32_t cp = next_codepoint(text, length, at);
    bool baked = cp == '\n' || ignorable(cp) || (baked_has(layout.baked, cp) && !needs_shaping(cp));
    while (at < length) {
      std::size_t peek = at;
      const std::uint32_t mark = next_codepoint(text, length, peek);
      if (!extends(mark)) break;
      baked = baked && (ignorable(mark) || baked_has(layout.baked, mark));
      at = peek;
    }
    const int face = baked ? -1 : face_for(cp, previous_face);
    if (face >= 0) previous_face = face;
    const std::uint8_t level = layout.levels[start];
    if (!layout.runs.empty() && layout.runs.back().face == face && layout.runs.back().level == level)
      layout.runs.back().end = static_cast<std::uint32_t>(at);
    else
      layout.runs.push_back({static_cast<std::uint32_t>(start), static_cast<std::uint32_t>(at),
                             static_cast<std::int8_t>(face), level});
  }
}

void shape(Layout& layout) {
  const char* text = layout.text.c_str();
  const std::size_t length = layout.text.size();
  for (Run& run : layout.runs) {
    run.first_glyph = static_cast<std::uint32_t>(layout.glyphs.size());
    if (run.face < 0) {
      std::uint32_t cluster = run.start;
      for (std::size_t at = run.start; at < run.end;) {
        const std::uint32_t start = static_cast<std::uint32_t>(at);
        const std::uint32_t cp = next_codepoint(text, length, at);
        // A baked combining mark belongs to its base's cluster, so no line starts with it.
        if (start == run.start || !extends(cp)) cluster = start;
        if (cp == '\n' || ignorable(cp)) {
          layout.glyphs.push_back({cp, 0, 0, 0, cluster, -1});
          continue;
        }
        const int advance = font_glyph(layout.baked, cp)->advance + layout.letter_spacing + layout.bold;
        layout.glyphs.push_back({cp, advance * 64, 0, 0, cluster, -1});
      }
    } else {
      hb_buffer_t* buffer = state->buffer;
      hb_buffer_clear_contents(buffer);
      hb_buffer_add_utf8(buffer, text, static_cast<int>(length), run.start, static_cast<int>(run.end - run.start));
      hb_buffer_set_direction(buffer, run.level & 1 ? HB_DIRECTION_RTL : HB_DIRECTION_LTR);
      hb_buffer_set_language(buffer, state->language);
      hb_buffer_guess_segment_properties(buffer);
      hb_shape(font_at(run.face, layout.px), buffer, nullptr, 0);
      unsigned count = 0;
      const hb_glyph_info_t* info = hb_buffer_get_glyph_infos(buffer, &count);
      const hb_glyph_position_t* position = hb_buffer_get_glyph_positions(buffer, nullptr);
      const int extra = kFaces[run.face].joined ? 0 : (layout.letter_spacing + layout.bold) * 64;
      for (unsigned i = 0; i < count; i++) {
        const bool first_of_cluster = i == 0 || info[i].cluster != info[i - 1].cluster;
        layout.glyphs.push_back({info[i].codepoint, position[i].x_advance + (first_of_cluster ? extra : 0),
                                 position[i].x_offset, position[i].y_offset, info[i].cluster, run.face});
      }
      // CJK keeps the Latin line height this way (Noto CJK's hhea metrics would make its lines a
      // quarter taller), and Arabic grows it by about a third rather than doubling it.
      hb_font_extents_t extents{};
      hb_font_get_h_extents(font_at(run.face, layout.px), &extents);
      const int em = layout.px * 64;
      const int ascent = std::min<int>(extents.ascender, em * kFaces[run.face].ascent / 1000);
      const int descent = std::min<int>(-extents.descender, em * kFaces[run.face].descent / 1000);
      layout.ascent = std::max(layout.ascent, (ascent + 63) >> 6);
      layout.descent = std::max(layout.descent, (descent + 63) >> 6);
    }
    run.glyph_count = static_cast<std::uint32_t>(layout.glyphs.size()) - run.first_glyph;
  }
  layout.line_height = layout.ascent + layout.descent;

  layout.advance.assign(length + 1, 0);
  layout.flags.assign(length + 1, 0);
  for (const Glyph& g : layout.glyphs) {
    layout.advance[g.cluster] += g.advance;
    layout.flags[g.cluster] |= kClusterStart;
  }
  // Break opportunities, before the character at each cluster start: after a space or a zero-width
  // space, and around CJK characters as kinsoku allows.
  std::uint32_t before = 0;
  for (std::size_t at = 0; at < length;) {
    const std::size_t start = at;
    const std::uint32_t cp = next_codepoint(text, length, at);
    if (cp == '\n') layout.flags[start] |= kNewline;
    if (is_space(cp)) layout.flags[start] |= kSpace;
    if ((layout.flags[start] & kClusterStart) && (start == 0 || !joins_next(before)))
      layout.flags[start] |= kGraphemeStart;
    if (start > 0 && (layout.flags[start] & kGraphemeStart) && !is_space(cp) &&
        (is_space(before) || before == 0x200B ||
         ((breaks_around(before) || breaks_around(cp)) && !no_line_start(cp) && !no_line_end(before))))
      layout.flags[start] |= kBreakBefore;
    before = cp;
  }
}

const Layout& layout_for(const char* text, const char* family, std::uint8_t font_size, int letter_spacing,
                         std::uint8_t font_weight, std::uint8_t direction) {
  const BitmapFont* baked = er_text_font(family, font_size);
  const int bold = font_weight ? 1 : 0;
  const char* family_name = family ? family : "";
  for (const Layout& layout : layouts->entries)
    if (layout.baked == baked && layout.serial == state->serial && layout.px == font_size &&
        layout.letter_spacing == letter_spacing && layout.bold == bold && layout.direction == direction &&
        layout.text == text &&
        layout.family == family_name)
      return layout;
  Layout& layout = layouts->entries[layouts->next];
  layouts->next = (layouts->next + 1) % kLayoutCacheEntries;
  layout = Layout{};
  layout.text = text;
  layout.family = family_name;
  layout.px = font_size;
  layout.letter_spacing = letter_spacing;
  layout.bold = bold;
  layout.direction = direction;
  layout.serial = state->serial;
  layout.baked = baked;
  layout.ascent = baked->baseline;
  layout.descent = baked->line_height - baked->baseline;
  resolve_levels(layout);
  itemize(layout);
  shape(layout);
  return layout;
}

// ---- Line breaking --------------------------------------------------------------------------

struct Line {
  std::uint32_t start, end;  // bytes, trailing spaces excluded
  std::int32_t width;        // 26.6
};

int to_px(std::int32_t fixed) { return (fixed + 63) >> 6; }

// Breaks like the bitmap renderer: at newlines, at break opportunities when the next cluster would
// pass `max_w` (0 = no limit), and inside a word only when nothing else fits, between grapheme
// clusters (a conjunct stays whole). `truncated` reports text left over after `max_lines`.
std::vector<Line> break_lines(const Layout& layout, int max_w, int max_lines, bool& truncated) {
  std::vector<Line> lines;
  truncated = false;
  const std::uint32_t length = static_cast<std::uint32_t>(layout.text.size());
  const std::int32_t limit = max_w > 0 ? max_w * 64 : INT32_MAX;
  std::uint32_t at = 0;
  auto skip_spaces = [&](std::uint32_t p) {
    while (p < length && (layout.flags[p] & kSpace)) p++;
    return p;
  };
  auto content_end = [&](std::uint32_t start, std::uint32_t end, std::int32_t& width) {
    // Width without trailing spaces: recount from start, ending at the last non-space cluster.
    width = 0;
    std::int32_t running = 0;
    std::uint32_t last = start;
    for (std::uint32_t p = start; p < end; p++) {
      if (!(layout.flags[p] & kClusterStart)) continue;
      running += layout.advance[p];
      if (!(layout.flags[p] & (kSpace | kNewline))) {
        width = running;
        last = p + 1;
        while (last < end && !(layout.flags[last] & kClusterStart)) last++;
      }
    }
    return last;
  };
  while (at < length) {
    if (max_lines > 0 && static_cast<int>(lines.size()) >= max_lines) {
      truncated = true;
      break;
    }
    at = skip_spaces(at);
    if (at >= length) break;
    const std::uint32_t start = at;
    std::uint32_t breakpoint = 0, grapheme = 0;
    std::int32_t width = 0;
    std::uint32_t end = length;
    at = length;
    for (std::uint32_t p = start; p < length; p++) {
      if (layout.flags[p] & kNewline) {
        end = p;
        at = p + 1;
        break;
      }
      if (!(layout.flags[p] & kClusterStart)) continue;
      if (p > start && (layout.flags[p] & kBreakBefore)) breakpoint = p;
      if (p > start && (layout.flags[p] & kGraphemeStart)) grapheme = p;
      // A line holds at least one grapheme, even one wider than `max_w`.
      if (width + layout.advance[p] > limit && p > start && !(layout.flags[p] & kSpace) && (breakpoint || grapheme)) {
        end = breakpoint ? breakpoint : grapheme;
        at = end;
        break;
      }
      width += layout.advance[p];
    }
    Line line{start, 0, 0};
    line.end = content_end(start, end, line.width);
    lines.push_back(line);
  }
  if (lines.empty()) lines.push_back({0, 0, 0});
  return lines;
}

// ---- Drawing --------------------------------------------------------------------------------

struct Style {
  std::uint32_t color;
  bool bold, italic;
  std::uint8_t decoration;
};

Style style_at(const ERTextRenderParams* params, const std::uint8_t* span_map, std::uint32_t cluster) {
  Style style{params->color, params->font_weight != 0, params->font_style != 0, params->text_decoration};
  if (!span_map) return style;
  const ERTextSpan& span = params->spans[span_map[cluster]];
  if (span.color) style.color = span.color;
  if (span.font_weight != 0xFF) style.bold = span.font_weight != 0;
  if (span.font_style != 0xFF) style.italic = span.font_style != 0;
  if (span.text_decoration != 0xFF) style.decoration = span.text_decoration;
  return style;
}

void draw_glyph(const Layout& layout, const Glyph& g, int x, int line_top, const ERRect& clip, const Style& style) {
  for (int pass = 0; pass < (style.bold ? 2 : 1); pass++) {
    if (g.face < 0) {
      er_text_draw_glyph(layout.baked, g.id, x + pass, line_top + layout.ascent - layout.baked->baseline, &clip,
                         style.color, style.italic);
      continue;
    }
    const CachedGlyph* image = glyph_image(g.face, layout.px, g.id);
    if (!image || !image->width) return;
    const int left = x + pass + image->left + ((g.dx + 32) >> 6);
    const int top = line_top + layout.ascent - image->top - ((g.dy + 32) >> 6);
    er_text_draw_coverage(image->pixels, image->width, image->height, left, top, &clip, style.color, style.italic);
  }
}

std::uint8_t paragraph_level(const Layout& layout, std::uint32_t at) {
  std::uint8_t level = 0;
  for (const Paragraph& paragraph : layout.paragraphs)
    if (paragraph.start <= at) level = paragraph.level;
  return level;
}

// The runs of a line in display order: rule L2 of the bidi algorithm, reversing every sequence of
// runs at or above each level from the highest down to the lowest odd one.
std::vector<const Run*> visual_runs(const Layout& layout, const Line& line) {
  std::vector<const Run*> runs;
  std::uint8_t highest = 0, lowest_odd = 255;
  for (const Run& run : layout.runs) {
    if (run.end <= line.start || run.start >= line.end) continue;
    runs.push_back(&run);
    highest = std::max(highest, run.level);
    if (run.level & 1) lowest_odd = std::min(lowest_odd, run.level);
  }
  for (int level = highest; level >= lowest_odd && level > 0; level--) {
    for (std::size_t i = 0; i < runs.size();) {
      if (runs[i]->level < level) {
        i++;
        continue;
      }
      std::size_t j = i;
      while (j < runs.size() && runs[j]->level >= level) j++;
      std::reverse(runs.begin() + i, runs.begin() + j);
      i = j;
    }
  }
  return runs;
}

void render(const ERTextRenderParams* params, const char* text, const std::uint8_t* span_map) {
  const Layout& layout = layout_for(text, params->font_family, er_text_clamp_font_size(params->font_size),
                                    params->letter_spacing, params->font_weight, params->direction);
  const ERRect& clip = params->clip;
  bool truncated = false;
  std::vector<Line> lines = break_lines(layout, clip.w, params->number_of_lines, truncated);
  const int line_height = params->line_height > 0 ? params->line_height : layout.line_height;
  const bool ellipsis = truncated && params->ellipsize_mode != ER_TEXT_ELLIPSIZE_CLIP;
  const std::uint32_t ellipsis_cp = baked_has(layout.baked, 0x2026) ? 0x2026 : '.';
  const int ellipsis_count = ellipsis_cp == 0x2026 ? 1 : 3;
  const int ellipsis_w = ellipsis_count * (font_glyph(layout.baked, ellipsis_cp)->advance + layout.letter_spacing + layout.bold);

  for (std::size_t i = 0; i < lines.size(); i++) {
    const int box_top = clip.y + static_cast<int>(i) * line_height;
    if (box_top >= clip.y + clip.h) break;
    // Half the leading above the line, as in CSS and React Native, so a lineHeight centres the text.
    const int line_top = box_top + (line_height - layout.line_height) / 2;
    Line line = lines[i];
    const bool cut = ellipsis && i + 1 == lines.size();
    if (cut) {
      // Whole grapheme clusters that fit before the ellipsis.
      const std::int32_t room = (clip.w - ellipsis_w) * 64;
      const std::uint32_t full = line.end;
      std::int32_t width = 0;
      std::uint32_t p = line.start;
      for (; p < full; p++) {
        if (!(layout.flags[p] & kClusterStart)) continue;
        if (layout.flags[p] & kGraphemeStart) {
          line.end = p;
          line.width = width;
        }
        if (width + layout.advance[p] > room) break;
        width += layout.advance[p];
      }
      if (p == full) {
        line.end = full;
        line.width = width;
      }
    }
    const bool rtl = paragraph_level(layout, line.start) & 1;
    const int width = to_px(line.width) + (cut ? ellipsis_w : 0);
    // A truncated line starts where its paragraph starts; the ellipsis goes at its end.
    const std::uint8_t align = cut ? ER_TEXT_ALIGN_START : er_text_physical_align(params->text_align, rtl);
    int x = clip.x;
    if (align == ER_TEXT_ALIGN_CENTER) x += std::max(0, (clip.w - width) / 2);
    else if (align == ER_TEXT_ALIGN_RIGHT || (align == ER_TEXT_ALIGN_START && rtl)) x += std::max(0, clip.w - width);

    const Style base = style_at(params, nullptr, 0);
    auto draw_ellipsis = [&](std::int32_t& pen) {
      for (int k = 0; k < ellipsis_count; k++) {
        draw_glyph(layout, Glyph{ellipsis_cp, 0, 0, 0, 0, -1}, (pen + 32) >> 6, line_top, clip, base);
        pen += (font_glyph(layout.baked, ellipsis_cp)->advance + layout.letter_spacing + layout.bold) * 64;
      }
    };
    std::int32_t pen = x * 64;
    if (cut && rtl) draw_ellipsis(pen);
    for (const Run* run : visual_runs(layout, line)) {
      // Shaped right-to-left runs come out of HarfBuzz in display order; baked ones are reversed
      // here, with mirrored brackets.
      const bool reverse = run->face < 0 && (run->level & 1);
      for (std::uint32_t k = 0; k < run->glyph_count; k++) {
        Glyph g = layout.glyphs[run->first_glyph + (reverse ? run->glyph_count - 1 - k : k)];
        if (g.cluster < line.start || g.cluster >= line.end) continue;
        if (reverse) g.id = hb_unicode_mirroring(hb_unicode_funcs_get_default(), g.id);
        const Style style = style_at(params, span_map, g.cluster);
        const int gx = (pen + 32) >> 6;
        draw_glyph(layout, g, gx, line_top, clip, style);
        pen += g.advance;
        if (style.decoration != ER_TEXT_DECORATION_NONE) {
          const int y = line_top + (style.decoration == ER_TEXT_DECORATION_UNDERLINE ? layout.ascent + 1 : layout.ascent * 2 / 3);
          const int x0 = std::max(gx, static_cast<int>(clip.x)), x1 = std::min((pen + 32) >> 6, clip.x + clip.w);
          if (x1 > x0 && y >= clip.y && y < clip.y + clip.h) er_text_fill(style.color, x0, y, x1 - x0, 1);
        }
      }
    }
    if (cut && !rtl) draw_ellipsis(pen);
  }
}

// ---- Engine callbacks -----------------------------------------------------------------------

bool claims(const char* text, const char* family, std::uint8_t font_size, std::uint8_t direction) {
  // Right-to-left text needs the bidi algorithm even when the baked font has every glyph.
  if (direction == ER_DIRECTION_RTL) return true;
  if (!state->any_face) return false;
  const BitmapFont* baked = nullptr;
  const std::size_t length = std::strlen(text);
  for (std::size_t at = 0; at < length;) {
    if (static_cast<unsigned char>(text[at]) < 0x80) {
      at++;
      continue;
    }
    const std::uint32_t cp = next_codepoint(text, length, at);
    if (ignorable(cp)) continue;
    if (needs_shaping(cp)) return true;
    if (!baked) baked = er_text_font(family, font_size);
    if (!baked_has(baked, cp)) return true;
  }
  return false;
}

void measure(const char* text, std::uint8_t font_size, const char* family, std::int16_t letter_spacing,
             std::uint8_t font_weight, int* out_width, int* out_height) {
  const Layout& layout = layout_for(text, family, font_size, letter_spacing, font_weight, ER_DIRECTION_INHERIT);
  std::int32_t width = 0;
  for (std::size_t p = 0; p < layout.text.size(); p++) width += layout.advance[p];
  *out_width = to_px(width);
  *out_height = layout.line_height;
}

int wrap(const char* text, std::uint8_t font_size, const char* family, std::int16_t letter_spacing,
         std::uint8_t font_weight, int max_w, int max_lines, int* out_width) {
  const Layout& layout = layout_for(text, family, font_size, letter_spacing, font_weight, ER_DIRECTION_INHERIT);
  bool truncated = false;
  const std::vector<Line> lines = break_lines(layout, max_w, max_lines, truncated);
  *out_width = 0;
  for (const Line& line : lines) *out_width = std::max(*out_width, to_px(line.width));
  return static_cast<int>(lines.size());
}

// Render workers measure and draw text concurrently. The HarfBuzz buffer and rasterizer, the glyph and
// layout caches and the lazily loaded faces are shared, and the references they hand out outlive the
// lookup, so shaped text renders one call at a time. claims() reads only the baked fonts.
std::mutex shaping;

void serial_measure(const char* text, std::uint8_t font_size, const char* family, std::int16_t letter_spacing,
                    std::uint8_t font_weight, int* out_width, int* out_height) {
  std::lock_guard lock(shaping);
  measure(text, font_size, family, letter_spacing, font_weight, out_width, out_height);
}

int serial_wrap(const char* text, std::uint8_t font_size, const char* family, std::int16_t letter_spacing,
                std::uint8_t font_weight, int max_w, int max_lines, int* out_width) {
  std::lock_guard lock(shaping);
  return wrap(text, font_size, family, letter_spacing, font_weight, max_w, max_lines, out_width);
}

void serial_render(const ERTextRenderParams* params, const char* text, const std::uint8_t* span_map) {
  std::lock_guard lock(shaping);
  render(params, text, span_map);
}

const ERTextShaper kShaper = {claims, serial_measure, serial_wrap, serial_render};

}  // namespace

namespace text_shaper {

void install(const char* font_dir, void (*log)(const char* line)) {
  shutdown();
  state = new State;
  cache = new GlyphCache;
  layouts = new LayoutCache;
  cache->map.reserve(4096);
  state->font_dir = font_dir;
  state->log = log;
  for (int i = 0; i < kFaceCount; i++) {
    struct stat st;
    const std::string path = state->font_dir + "/" + kFaces[i].file;
    state->faces[i].present = stat(path.c_str(), &st) == 0 && S_ISREG(st.st_mode);
    state->any_face = state->any_face || state->faces[i].present;
  }
  host::DeviceInfo device;
  host::device_info(device);
  set_language(*device.language ? device.language : "en");
  state->buffer = hb_buffer_create();
  state->raster = hb_raster_draw_create_or_fail();
  hb_raster_draw_set_scale_factor(state->raster, 64, 64);
  er_text_set_shaper(&kShaper);
}

void set_language(const char* tag) {
  if (!state) return;
  state->language = hb_language_from_string(tag, -1);
  state->prefer_japanese = std::strncmp(tag, "ja", 2) == 0 && (tag[2] == '\0' || tag[2] == '-');
  // zh-Hant, and the regions that write it when the tag names no script: Taiwan, Hong Kong, Macau.
  std::string lower(tag);
  for (char& c : lower) c = c == '_' ? '-' : static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  const auto has = [&](const char* part) { return (lower + "-").find(std::string("-") + part + "-") != std::string::npos; };
  state->prefer_traditional = lower.rfind("zh-", 0) == 0 && !has("hans") && (has("hant") || has("tw") || has("hk") || has("mo"));
  state->serial++;
}

void shutdown() {
  if (!state) return;
  er_text_set_shaper(nullptr);
  delete layouts;
  cache->clear();
  delete cache;
  for (Face& face : state->faces) {
    for (auto& [size, font] : face.sizes) hb_font_destroy(font);
    hb_font_destroy(face.probe);
    hb_face_destroy(face.face);
  }
  hb_buffer_destroy(state->buffer);
  hb_raster_draw_destroy(state->raster);
  delete state;
  state = nullptr;
  layouts = nullptr;
  cache = nullptr;
}

std::vector<std::pair<int, int>> lines(const char* text, const char* font_family, int font_size, int max_w) {
  std::lock_guard lock(shaping);
  const Layout& layout = layout_for(text, font_family, er_text_clamp_font_size(font_size), 0, 0, ER_DIRECTION_INHERIT);
  bool truncated = false;
  std::vector<std::pair<int, int>> out;
  for (const Line& line : break_lines(layout, max_w, 0, truncated))
    out.emplace_back(static_cast<int>(line.start), static_cast<int>(line.end));
  return out;
}

}  // namespace text_shaper
