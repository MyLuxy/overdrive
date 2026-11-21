// Adapted from Orbit Store 1.0.1 by saawant12 (https://github.com/saawant12/orbit-store-ps5).
// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only browser capture; original corresponding source is recorded in README.md.
#ifndef ORBIT_BROWSER_NATIVE_H
#define ORBIT_BROWSER_NATIVE_H
#include "browser_scan.h"
#include <signal.h>
#include <stdatomic.h>
#include <time.h>
typedef struct {
    int pid;
    int64_t started_seconds, started_microseconds;
    char name[20];
    bool unpaced; /* The baseline pass, before the browser is in front, reads without the delay. */
    atomic_bool *cancel;
    volatile sig_atomic_t *interrupted;
    time_t deadline;
    bool identity_changed;
} ProbeTarget;
/* 1: a unique network process, 0: absent, -1: unsupported metadata,
 * -2: multiple eligible processes. Never guess a process. */
int probe_target_find(ProbeTarget *target);
bool probe_target_active(void *context);
int probe_target_read(void *context, uint64_t address, void *bytes, size_t length);
ProbeResult probe_target_scan(ProbeTarget *target, ProbeReader *reader, const char *marker);
int probe_browser_open(const char *url);
#endif
