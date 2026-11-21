/* Copyright (C) 2026 half144 and PS5 React contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Additional attribution term: see LICENSE-ATTRIBUTION.
 * The WAVs an app imports, baked by tools/bundle.mjs into sounds.generated.c. */
#pragma once

#include <stdint.h>

typedef struct {
  const char* name;       /* the file's basename, which the import resolves to */
  const int16_t* samples; /* interleaved when stereo */
  uint32_t frames;
  uint32_t rate;
  uint32_t channels; /* 1 or 2 */
} BakedSound;

#ifdef __cplusplus
extern "C" {
#endif
extern const BakedSound ps5_react_sounds[];
extern const uint32_t ps5_react_sound_count;
#ifdef __cplusplus
}
#endif
