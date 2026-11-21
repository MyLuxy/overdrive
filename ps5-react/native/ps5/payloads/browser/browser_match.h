// Adapted from Orbit Store 1.0.1 by saawant12 (https://github.com/saawant12/orbit-store-ps5).
// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only browser capture; original corresponding source is recorded in README.md.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include "browser_scan.h"
#define BROWSER_CAPTURE_REJECTED_MAX 6
#define BROWSER_CAPTURE_STALE_MAX 4096
typedef struct {
  const char *prefix;   /* The one prefix to scan for; the request's, in anchor mode. */
  const char *filename; /* The expected filename, or the anchor that stands for it. */
  bool anchor;          /* Anchor mode: any file link carrying the anchor, or on a known host. */
  bool page;            /* Page mode: a Vikingfile file page, /f/<id>, as a LinkVault vault opens it. */
  /* Links the app already probed and refused this session; the scan passes over them. */
  const char *rejected[BROWSER_CAPTURE_REJECTED_MAX];
  size_t rejected_count;
  /* The browser keeps the addresses of files it saw earlier in memory it never clears, so the
   * first pass, before the page opens, only fingerprints every unbound match already there
   * (`baseline`); the scans after it take an unbound link only when it is new. A link bound to the
   * game (its title id, or Vikingfile's expected filename) stays acceptable however old: it is
   * this game's file, and an expired one fails the app's probe. */
  bool baseline;
  uint64_t *stale;
  size_t stale_count;
  bool stale_full;
  /* Vikingfile links that spelled the start of the expected filename but then broke off from it:
   * reported when nothing is found, so a name the scan cannot read shows up in the log. */
  unsigned near_misses;
  char url[PROBE_MATCH_MAX];
} BrowserMatch;
extern const char *const browser_capture_prefixes[2];
extern const char *const browser_capture_page_prefixes[2];
bool browser_capture_page_url(const char *url);
const char *browser_capture_prefix(const char *url);
bool browser_capture_url(const char *filename, const char *url);
/* 0: not the file; BOUND: its name carries the anchor; UNBOUND: a file link that names no game
 * (a known host's free name, or a route with no name at all). */
enum { BROWSER_CAPTURE_BOUND = 1, BROWSER_CAPTURE_UNBOUND = 2 };
int browser_capture_anchor_url(const char *anchor, const char *url);
bool browser_match(void *context, const unsigned char *bytes, size_t length);
