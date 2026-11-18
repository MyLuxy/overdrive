# Download performance research

Status: research supporting the initial native implementation. See
[NETWORKING.md](NETWORKING.md) for the implemented API, limits, and validation.
The optimization experiments below remain proposals until measured on PS5.
No download throughput has been measured on a PS5 for this framework.

## Objective

Maximize useful bytes delivered to a complete, verified file while keeping
controller input and rendering responsive. Count connection setup, retries,
verification and final disk synchronization in completion time. Receiving bytes
into a cache is not the same as completing a durable download.

The throughput ceiling is the slowest stage: source service, network path,
TLS/hash processing, or destination storage. More connections and larger buffers
help only when they address that limiting stage.

## Evidence from the supplied Spectrum 1.4.8 artifacts

Static inspection of the extracted downloader (`embutido_1.elf`, SHA-256
`d8f947386a794c6fdc1348058e8aba1f3c2b5abd47b3de8eba88bc2f53c2c19b`)
identified the following application code, beyond bundled-library strings:

| Function / address | Observation |
| --- | --- |
| `run_parallel_download`, `0x2520` | Clamps worker count to 1–8 and the number of pieces; creates and joins pthread workers. |
| `perform_piece_attempt`, `0x46e0` | Allocates a 16 MiB application buffer, creates a curl easy handle, installs write/progress callbacks, performs a transfer and cleans up that handle. |
| `piece_write_cb`, `0x52a0` | Copies received data into that fixed buffer and updates a streaming SHA-1 digest. |
| `flush_piece_buffer`, `0x54d0` | Writes at the piece offset plus saved progress through `pwrite`, handles short writes and records flushed progress. |
| `load_resume_state` / `save_resume_state` | Persists per-piece progress using `.resume.json`. |

The supplied native PKG contains a byte-identical copy of a different extracted
ELF (`embutido_3.elf`, SHA-256
`db31f662bce1ac32101ba2fea71042ab2811aa7be4bf3fa0995518d79838ba9e`).
It contains `stream_package_to_client` and `chunk_worker_thread`, consistent with
an HTTP streaming helper. This does not establish that the PKG uses the exact
downloader version described above. Neither artifact was executed.

The local manifest collection contains 363 JSON manifests and 8,257 pieces.
The median piece size is approximately 1,812 MiB; the median number of pieces
per manifest is 11. These are historical local inputs, not live catalog claims.
Connection reuse therefore saves setup and retry work, but may have a modest
effect on a single successful transfer of a multi-gigabyte piece.

## Framework constraints

The pinned platform's `src/runtime/app_heap.c` wraps allocation into one
process heap. `patches/platform-heap-size.patch` sizes it at launch from the
title's free flexible memory, 1 GiB down to 128 MiB, and the host logs the result
as `[PS5-REACT] heap: N MiB`; download telemetry prints `heap=live/size`. The PS5 host also sets a 32 MiB QuickJS limit and a 1 MiB
QuickJS stack limit. The JavaScript allowance is not an additional native heap.
The render thread has an 8 MiB stack. TLS, rendering, assets, native objects and
download buffers need a combined measured memory budget.

Size buffers for the 128 MiB floor: a console that leaves less flexible memory
free still gets only that. Do not copy Spectrum's buffer policy into this runtime or change the pinned
platform heap without a reviewed patch and validation.

Existing filesystem elevation initializes libSceNet in a startup-local scope.
A download service needs its own explicit process-lifetime networking ownership;
it cannot assume that the startup helper leaves a pool alive. Networking access
and destination filesystem access are separate capabilities.

## Proposed data path

```text
JS commands / progress snapshots (render thread)
                  |
                  v
native scheduler + persistent libcurl multi (network thread)
                  |
      reusable bounded buffer pool
                  |
                  v
native writer + streaming verification (storage thread)
                  |
        pwrite at 64-bit offsets
                  |
       .part file + resume checkpoints
```

Start by comparing a persistent easy handle per worker with one persistent
multi loop and an independent writer. Neither architecture is inherently faster
on every platform. The multi loop is the preferred starting design for shared
connection/DNS caches and centralized scheduling; TLS work concentrated on one
thread can justify a small number of independent network loops if profiling
shows that thread saturating a core.

All QuickJS values, Promise settlement and React callbacks stay on the render
thread. Native commands enqueue work and return immediately. Events have a
bounded queue; progress is coalesced while terminal results are retained. On
exit, stop new work, cancel transfers, settle file ownership and join native
workers before destroying the JS context or network resources.

## Ranked optimizations

### 1. Keep network reception independent of disk stalls

Do not perform blocking disk writes, resume-file updates or slow hashing inside
a shared network loop's write callback. Copy into reusable blocks, enqueue the
block with its transfer identity and absolute offset, then return promptly.
The writer handles short writes, interruption, disk-full errors and verification.

Keep the hot path free of a shared progress mutex: use per-transfer counters and
an atomic cancellation flag, aggregate statistics periodically, and publish at
most four progress snapshots per second. The inspected Spectrum callback path
checks cancellation and updates progress through shared mutex-protected state;
that is a profiling candidate, not a measured bottleneck. Do not introduce
lock-free queues merely for their name: compare a simple short-held queue lock
with a single-producer/single-consumer queue under the actual workload.

Use a bounded pool with high/low watermarks. When the writer falls behind,
pause reception and resume on the owning network thread after the queue drains.
Wake that thread rather than polling it on a fixed sleep. Never call
`curl_easy_pause` from the storage thread. A paused write callback must accept
none of the presented data, because curl presents that data again on resumption.

Start experiments with 256 KiB–1 MiB blocks and an 8–16 MiB total pool, after
measuring available heap. Pool size and curl's receive-buffer size are different
settings. At 100 MB/s, a 50 ms disk stall requires approximately 5 MB of queued
data to keep reception moving; this is a sizing example, not a PS5 measurement.

HTTP/2 pause buffering must be included in the memory budget: libcurl documents
additional per-stream buffering when other multiplexed streams keep running.
A bounded application queue by itself does not bound total memory.

### 2. Adapt useful concurrency to each origin and destination

Measure 1, 2, 4, 8 and, only if memory and service behavior permit, 12/16 active
transfers. Begin with two as a provisional setting. Raise concurrency gradually
when useful throughput increases and writer backlog remains low. Reduce it on
disk saturation, persistent throttling, memory pressure or growing error rates.
Use several-second windows and hysteresis; do not react to individual callbacks.

Keep global and per-origin limits. Scheduled files share one budget instead of
each independently creating eight connections. Respect `Retry-After`; retry
transient failures with bounded exponential backoff and jitter. Do not repeatedly
retry authorization, certificate or manifest-validation errors.

Prefer independent manifest pieces, each with a verifiable digest. For a single
large file, probe actual range behavior and compare one stream with parallel
byte ranges. Use moderately sized schedulable ranges so a slow connection does
not own the final large remainder; test 8/32/64 MiB rather than hard-coding a
single chunk size. Avoid duplicate speculative requests unless evidence shows
that saved tail time exceeds wasted bandwidth.

Validate exact `206` and `Content-Range`, identity encoding, expected length and
resource validators before accepting a range body. Never append a full `200`
response to an existing partial range. Unknown-size or non-range responses use
the sequential path. A manifest piece split into new ranges still needs its
original whole-piece hash checked: subrange hashes cannot replace that digest.

### 3. Reuse connections, buffers and allocations

Keep curl easy handles for successive parts and preserve the multi handle's
connection cache. Reset request-specific options safely between transfers.
Reuse warm TCP/TLS connections, TLS sessions and DNS caches where applicable;
connections cannot be reused across incompatible origins. Reuse buffer blocks
without reallocating on every callback or piece.

Compare receive-buffer requests of 64/256/1024 KiB. Since libcurl 8.7.0, a
multi handle shares one transfer buffer among its easy handles. This reduces
one category of allocations; it does not eliminate application, TLS, socket or
HTTP/2 buffering. Larger buffers do not guarantee greater throughput.

### 4. Optimize storage and integrity together

Use one destination descriptor, non-overlapping 64-bit positional writes and
coalesced blocks. Start with one writer; benchmark additional writers only if
storage remains underutilized. Favor nearby offsets when doing so does not
starve active streams, especially on USB disks with slow random access.

Try actual allocation only when the native filesystem API supports it.
`ftruncate` may set a sparse file's logical size without reserving space.
Neither logical size nor a preallocated size proves that any piece is complete.
Do not zero-fill the entire file as a prerequisite to starting the network.

Compute expected per-piece hashes while processing ordered bytes. Compare the
crypto library's optimized implementation with a scalar implementation. Preserve
the algorithm specified by the source; changing SHA-1 to SHA-256 would not
validate a SHA-1 manifest. Out-of-order whole-file hashing requires ordering or
an additional verification pass, and that cost belongs in completion time.

Batch resume checkpoints by time and bytes instead of rewriting metadata on
every callback. Mark only safely recoverable bytes as committed. Durable resume
requires data synchronization before persisting a checkpoint that claims those
bytes; alternatively, revalidate checkpointed blocks after restart. Apply an
atomic metadata replacement and an appropriate final synchronization policy.
Benchmark checkpoint intervals without silently weakening the recovery contract.

### 5. Select protocols and platform transport from evidence

Compare HTTP/1.1 with several warm connections against HTTP/2 multiplexing when
both the linked curl build and server support it. Streams and TCP connections
are different resources. A single multiplexed connection is not guaranteed to
outperform multiple connections on a lossy or high-latency path. HTTP/3 is a
later experiment requiring a working QUIC stack and PS5 evidence.

Use `Accept-Encoding: identity` for range-addressed binary downloads. Compressed
archives rarely benefit from additional HTTP decompression, and transformed
bodies invalidate byte offsets. Keep certificate and hostname verification on.

Inspect TCP window limits before changing socket buffers. At 1 Gbit/s and
50 ms RTT, the bandwidth-delay product is approximately 6.25 MB across the
path; a disk-write buffer does not enlarge TCP's receive window. Avoid blind
socket-option overrides and global system tuning.

The pinned ProsperoStore PacBrew guide describes a native-title path using
libcurl/OpenSSL with compatibility functions, `sceNetResolver`, nonblocking
socket setup and an explicit trust store after elevation. It also reports BSD
connection failures in the sandbox and recommends retaining a `sceHttp` path
there. Treat this as an implementation reference, not proof for our linked
artifact. Pin any additional dependencies and retain their notices.

## Measurement and acceptance

Instrument network setup/TTFB, bytes received, distinct bytes written,
verification time, connection reuse, retry bytes, writer latency, queue
occupancy, peak total heap and render/input latency. Report wall-clock time
through verification and final synchronization, not only instantaneous receive
speed. Distinguish warm-cache results from durable storage throughput.

Use a controlled server with range support and deterministic test data. Compare
network-to-discard, disk-only, network-to-disk, and network-to-disk-with-hashing
to isolate the limiting stage. Repeat candidate settings three times in varied
order with identical source and destination conditions. Test sufficiently large
files to exceed transient buffering and include startup/finalization separately.

Correctness tests must cover ignored/malformed ranges, changing ETags, redirects,
unknown lengths, truncated bodies, rate limiting, disconnect/resume, corrupted
pieces, short writes, disk-full failure, cancellation and app shutdown. Verify
exact bytes and bounded memory. Run `npm test` and `npm run build` after runtime,
native host and packaging implementation.

Qualify performance on the exact PS5 artifact, firmware, loader, network and
storage device. Record results in `HARDWARE.md` only after actual console tests.
On a 1 Gbit/s link, 125 MB/s is the raw line-rate ceiling before protocol
overhead, not a promised application download speed.

## Primary references

- [libcurl multi interface](https://curl.se/libcurl/c/libcurl-multi.html)
- [Handle reset preserves connection and DNS caches](https://curl.se/libcurl/c/curl_easy_reset.html)
- [Receive-buffer size and multi buffer sharing](https://curl.se/libcurl/c/CURLOPT_BUFFERSIZE.html)
- [Pause ownership, callback replay and multiplexed buffering](https://curl.se/libcurl/c/curl_easy_pause.html)
- [Event-driven waiting](https://curl.se/libcurl/c/curl_multi_poll.html)
- [Cross-thread wakeup](https://curl.se/libcurl/c/curl_multi_wakeup.html)
- [Per-host connection limits](https://curl.se/libcurl/c/CURLMOPT_MAX_HOST_CONNECTIONS.html)
- [HTTP version negotiation](https://curl.se/libcurl/c/CURLOPT_HTTP_VERSION.html)
- [TCP window scaling and high-bandwidth paths, RFC 7323](https://www.rfc-editor.org/rfc/rfc7323.html)
- [Pinned native-title PacBrew compatibility guide](https://github.com/JVK3R/ProsperoStore/blob/22dca63607cf5f1f95006eda6ffb802607bed699/examples/pacbrew-curl/README.md)

## Controlled desktop benchmark (2026-10-06)

Run `python3 tools/benchmark_network.py`. A localhost source sends 64 KiB every
6 ms per connection, with a 16 MiB file, 1 MiB ranges and adaptation disabled.
Three runs per setting include startup, downloading, disk sync and publication;
all outputs are hash-checked and application buffering stays within 8 MiB.

| Connections | Median ms | MiB/s |
| --- | ---: | ---: |
| 1 | 1934 | 8.27 |
| 2 | 954 | 16.77 |
| 4 | 480 | 33.33 |
| 8 | 273 | 58.61 |
| 16 | 188 | 85.11 |

This artificial per-connection bottleneck demonstrates effective parallelism.
It does not predict PS5, TLS, internet, SSD or real-server throughput, and cannot
select a universal concurrency optimum. Native integration tests also exercise
a synthetic sparse resume above 4 GiB, bounded retry, untrusted TLS rejection,
range identity errors and cancellation/recovery.
