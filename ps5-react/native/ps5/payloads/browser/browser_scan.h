// Adapted from Orbit Store 1.0.1 and 1.3.5 by saawant12 (https://github.com/saawant12/orbit-store-ps5).
// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only browser capture; original corresponding source is recorded in README.md.
#ifndef ORBIT_BROWSER_SCAN_H
#define ORBIT_BROWSER_SCAN_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

/* Bounded read-only scanner. Matchers must return only the selected file. */
#define PROBE_CHUNK 65536U
#define PROBE_MARKER_MAX 256U
/* Percent-encoded filename and route, including NUL. FileKeeper hands its file out through
 * Datanodes' dlproxy.uk gateway with a 598-character token and a signature, about 675 bytes. */
#define PROBE_MATCH_MAX 2048U
/* Cumulative reads, not resident memory: enough to keep scanning through the whole verification
 * window at about 8 MiB/s, a late human verification included (Orbit Store 1.3.5). A LinkVault
 * page adds its own check and a mirror before the host's, so the window is up to 300 s. */
#define PROBE_READ_DELAY_NS 8000000L
#define PROBE_SESSION_BUDGET (3ULL * 1024ULL * 1024ULL * 1024ULL)
typedef struct {
    void *context;
    int (*read)(void *, uint64_t, void *, size_t);
    bool (*active)(void *); /* Checks deadline, cancellation and process identity. */
    bool (*match)(void *, const unsigned char *, size_t);
    void *match_context;
    uint64_t remaining, attempted, readable;
    unsigned failures;
} ProbeReader;
typedef enum {
    PROBE_ABSENT, PROBE_FOUND, PROBE_STOPPED, PROBE_BUDGET, PROBE_INVALID
} ProbeResult;
ProbeResult probe_scan_region(ProbeReader *, uint64_t start, uint64_t end,
                              const char *marker);
#endif
