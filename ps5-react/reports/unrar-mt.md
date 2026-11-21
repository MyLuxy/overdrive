# Multithreaded UnRAR for RAR extraction

Branch `perf/unrar-mt` (worktree `~/Documents/ps5-react-wt-unrar`), based on `main` at `6c168a6`. It hasn't been pushed.

## What changed

RAR sets are no longer decoded inside the engine. They go to **rar-extract**, a separate program built from RarLab's UnRAR 7.2.1 plus a small MIT-licensed driver (`native/rar_worker/rar_worker.cpp`).

- **PS5:** `rar-extract.elf` is a payload. It goes to the loader on 127.0.0.1:9021 the same way as `pkg-installer.elf`.
- **Desktop:** it runs as a child process connected over a socketpair (`native/desktop/rar_worker_process.cpp`).
- **Interface:** the engine sees only four host functions in `archives.hpp`: `start_rar_worker`, `read_rar_worker`, `cancel_rar_worker` and `close_rar_worker`. It never links UnRAR.

```
engine (GPL)                                rar-extract (MIT driver + UnRAR)
archives.cpp: preflight, staging, receipt   request on stdin: threads, window, limit, flatten,
  rar_volumes()? ── request ──────────────▶   reserved, password(hex), dest, source...
  extract_rar() ◀── "p <bytes>"             UnRAR RAR5 multithreaded (RAR_SMP), RAR_TEST mode
                ◀── "f <sha256> <size> <path>"  data callback -> Writer thread (pwrite + SHA-256 + fsync)
                ◀── "ok" | "fail <reason>" | "cancelled"
  "cancel\n" ───────────────────────────────▶ checked every 250 ms; EOF on stdin = cancel
```

### Engine side (`native/shared/archives.cpp`)

**Preflight is unchanged.** It still refuses RAR5 dictionaries above 32 MiB before anything starts.

**`rar_volumes()` decides who extracts.** Every source must start with a RAR4 or RAR5 signature. Sets split by bytes (`.001`, raw cuts) and any path containing a newline stay on libarchive.

**libarchive is the fallback when the worker cannot start.** That covers the loader not answering on 9021, a missing ELF, or a missing binary on the desktop. Nothing has been written to staging at that point, so the fallback is clean.

**Every `f` report is checked as an untrusted entry before it enters the receipt.** The engine checks:
- `safe()` on the path
- no `.ps5-react-` in the name
- `plain_path` with no link
- `lstat` shows a regular file of the reported size
- the size limit
- `max_entries` and `max_artifacts`
- the 64-character hex SHA-256

**How a run ends:**
- **Cancel or a refused report:** the engine sends `cancel`, waits up to about 10 s (40 reads × 250 ms), closes, and the existing code removes staging.
- **Silence:** about 30 s with no output fails the job with "The RAR worker stopped before finishing."
- **Worker crash:** EOF without a final line produces the same message.

### Worker side (`native/rar_worker/rar_worker.cpp`)

- **Driver:** a copy of the `dll.cpp` logic, so the thread count can be set before `CmdExtract` exists.
  - `ExtractCurrentFile` runs in test mode (`RAR_TEST`), and the data arrives through `UCM_PROCESSDATA`.
  - UnRAR checks CRC32 or BLAKE2 for each file.
- **Threads:** `sysconf(_SC_NPROCESSORS_ONLN) - 2`, clamped to 1..4, so two cores stay with the UI and downloads.
- **Writer thread:** 4 × 4 MiB buffers, a fixed 16 MiB.
  - The decoder copies into them; the writer thread does `pwrite`, SHA-256 and `fsync`/`close`, then reports `f`.
  - SHA-256 comes from CommonCrypto on macOS and OpenSSL EVP (libcrypto from the PacBrew ports) on the PS5.
  - UnRAR's built-in SHA-256 was the bottleneck: it capped extraction at about 175 MB/s.
- **Paths and links:**
  - It applies the same rules as the engine's `safe()`.
  - Images are flattened to the set root (the ShadowMount rule; the engine sends the list of extensions).
  - Any `RedirType` (symlink, hardlink, junction, file copy) is refused.
  - Files are created with `O_EXCL|O_NOFOLLOW`; each parent directory is checked with `lstat` and must not be a link.
  - `umask(0)` so the app can read and remove files the payload created.
- **Volumes:** the next volume is always the next item in the engine's list, through a new `UCM_NEXTVOLUMEW` message. It does not depend on file names: the tests' `encrypted-volume-0.rar`/`-1.rar` names work.
  - A RAR5 volume whose number is out of place counts as a missing volume.
- **Clear error messages** that the app's classifier already recognizes:
  - missing volume: "Incomplete RAR archive or missing volume."
  - damaged data: "RAR checksum mismatch; the archive is damaged." (matches the damaged rule)
  - wrong password: "Incorrect RAR archive password."
  - no password given: "RAR archive password is missing."
  - large dictionary: "This archive needs more memory to extract…" (matches archiveTooLarge)
  - disk full: `strerror(ENOSPC)` = "No space left on device" (matches noSpace)
- **Dictionary cap:** `window` = 32 MiB is checked per file header before decoding (`Method != 0`), and `WinSizeLimit` is set to the same value. This also covers sets with encrypted headers, where the preflight cannot read the dictionary size.

### UnRAR patches (`patches/unrar-worker.patch`, 3 files plus `dll.hpp`)

1. **`unicode.cpp`:** with `UNRAR_UTF8_NAMES`, names convert as UTF-8, as on Apple. This does not depend on the locale (the console runs in "C").
2. **`volume.cpp` and `dll.hpp`:** the new `UCM_NEXTVOLUMEW` callback, where the host supplies the exact next volume.
3. **`threadmisc.cpp`:** pool threads get an explicit 1 MiB stack instead of the system default.

UnRAR is fetched from `rarlab.com` and pinned by SHA-256 (`unrarSource` in `dependencies.lock.json`). `tools/rar_worker.py` extracts it, applies the patch and builds it for any compiler.

## Mac numbers (M-series, 10 cores; load average 4-7 from other agents, so there is noise)

| Set | Current engine (libarchive) | New (engine + rar-extract) | Gain |
| --- | --- | --- | --- |
| 512 MB RAR5 compressed, 3 volumes (half random, like a game) | 6.8–7.3 s (74–79 MB/s) | 2.1–2.9 s (183–257 MB/s) | **2.5–3.4×** |
| 232 MB, 6000 files, solid RAR5 | 3.96–4.44 s | 2.05–3.76 s | 1.1–1.9× |
| 232 MB, 6000 files, stored (-m0), 4 volumes | 1.08–1.17 s | 1.01–1.18 s | parity (fsync per file is the limit) |

Thread scaling, worker alone on the 512 MB set:

| Threads | 1 | 2 | 4 | 8 |
| --- | --- | --- | --- | --- |
| Time | 5.0–6.2 s | 2.8–4.5 s | 2.25–2.9 s | 1.8–2.4 s |

The UnRAR CLI on the same set takes 1.9–2.75 s; with `-mt1` it takes 6.0–7.0 s.

**Outputs are byte-identical:**
- The big set's SHA-256 matches the source and the receipt.
- The 6000 files are compared by manifest for the solid, stored and `-hp` (encrypted headers) 2-volume sets.

The `-hp` set with a password extracts through the worker. Before, it needed `Rar5PasswordReader` plus single-threaded libarchive.

## Tests run

- **`tools/test_archives.py`:** the whole suite passes with RAR going through the worker. Cases added:
  - a nested image flattened to the set root
  - names `../escape`, `/escape`, `a\..\..\escape`, `a/../../escape`, `x/.ps5-react-extraction` and a RAR5 symlink: all refused, and nothing is created outside staging
  - a missing middle volume reports "missing volume"
  - no password reports "password"
- **`tools/tests/rar_worker_stress.cpp`:** random cancels and `stop()` mid-extraction, with UBSan on the engine.
  - 15 rounds on the 512 MB set, 8 on solid, 8 on stored.
  - Every cancel finishes in 109–622 ms, staging is removed, the worker is reaped (`pgrep`), and no file descriptor leaks.
- **Fuzzing (`/private/tmp/xbench-unrar/scripts/fuzz.py`):** 83 RAR files from the libarchive corpus (fuzz cases for distance overflow, window desync, invalid dictionaries and so on), plus about 1,700 mutants (bit flips, truncation, overwritten ranges) of compressed, solid, encrypted, stored and 4-volume seeds.
  - Run three ways: plain, UBSan (`-fno-sanitize=alignment,enum`) and Guard Malloc (`libgmalloc`, `MALLOC_STRICT_SIZE`).
  - **0 crashes, 0 hangs, 0 UBSan reports** outside the excluded classes.
  - The only UB found is UnRAR loading an invalid enum value (`HEADER_TYPE`) from corrupt headers, which is harmless in practice.
- **Disk full:** a 512 MB set onto an 80 MB HFS+ volume fails with "No space left on device", and staging is removed.
- **Worker killed with `kill -9` mid-extraction:** the job fails with "The RAR worker stopped before finishing.", and staging is removed.
- **64 MB dictionary** (a 33 MB file, `-md64m`): refused by the preflight, and also by the worker on its own.
- **ASan and TSan could not run on this Mac.** On macOS 26.6, Apple clang 17's and Homebrew llvm@18's ASan both hang during startup in `get_dyld_hdr`, and TSan segfaults on an empty program. Guard Malloc plus UBSan stand in for ASan. TSan coverage still needs Linux or newer LLVM; with only 1.7 GB of free disk, a newer LLVM did not fit.

## PS5 cross-compile

- **Real build:** `tools/build_ps5.py --compile-only` (starter app) succeeds.
  - The app's `eboot.elf` links, including the native-app `link` step that checks imports.
  - `rar-extract.elf` builds with the payload SDK (`prospero-clang++ -fexceptions -frtti`, libunwind, libc++abi, libc++), plus `libcrypto.a` from the ports and `libclang_rt.builtins` (for `__cpu_model`).
- **Size:** 6.6 MB unstripped, 5.7 MB stripped. The packaging step strips it.
- **No exceptions in the app:** the app itself still builds with `-fno-exceptions`. UnRAR's exceptions only exist in the payload.
- **Packaging:** the full build copies `rar-extract.elf` to `dist/<title>/` and UnRAR's `license.txt` to `notices/unRAR-license.txt`.

## License

UnRAR's license allows its use in any software to extract RAR archives, free of charge. It forbids using it to create a RAR-compatible archiver, and it requires the "UnRAR source code may be used…" paragraph to ship with it. It is not a free license and not GPL-compatible, so it cannot be linked into the GPL engine.

- **How the branch handles it:**
  - UnRAR lives only in a separate program.
  - The driver is MIT and imports no GPL code from the engine.
  - The engine talks to it over a stream with a simple line protocol. The GPL FAQ treats sockets or pipes between separate programs as aggregation when the data exchanged is simple.
  - Both files are shipped together in the package.
  - The license text is in `native/rar_worker/LICENSE` and `notices/unRAR-license.txt`.
- **Needs checking before a release:**
  1. Whether shipping the ELF inside the same PKG is acceptable to the project. The alternative is downloading it on first use.
  2. Whether the payload SDK runtime (`crt1.o`, its `libc` and linker scripts, marked GPL-3 in the scripts) has a linking exception. If it does not, linking it with UnRAR has the same problem. pkg-installer and relauncher use the same SDK, but they are GPL, so it does not matter for them. The SDK license files are not in the extracted `.deps/sdk`.

## GPL-compatible multithreaded alternatives (if UnRAR cannot ship)

| Option | License | Estimated gain on a large compressed RAR5 | Effort and risk |
| --- | --- | --- | --- |
| Writer pipeline in libarchive (`perf/extraction-writer`) | GPL/BSD | about 1.2–1.3× (65–88 → about 100 MB/s on the Mac) | Done in the other branch |
| Parallel fsync and close (several closer threads) plus fsync at the end | GPL | 1.3–2× on many small files; about 0 on one large image | Low; already started in the other branch |
| Multithreaded RAR5 decoding in libarchive's `archive_read_support_format_rar5.c` (BSD-2): each RAR5 block carries its own Huffman tables. N threads decode blocks into lists of literals and matches, then one thread applies LZ and filters, like UnRAR's `Unpack5MT`, written from the published RAR5 format, not from UnRAR's code | BSD-2 (compatible) | **1.8–2.3×** with 3–4 threads (UnRAR goes 1 → 4 threads: 5.0 → 2.3 s) | High: 2–3 weeks plus fuzzing; the gain depends on blocks ≤128 KB, which WinRAR produces |
| Several libarchive readers in parallel, one per group of files (non-solid sets only) | BSD/GPL | about N× on many files; **0 on one large image** (the common game format) | Medium; does not help the main case |
| Faster SHA-256 in the engine (OpenSSL SHA-NI on Zen2, already used) plus 1 MiB read blocks instead of 128 KiB in libarchive | GPL/Apache | 5–15% | Low |
| 7-Zip's RAR5 decoder | LGPL **with the unRAR restriction** | Not usable | Same license problem |

Recommendation: if UnRAR is ruled out, the best gain-to-effort ratio is the writer pipeline plus parallel closers. The only GPL-compatible path to 2× and above on large games is block-parallel RAR5 decoding in libarchive (BSD).

## Crash risks and guards

| Risk | Guard |
| --- | --- |
| Exception or crash inside UnRAR (corrupt data, `bad_alloc`, `pthread_create` failing) | Separate process. `catch (RAR_EXIT)` / `bad_alloc` / `...` in `main`. If it still dies, the app sees EOF and fails the job cleanly; it never aborts. |
| Exception thrown in an UnRAR pool thread (`realloc` failing in `UnpackDecode` on a hostile archive) | `std::terminate` kills only the worker; the app reports the failure. Blocks over 128 KB already fall back to single-threaded decoding inside UnRAR. |
| Memory | Window ≤ 32 MiB (checked per header), plus `ReadBufMT` 4 MiB, plus item lists (normally < 1 MiB per block), plus a fixed 16 MiB writer. All of it is in the payload's process, not the app's 128 MiB heap. |
| QuickJS or JS on threads | None. The worker has no JS, and the engine reads the stream on the archive thread it already had. |
| Cancel, pause, app exit | `cancel` on the socket. EOF on stdin is treated as cancel (app closed or killed). The desktop kills the child after 5 s. The engine removes staging only after `close_rar_worker`. |
| Worker hung (dead USB in `fsync`) | The engine gives up after about 30 s of silence, or about 10 s after a cancel. The desktop sends SIGKILL; the PS5 can only close the socket, and the payload stops at its next check. |
| Reports from a buggy or hostile worker | Each `f` is validated as untrusted (path, link, size, limits). The `written` value from `p` lines is clamped to `max_bytes`. |
| Missing, out-of-order or truncated volumes | `UCM_NEXTVOLUMEW` uses only the engine's list, RAR5 volume numbers are checked, and the result is a clear error. |
| Stale worker after an app restart writing into staging that the app is restarting | It stops within 250 ms of the old socket closing. There is a short window; acceptable. |

## What needs a console test

1. The loader on 9021 runs `rar-extract.elf`, and the request and replies flow over the socket (stdin and stdout are the socket).
2. The paths the app sees (`/data/...`, `/mnt/usb0/...`, `/mnt/ext0/...`) are the same in the payload process. pkg_installer rewrites `/data/` → `/user/data/` only for the install service.
3. Ownership: files and directories the payload creates (probably as root, 0666/0777 with `umask(0)`) can be read back by the app for receipt recovery, renamed (staging → destination) and removed.
4. What `sysconf(_SC_NPROCESSORS_ONLN)` returns in the payload, and whether 4 threads keep the UI at 60 fps with a download running at the same time. If not, use 3 threads or lower the priority.
5. Unwinding in the payload: extract a corrupt or truncated archive on the console. This exercises `throw RAR_EXIT` → `catch`.
6. OpenSSL EVP SHA-256 works in the payload, and SHA-NI is active (throughput).
7. Throughput on the console: the same 512 MB set and a real game (10–150 GB, `.partN.rar`). Compare with libarchive and look at the `rar worker started/finished` trace lines.
8. Cancel and pause mid-extraction, and closing the app mid-extraction followed by reopening it (owned staging is restarted).
9. A set where the loader is not running: it must fall back to libarchive with the `rar worker unavailable` trace.

## Merging with `perf/extraction-writer` (now `27c7865`)

There are textual conflicts only, where both branches add lines in the same places:
- `archives.hpp` and `native_host.cpp`: `pipeline_bytes()` next to the four worker functions.
- `CMakeLists.txt` and `test_archives.py`: source lists.
- `archives.cpp`: includes, and the libarchive block.

To resolve them, keep both sides. The other branch's libarchive block (writer, timings, `writer.finish`) goes inside this branch's `if (!rar_volumes(request) || !extract_rar(...)) { ... }`. The two pipelines are independent: RAR goes to the worker, everything else to libarchive with the ring.

Their `Writer` (parallel closers) could replace the worker's simpler writer, which has a single thread doing `fsync`. That would help small-file solid sets, but it requires relicensing that code as MIT or rewriting it, because the worker cannot contain GPL code.

## Files

- `native/rar_worker/rar_worker.cpp`, `native/rar_worker/LICENSE`
- `native/shared/archives.cpp` / `.hpp` (`rar_volumes`, `rar_request`, `rar_file`, `extract_rar`)
- `native/desktop/rar_worker_process.cpp`, `native/ps5/native_host.cpp`, `native/ps5/payload_loader.*`
- `tools/rar_worker.py`, `tools/build_ps5.py`, `tools/cli.py`, `tools/test_archives.py`, `tools/tests/rar_worker_stress.cpp`
- `patches/unrar-worker.patch`, `dependencies.lock.json` (`unrarSource`), `docs/DEPENDENCIES.md`
- Bench and fuzz scripts (not committed): `/private/tmp/xbench-unrar/scripts/`
