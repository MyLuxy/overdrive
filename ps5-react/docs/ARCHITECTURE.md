# Architecture

## Responsibilities

```text
apps/<app>/index.jsx                 application, state, components
            ↓
runtime/js (@ps5-react/core)         focus navigation, controller API, native modules, primitives
            ↓ React reconciler / NativeUI / QuickJS
Embedded React C                    tree, layout, text, rasterization
            ↓ opaque ARGB8888 framebuffer
native/shared/GlPresenter           changed rows into a framebuffer texture, layers, presentation
            ↓
native/desktop | native/ps5          window/EGL, input, clock, lifecycle,
                                     native modules via native/shared/host_api
```

Applications do not access scePad, EGL, libkernel, or the SDK directly. They
reach platform services only through the `@ps5-react/core` native modules
(`runtime/js/native.js`), which wrap `globalThis.__ps5ReactNative`. Its shape is
fixed by `native/shared/host_api.hpp`: `native/shared/host_api.cpp` installs it
and implements the filesystem with POSIX, while `native/ps5/` and
`native/desktop/` implement the platform functions. Calls are synchronous on the
render thread. Networking calls submit/cancel/poll bounded native tasks; two
workers perform network and disk I/O without touching QuickJS or the engine.
Remote images have two more workers (fetch and decode) that hand finished
pixels to the render thread, which registers them with the engine
([IMAGES.md](IMAGES.md)). Hosts cancel and join all workers before runtime
shutdown. See
[NETWORKING.md](NETWORKING.md) for the buffer, heap, stack and queue contract,
and [NATIVE-API.md](NATIVE-API.md) for the bridge. The presenter keeps a copy of the
framebuffer in a 2D texture on the GPU. Each frame it replays the engine's moved
rects there as framebuffer blits, then uploads the damaged rows, merged into
bands, through small buffer textures that a shader draws into that texture with
`texelFetch`: on the PS5 `glTexSubImage2D` of 3840×270 takes about 15 ms of CPU,
and every draw costs about 25 µs plus 15 µs per MiB of the buffer textures it
reads, so only the rows being uploaded live in buffer textures. One draw then
puts that texture on screen, scaled and letterboxed when the surface differs
from the render size. When the engine lists layers (`<Image layer>`, see
[IMAGES.md](IMAGES.md)), that draw samples up to four of those images first (one more draw per four more), each
uploaded once to its own texture, and the framebuffer over them with
premultiplied blending; the engine leaves their rects transparent and keeps
what it draws over them in the alpha channel. A frame that changed nothing is
neither drawn nor swapped: the host sleeps to the next vertical sync.
Every other pixel is still rasterized on the CPU. The presenter
has no knowledge of React state, fonts, or widgets. The engine and JavaScript
run on the same render thread. The PS5 host keeps the heap, shims, CRT, SDK
pair, and FSELF path used by the hardware-tested proof of concept.

Video decoding is the other work off the render thread: each `<Video>` player
demuxes and decodes video and audio on three threads of its own, and the render
thread only picks the decoded picture due and draws it as a layer
([VIDEO.md](VIDEO.md)). Apps with `"video": true` reserve 448 MiB of flexible
memory outside the heap for the PS5's hardware decoders, so their heap is
smaller than the 96 MiB rule below gives.

Only a commit's repaint leaves the render thread. `native/shared/render_workers.cpp`
starts a thread per available CPU, up to `ERUI_RENDER_WORKERS` (8), and the
engine splits each commit's repaint once into horizontal bands, one per worker
at most, each holding about an equal share of the damaged area and at least 16
rows and 128 Ki pixels of it, joined before the commit returns; workers without
a band are not woken. Each worker
has its own clip stack, opacity strips, transform buffer and damage set, which
the render thread folds after the join. Vector paths and HarfBuzz-shaped text
render one call at a time under a lock, and while any view casts a shadow every
commit renders single-core. JavaScript, layout and QuickJS never run on a
worker. Hosts stop the workers before destroying the backend. Opacity strips and
transform buffers are static, per worker, and outside the heap, which on the PS5
takes the largest size that leaves 96 MiB of flexible memory free: keep them
small enough that it stays at 256 MiB (`native/ps5/CMakeLists.txt`). Hosts log
`render workers=N of 8, cpus=M`. To compare against single-core, set
`PS5_REACT_RENDER_WORKERS=1` for the desktop preview, or put a count in
`dev/render-workers.txt` of a PS5 test deploy. `npm test` runs the self-test
single-core and across the workers, and fails unless the snapshots are
byte-identical and at least one commit forked.

The reconciler commits through the bridge after each React commit, during the
host's input and JavaScript phase. Hosts bracket that phase with
`er_set_raster_deferred`, so those commits run layout and `onLayout` but leave
their damage to the commit after `ps5_react_frame`, which paints the frame once.
A view that scales or rotates keeps its rendered source in one of
`ERUI_XFORM_CACHE_SLOTS` shared slots (two on the PS5, 2.25 MiB each), reused
while its subtree, images and size are unchanged.

QuickJS frees most objects when their last reference goes, but cycles (React
fibers of unmounted components, effect lists) wait for its collector, a pause of
tens of milliseconds on the PS5 that runs inside whatever allocation crosses its
threshold, often the frame handling a key press. Hosts install a counting
allocator (`native/shared/js_heap.cpp`) and collect in idle frames, half a
second after the last input, once a third of the room before that threshold is
garbage, so bursts of input start with most of it. The room is at least 8 MiB,
more than QuickJS's 1.5 times what survived while that is under 16 MiB, and the
threshold stays an eighth below `memory_limit`: QuickJS fails an allocation past
the limit without collecting first. An idle collection also waits for three
frames in a row that repainted under a fiftieth of the screen, so it does not
land in a page slide, until three quarters of the room is garbage. A pause grows
with the heap it scans: on the PS5 about 12 ms at 9 MiB live and 48 ms at 17.5.
Hosts log each collection as `gc: idle` or `gc: automatic` with the live heap.
A PS5 test deploy can drop the wait for still frames with `dev/gc-still.txt`
holding 0.

`className` and `tw` styling is compiled by `tools/tailwind` during bundling into
literal style objects; class names and CSS never reach QuickJS or the engine.
See [TAILWIND.md](TAILWIND.md).

Hosts send directional actions (`up`, `down`, `left`, `right`, `confirm`,
`back`) through `globalThis.__ps5ReactDispatch`, and call `globalThis.__ps5ReactFrame`
once per frame for per-frame motion. `runtime/js/focus/` moves focus
between focusable elements from their laid-out rectangles, in JavaScript on the
render thread; hosts know nothing about focus. See [NAVIGATION.md](NAVIGATION.md).

Only execution infrastructure and InputTracker are used from ps5-homebrew-ui.
Its UI components, themes, and UI renderer are not used.

| Directory | Responsibility |
| --- | --- |
| `apps/` | Independent JSX entry points, manifests, and assets |
| `runtime/js/` | Public primitives, focus navigation, native modules, and host input contract |
| `native/` | Shared presenter and desktop/PS5 hosts |
| `tools/` | Bootstrap, bundle, `className` compiler, assets, builds, verification, CLI |
| `docs/` | Decisions, evidence, limitations, provenance |

Generated files live in `.deps/`, `.build/<app>/`, and `dist/<TITLE_ID>/`.
A process lock serializes builds because dependency tooling is shared.

## Reproducibility

1. Pin Embedded React, platform, and QuickJS revisions; use `npm ci`.
2. Verify SDK, OpenGL, compiler-rt archive, and graphics manifest SHA-256 hashes.
3. Use the same engine profile for desktop and PS5, propagating C definitions.
4. Record source, bundle, executable, and toolchain hashes; verify ELF/SELF/ZIP.
5. Validate each output on hardware and record the firmware/loader combination.

The default SDK is v0.42 from a pinned URL and hash. Cross-compilation uses
Clang/LLD 18. Host utilities use the macOS compiler and system zlib. This is
functional reproducibility with recorded dependencies, not a guarantee of
identical output across operating systems. A future release pipeline should
also pin the CI image, Python, Node, CMake, and host compiler.

## Developer experience

`npm run dev` watches JSX, assets, and configuration, rebuilding and reopening
the macOS preview. State resets; this is not Fast Refresh. Build errors remain
visible and another save retries. The watcher never connects to the console.

`npm run build` produces an application folder and ZIP. JSON controls identity,
version, resolution, and timeout. `npm run create` adds an app without copying
C++. Configuration errors are reported before dependency downloads, and each
build stage retains its full log.

## Future work

- Hardware validation of focus navigation, including modal, reconnect, and repeat tests.
- Restart only the JS runtime while preserving the desktop graphics context.
- Measure PS5 frame time and memory, then consider damaged-region uploads.
- Extend native networking as measured on hardware; add music, text input, save data,
  caching, and virtualization behind explicit APIs.
- Ship an installable CLI and a pinned CI matrix.

The software renderer still owns the pixels. A future GPU backend can preserve
the application API but is not implemented here. No part depends on RNPS,
Sony bundle signature bypasses, or changing the system home screen.
