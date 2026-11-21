# Download engine: is it at the ceiling?

Date: 2026-10-10. Engine: `ps5-react` main at d1e4aa2. App: `game-store` main at 0b1837b.
Prototypes: `ps5-react` branch `perf/download-speed` (f9e6bd3), `game-store` branch
`perf/download-speed` (16118eb). Nothing pushed, released or deployed.

## Short answer

No. The beta log (`conns=25/27 recv=35479KB/s net_busy=22% retries=0`) is not limited by the line,
TLS, the network thread or storage. It is limited by **how many ranges the file has**, and the same
mechanism makes the end of every download (and every slow connection) run with few connections.
Multi-part releases are also capped at **8 connections** because the app never passes its options
for volumes.

Per connection the tester got 35.5 MB/s / 25 = **1.42 MB/s**, the per-connection share archive.org
gives. Throughput is roughly `connections x 1.4 MB/s`, so the connection count is the lever.

## 1. Where the ceiling is

| Suspect | Verdict | Evidence |
|---|---|---|
| Connection count (why 25-27, not 64) | **Ceiling** | Ranges are fixed 16 MiB (`download-queue.js:182`); a transfer slot only takes a whole unscheduled range (`network.cpp:1415-1425` at d1e4aa2). A file with N ranges never has more than N connections. The AIMD window grows only when full (`Window::grow`, `network.cpp:564`: 8, 12, 18, 27, 40, 60, 64, once a second), so with about 25 ranges left it stops at 27 with 25 in use, which is the tester's line. Reproduced on localhost with a 432 MiB file (27 ranges) at 1.4 MB/s per connection: `conns=27/40 recv=36936KB/s`, the same 37 MB/s plateau. |
| Tail effect | **Ceiling** | A 16 MiB range at 1.4 MB/s takes about 12 s. The last ranges run alone: the 432 MiB run spends its last 2 s at 9 connections; a 900 MiB file goes 56 to 38 to 16 connections over its last 4 s. There is no work stealing or slow-connection replacement. One 10x-slow connection holds the job for a whole range (120 s, below). |
| Multi-part sets (volumes) | **Ceiling, 8 connections** | `executeSet` enqueues without `connections`/`adaptive`/`rangeBytes` (`download-queue.js:416`), so it gets the engine defaults `connections = 8`, `range_bytes = 32 MiB` (`network.hpp:22-23`). Most of the catalog is multi-part (AkiraBox 4203, VikingFile 3937, 1fichier 2943, rootz 3400, MediaFire 2036 volume releases). Bench, 900 MiB volume: **9.7 MB/s** against 34.6 MB/s with 64 connections. |
| Ramp-up | Minor | 8 to 64 takes about 5 s per job (about 3 s of full-speed time lost). Every volume of a set ramps again from 8. |
| Server per-connection cap | Host property | archive.org: about 1.4 MB/s per connection in the log; it scales with connections (2026-10-07 Mac measurement). MediaFire: per client (below). |
| Network thread, TLS | Not the limit | `net_busy=22%` at 35 MB/s means it would saturate near 160 MB/s, above gigabit (117 MB/s, about 73% busy). The PS5 build links OpenSSL 3.5.2 with assembly (`aesni_ctr32_encrypt_blocks` and others in `libcrypto.a`) and curl 8.18.0. One `curl_multi` handle with `curl_multi_poll`, not select. |
| SO_RCVBUF | Not the limit | 2 MiB per socket (`network.cpp:528`). At 200 ms RTT that allows 10 MB/s per connection, 7x what the server gives. |
| HTTP version, keep-alive | Correct | HTTP/1.1 is forced (`configure_transport`). archive.org also speaks h2 (`HTTP/2 200` from the Mac), which would multiplex every range on one TCP connection and lose the per-connection share. Each transfer slot reuses its connection; a new range costs one RTT, about 2% at 16 MiB ranges. |
| Write path | Not the limit now | `disk == recv`, `buffered=3200KiB` of 16 MiB, `paused=0`: storage keeps up. `write_avg` is about 140 KiB because the two writers drain the queue (`queued=3`) faster than 25 transfers fill 128 KiB blocks, so batches rarely form. That is self-regulating: at about 3 ms per call two writers do about 85 MB/s with 128 KiB writes, and past that the queue grows and batches up to 2 MiB form. Watch `paused` and `buffered` at gigabit speeds. |
| Checkpoints | Not the limit | Every 5 s on its own thread (`queue_checkpoint`); `sync_max=0ms` in the log. |
| DNS | Not the limit | curl's per-multi DNS cache; one lookup per host per minute. |

Unconfirmed: whether the tester's file had about 25 ranges left (a file of about 400-430 MiB, or a
resumed one). The first lines of that log (`download: conns=8/8`, then the growth) and the file size
would settle it. A large file with these settings reaches 64 connections in about 5 s (bench below).

## 2. Measurements

### Harness

`reports/download-speed-bench/`: `server.go` serves a virtual file with Range, a strong ETag,
a token bucket per connection (`-conn`), one shared per client (`-client`), a delay before the first
byte (`-rtt`), a share of 10x-slow connections (`-slowfrac`) and HTTP 500 past N concurrent ranges
(`-maxbusy`), over HTTP or HTTPS. `client.cpp` links `native/shared/network.cpp` unchanged and
checks every byte of the result. Outputs went to a 1 GiB APFS RAM disk and were deleted.
"base" is d1e4aa2; "split" is the prototype.

### Localhost results (1.4 MB/s per connection, 150 ms first-byte delay, adaptive, all bytes verified)

| Scenario | Settings | base | split |
|---|---|---|---|
| 432 MiB file (27 ranges) | 64 conns, 16 MiB | 14.3 s, **31.7 MB/s**, peak 27 conns | 8.4 s, **53.9 MB/s**, peak 64 |
| 900 MiB file | 64, 16 MiB | 16.3 s, 58.0 MB/s, peak 57 | 14.3 s, 66.2 MB/s |
| 432 MiB, 15% of connections 10x slower | 64, 16 MiB | 121 s, **3.7 MB/s** | 21.3 s, **21.3 MB/s** |
| 900 MiB volume, app's current set options | 8, 32 MiB | 96.9 s, **9.7 MB/s** | 85.4 s, 11.1 MB/s |
| 900 MiB volume, 64 connections (app fix) | 64, 32 MiB | 27.3 s, 34.6 MB/s | 14.4 s, **65.4 MB/s** |
| Large file, steady state | 64, 16 MiB | 87.5 MB/s at 64 conns | 87.5 MB/s (no splits) |
| Busy origin (500 past 14 ranges), 432 MiB | 64, 16 MiB | 15.5 MB/s, 5 retries | 17.2 MB/s, 6 retries |
| Per-client cap 3 MB/s (MediaFire-like), 200 MiB | 8 or 64 | 3.0 MB/s | 3.0 MB/s |
| Same, plus one mirror on another host with the same cap | 64, 16 MiB | 5.5 MB/s | 5.8 MB/s |
| HTTPS, 432 MiB | 64, 16 MiB | 31.8 MB/s | 53.9 MB/s |

The ideal at 64 connections is 89.6 MB/s; steady state reaches 98% of it. Smaller fixed ranges
without splitting also help small files (432 MiB: 4 MiB ranges 47.9 MB/s, 8 MiB 44.1 MB/s), but
they cost about 3% in steady state and break the resume of existing partials, because the
checkpoint stores `range_bytes`.

### Internet, from the Mac (inconclusive)

The Mac's line was slow during this run: about 1.0-1.3 MB/s total to GitHub's CDN with 1 or 4
connections. archive.org gave 0.08 MB/s on one connection and 0.9 MB/s on 16. MediaFire gave
1.5 MB/s on 1 connection, 1.5 MB/s on 4, 0.95 MB/s on two different links together, and 1.4 MB/s
on 2 links x 4 connections. All of that is at the line's limit, so it cannot tell a per-IP cap from
a per-link cap. It does confirm that MediaFire direct links answer `accept-ranges: bytes` with **no
ETag and no Last-Modified** (resume goes through `check_sample`). Each volume is about 10 GB
(`content-length: 10630044057`).

## 3. Multi-source download

What exists (`network.cpp`): `Request::mirrors` (up to 4), `verify_mirrors` (a probe per mirror:
same size, and the same strong ETag, or a SHA-256 when the primary has no ETag), `pick_mirror`
(each transfer slot sticks to one server), one AIMD window per host, and `forget_mirror` (a mirror
that fails a range is dropped and the range goes back to the primary). Bench: one mirror on a
second capped host takes 3.0 MB/s to 5.5-5.8 MB/s (ideal 6).

Why the app cannot use it today:

1. Cross-host mirrors are always rejected when the primary has a strong ETag (archive.org does),
   because `verify_mirrors` and `valid_file_response` compare every range with the **primary's**
   ETag and Last-Modified. Each mirror needs its own validators.
2. With no ETag (MediaFire), a mirror is accepted only with a whole-file SHA-256. The catalog has
   it for **6 of 32,694** releases.
3. The app strips mirrors (`download-queue.js:180-182`, "one server keeps the heap's margin for
   images").

What it would take to do safely: size equality, then a sampled identity check (for example 64 KiB
at 0, 1/3, 2/3 and the last 64 KiB from every source, compared byte for byte with the primary), each
mirror's own validators for its ranges, and the existing whole-file SHA-256 when known. Volumes are
RAR parts with CRCs, so a wrong upload is also caught at extraction, but only after the download.
Candidates are a volume's other `sources[]` (other hosts with the same part). Expected gain on
capped hosts: about +1x the cap per independent host, so about 2x with one extra host. A second
link of the same MediaFire file gains nothing if the cap is per IP, which is likely but unconfirmed
(see above).

## 4. Ranking

| # | Change | Expected gain | Effort | Risk | Status |
|---|---|---|---|---|---|
| 1 | Volumes use `connections: 64, adaptive: true` (keep the 32 MiB ranges so partials resume) | Up to **3.5x** on per-connection hosts (9.7 to 34.6 MB/s), **6.7x** with #2. Nothing on per-client caps | 1 line | ~0: same settings the single-file path ships with | **Done**: game-store 16118eb, 75/75 queue tests |
| 2 | Engine tail splitting: idle connections take the second half of the range with the most bytes left (down to 1 MiB) | +70% under 1 GiB, +14% at 900 MiB, 5.7x with slow connections, 0 on large-file steady state | ~70 lines | Low: verified bytes in every bench run, 100 stress runs, cancel and resume mid-split, HTTPS, PS5 cross-compile with `-Werror`, `tools/test_network.py` passes with a new split and split-retry test | **Done**: ps5-react f9e6bd3 |
| 3 | Keep each host's learned window across jobs, so volumes 2..N start at the window volume 1 reached | About 3 s of full speed per volume | Small | Low (AIMD still shrinks on 5xx) | Recommended |
| 4 | Multi-source across hosts with sampled identity check and per-mirror validators | About 2x on capped hosts (MediaFire) when a second host has the same part | Medium-high | Medium (identity, heap) | Recommended after #1-#2 |
| 5 | Two volumes in parallel, if a host caps per link rather than per IP | Up to 2x on those hosts | High (the engine runs one job at a time) | Medium | Only if a console test shows a per-link cap |
| 6 | Writer gathering (wait a few ms for contiguous blocks) | Only above about 80 MB/s | Small | Low | Not needed yet |

### The split prototype in detail (f9e6bd3)

- A transfer keeps `requested` (what the server was asked for) apart from `length` (where it ends
  now). Responses are still validated against `requested`.
- When no unscheduled range is ready and the origin's window has room, an idle slot first takes a
  waiting span (a split part that failed), else cuts the active transfer with the most bytes left
  (more than 2 MiB) at half its remainder.
- The cut transfer drops bytes past its new end (returning fewer would fail it, and
  `curl_easy_pause` with it: the first version hit exactly that, 1 run in 25) and the loop removes
  it once complete; its connection closes.
- A range completes when all its parts do (`open` count); checkpoints are unchanged (a range is
  recorded only when whole), so the resume format and old partials are unaffected. A failed part of
  a split range retries alone, with the same per-range attempt limits.
- Manifest (`pieces`) jobs and non-ranged downloads never split.
- The stat line gains `splits=N`.

## What needs a console test

1. The beta tester's case: send the first and last stat lines and the file size. Then run the split
   build on an archive.org file under 1 GiB and one over 2 GiB: `conns` should reach 64, `splits`
   grow only near the end, and `retries` should not jump (archive.org 500s with more connections),
   with `heap=` peak no higher than today.
2. A multi-part VikingFile, AkiraBox or Buzzheavier set with the app fix: does the speed scale with
   64 connections, or is that host capped per client like MediaFire?
3. MediaFire per IP or per link: two volumes of one release downloaded at once on a fast line
   (the Mac's line was too slow today).
4. At gigabit speeds: whether `paused` or `buffered` near 16 MiB show storage becoming the limit.

## Addendum: the tester's file (MediaFire, 1.27 GB)

The beta log came from PPSA03647 on **MediaFire**, 1.27 GB (about 76 ranges of 16 MiB), at
35-40 MB/s with `conns=25/27` for most of the transfer. So the console got about 1.4 MB/s per
connection from MediaFire and it scaled with connections: the "near 3 MB/s per client" measured
from the Mac does not hold there. The range-count explanation above does not fit this file.

Reproduction attempts on localhost with 1.27 GB at 1.4 MB/s per connection all grew 8 to 64 within
about 6 s and held 87.5 MB/s: with validators and without, with `Connection: close` on every
response, with up to 3 s of random time to first byte, and with a 3 ms delay on every write (PS5
storage). The stall at 27 is **not reproduced**. In the code, the window grows only when
`in_flight >= allowed` at the moment of the check (`Window::grow`), and a slot freed by a finished
range is refilled in the same pass, so on the Mac it is always full when ranges remain.

Change (commit "Grow an origin's connection window when it is nine-tenths busy"): grow while nine-tenths of the window is busy (`in_flight + allowed/10 >= allowed`;
below 10 connections it still needs every slot), with the same halving on 5xx, 429, 408 and broken
connections. It does not change any localhost number (the window was already full there; the busy-origin
case still peaks at 14 connections with 5-6 retries), and it would have taken the tester's 25/27 to 40.
Whether that raises the console's speed, or a second cause (a MediaFire per-IP connection limit, or
a console clock or socket limit) holds it at about 25, needs the console test: the timestamps of
consecutive stat lines from the start of that download (to check the 1 s and 2 s intervals), and a
run of the new build on the same file.

The app's "Capped near 3 MB/s" label for MediaFire (`sources.speed.mediafire`, used only as text by
`describeSource` in `native/game/sources.js:41-43`) caps nothing, but it is now contradicted by the
console and should be dropped or reworded. That file has uncommitted changes from another task, so
this branch leaves it alone.
