// Adapted from Orbit Store 1.0.1 and 1.3.5 by saawant12 (https://github.com/saawant12/orbit-store-ps5).
// SPDX-License-Identifier: GPL-3.0-or-later
// Read-only browser capture; original corresponding source is recorded in README.md.
#include "browser_scan.h"
#include <stdlib.h>
#include <string.h>

static bool contains(const unsigned char *bytes, size_t length,
                     const unsigned char *needle, size_t size) {
    for (size_t i = 0; size <= length && i <= length - size; i++)
        if (bytes[i] == needle[0] && !memcmp(bytes + i, needle, size)) return true;
    return false;
}

ProbeResult probe_scan_region(ProbeReader *reader, uint64_t start, uint64_t end,
                              const char *marker) {
    if (!reader || !reader->read || !reader->active || !marker || start >= end)
        return PROBE_INVALID;
    size_t length = 0;
    while (length < PROBE_MARKER_MAX && marker[length]) length++;
    if (!length || length == PROBE_MARKER_MAX) return PROBE_INVALID;
    unsigned char wide[PROBE_MARKER_MAX * 2] = {0};
    for (size_t i = 0; i < length; i++) wide[i * 2] = (unsigned char)marker[i];
    /* A bounded URL may use two-byte JSON slash escapes in UTF-16. */
    const size_t overlap = reader->match ? PROBE_MATCH_MAX * 4 - 1 : length * 2 - 1;
    unsigned char *buffer = malloc(PROBE_CHUNK + overlap);
    if (!buffer) return PROBE_INVALID;
    size_t carried = 0;
    ProbeResult result = PROBE_ABSENT;
    for (uint64_t position = start; position < end;) {
        if (!reader->active(reader->context)) { result = PROBE_STOPPED; break; }
        if (!reader->remaining) { result = PROBE_BUDGET; break; }
        uint64_t left = end - position;
        size_t take = left < PROBE_CHUNK ? (size_t)left : PROBE_CHUNK;
        if (take > reader->remaining) take = (size_t)reader->remaining;
        reader->remaining -= take;
        reader->attempted += take;
        if (reader->read(reader->context, position, buffer + carried, take)) {
            /* Never join bytes across an unreadable hole. */
            reader->failures++;
            carried = 0;
        } else {
            reader->readable += take;
            size_t available = carried + take;
            bool matched = reader->match
                ? reader->match(reader->match_context, buffer, available)
                : contains(buffer, available, (const unsigned char *)marker, length) ||
                  contains(buffer, available, wide, length * 2);
            if (matched) {
                /* Cancellation/PID replacement wins over an in-flight read. */
                result = reader->active(reader->context) ? PROBE_FOUND : PROBE_STOPPED;
                break;
            }
            carried = available < overlap ? available : overlap;
            memmove(buffer, buffer + available - carried, carried);
        }
        position += take;
    }
    /* The browser's bytes are never logged or written to disk. */
    volatile unsigned char *wipe = buffer;
    for (size_t i = 0; i < PROBE_CHUNK + overlap; i++) wipe[i] = 0;
    free(buffer);
    return result;
}
