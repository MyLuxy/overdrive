# HTTP and large downloads

Import `Http` and `Downloads` from `@ps5-react/core`. Binary file bytes remain
in native memory; JavaScript receives progress and completion only.

## Enable PS5 networking

Add these fields to your app's `app.json`, then build normally:

```json
{
  "networking": true,
  "filesystemAccess": "console"
}
```

The initial native-title transport requires successful console filesystem
elevation (resident Lapy or a localhost ELF loader, as described in
[NATIVE-API.md](NATIVE-API.md#hardware-status)). It uses the console trust store
at `/system/common/cert/CA_LIST.cer`, verified HTTPS, SceNetResolver DNS and
BSD sockets with native-title nonblocking compatibility. Failed elevation or
missing trust certificates leave networking unavailable with an actionable
error. Desktop networking uses macOS libcurl and its trust configuration;
it is available without the PS5 opt-in. Desktop headers and libraries require
libcurl 7.85 or newer; install a current curl development package if CMake reports
an older version.

The optional build downloads the SHA-256-pinned PacBrew v0.40.2 networking
archive. It extracts only networking headers/libraries, preserving the main
v0.42 SDK. See [DEPENDENCIES.md](DEPENDENCIES.md).

**Hardware status:** compilation and desktop tests do not establish PS5 network
operation, throughput, heap headroom or firmware compatibility. The networking
artifact still requires its own [hardware evidence](HARDWARE.md).

## Download a large file

```js
import {Downloads, FileSystem} from '@ps5-react/core';

const task = Downloads.enqueue({
  url: 'https://example.com/archive.bin',
  destination: `${FileSystem.dataDir}/archive.bin`,
  // sha256: '64 hexadecimal digits from a trusted manifest',
});
const unsubscribe = task.subscribe(progress => {
  console.log(progress.state, progress.written, progress.total);
});
try {
  await task.done;
} finally {
  unsubscribe();
}
```

The destination's parent directory must exist. The task writes `destination.part`
and maintains `destination.resume` for eligible ranges. The destination must not
already exist unless `recoverCompleted` can verify its completion receipt.
Keep the destination and sidecars exclusively owned by the task;
filesystem APIs and other processes must not rename, edit or create them while
it runs. Successful completion syncs and renames the partial file. Failed or
cancelled tasks preserve partial data. Metadata syncs precede checkpoint rename;
parent directories are synced where supported. Filesystems that reject directory
fsync cannot provide the same power-loss durability. Missing or incompatible
checkpoints fail safely. Publication uses an exclusive hard link where available;
exFAT reserves the filename with `O_EXCL` before rename. Keep exclusive ownership
of that reservation; other processes must not replace it.

`task.cancel()` requests cancellation. `task.done` rejects with an `AbortError`
on cancellation and an `Error` on failure. Each task exposes `id`, `snapshot`,
and `subscribe(listener)`, which immediately supplies the current snapshot and
returns an unsubscribe function. In a React effect, unsubscribe and cancel the
task during cleanup if its lifetime belongs to that component.

| Option | Default | Limits and behavior |
| --- | --- | --- |
| `connections` | 8 | Integer 1–64; maximum ranges in flight |
| `mirrors` | omitted | Up to 4 other http(s) URLs for the same file. Each is probed and kept only if its size and strong ETag match the primary (or a `sha256` is given); ranges then rotate over the primary and the mirrors, and a mirror that fails a range is dropped. Not combined with `pieces` |
| `adaptive` | `true` | Per-origin congestion window (AIMD) under `connections`: starts at up to 8 and grows by half each second while full and healthy; HTTP 5xx/429/408 or a broken connection halves it (Retry-After also pauses that origin), after which it grows by one a second. `false` keeps `connections` fixed |
| `rangeBytes` | 32 MiB | Integer 1–256 MiB; at most 65,536 ranges |
| `resume` | `true` | Reuses matching durable completed ranges; `false` refuses existing partial files |
| `rejectHtml` | `false` | Rejects HTML content types and initial HTML signatures before a file can be published; provider pages are not binary downloads |
| `recoverCompleted` | `false` | Writes a durable `.complete` receipt before publication; a later identical request accepts its owned final file (re-hashing it only against a requested `sha256`) instead of downloading it again |
| `sha256` | omitted | Trusted 64-digit SHA-256; verifies the complete file in the writer thread before publication |
| `expectedBytes` | omitted | Exact positive safe-integer file size; rejects mismatched server sizes before downloading |
| `storageRoot` | omitted | Allowed absolute directory containing the destination; guards device/inode identity during writes and before publication |
| `headers` | omitted | Up to 32 string header values; see HTTP restrictions below |

A one-byte GET probe checks range support and size. A server that answers it with
a 206 range downloads in parallel and can resume. A strong ETag guards every range
through `If-Range`; without one, `Last-Modified` does (weak ETags are ignored);
without either, only the exact size and range bounds are checked. Ranges reuse the
probe's final URL after redirects, resolving the original URL again on a 4xx or on a
range's second 5xx there; the first range that lands through the new redirect pins its
target. Every range checks its exact bounds, total, status and validator. Only an
ETag, Last-Modified or total that differs on the URL the validators came from fails
the task as "server changed the resource"; a 200 that ignores `Range` or a 206 with
the wrong span is retried up to three attempts, and so is a validator difference on
a range that a fresh redirect sent to another node. A server without range
support uses a single sequential connection; its partial files cannot resume.

Resume requires the same validator, hash, size, range size and storage root, not
the same URL: a signed link that expired can be resolved again and the partial
continues. Without a strong ETag, a resume first downloads the last 64 KiB of the
last completed range again and compares it with the partial file; a difference
fails with "the server's file changed since this partial download". Only
completed, synced ranges survive resume; unfinished ranges download again. With
`rejectHtml`, HTTP 401/403 fails with "provider denied the file; link expired or
browser verification required", so an app can resolve its source again. Hash
verification performs one final sequential file read because ranges arrive out of
order. Matching validators are consistency checks, not cryptographic verification
of local partial data.

With `recoverCompleted: true`, the writer persists `destination.complete` after
verification and file sync, before publishing the final filename. The receipt
records the request identity, the selected root, the final inode and size, and the
SHA-256 when one was checked. Recovery matches the request (hashes and expected
size; not URLs), selected-root identity, final inode and size. It re-reads the
entire file only when the request carries a `sha256` (or piece SHA-1s) to check;
otherwise the receipt is trusted, so recovering a finished file of tens of GB costs
no read-back. Without a hash, verification proves the file is the one this task
published, not its content. Recovery does not contact the provider or accept an
existing file by name/size alone. Keep the receipt with the final file for crash
recovery.

A sequential partial without a checkpoint cannot resume. An app may offer an
explicit restart that discards its exclusively owned partial and sidecars after
cancellation has finished. Never discard or overwrite an existing final file
to make a retry succeed.

## Split-file manifests and format routing

```js
import {DownloadFormats, Downloads, FileSystem} from '@ps5-react/core';

const artifact = DownloadFormats.artifact({format: 'ffpfsc', filename: 'game.ffpfsc'}, '/data');
FileSystem.mkdir(artifact.directory, {recursive: true});
const task = Downloads.enqueueManifest({manifest, destination: artifact.destination, storageRoot: '/data'});
await task.done;
```

`DownloadFormats.manifest` validates Spectrum's `originalFileSize`,
`numberOfSplitFiles`, `packageDigest` (SHA-256), and `pieces` with `url`,
`fileOffset`, `fileSize`, and optional `hashValue` (SHA-1). Pieces are sorted and
must cover the exact size without gaps or overlaps. The limit is 1024 sources
and 65,536 transfer ranges. `enqueueManifest` normalizes this schema and submits
the same native service as `enqueue`.

Alternatively, `enqueue` accepts `pieces: [{url, offset, size, sha1}]` together
with `expectedBytes`. Each source is probed separately. Sources supporting
ranges use source-relative HTTP ranges; writes use absolute output offsets.
Sources without range support use one whole-piece request. Multiple pieces can
be in flight within the same 1–64 connection and 16 MiB buffer limits. No complete
temporary copy of each piece is required. The final writer verifies SHA-1
pieces and optional whole-file SHA-256 in one sequential read before publication.
SHA-1 here checks legacy manifest integrity; it is not a modern authenticity proof.

Each source needs a strong ETag, piece SHA-1, or whole-file SHA-256. The checkpoint
identity includes every offset, size, hash and validator, but no URL. Changed manifests
or storage identities cannot reuse a checkpoint. Completed ranges of whole-piece
fallbacks resume only once that entire piece has been durably written. Inputs
must describe raw byte slices; independent RAR volumes are not such a manifest.

`DownloadFormats.artifact({format, filename}, root)` validates the filename and
returns `directory`, `destination`, `format` and `nextAction`:

| Formats | Relative destination | Next action |
| --- | --- | --- |
| `ffpkg`, `exfat`, `ffpfs`, `ffpfsc` | `homebrew/<filename>` | `shadowmount` |
| `pkg`, `fpkg` | `downloads/packages/<filename>` | `installer-required` |
| `zip`, `rar`, `7z`, `tar`, `tar.gz`, `tgz` | `downloads/archives/<filename>` | `extraction-required` |
| Other binary files | `downloads/files/<filename>` | `downloaded` |

`DownloadFormats.detected({filename}, root, kind)` routes a file whose catalog
format was unknown by the `kind` `Archives.inspect` read from its bytes; the
filename takes that extension in place of `.bin`/`.binary`.

Routing checks declared format against known filename extensions; it does not
parse filesystem/package headers or certify mountability. `.fpkg` is a package,
whereas `.ffpkg` is a UFS image. A raw `.part0`/`.001` file cannot be handed to
ShadowMount directly. Extracted application folders remain the existing build
workflow; they are not a single HTTP artifact. No archive extractor or PKG
installer is included. Successful downloading is not installation or registration.

With `storageRoot`, the worker holds a directory descriptor, checks its device
and inode against the path at most once per second and immediately before
publication, and requires the partial to remain on that filesystem. Resume
identities include the original root identity. A disconnect can allow up to one
second of writes to the open file before detection; it never redirects those
writes to another storage root. Apps still need to check free space and actual
mounted external roots before submission. Write failures preserve partial data.

Snapshots contain `state`, `received`, `written`, `total` (bytes or `null`),
`bytesPerSecond`, `connections`, `retries`, `bufferedBytes`, `status`, `id`,
`destination` and `error`. States are `queued`, `connecting`, `downloading`,
`verifying`, `completed`, `failed`, and `cancelled`. Progress is sampled and
polled every 250 ms; retrying a range can reduce progress. `written` is completed
ranges plus bytes written in current ranges, not bytes already checkpointed.
`connections` includes ranges draining to disk, rather than an exact socket count.

## Bounded HTTP requests

```js
import {Http} from '@ps5-react/core';

const response = await Http.request('https://example.com/catalog.json', {
  method: 'GET',
  maxBytes: 1024 * 1024,
});
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const catalog = await response.json();
```

`method` supports uppercase GET, HEAD, POST, PUT, PATCH and DELETE. `body` is a
UTF-8 string up to 1 MiB. `maxBytes` defaults to 1 MiB and accepts 1 byte–4 MiB.
Requests have a 30-second total timeout. The result exposes `status`, `ok`,
the effective `url`, a frozen `headers` object with lowercase names, async
`text()` and async `json()`. Non-2xx responses resolve normally;
transport and response-size failures reject. Only content-type, content-length, content-disposition, content-range, location,
hx-redirect, etag and retry-after are exposed. Redirect response headers are
cleared before collecting the final response. Cookies and authentication headers
are not exposed; binary request or response bodies are not exposed. A compatible `signal` with `aborted`,
`addEventListener` and `removeEventListener` can cancel requests; the framework
does not install an AbortController or global `fetch`.

URLs must use HTTP or HTTPS and be at most 8192 bytes. Headers have token names
up to 128 bytes and string values up to 2048 bytes, without CR/LF. Range,
If-Range, Accept-Encoding, Content-Length, Connection and Host are owned by the
transport and cannot be overridden. Custom headers disable automatic redirects;
use the final URL for authenticated requests. `followRedirects: false` also disables redirect following, making the
allowlisted Location/HX-Redirect metadata available for provider adapters.
Otherwise redirects are limited
to five, and HTTPS cannot downgrade to HTTP. TLS peer and hostname verification
are always enabled. Responses use identity encoding.

Remote images (`<Image source={{uri}}>`, [IMAGES.md](IMAGES.md)) use the same
transport policy on their own workers and connections, outside this queue.

## Performance and resource contract

One persistent libcurl multi handle and reusable easy handles share connections.
HTTP/1.1 limits buffering associated with paused multiplexed streams. A 16 MiB
pool of 32 × 256 KiB blocks bounds application file buffers, independently of
file size and concurrency. A network worker and a disk writer each use a 1 MiB
stack; TLS, curl internals, response strings and metadata consume additional
memory in the title's one process heap. These are not total-memory bounds.

The writer uses 64-bit-offset `pwrite`, and buffer exhaustion pauses network
transfers until the writer returns blocks. Checkpoints run every five seconds
and at completion/cancellation. Connection failures (reset, timeout, refused,
unresolved, truncated body) and HTTP 408/429/5xx are a busy server, not a damaged
file: a range retries up to eight total attempts (a probe six), with exponential
delay from 0.5 s to 30 s, jitter, and numeric Retry-After honored up to a minute.
HTTP-date Retry-After is not supported. Each failed range logs its status,
Content-Range, Content-Length, ETag, encoding and final URL.
The default concurrency is a starting point, not a measured PS5 optimum.

The FIFO queue accepts eight unconsumed tasks, with **one task active at a time**;
a large file uses multiple connections within that task. HTTP requests queued
behind that file wait for it to finish. Polling consumes terminal snapshots and
frees queue slots. Hosts cancel and join both workers before destroying QuickJS.
Workers never access JavaScript, the engine or controller state; native bridge
calls synchronously submit/cancel/poll bounded work on the render thread.

Run `npm test` for localhost native transfer tests, JS task lifecycle tests and
existing UI/controller checks. No tests contact a console or download a catalog.
Use [DOWNLOAD-PERFORMANCE.md](DOWNLOAD-PERFORMANCE.md) for research and the
hardware benchmark plan. No PS5 download-speed measurement is claimed.
