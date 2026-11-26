# Dependencies and licensing

Framework-owned code uses GPL-3.0-or-later with the attribution-preservation
term in `LICENSE-ATTRIBUTION`. Third-party code retains its original license.
No proprietary Sony modules are redistributed.

| Dependency | Purpose and license |
| --- | --- |
| Embedded React | C engine, QuickJS bridge, reconciler, software compositor. Apache-2.0; revision `cf5dfe4fae966fe21a265acc3dd3b054d245f981`. |
| ps5-homebrew-ui | EGL, controller, system, InputTracker, audio mixer and output, heap, CRT, shims, native tools. GPL-3.0-or-later; revision `4bd942579dd981b3df9c740438489ca6a614ddc0`. Its repository (github.com/blackbearreloaded/ps5-homebrew-ui) is gone; the history up to that revision is kept, unchanged, on the `ps5-homebrew-ui` branch of [MyLuxy/overdrive-deps](https://gitlab.com/myluxy/overdrive-deps). |
| ProsperoStore elevation client | Optional cooperative filesystem-access client and pinned helper build. GPL-3.0-or-later; revision `335d8c43f916020205f445b76b66106ee50d2eeb`. Its original repository (github.com/blackbearreloaded/ProsperoStore) is gone; the same history is kept at [JVK3R/ProsperoStore](https://github.com/JVK3R/ProsperoStore). |
| PacBrew archive ports | Same hash-pinned v0.40.2 distribution: libarchive 3.7.4 (BSD), liblzma 5.4.6 (primarily public domain), bzip2 (bzip2 license), plus zlib/zstd/OpenSSL. Exact notice sources and hashes are in `licenses/archives-SOURCES.json`. |
| PacBrew networking ports | Optional SHA-256-pinned v0.40.2 archive: curl 8.18.0 (curl license), OpenSSL 3.5.2 (Apache-2.0), zlib, zstd and libpsl; individual notices and source links follow the pinned ProsperoStore `third_party/PACBREW_LICENSES.json`. Native-title `compat.c` and `netdb.c` reuse that pinned reference under GPL-3.0-or-later. |
| Mozilla CA certificates | The root store curl publishes as `cacert-<date>.pem` (MPL-2.0), SHA-256-pinned (`caBundle` in the lock file; `tools/ca_bundle.py` pins the newest dated copy and checks it). Networking apps ship it as `certs/cacert.pem`; at start the console merges it with its own store, which old firmwares let fall behind. Builds copy `licenses/MPL-2.0.txt` to `notices/cacert-MPL-2.0.txt`. |
| Lapy helper | Optional exact-title one-shot helper: mpereiraesaa/PS5-Lapy-JB-Daemon `54a095c0f19161825e845daa760a03b446e654fa`, MIT; protocol LGPL-2.1-or-later, ps5log GPL-3.0-or-later. The helper uses the app SDK v0.42 with `patches/lapy-sdk-042-attributes.patch`; source revision and ps5log hash are pinned in the lock file. |
| ps5-opengl | SDK 1.0.0; GPL and per-component/Mesa licenses. The release includes sources and notices. Its original repository (github.com/blackbearreloaded/ps5-opengl) is gone, but the intact v1.0.0 release archive survives on the mirror at [JVK3R/ps5-opengl](https://github.com/JVK3R/ps5-opengl/releases/tag/v1.0.0), whose bytes match the pinned hashes bit for bit; the lock file pins its URL, SHA-256 and `manifest.sha256`, and the build downloads the archive itself, checks it against the archive hash, and then checks every file of the extracted SDK against the manifest it carries. An archive rebuilt from the SDK sources remains usable through `--opengl-archive`; it is then verified by the manifest alone. |
| React / QuickJS-ng | React 18.3.1, reconciler 0.29.2, QuickJS-ng 0.15.0; MIT. npm lockfile and QuickJS commit are pinned. |
| Tailwind CSS palette and scales | v3.4.17 default colors and theme values copied into `tools/tailwind/`; MIT. Build-time data only; the `tailwindcss` package is not installed or used. |
| stb_image | v2.30 single-file JPEG/PNG decoder for remote images; public domain or MIT (choice). Fetched from a pinned commit URL and verified by SHA-256 (`stbImage` in the lock file); builds copy its license to `notices/stb_image-LICENSE`. |
| HarfBuzz | 14.6.0 (Old MIT license), SHA-256-pinned release archive (`harfbuzz` in the lock file). Linked into both hosts for runtime text: OpenType shaping and outline rasterization (`HB_TINY`, `hb-raster`); also built as the host-side font subsetter `tools/font_subset.cpp`. Builds copy `COPYING` to `notices/harfbuzz-COPYING`. |
| SheenBidi | 3.0.0 (Apache-2.0), SHA-256-pinned release archive (`sheenBidi`): the Unicode bidirectional algorithm for right-to-left text, compiled as one translation unit into both hosts. Builds copy its license to `notices/SheenBidi-LICENSE`. |
| Noto fonts | Noto Sans SC, TC and JP 2.004, Devanagari 2.007, Bengali 3.011 and Arabic 2.013 (SIL OFL 1.1), pinned by commit and SHA-256 (`notoFonts`). Packaged only for the scripts an app lists in `textFonts`, subset by `tools/text_fonts.py`; builds then copy `licenses/Noto-fonts-LICENSE.txt` to `notices/`. |
| Material Design sound resources | The starter's interface sounds, (c) Google, CC BY 4.0: six files from the pack's `wav` set, mixed to mono, trimmed, faded and normalized by `tools/ui_sounds.mjs`. Attribution and changes: `licenses/material-sounds-NOTICE.txt`; builds copy it to `notices/material-sounds-NOTICE.txt`. Keep it with any app that ships these sounds. |
| UnRAR | RarLab unrarsrc 7.2.1, SHA-256-pinned (`unrarSource`), patched by `patches/unrar-worker.patch`. UnRAR license (free to use for extracting RAR archives; not GPL-compatible). Linked only into `rar-extract` (`native/rar_worker`, MIT), a separate program the engine starts for RAR sets (the payload loader on the console, a child process on the desktop); never linked into the engine. `rar-extract` also links the archive ports' libarchive and its libraries, for 7z archives over the engine's heap budget. Builds copy its license to `notices/unRAR-license.txt`. |
| FFmpeg | 7.1.5, SHA-256-pinned release archive (`ffmpeg` in the lock file), built static by `tools/ffmpeg.py` with the same components for both hosts: libavformat, libavcodec, libavutil, libswresample and libswscale, configured `--enable-version3` without GPL parts, so LGPL-3.0-or-later. Linked only into apps with `"video": true`; the PS5 build uses the pinned OpenSSL for https. Builds copy `LICENSE.md` and `COPYING.LGPLv3` to `notices/`. The build's corresponding source is the pinned archive plus that configure line. |
| ArtCNN C4F16 | The mpv user shader `GLSL/ArtCNN_C4F16.glsl` of [ArtCNN](https://github.com/Artoriuz/ArtCNN) at commit `8789539dfae120f2877a89bb6218026d56809612`, unchanged, embedded by `native/shared/upscalers/ArtCNN_C4F16.glsl.inc` for `<Video upscale>`. MIT; builds copy `licenses/ArtCNN-LICENSE` to `notices/`. |
| Anime4K Upscale CNN x2 | The mpv user shaders `glsl/Upscale/Anime4K_Upscale_CNN_x2_{S,M,L,VL,UL}.glsl` of [Anime4K](https://github.com/bloc97/Anime4K) at commit `7684e9586f8dcc738af08a1cdceb024cc184f426`, unchanged, embedded by `native/shared/upscalers/` for `<Video upscale>`. MIT; builds copy `licenses/Anime4K-LICENSE` to `notices/`. |
| PS5 video decoder interface | `native/ps5/video_decoder.cpp` is new GPL-3.0-or-later code against the `libSceVideodec2` interface as ProsperoLight and EVO Player (both GPL-3.0) established it; no Sony code or headers. The import stub is generated from function names at build time. Builds copy `licenses/video-decoder-NOTICE.txt` to `notices/`. |
| HDMI audio passthrough | `native/shared/iec61937.hpp` is ported from [SlopFin](https://github.com/BeLikeBrett/SlopFin)'s `src/iec61937.hpp` at commit `6e22b23e7ececf1af24cb2850536411f91ebb9d6` (Copyright (C) 2026 Brett, GPL-3.0-or-later), an independent implementation of the IEC 61937 layout FFmpeg's spdif muxer writes; `native/ps5/bitstream_output.cpp` is new GPL-3.0-or-later code following SlopFin's findings on the `sceAudioOutEx` output calls and modes. No Sony code or headers. Video apps' builds copy `licenses/audio-passthrough-NOTICE.txt` to `notices/`. |
| Inter / LLVM / payload SDK | Inter: SIL OFL. LLVM: Apache-2.0 with exceptions. The public SDK contains separately licensed components. |

Sources: [Embedded React](https://github.com/TheMasterCoder007/embedded-react),
[ps5-homebrew-ui](https://gitlab.com/myluxy/overdrive-deps/-/tree/ps5-homebrew-ui),
[ps5-opengl 1.0.0](https://github.com/JVK3R/ps5-opengl),
[PS5 Payload SDK](https://github.com/ps5-payload-dev/sdk),
[QuickJS-ng](https://github.com/quickjs-ng/quickjs),
[stb](https://github.com/nothings/stb),
[HarfBuzz](https://github.com/harfbuzz/harfbuzz),
[SheenBidi](https://github.com/Tehreer/SheenBidi),
[Noto CJK](https://github.com/notofonts/noto-cjk),
[Noto fonts](https://github.com/notofonts/notofonts.github.io),
[Material Design sound resources](https://m2.material.io/design/sound/sound-resources.html)
(mirrored at [archive.org](https://archive.org/details/material-design-sound-resources)),
[Tailwind CSS v3.4.17](https://github.com/tailwindlabs/tailwindcss/tree/v3.4.17),
[FFmpeg 7.1.5](https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz),
[ProsperoLight](https://github.com/blackbearreloaded/ProsperoLight),
[EVO Player](https://github.com/sainsaji/EVO-PLAYER-PS5),
[SlopFin](https://github.com/BeLikeBrett/SlopFin).

Exact revisions, archive hashes, and compiler-rt package identity are recorded
in `dependencies.lock.json`; each local build also creates a receipt.

`patches/` holds modifications applied to pinned dependencies after checkout;
each patch states what it changes, and the build rejects any other local change.
`embeddedReact-flex-wrap-auto-height.patch` modifies Apache-2.0 engine files and
has been proposed upstream; drop it once the pinned revision contains the fix.
`embeddedReact-scroll-offset.patch` and `embeddedReact-scroll-to.patch`
(Apache-2.0 engine and bridge files) expose ScrollView offsets to JavaScript as
`NativeUI.scrollTo` for focus scrolling, and warn when the node pool is full.
`embeddedReact-view-gradient.patch` (Apache-2.0 engine and bridge files) adds
the `backgroundGradient` View style with dithered, damage-clipped rasterization.
`embeddedReact-scroll-copy.patch` (Apache-2.0 engine, software backend and test
files; not yet proposed upstream) scrolls a ScrollView by moving its painted
pixels through a new backend `move_rect` and repainting the exposed strip.
`embeddedReact-damage-split.patch` (not yet proposed upstream) keeps a scroll
strip and a card apart in the damage set, and
`embeddedReact-scroll-copy-paint-free.patch` (proposed with the scroll copy)
stops a container that paints nothing from forcing a scrolled viewport to
repaint; both modify Apache-2.0 engine and test files.
`embeddedReact-software-avx2.patch` (Apache-2.0 software backend; not yet
proposed upstream) blends eight pixels per step on AVX2 targets, bit-identical
to the scalar loops.
`embeddedReact-image-unload.patch` (Apache-2.0 engine files; not yet proposed
upstream) adds `er_image_unload` and `er_image_load_argb` with a caller-known
opacity, so an image cache can give registry slots back.
`embeddedReact-aspect-main-size.patch` (Apache-2.0 layout engine; not yet
proposed upstream) derives a flow child's main size from a definite cross size
and `aspectRatio`, as CSS and React Native do.
`embeddedReact-translate-subtree.patch` (Apache-2.0 engine and test files; not
yet proposed upstream) moves a node translated without scale or rotation
together with its descendants, which kept painting at their layout boxes.
`embeddedReact-occluded-translate.patch` (Apache-2.0 engine and test files; not
yet proposed upstream) keeps a translated node's paint record translated while
an opaque node above covers it, so its next move erases what it painted.
`embeddedReact-text-wrap-height.patch` (Apache-2.0 layout, text renderer and
test files; not yet proposed upstream) makes an auto-height Text as tall as the
lines it wraps into, capped by `numberOfLines`, including in flexed rows.
`embeddedReact-image-radius.patch` (Apache-2.0 engine and test files; not yet
proposed upstream) clips an `Image` to its `borderRadius`.
`embeddedReact-bold-wrap.patch` (Apache-2.0 text, layout and test files; not
yet proposed upstream) breaks bold text at the width it is drawn with.
`embeddedReact-paint-free-move.patch` (Apache-2.0 engine and test files; not
yet proposed upstream) stops a container that paints nothing from damaging its
whole box when it only moves or resizes.
`embeddedReact-border-sweep.patch` (Apache-2.0 engine, bridge and test files;
not yet proposed upstream) adds the `borderSweep*` View styles, a light
travelling around a rounded border, with a native-driver phase.
`embeddedReact-border-gradient.patch` (Apache-2.0 engine, bridge and test
files; not yet proposed upstream) adds `borderGradient`, a conic gradient seen
through the border ring, with a native-driver `borderGradientAngle`.
`embeddedReact-border-radial.patch` (Apache-2.0 engine and bridge files; not
yet proposed upstream) adds `borderGradient` `type: 'radial'`, a moving radial
gradient seen through the border ring (the web's shine border).
`platform-heap-size.patch` (GPL-3.0-or-later `src/runtime/app_heap.c`) sizes the
process heap from the title's free flexible memory (1 GiB down to 128 MiB, the
first that leaves 96 MiB outside it and maps) instead of a fixed 128 MiB, and
adds `hui_heap_capacity()` to report the size obtained.
`embeddedReact-european-glyphs.patch` (Apache-2.0 font baker and test; not yet
proposed upstream) adds the `latin-ext`, `cyrillic` and `european` glyph sets.
`embeddedReact-text-shaper.patch` (Apache-2.0 text renderer and compositor; not
yet proposed upstream) lets a host shaper lay out and draw the text the baked
fonts cannot, and keeps node text from ending in half a UTF-8 sequence.
`embeddedReact-text-direction.patch` (Apache-2.0 engine, layout, bridge and
type files; not yet proposed upstream) adds the inherited `direction` style with
right-to-left flex layout, Text `writingDirection`, and `start`/`end` text
alignment.
`embeddedReact-text-clip.patch` (Apache-2.0 engine and bridge files; not yet
proposed upstream) adds `er_utf8_clip()` and clips Text, TextInput and span
strings at a character boundary rather than a byte count.
`embeddedReact-host-props-cost.patch` (Apache-2.0 bridge files; not yet
proposed upstream) makes a host element copy only the props it was given and
skips re-flattening a style that is already a plain object.
Patches apply in the order the lock lists them, and may add files.

`tools/bundle.mjs` adapts upstream Apache-2.0 tooling and preserves its notice.
This file is not covered by the framework's additional attribution term.
`tools/tailwind/colors.mjs` reproduces the Tailwind CSS palette unchanged under
its MIT notice in `licenses/tailwindcss-LICENSE`.
The Inter font and bundled third-party license texts retain their own terms.

`LICENSE`, `LICENSE-ATTRIBUTION`, `NOTICE`, `licenses/`, and generated
`dist/<TITLE_ID>/notices/` preserve credits and licensing information.

## Initial public release

Version 0.1.0 is a **source release**. It does not distribute prebuilt PS5
executables or SDK libraries. The source archive and pinned build instructions
are available from the repository and GitHub release.

Before redistributing compiled applications, assemble the complete corresponding
source and required notices for all linked GPL components, plus notices for
LLVM and other statically linked libraries. The application's generated notices
are useful build output, not a substitute for this source-distribution step.

The Lapy SDK compatibility patch should be proposed upstream once hardware
qualification confirms this integration. It preserves all 32 attribute bytes
required by the current SDK. No upstream contribution has been submitted.

## Optional networking ports

`tools/network_ports.py` selectively extracts the pinned networking archive
without replacing the payload SDK. Network-enabled builds copy verified
component license texts and source metadata to `notices/networking/`, plus the
compatibility reference license. Build receipts record the archive and selected
static library hashes. Preserve these notices and provide corresponding source
for linked GPL components when distributing binaries; an archive of libraries
and license texts alone does not satisfy source-distribution requirements.
