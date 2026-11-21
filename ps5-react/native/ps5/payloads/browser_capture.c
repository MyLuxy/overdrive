// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "browser/browser_platform.h"
#include "browser/browser_match.h"
#include <poll.h>
#include <stdio.h>
#include <limits.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static atomic_bool cancelled;
static time_t last_heartbeat;
/* "preparing" while the first pass fingerprints what memory already holds, "waiting" after. */
static const char *heartbeat = "preparing\n";
static int line(char *out, size_t cap) {
  size_t n = 0;
  while (n + 1 < cap) {
    char c;
    if (read(0, &c, 1) != 1) return 0;
    if (c == '\n') { out[n] = 0; return 1; }
    if ((unsigned char)c < 32) return 0;
    out[n++] = c;
  }
  return 0;
}
static time_t now(void) {
  struct timespec t;
  return clock_gettime(CLOCK_MONOTONIC, &t) ? 0 : t.tv_sec;
}
static bool connected(void) {
  struct pollfd fd = {.fd = 0, .events = POLLIN};
  if (poll(&fd, 1, 0) < 0 || fd.revents & (POLLHUP | POLLERR | POLLNVAL | POLLIN)) atomic_store(&cancelled, true);
  const time_t current = now();
  if (current != last_heartbeat) {
    const size_t size = strlen(heartbeat);
    if (write(1, heartbeat, size) != (ssize_t)size) atomic_store(&cancelled, true);
    last_heartbeat = current;
  }
  return !atomic_load(&cancelled);
}
static bool active(void *context) { return connected() && probe_target_active(context); }
static void say(const char *kind, const char *value) {
  char buffer[PROBE_MATCH_MAX + 64];
  const int length = snprintf(buffer, sizeof buffer, "%s %s\n", kind, value);
  if (length <= 0 || length >= (int)sizeof buffer) return;
  size_t sent = 0;
  while (sent < (size_t)length) {
    const ssize_t count = write(1, buffer + sent, (size_t)length - sent);
    if (count <= 0) break;
    sent += (size_t)count;
  }
}
static int fail(const char *reason) { say("fail", reason); return 1; }
int main(void) {
  char magic[8], prefix[64], suffix[162], seconds[8], count[4], memory[24];
  static char rejected[BROWSER_CAPTURE_REJECTED_MAX][sizeof ((BrowserMatch *)0)->url];
  signal(SIGPIPE, SIG_IGN);
  if (!line(magic, sizeof magic) || strcmp(magic, "BRC1") || !line(prefix, sizeof prefix) ||
      !line(suffix, sizeof suffix) || suffix[0] != '/' || !line(seconds, sizeof seconds) ||
      !line(count, sizeof count) || count[0] < '0' || count[0] > '0' + BROWSER_CAPTURE_REJECTED_MAX || count[1])
    return fail("Invalid capture request.");
  /* Links the app already probed and refused: a page keeps them in memory, so a new scan would
   * otherwise stop on the same one again (Orbit Store 1.3.5 keeps six). */
  const size_t refused = (size_t)(count[0] - '0');
  for (size_t i = 0; i < refused; i++)
    if (!line(rejected[i], sizeof rejected[i]) || strncmp(rejected[i], "https://", 8))
      return fail("Invalid capture request.");
  /* "fresh" runs the first pass below; "resume <n>" hands back the n fingerprints a fresh session
   * of the same capture reported, so a restart after a refused link does not count the links that
   * appeared since (the right one among them) as already known. */
  static uint64_t stale[BROWSER_CAPTURE_STALE_MAX];
  size_t known = 0;
  bool resume = false;
  if (!line(memory, sizeof memory)) return fail("Invalid capture request.");
  if (strncmp(memory, "fresh", 6)) {
    char *rest;
    const unsigned long count_known = strncmp(memory, "resume ", 7) ? ULONG_MAX : strtoul(memory + 7, &rest, 10);
    if (count_known > BROWSER_CAPTURE_STALE_MAX || *rest) return fail("Invalid capture request.");
    for (known = 0; known < count_known; known++) {
      char hex[20];
      if (!line(hex, sizeof hex) || strlen(hex) != 16) return fail("Invalid capture request.");
      stale[known] = strtoull(hex, &rest, 16);
      if (*rest) return fail("Invalid capture request.");
    }
    resume = true;
  }
  /* A whole-scheme prefix asks for anchor mode: any file link that carries the anchor (the game's
   * title id), or any file link on a known file host, wherever the page leads. */
  const bool anchor = !strcmp(prefix, "https://");
  const bool page = !strcmp(prefix, "https://vikingfile.com/f/");
  if (!anchor && !page && strcmp(prefix, "https://vikingfile.com/d/")) return fail("Invalid capture request.");
  const char *filename = suffix + 1;
  if ((anchor && !*filename) || (page && *filename) || strchr(filename, '/') || strchr(filename, '\\') ||
      strstr(filename, "..")) return fail("Invalid filename.");
  char *end;
  const long timeout = strtol(seconds, &end, 10);
  if (*end || timeout < 1 || timeout > 300 || !now()) return fail("Invalid deadline.");
  ProbeTarget target = {.cancel = &cancelled, .deadline = now() + timeout};
  BrowserMatch match = {.prefix = prefix, .filename = filename, .anchor = anchor, .page = page, .rejected_count = refused,
    .stale = stale, .stale_count = known};
  for (size_t i = 0; i < refused; i++) match.rejected[i] = rejected[i];
  ProbeReader reader = {.context = &target, .read = probe_target_read, .active = active,
    .match = browser_match, .match_context = &match, .remaining = PROBE_SESSION_BUDGET};
  ProbeResult result = PROBE_ABSENT;
  /* The browser's network process outlives its pages, and the addresses of files it fetched
   * before stay in memory it never clears: without this pass a capture took another game's file
   * the moment it started. The app opens the page only once "armed" arrives, so every link the
   * pass finds was there before, and only a link that appears after it can be taken. A browser
   * not running yet starts with nothing to remember. */
  int found = 0;
  for (const time_t look = now() + 2; connected() && now() < look; usleep(100000))
    if ((found = probe_target_find(&target))) break;
  if (found < 0) return fail("The browser could not be identified safely. Reopen the page and retry.");
  char armed[96];
  if (resume) snprintf(armed, sizeof armed, "resumed with %zu known links", known);
  else if (found == 1) {
    const time_t began = now();
    match.baseline = true; target.unpaced = true;
    result = probe_target_scan(&target, &reader, prefix);
    match.baseline = false; target.unpaced = false;
    if (result != PROBE_ABSENT && result != PROBE_BUDGET) {
      memset(&match, 0, sizeof match); memset(rejected, 0, sizeof rejected);
      return fail(target.identity_changed ? "The browser restarted. Reopen the page and retry."
                                          : "Could not read the browser memory before the page opened. Retry.");
    }
    snprintf(armed, sizeof armed, "%zu%s known links, %llu KiB in %lld s", match.stale_count,
      match.stale_full ? "+" : "", (unsigned long long)(reader.readable / 1024), (long long)(now() - began));
    for (size_t i = 0; i < match.stale_count; i++) {
      char hex[20];
      snprintf(hex, sizeof hex, "%016llx", (unsigned long long)stale[i]);
      say("known", hex);
    }
  } else snprintf(armed, sizeof armed, "browser not running yet, nothing known");
  say("armed", armed);
  heartbeat = "waiting\n";
  reader.remaining = PROBE_SESSION_BUDGET;
  reader.readable = reader.attempted = 0;
  reader.failures = 0;
  while (found != 1 && connected() && now() < target.deadline) {
    found = probe_target_find(&target);
    if (found < 0) break;
    if (!found) usleep(100000);
  }
  if (found != 1) return fail("The browser could not be identified safely. Reopen the page and retry.");
  while (active(&target) && reader.remaining) {
    result = probe_target_scan(&target, &reader, prefix);
    if (result == PROBE_FOUND && active(&target)) {
      say("found", match.url);
      memset(&match, 0, sizeof match); memset(rejected, 0, sizeof rejected);
      return 0;
    }
    if (result != PROBE_ABSENT) break;
    usleep(100000);
  }
  const unsigned near_misses = match.near_misses;
  memset(&match, 0, sizeof match); memset(rejected, 0, sizeof rejected);
  if (target.identity_changed) return fail("The browser restarted. Reopen the page and retry.");
  if (result == PROBE_INVALID) return fail("Could not read the browser memory map. Retry or enter the final file link.");
  if (!reader.readable) return fail(reader.attempted
    ? "Browser memory reads failed. Check the jailbreak and retry."
    : "No eligible browser memory was available. Reopen the page and retry.");
  char reason[256];
  /* Near misses: Vikingfile links that began with the file's name and broke off from it. */
  snprintf(reason, sizeof reason, "No matching link found (read %llu KiB, attempted %llu KiB, failed reads %u, near misses %u). Reopen the page and retry.",
    (unsigned long long)(reader.readable / 1024), (unsigned long long)(reader.attempted / 1024), reader.failures, near_misses);
  return fail(reason);
}
