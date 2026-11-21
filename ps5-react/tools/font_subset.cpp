// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Build-time font subsetter for tools/text_fonts.py, linked against the pinned HarfBuzz:
//   font-subset <input.otf|ttf> <output> <codepoints-file>
// The codepoints file lists hexadecimal codepoints separated by whitespace. Layout tables are kept
// (with their glyph closure) for runtime shaping; hinting is dropped because the runtime
// rasterizer does not hint.
#include <hb-subset.h>
#include <cstdio>
#include <cstdlib>

int main(int argc, char** argv) {
  if (argc != 4) {
    std::fprintf(stderr, "usage: font-subset <input> <output> <codepoints-file>\n");
    return 2;
  }
  hb_blob_t* blob = hb_blob_create_from_file_or_fail(argv[1]);
  if (!blob) {
    std::fprintf(stderr, "font-subset: cannot read %s\n", argv[1]);
    return 1;
  }
  hb_face_t* face = hb_face_create(blob, 0);
  hb_subset_input_t* input = hb_subset_input_create_or_fail();
  FILE* list = std::fopen(argv[3], "r");
  if (!input || !list) {
    std::fprintf(stderr, "font-subset: cannot read %s\n", argv[3]);
    return 1;
  }
  hb_set_t* unicodes = hb_subset_input_unicode_set(input);
  unsigned codepoint;
  while (std::fscanf(list, "%x", &codepoint) == 1) hb_set_add(unicodes, codepoint);
  std::fclose(list);
  hb_set_t* features = hb_subset_input_set(input, HB_SUBSET_SETS_LAYOUT_FEATURE_TAG);
  hb_set_clear(features);
  hb_set_invert(features);
  hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_NO_HINTING);
  hb_face_t* subset = hb_subset_or_fail(face, input);
  if (!subset) {
    std::fprintf(stderr, "font-subset: subsetting %s failed\n", argv[1]);
    return 1;
  }
  hb_blob_t* result = hb_face_reference_blob(subset);
  unsigned length = 0;
  const char* data = hb_blob_get_data(result, &length);
  FILE* out = std::fopen(argv[2], "wb");
  if (!out || std::fwrite(data, 1, length, out) != length || std::fclose(out) != 0) {
    std::fprintf(stderr, "font-subset: cannot write %s\n", argv[2]);
    return 1;
  }
  return 0;
}
