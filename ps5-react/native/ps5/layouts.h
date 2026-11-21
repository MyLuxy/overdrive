/* Copyright (C) 2026 half144 and PS5 React contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 * Additional attribution term: see LICENSE-ATTRIBUTION. */
#pragma once

/* The app compiled for one render size: Tailwind classes and baked fonts are fixed at build time.
 * A fixed-size app has one layout; "resolution": "auto" builds one per supported output, ordered
 * by size. tools/build_ps5.py generates the table. */
#ifdef __cplusplus
extern "C" {
#endif
typedef struct {
  int width, height;
  int surface_width, surface_height;
  const char* bundle;
  unsigned long bundle_length;
  void (*register_assets)(void);
} Ps5ReactLayout;

extern const Ps5ReactLayout ps5_react_layouts[];
extern const unsigned ps5_react_layout_count;
#ifdef __cplusplus
}
#endif
