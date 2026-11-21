# PS4 port: plan, status and console bring-up

This document is the working hand-off for the PS4 port of Overdrive. It is written so
that the next development session can continue from the middle: what exists, what is
verified, what is not, and how to set the environment up from zero.

Current state: **everything below is untested on hardware.** The PS5 codebase this port
branches from is complete and shipping (see the upstream Overdrive repositories), and the
desktop preview of this very tree works — run `npm run preview`. The PS4-specific layer
is written but was never compiled for Open Orbis.

## What already works

- **The whole Overdrive application** (`app/`): React UI inside QuickJS, the 3,400+ game
  catalog, 17+ interface languages, i18n, archive passwords metadata, debrid services.
  This code is platform-independent by design and is reused unchanged.
- **The desktop preview** (`ps5-react/native/desktop`): SDL2 window, software renderer
  presenting through OpenGL, libcurl networking, libarchive extraction. This is the
  reference implementation the PS4 host mirrors.
- **The engine build** (`ps5-react/native/ps5/CMakeLists.txt`): embedded-react + the
  software backend + the QuickJS bridge as plain C, compiled identically for PS5, macOS
  preview and now PS4.

## What the PS4 port adds

| Path | State | Notes |
| --- | --- | --- |
| `ps5-react/native/ps4/host_platform.cpp` | Written, untested | Mirrors `native/desktop/host_platform.cpp`: SDL pad/audio/keep-awake, sandbox under `/data/overdrive/sandbox`, mounts probed at `/data`, `/app0`, `/mnt/usb0..7` (no `/proc/self/mounts` on Open Orbis) |
| `ps5-react/native/ps4/rar_worker_process.cpp` | Stub | Open Orbis exposes neither `fork` nor `posix_spawn`; RAR requests fail with an honest message until an in-process worker exists |
| `ps5-react/native/ps4/package_installer.cpp` | Stub | PKG installation stays with the console's HEN tooling; Overdrive on PS4 downloads files only |
| `ps5-react/native/ps4/browser_capture.cpp` | Stub | The PS5 flow asks the ELF loader on port 9021; no PS4 equivalent |
| `ps5-react/native/ps4/CMakeLists.txt` | Written, never compiled | Mirrors the desktop target: same shared sources, `../desktop/host.cpp` as the entry, video optional (`-DPS4_REACT_VIDEO=ON` + `-DFFMPEG_PREFIX=...`), no `-Werror` yet so first hardware builds are not blocked by warnings |
| `ps5-react/native/ps4/toolchain-openorbis.cmake` | Written, never compiled | Pins compilers/find roots to `$OO_PS4_TOOLCHAIN`; the Open Orbis clang driver carries the PS4 target itself |
| `ps5-react/tools/build_ps4.py` | Written, never run | Reuses `common.py` (`bundle`, `layouts`, `resource_files`, pinned dependencies) exactly like `build_ps5.py`; stops after staging `dist/<title>-ps4/` with `eboot.elf` + app data + a build receipt |
| `packaging/build-ps4.sh` | Written, never run | `npm run build:ps4` wrapper: env checks, then the Python driver |

Deliberately not ported from the PS5 build: the libc runtime `.prx`, all loader payloads
(pkg-installer, relauncher, browser capture, pkg-helper, rar-extract), the
filesystem-helper elevation, and the fake-fPKG assembly. The PS4 homebrew ecosystem
solves these differently; the first hardware session decides how.

## Build environment

Target: Linux x86-64 (WSL2 also fine), or macOS for the desktop preview.

1. **Base tools**: `git`, `cmake`, `ninja`, `node` (LTS), `python3` (3.12+), `clang++`.
   `npm run setup` installs the rest for the desktop preview.
2. **Open Orbis toolchain**: clone and install
   [OpenOrbis/OpenOrbis-PS4-Toolchain](https://github.com/OpenOrbis/OpenOrbis-PS4-Toolchain),
   then export its root:
   ```sh
   export OO_PS4_TOOLCHAIN=/opt/OpenOrbis-PS4-Toolchain
   ```
3. **Ported libraries** the PS4 host links against. Install (or build) the Open Orbis
   ports of: **SDL2, libcurl (with OpenSSL TLS), libarchive (with xz, bzip2, zstd,
   zlib), OpenSSL, zlib** — into the toolchain tree so `find_package` finds them under
   `CMAKE_FIND_ROOT_PATH`. Verify the exact port names and versions against the toolchain
   release you installed; this is the step most likely to need adjustment.
4. **Sanity check**: `npm run preview` must work before any PS4 build — it compiles the
   same shared sources the PS4 target uses.

## Building

```sh
export OO_PS4_TOOLCHAIN=/opt/OpenOrbis-PS4-Toolchain
npm run build:ps4
```

Outputs:

- `dist/<title>-ps4/eboot.elf` — the native host (the `overdrive-ps4` CMake target)
- `dist/<title>-ps4/` — the app data as it would sit beside the executable:
  `data/`, `i18n/`, fonts, `sce_sys/` artwork
- `dist/<title>-ps4.receipt.json` — hashes of the bundle and every staged file

The title ID comes from `app/app.json` (PS5's `PPSA99058`) unless `--title-id` overrides
it. For a real PS4 install, choose an ID from the homebrew range in use by the target
HEN/PKG tooling during the first hardware session.

## Console bring-up checklist

For the session with physical hardware. Record everything: klog, serial output where
available, photos of failures, the app's files under `/data/overdrive`.

1. **Prepare the console**: jailbroken PS4, HEN active, enough free space; note the exact
   firmware version and the HEN/loader in use.
2. **Get the ELF over**: `eboot.elf` plus the data tree. Options to evaluate in order:
   the toolchain's own remote loader (`ps4-payload-host`/`ps4-elf-loader` via
   `ps4-payload-recover`), packaging as fPKG with the community tooling, or running from
   a USB drive if the loader supports it.
3. **First boot expectations**:
   - The app is not signed: Open Orbis homebrew runs only under HEN.
   - If the screen stays black, the renderer did not present — see Known risks, risk 1.
   - The first log line (`[PS4 overdrive] host: ps4, sandbox: ...` shape) proves the
     host reached `main`.
4. **Functional pass** (in order, stop and record on the first hard failure):
   - UI renders at 1080p60, page transitions animate
   - Controller: D-pad focus, ✕ select, ◯ back, L1/R1 sections
   - Catalog loads from the bundled `data/` (no network needed yet)
   - Network: catalog update from the feed (curl/TLS through the port)
   - Download a small file to `/data/overdrive/sandbox`
   - Download to a USB drive (`/mnt/usb0`)
   - Extract a ZIP through libarchive
   - Debrid services: config screen renders; keys persist
5. **Record**: `device_info` output, free memory, frame stats overlay
   (the framework prints per-frame js/layout/raster splits), and every `[notify]` line.

## Known risks

Ordered by expected severity:

1. **GL presentation.** `../desktop/host.cpp` asks SDL for an OpenGL 4.1 Core context and
   presents through `gl_presenter.cpp`. The PS4 SDL2 port may not provide a GL context.
   Fallback plan: present the software framebuffer with `SDL_GetWindowSurface` +
   `SDL_BlitSurface` (or `SDL_UpdateWindowSurface`) and drop the upscale pass —
   the upstream PS5 build proves the software renderer works without GPU blits.
2. **libc surface gaps**: `getrusage`, locale handling and `statvfs`
   fields differ; the host degrades gracefully (fields stay empty or -1) but verify.
3. **Networking**: the curl port must route through the console's socket stack with a
   usable CA store; the PS5 build bundles Mozilla roots (`certs/cacert.pem`) — do the
   same on PS4 if the port lacks a system store.
4. **Memory**: no PS5 flexible/direct memory split; the engine's heap accounting
   (`native/shared/js_heap.cpp`) uses whatever the process reports. A 3,400-entry catalog
   parse is the heaviest single operation — watch QuickJS heap pressure.
5. **Threading**: render workers (`ERUI_RENDER_WORKERS=8` in `native/ps5/CMakeLists.txt`)
   assume free thread creation; reduce if the console's scheduler misbehaves.

## Repository layout (what differs from upstream Overdrive)

```
app/                     unchanged (the Overdrive application)
covers/, docs/, tools/   unchanged (catalog tooling, importers, password metadata)
packaging/
  build.sh, ...          unchanged (the PS5 pipeline, still the reference)
  build-ps4.sh           NEW: PS4 staging build wrapper
ps5-react/
  native/desktop/        unchanged (reference host)
  native/ps5/            unchanged (engine + PS5-specific layer)
  native/ps4/            NEW: the PS4 host (see its README.md)
  tools/build_ps4.py     NEW: the PS4 build driver
docs/PS4.md              this file
```
