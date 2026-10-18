# Changelog

## Unreleased — PS5 packages install

- The package installer payload takes a PS5 package (`\x7F` `FIH`) as well as a PS4 one
  (`\x7F` `CNT`). A PS5 header has no content ID field, so it goes to the install service with none
  and the service's answer names it; before, the payload answered "The file is not a PKG." and the
  console was never asked. When the service answers no ID, the payload says `started (unknown)` and
  `ok` once the service has taken the package, since there is nothing to follow it by.

## Unreleased — app.log keeps five sessions

- app.log holds up to five sessions, each opened by a `[PS5-REACT] session <local date and time>`
  line; the sixth start moves it to app.prev.log (the five before) and opens a new one. A file over
  10 MiB moves aside whatever its count, and one session stops logging at 8 MiB (was 16), so the two
  files stay under about 20 MiB. Before, every start replaced app.log and kept one session aside.

## Unreleased — resumable download progress

- Download task snapshots expose `completedBytes` independently of the live `written`
  counter, so the app can show progress based on completed ranges across pause/resume.

## Unreleased — Vikingfile names with spaces

- Vikingfile mode reads a file name that keeps its spaces as they are in the page's JSON (or as
  ` `): a space where the expected name has one continues the link, handed out as `%20`, where
  before it ended the link and no name with a space could ever match. A literal `+` reads as a space
  too, `%2B` stays a plus. A space anywhere else still ends a link. When nothing is found, the error
  counts the "near misses", links that began with the name and broke off from it.

## Unreleased — PS5 packages by their header

- `Archives.inspect` reports `pkg` for a PS5 package (`\x7F` `FIH`) as it does for a PS4 one
  (`\x7F` `CNT`), so a download of unknown format is routed to the package installer.

## Unreleased — desktop preview on Linux, with a mouse

- The desktop preview builds and runs on Linux: `sysinfo`, `/proc/self/mounts` and `xdg-open` stand
  in for the Mach, BSD and Launch Services calls, FFmpeg and `rar-extract` take TLS and SHA-256 from
  the system OpenSSL, and the JS stack guard is 4 MiB there. macOS keeps SecureTransport and
  VideoToolbox; the PS5 build is unchanged. Build with `CC=clang CXX=clang++`: GCC rejects a
  bounds warning in `archive_preflight.cpp`.
- A mouse drives the preview as a developer's pointer: a left click focuses the smallest navigable
  element under it and confirms, a right click is `back`, and the wheel is `up`/`down`.
  `ps5_drive.py click <x> <y>` does the same in the snapshot's logical pixels. The click goes
  through `globalThis.__ps5ReactHit(nx, ny)`, a hit-test over the focus manager's nodes that takes
  the point as fractions of the screen; the desktop host maps the window point through the frame's
  letterbox first.
- None of this reaches the console. The Linux stand-ins, the mouse handling and the `click` command
  live in `native/desktop/` and `tools/`, which the PS5 build never compiles; `ffmpeg.ps5()` and the
  PS5 `rar-extract` link line are untouched. The one shared file is the JS bundle: `__ps5ReactHit` is
  defined only when the host sets `globalThis.__ps5ReactPointer` before the bundle loads, which the
  desktop host does and the PS5 host does not, so on the console the hook is never created and
  nothing calls it. Its source text (about 600 bytes of the 2.4 MB bundle) still ships, as the
  existing `__ps5ReactInspect` and `__ps5ReactFocus` dev hooks do; stripping it would need a
  target-aware bundle step, a change to the PS5 build path this entry deliberately avoids.
  

## Unreleased — far focus scrolls skip ahead

- A focus reveal more than two viewports away (Circle back to the top of a long page) jumps to one
  viewport short of its target, then eases the rest. Easing the whole way ran at a catch-up speed
  that rasterized screens of rows per frame and stuttered.
- A VirtualList re-basing its rows shifts only offsets at or below its top: a view or a scroll target
  on the content above the list (a jump back to a page's top) keeps its offset instead of being
  carried back down into the list.

## Unreleased — Buzzheavier's file server

- Anchor mode accepts Buzzheavier's file server, `<server>.buzzheavier.com/d/<id>?v=<signed token>`,
  which its Download button's `hx-redirect` answer names and which carries no file name (observed
  2026-10-17; the file's name comes in its Content-Disposition). Its pages stay on the bare domain.

## Unreleased — links up to 2047 bytes

- A captured link may be up to 2047 bytes (was 543, Orbit Store's limit): FileKeeper hands its file
  out through Datanodes' `tunnel<n>.dlproxy.uk` gateway as `/download/<598-character token>?sig=...`,
  about 675 bytes, which the scan cut short and so never returned. `rejected` links follow.

## Unreleased — a vault's Vikingfile page, and a PKG's own title id

- Page mode: `prefix: 'https://vikingfile.com/f/'` with the suffix `/` returns the Vikingfile file
  page, `/f/<10-character id>`, that a LinkVault vault opens. The app reads that page's public
  metadata and captures the file it names next, so a vault's Vikingfile download is bound to its
  exact filename and size, as a direct Vikingfile source's is.
- `Archives.inspect` also returns `title`: for a PKG, the title id its content id names (the
  header's `UP0001-CUSA01234_00-...` at 0x40), so the app can tell another game's file early.

## Unreleased — only links that appear after the capture starts

- The browser's network process keeps the addresses of files it fetched earlier in memory it never
  clears, and a capture took one of them, another game's file, the moment it started. A capture now
  first fingerprints every link already in memory that names no game, before the app opens the page
  (the task stays `queued` until that pass ends and logs what it found), and only a new such link is
  taken after it. A link bound to the game, by its title id or Vikingfile's expected filename, is
  accepted however old. `resume: true` restarts after a refused link with those fingerprints.

## Unreleased — 1fichier and Datanodes routes, and no stop on a host's own page

- Anchor mode accepts the generated routes that carry no file name, adapted from Orbit Store
  1.3.5's `backend/providers.c`: 1fichier's `a-<n>.1fichier.com/<token>` and Datanodes'
  `tunnel<n>.dlproxy.uk/<8>/<name>?sig=<signature>` gateway.
- A host's own page is never taken for its file, even when it names the archive: LinkVault,
  MediaFire's `www` page, an AkiraBox path outside `/download/`, Vikingfile's `/f/` and the
  `/<12-character id>` pages of Datanodes, Filekeeper and Datavaults. A LinkVault vault lists
  those pages, so the capture used to stop on one before the player picked a mirror.
- `BrowserCapture.capture` takes `rejected`, up to six links the app already probed and refused;
  the payload scans past them, so a wrong candidate no longer ends the session (Orbit Store 1.3.5
  keeps six). The deadline may be up to 300 seconds and the read budget is 3 GiB, enough for a
  LinkVault page's own check and mirror before the host's.

## Unreleased — one capture for every browser-only provider

- Browser capture also takes the file link from the browser for the hosts whose check only the
  console browser passes (LinkVault's mirror pages, Akirabox, Datanodes, Filekeeper), not just
  Vikingfile: `prefix: 'https://'` with the game's title id as the suffix returns the file link that
  carries that id in its own name, or, on a host known to serve files, one that names its archive
  freely. The payload's name check reads the last path segment only, so an advertisement that hides
  the real address in its query is not the file, and the app's one-byte range probe still decides
  whether the captured URL is the game's own file.

## Unreleased — Vikingfile capture without the Download button

- Browser capture finds the verified Vikingfile link as the page holds it once the verification
  passes, a JSON string with escaped slashes, so the user no longer selects Download and the
  advertisements around it. The scanner reads at about 8 MiB/s with a 1 GiB session budget, so it
  keeps looking through a slow verification; both changes follow Orbit Store 1.3.5.

## Unreleased — download speed limit

- Add `Downloads.setRateLimit(bytesPerSecond)` (native ABI v17, `network.setRateLimit`): every file
  download shares the cap, and a new value applies at once, to running downloads too. A capped
  download opens about one connection per MB/s and resumes its paused connections in turn, so none
  sits long enough to hit the 30-second low-speed cutoff. `unlimited: true` exempts a download.

## Unreleased — comparing upscalers

- `<Video compare={{upscale, split}}>` (native ABI v15, `video.setCompare`): right of `split` (0 to 1
  across the picture) the picture goes through a second model, or none, so two upscalers show side
  by side on the same frame. The second model runs whole in the display frame its picture first
  shows in, on top of the element's own: a heavy pair drops frames while playing, a paused picture
  costs one run per model.

- A model picked while the video was paused never ran: an upscaler started only on a new picture,
  so the paused one went on showing as it came. A model picked over a paused picture now runs on it
  once.

## Unreleased — focus returns through stacked pages

- Add `useFocusActions()`: `focus`, `blur` and `focusedRect` without subscribing to focus changes.
  A component that called `useFocus()` only to move focus re-rendered, with everything under it, on
  every D-pad move.

- A page that had another opened over it (a detail page under a player) forgot where it was
  opened from once that one closed: focus coming back overwrote the page's return target with the
  closed layer, so closing the page too sent focus to whatever lay nearest, often a tab. Focus that
  goes back to where a closed layer was opened from now leaves the return targets of the scopes it
  lands in alone.

## Unreleased — local time

- Add `DeviceInfo.utcOffset(time)` (native ABI v14, `device.utcOffset`): the system time zone's
  offset from UTC in minutes at an instant, from `localtime_r` in the shared host. The runtime has
  no `Date` objects, so apps had no way to show a local clock short of hard-coding a zone. The
  PS5's libc gives the console's zone in the calendar fields but leaves `tm_gmtoff` 0, so the
  offset is the fields less the instant.

## Unreleased — HDMI audio passthrough

- `<Video audioOutput>`: `'pcm'` (the default, as before) decodes the track; `'auto'` sends AC-3,
  E-AC-3 and DTS (the core) at 48 kHz to the TV or receiver undecoded when its EDID lists the codec;
  `'passthrough'` does so whatever the EDID says. Frames are packed as IEC 61937 bursts (ported from
  SlopFin, checked byte for byte against FFmpeg's spdif muxer) and sent on the HDMI output the
  console's disc player uses. The bursts are the clock, so pause, seek and buffering work as with
  decoded audio; `volume` has no effect on a bitstream, `muted` sends silence. The status has
  `audioPassthrough`. TrueHD and multichannel PCM output are not supported: decoded audio stays stereo.
- `AudioOutput.capabilities()` (native ABI v13): the connected sink's audio formats from its EDID, the
  codecs it can be passed, and its most PCM channels, for an app to decide what to ask a media
  server for. The desktop preview reports `known: false`.

## Unreleased — light on glass

- Add the View styles `roundedClip` and `mixBlendMode: 'plus-lighter'`
  (`patches/embeddedReact-rounded-clip-blend.patch`). `roundedClip: true` clips children to the
  view's rounded border box, anti-aliased like a rounded background of that box; `overflow:
  'hidden'` alone is unchanged. `plus-lighter` adds a subtree's drawing to what is beneath it,
  through the new optional backend `add_rect`, which the software backend implements and the
  damage tracker wraps. Neither has a Tailwind class; `mix-blend-*` now names the style in its
  error. Desktop tests only; not yet run on a PS5.

## Unreleased — rows and the touchpad

- `FocusScope row`: Left and Right stop at a row's ends instead of stepping into the rows around it
  (a `blocked` move), and a row entered for the first time starts at its `selected` element or its
  first, later at the one it had.
- The touchpad navigates (input protocol v5): hosts report the DualSense's first finger to
  `__ps5ReactTouch`, and the focus runtime steps focus once per stretch of a swipe, locked to the
  axis it started on. Its moves carry `source: 'touchpad'` in navigation events. The PS5 reads the
  touch data beside the pad's sample queue with `scePadReadState`; not yet validated on hardware.
- `useFocus().focusedRect()`: the focused element's rectangle on screen, to place a menu beside it.
- Input scripts and `ps5_drive.py script` take `swipe:DIRECTION:TRAVEL`.

## Unreleased — controller events and trigger effects

- Add `useControllerEvents(handler)` and `Controller.subscribe(listener)`: once per frame, from one
  shared read of the controller state, `press` and `release` (with `heldMs`) for every
  `GamepadState` button, L2/R2 at the host's half-travel press and the touchpad included, and
  `trigger` when L2's or R2's travel changes; `{frames: true}` adds a `frame` event for work that
  steps while something is held. Apps no longer poll `getState()` on a timer to see a release or
  a trigger's depth. `useGamepad` reads on the same per-frame reader instead of a 16 ms timer;
  `intervalMs` now defaults to every frame and, when given, throttles by frame time.
- Add `Controller.setTriggerEffect(trigger, effect)` (native ABI v12, `pad.setTriggerEffect`, which
  replaces `pad.setTriggerResistance`): `off`, `resistance`, `weapon` (resists over part of the
  travel, then gives way) and `vibration`, through the generalized `Pad::set_trigger_effect` of
  `patches/platform-trigger-effect.patch`. `setTriggerResistance` is now a wrapper for
  `resistance`. The PS5 host logs each mode's first `scePadSetTriggerEffect` result. The PS5 host
  builds; neither the new modes nor the events have been run on a PS5 yet.
- The desktop preview puts every key's button into `Controller.getState()`, not only the first
  six: Z and C hold L2 and R2 at full travel, or a light 0.4 with Shift, and fire `l2`/`r2` as the
  travel crosses half, like an analog trigger; P is the touchpad.
- Tools hold buttons and set trigger travel: `ps5_drive.py hold BUTTON [ms]`, `release BUTTON` and
  `trigger l2|r2 VALUE [ms]`, and the input-script steps `hold:`, `release:` and `trigger:` on both
  hosts. A held button with an action dispatches it as it goes down.

## Unreleased — Options for apps

- Options reaches every app as the `options` action, as upstream now delivers it (O and a
  controller's Start on the desktop); the PS button leaves, Escape on the desktop. The
  `"optionsButton"` app.json setting this fork added for the same is gone: an app that sets it
  builds as before, and the key is ignored.

## Unreleased — resolution auto

- The starter, and so every `npm run create` scaffold, uses `"resolution": "auto"` at 60 Hz. It
  rendered at 2560×1440 into a 1920×1080 surface, which the presenter scaled down 0.75× and a 4K
  TV upscaled again, softening text. Its pinned font sizes fit only the 2560-wide layout, so the
  bundler now picks them per layout.
- `"resolution": "auto"` in `app.json` builds an app at 1920×1080 and 3840×2160, and the title picks
  the layout matching the console's video output at launch (4K and 1440p get 3840×2160). The output
  mode comes from `sceVideoOutGetCurrentOutputMode_` on the main AvSetting bus. Generated bundles and
  assets moved to `.build/<app>/generated/<width>x<height>/`, and `--resolution 1080p` previews the
  small layout.

## Unreleased — runtime refresh rate

- Add `Display.refreshRate()` and `Display.setRefreshRate(hz)` (native ABI v11): an app switches
  between 60 and 120 Hz while it runs, among the rates app.json `"refreshRates"` lists. The PS5 host
  reopens the display at the new rate between frames and rebuilds the presenter; app state is kept,
  the TV resyncs. The desktop preview rebuilds its presenter and keeps the monitor's rate. Not yet
  validated on a PS5.

## Unreleased — fixes

- The glyph cache unlinked its oldest glyph from the wrong end of its recently-used list, so
  evicting it once the cache was full left the freed glyph listed as the oldest.
- `<Video resizeMode="contain">` left its letterbox bars undrawn, so layers under the element (a
  page's backdrop) showed through them on screen. The presenter now paints the bars black. `shot:`
  screenshots already composited them black, which hid it.

## Unreleased — video upscalers

- `<Video upscale>` doubles a picture shown bigger than its source with a network for animation
  before it is scaled to its box: `'artcnn'` (ArtCNN C4F16, the luma) or `'anime4k-s'`, `-m`, `-l`,
  `-vl`, `-ul` (Anime4K Upscale CNN x2). Their mpv user shaders are embedded unchanged and run as
  GL compute passes, split over two display frames; needs compute shaders (the PS5).
- 10-bit pictures from the PS5 decoder are read as low-aligned samples: HEVC Main 10
  showed green.

## Unreleased — less CPU per frame

- The presenter keeps the framebuffer in a GPU texture: moved rects are blitted there, damaged
  rows are uploaded in merged bands through small buffer textures, and one draw composites the
  layers and the framebuffer on screen. On the PS5 the render thread's present went from 3.3 to
  0.9 ms of CPU per frame and the process from 0.90 to 0.75 cores on a tour of a media browser
  app, at 59 fps. Desktop snapshots are unchanged; PS5 readbacks match the software
  screenshots within 1/255.
- Hosts neither draw nor swap a frame that changed nothing, and sleep to the next vertical sync.
- Patch Embedded React (`patches/embeddedReact-slice-by-area.patch`) so a repaint forks across
  workers once per commit, in bands of about equal damaged area (at least 128 Ki pixels each),
  instead of once per damage rect across every worker, and wakes only the workers with a band:
  the same tour went from 0.75 to 0.66 cores with as many slow frames.
- Patch Embedded React (`patches/embeddedReact-layer-radius.patch`) so a rounded `<Image layer>`
  at full opacity is drawn by the host too, except a square of its radius at each rounded corner,
  and an image scrolled out of view no longer takes a layer slot from one in view. Making the
  cards of a media browser app layers saved no CPU on the PS5: their repaints are mostly other
  content drawn over and under the image.
- The frame-time log reports `cpu=` cores and the render thread's CPU ms per frame
  (docs/ANIMATION.md).

## Unreleased — cheaper mounts

- `motion` elements run two effects each instead of six and add a context provider only
  when they pass new variant labels down. Their animations now start in a microtask after the
  commit, still before the frame paints, instead of in a passive effect each. Mounting a
  `motion.View` costs about a fifth less JavaScript.
- Patch Embedded React's QuickJS bridge (`patches/embeddedReact-host-props-cost.patch`) so a host
  element copies only the props it was given and a plain style object is not re-flattened.
- The frame-time log splits `present` into `upload` and `draw` and reports the kilobytes uploaded
  per frame (docs/ANIMATION.md).
## Unreleased — render thread freed during downloads, RAR sets checked before decoding

- `Archives.inspect` reads a RAR's first file header, then walks the next ones for about 100 ms
  (plus the header under way), instead of up to 4096 of them. Each header sits after the previous
  file's data, so on a large volume each is a disk read of its own: on a tester's console, inspecting
  a game archive while it downloaded at ~105 MB/s held the render thread for over 40 s. A header the
  walk misses is still refused before anything is extracted: by the preflight, or in a set extracted
  while it downloads (also checked with `inspect`), by the RAR worker.
- `FileSystem.removeAsync(path)` removes a file, or a directory and everything in it, on a worker
  thread and returns a promise: a path already gone resolves, a failure rejects with the path and the
  system error. On a tester's console, `fs.remove` of a large download held the screen for 5 s.
- rar-extract reads the end block of a set's last volume and the header of its first before decoding,
  headers decrypted with the set's password. A whole last volume that says more follow (or, in RAR5, has
  no end) fails at once with `Incomplete RAR archive or missing volume.`, a first one that is not the first with
  `Missing first RAR volume.`, both without the volume suffix. A set lacking its last volume decoded
  every other one first: hours on the console. While a set downloads, its first volume is checked at
  once and its last as soon as it arrives. Headers that cannot be read (no password, a wrong one)
  leave the reason to the extraction, as before. A last volume cut short (a download stopped early) fails
  as before, now always named: `... Volume 4 of 4 looks incomplete.`

## Unreleased — extracted file permissions

- Archives extracted in the app (ZIP, 7z, TAR, and RAR when rar-extract cannot start) write folders
  0777 and files 0666, and every extraction root is 0777, whatever the app's umask. They were 0700
  and 0600: a game extracted that way and installed by ShadowMount froze the console at launch until
  its tree was set to 0777 by hand. rar-extract already wrote its files open.

## Unreleased — verified sandbox roots

- After filesystem elevation, find /app0, /download0 and /temp0 from a descriptor opened on each
  before the root change (the helper replaces only the root and jail), checked by device and inode,
  else by that identity among the title's /mnt/sandbox/<TITLE>_NNN folders, instead of assuming
  _000. A console with a ShadowMount image install found no app files at _000: no locale files,
  runtime fonts or payloads. Without an identity the app root is the newest candidate holding
  eboot.bin, ShadowMount's /system_ex/app/<TITLE> included; each rejected candidate is logged.
- app.log keeps the lines logged before it opens, so it shows how filesystem access chose its roots.

## Unreleased — download tail splitting

- Once every range of a download has a connection, idle connections split the range with the most
  bytes left and fetch its second half, down to 1 MiB parts. Files with fewer ranges than allowed
  connections (under 1 GiB at 16 MiB ranges) now use every connection, and a slow connection or the
  last ranges no longer hold the end of a download: a 432 MiB file from a 1.4 MB/s-per-connection
  origin went from 14.3 s to 8.4 s on a localhost benchmark. The stats line counts `splits`.
- An origin's connection window grows while nine-tenths of it is busy, not only when it is full: a
  console download held 25 of 27 connections for most of a 1.27 GB file and never grew.

## Unreleased — RAR extraction threads

- rar-extract decodes with 6 threads when no download runs and 4 while one does (or while the set
  itself still downloads), instead of 4 always; it never takes more than the cores but one. Its
  `throughput` trace line adds the threads, cores, process CPU time, write and fsync time and the
  decoder's waits, which the worker now reports on a `t` line.

## Unreleased — downloads across rest mode

- A download whose connections die while the title is suspended (rest mode, or another app in
  front) retries the ranges they carried without counting them as a busy server's refusals: they
  no longer halve the origin's connection window, which then only grew back one connection a
  second for the rest of the job, nor spend the attempts that fail a download. Connection failures
  in the minute after the suspension, while the network comes back, are treated the same way.

## Unreleased — multi-core rendering

- Keep translated framebuffer copies out from under translucent ancestors, use
  clipped coverage for image crossfades, retain images by the displayed scroll
  position, advance screen switches when an outgoing screen is removed, and
  clamp screenshot sampling taps independently at image edges.

- Render each commit's repaint in horizontal slices across up to eight render
  workers, one per available CPU (docs/ARCHITECTURE.md). On a PS5 at 3840×2160
  a scripted tour of a private app spent 2.7 s over the 16.7 ms frame budget,
  against 9.3 s single-core (docs/HARDWARE.md).
- Present the framebuffer through as many buffer-texture slices as the render
  size needs (eight at 2160p), so changed rows avoid `glTexSubImage2D` at 4K.
- Log the worker count at launch and `parallel=` per stats window; set
  `PS5_REACT_RENDER_WORKERS` (desktop) or `dev/render-workers.txt` (PS5 test
  deploy) to pick the count.
- `npm test` now also renders the self-test single-core and fails unless the
  parallel snapshots are byte-identical.
- Force the opacity strip height (128 rows) and transform buffer size (768 px)
  in `native/ps5/CMakeLists.txt`: they were taken from a build directory's
  first configure, and per-worker strips at 768 rows shrank the PS5 heap to
  192 MiB.
- Two Embedded React patches, maintained here and not proposed upstream, render
  vector paths from workers under a lock and look up a worker's context once
  per call.
- Keep the source of a scaling or rotating view across frames, shared by every
  worker (`ERUI_XFORM_CACHE_SLOTS`, two on the PS5), so a focus scale no longer
  re-renders the card's subtree each frame.
- Both hosts defer the paint of commits made during input and JavaScript to the
  frame's own commit, so a region that React and an animation change in the same
  frame is painted once. Layout and `onLayout` still run at each React commit.
  The two changes cut a PS5 tour's time over budget from 1.4 s to 0.66 s
  (docs/HARDWARE.md).
- Raise the PS5 node pool (`ERUI_MAX_NODES`) and bridge handles from 2048 to
  4096, so an app can keep a screen mounted while hidden. The heap still lands
  at 256 MiB, and the per-commit pool walks stay at 0.1–0.3 ms.
- Add `ReleaseImages`: the remote images under it stop holding their cache
  entries while `when` is true, except those on screen at that moment, and are
  taken again without re-rendering when it turns false (docs/IMAGES.md).
- Remote images decode on four threads within the same 40 MB decode-memory
  bound, so a screen of cached images appears 3–4 times sooner on the desktop
  preview. Decode errors no longer include stb_image's reason.
- Deliver finished image loads under a per-frame budget of about 4 ms of
  `<Image>` re-renders, at least one a frame: dozens finishing together on a
  page mount re-rendered in one frame, 50–70 ms of React work on the PS5
  (docs/IMAGES.md).
- Fix scaled images and gradients wider than `ERUI_MAX_IMG_ROW_PIXELS` (2560 on
  the PS5) being cut off at that width: a full-width 4K cover image lost its
  right third. Rows are now rendered in chunks, and a gradient's colours no
  longer shift by one step with the clip window. Drawing the whole image makes
  full-screen crossfades at 3840×2160 cost about 30 ms of raster per frame.
- Add `<Image layer>`: when the image qualifies (opaque, untinted, square,
  `cover` or `stretch`, no scale or rotation, and for a translucent one an opaque
  layer directly beneath), both hosts draw it as a GPU texture under the
  framebuffer, and fading it repaints nothing (docs/IMAGES.md). An Embedded React
  patch, maintained here and not proposed upstream, adds the layer list and a
  backend clear, and makes the software backend's blends keep destination alpha,
  bit-identical over opaque pixels. Set `PS5_REACT_LAYERS=0` (desktop) or
  `dev/layers.txt` to 0 (PS5 test deploy) to rasterize every image. On the desktop
  preview, single-core, the frames of a 4K crossfade went from about 130 ms of
  raster each to none; the two that add and drop an image still repaint what is
  drawn over it (about 45 ms there).
- Add `Screens`, `Screen` and `useIsScreenActive`: a leave-then-enter page
  switcher that keeps every page it has shown mounted, hidden, inert and without
  image cache entries, and can preload pages not shown yet (docs/NAVIGATION.md,
  "Tabs that keep their pages").
- A variant label change re-renders only the motion elements that use labels.
  Every motion element under a labelled parent re-rendered before: about 157 of
  them per tab switch in a PS5 app, which took a page switch from 203 ms to 69 ms.
- Move a full-screen opaque page that only an animated translate moves by
  copying its pixels, repainting only what the move uncovers (docs/ANIMATION.md,
  "Page transitions"). An Embedded React patch, maintained here and not proposed
  upstream. A details sheet sliding in at 3840×2160 had every frame at about
  20 ms with 10–12 ms of raster; now every frame of the slide fits 16.7 ms.
- Fix nodes that a translate moved wholly off the screen in one frame (a top bar
  scrolled away) repainting their old footprint on every later commit; with a
  focus ring animating, that was 1.4 million pixels a frame. An Embedded React
  patch, maintained here and not proposed upstream.
- `"refreshRate": 120` requests 120 Hz output and sets the `param.json` bits the
  console requires; a display without 120 Hz stays at 60, and the log reports the
  accepted mode after the first frame. The PS5 host counts vblanks at that mode
  and carries the engine clock's sub-millisecond remainder, and focus scrolling
  shows the positions between its 60 Hz steps, so motion keeps its speed.
- Idle garbage collections wait for a still screen (three frames that repainted
  under a fiftieth of it) until three quarters of their room is garbage, and the
  room is at least 8 MiB (docs/ARCHITECTURE.md). On a PS5 burst of detail pages
  and grid scrolling, the previous policy collected automatically inside a
  full-screen frame in both runs (51–58 ms); this one in neither.
- A PS5 test deploy can report every slow frame with a limit in
  `dev/slow-frame-lines.txt`, instead of the first eight per window.
- A JavaScript sampling profiler: `dev/profile.txt` on a PS5 test deploy (the
  interval in microseconds) or `PS5_REACT_PROFILE=<file>` for the preview writes
  folded stacks of where JavaScript time went (docs/ANIMATION.md, "Profiling
  JavaScript"). A QuickJS patch, maintained here and not proposed upstream, lets
  the interrupt handler sample the stack.
- Per-frame callbacks run in one React batch, through an Embedded React patch
  that exports `unstable_batchedUpdates`: each image delivered and each
  VirtualList step rendered on its own before.
- VirtualList spreads a mount across frames while focus is outside it: rows on
  screen fill a row a frame instead of all at once. A PS5 search keystroke that
  remounts a results grid went from a 44 ms frame to 26 ms (docs/LISTS.md).

## Unreleased — browser capture

- Add ABI v7 `BrowserCapture.capture`, a bounded, read-only Vikingfile URL
  matcher running through a loader payload, with cancellation and desktop failure.
  Adapted from Orbit Store 1.0.1; firmware execution still needs hardware validation.

## Unreleased — package installation

- Add `Packages.install` (ABI v5 additive `packages.install/cancel/poll`): a
  `.pkg` installs through the console's install service from a loader payload,
  with the install stage and bytes reported once a second (docs/NATIVE-API.md).
- Resolve image hosts a blocking DNS refuses over DoH, and name each image
  origin's last failure in the stats line.
- Also reroute an image host over DoH when the DNS points it at another server
  (a TLS handshake for the wrong certificate, or an empty reply), and fall back
  from 1.1.1.1 to 8.8.8.8 when the network blocks the first.
- Pin a DoH-resolved image host to the address its first load connected to,
  instead of a DoH query per image: a fresh install's covers appear at once.
- Elevate under ShadowMountPlus 1.7beta4, which mounts /data into the sandbox:
  the elevation client (filesystemHelperClient 335d8c4) no longer mistakes
  that mount for console access, which left the app sandboxed with no image
  cache and froze it in fs.mounts.

## Unreleased — international text

- Add the `latin-ext`, `cyrillic` and `european` baked glyph sets, so runtime
  text in Spanish, French, German, Portuguese, Indonesian, Russian and the other
  European languages renders without listing each letter (docs/TEXT.md).
- Draw Chinese and Japanese text: app.json `textFonts` packages subset Noto Sans
  SC (GB 2312) and JP (JIS X 0208) fonts, which HarfBuzz shapes and rasterizes
  on demand into a 4 MiB glyph cache, loading each font only when text needs
  it. CJK text breaks between characters with basic kinsoku rules.
  `Fonts.setLanguage` (ABI v6) picks Japanese or Chinese Han forms; it defaults
  to the system language.
- Shape Hindi (Devanagari), Bengali, Arabic and Urdu with HarfBuzz and order
  right-to-left text with the Unicode bidi algorithm (SheenBidi 3.0.0); add
  `textFonts` `devanagari`, `bengali` and `arabic`. The inherited `direction`
  style lays rows out right to left, Text takes `writingDirection`, and
  `textAlign` gains `start` (now the default) and `end`, which `text-start` and
  `text-end` compile to.
- Hindi, Bengali, Arabic and Urdu text breaks at spaces: it broke between any
  two letters, like CJK, so a line could end mid-word (`गे|म`). A word wider
  than its line breaks between grapheme clusters and never inside a conjunct,
  and a truncated line keeps whole clusters. `tools/test_text.py` checks the
  layouts of Overdrive's notes in each script against text-lab's fonts.
- Text, TextInput and nested-Text span strings are clipped at their 255- and
  63-byte limits on a character boundary (`er_utf8_clip`): a span could end in
  half a UTF-8 sequence, and a clipped string in a mark without its letter.

## Unreleased — native archive extraction

- Skip optional RAR5 quick-open (`QO`) service indexes and read original headers.
  3D MiniGolf's index carried a different password check, causing a false incorrect
  password error after its files. Every file password, output CRC and header CRC
  remains enforced; incomplete index data still fails. Full-archive streaming on
  macOS verified 128 files (1,331,695,832 decoded bytes), and a worker reproduction
  using the original index extracted the eboot successfully. The corrected build
  still needs PS5 hardware validation.
- Accept an optional archive password, including ordered volumes. Stream-decrypt
  RAR5 AES-256 headers and file data before libarchive decodes them, retaining CRC
  verification, memory limits, safe staging and cancellation. ZIP uses libarchive
  passphrases; RAR5 files without CRC32, keyed RAR5 checksums and encrypted older RAR/7z remain unsupported.
- Verify password-protected RAR5/ZIP extraction, incorrect passwords and encrypted
  RAR5 volumes; a local test extracted the actual 3D MiniGolf eboot with its source
  CRC preserved. Hardware execution is not established by those tests.
- Add cancellable `Archives.extract` with streaming ordered-volume extraction,
  bounded output, safe paths, atomic staging and SHA-256 completion recovery.
- Reuse native task polling and integrity hashing for HTTP and archive workers.
- Link pinned PacBrew archive/compression ports into native PS5 titles; add
  `tools/build_ps5.py --compile-only` for package-free linker validation.

## Unreleased — video

- Add `<Video>` (native ABI v10, docs/VIDEO.md): files and http(s) streams, demuxed by FFmpeg 7.1.5
  (LGPL-3.0-or-later, pinned and built static for both hosts by `tools/ffmpeg.py`), decoded on the
  PS5 by `libSceVideodec2` for H.264, HEVC Main/Main 10 and VP9 up to 3840×2160 and by FFmpeg for
  the rest up to 1080p. The picture is a layer the presenter draws (YUV to RGB, HDR tone-mapped to
  SDR); the audio plays through the sound mixer and is the clock; seeking, pause, volume, looping
  and audio track selection; an audio delay for TVs that show the picture late; text subtitles from
  the file or from separate files, given to the app as text to draw (`onSubtitle`). A stream that
  breaks off is opened again where it stopped once the network is back. Apps opt in with `"video": true`, which also raises the PS5 title's
  flexible memory to 1 GiB and keeps 448 MiB of it outside the heap for the decoders.
- `apps/video-lab`: plays the files in its `media/` folder and URLs, with the player's measurements
  on screen and an unattended playlist mode for console runs.

## Unreleased

- Add `LocalNetwork.broadcast({port, message})` (native ABI v9): a UDP broadcast on the local
  network whose replies come back with their sender's address, for service discovery such as
  Jellyfin's `who is JellyfinServer?` on port 7359 (docs/NATIVE-API.md).

- `VirtualList` takes a `ref` whose `focusIndex(index)` scrolls to and focuses any item, including
  rows that are not mounted yet (docs/LISTS.md). The jump scrolls at once, and focus recovery waits
  for it instead of moving focus out of the list when the focused row unmounts.
- Add `Controller.setTriggerResistance(trigger, strength, from)` (native ABI v8): DualSense
  adaptive trigger resistance from a point of the travel on, in eight strengths, through
  `scePadSetTriggerEffect` (`patches/platform-trigger-effect.patch`). The triggers are released when
  the app quits. The desktop preview logs the request.
- Text with a `lineHeight` taller than its font's is centred in the line, with half the extra space
  above it, as in CSS and React Native. It used to sit at the top: an 18 px label in a 27 px line
  (`text-md`) sat 2.5 px above an icon centred beside it. Text with a `lineHeight` set moves down by
  half the difference.
- Downloads treat a busy server as busy, not as a damaged file. archive.org's storage node answered
  HTTP 500 to some of 16 or 64 concurrent ranges, which failed the whole task as "server changed the
  resource"; now HTTP 5xx/429/408 and broken connections retry the range up to eight times (0.5 to
  30 s apart with jitter, Retry-After honored up to a minute), a 200 that ignores `Range` or a wrong
  span retries three times, and only validators that differ on the probed URL fail as changed. A
  pinned redirect target is resolved again after a range's second 5xx and the new one pinned.
- `adaptive` is now a per-origin AIMD window: it starts at 8, grows by half each second while
  healthy, halves on 5xx/429/408 or a broken connection and then grows by one a second. BATTLESHIP
  (1.25 GB) from archive.org completes in 99 s at 64 connections and 111 s at 16 (both failed
  before; 8 fixed took 246 s). Each failed range logs its status, headers and final URL.
- Remote images load lazily: an element's image reaches the network after 120 ms mounted, and no
  request starts while a ScrollView moves or for 150 ms after (new internal `image.defer`). Holding
  Down through Overdrive's grid for 3 s fetched 45 covers instead of 140 and decoded 69 instead of 167;
  cached art still draws at once.
- Image requests retry connection failures, timeouts and 429/502/503/504 four times, 0.5 to 4 s apart
  (was twice, 0.5 and 1 s), use at most 8 keep-alive connections per origin, and cache hits no longer
  wait for a free connection.
- The decoded image cache holds 64 MiB and 256 images (was 24 MiB, 128); the PS5 host keeps 64 MiB
  with a 256 MiB heap, 40 MiB from 192 MiB and 24 MiB below.
- The PS5 memory log adds `[PS5-REACT] images:` counters (cache, disk and network loads, decode and
  time-to-pixels averages, cancellations, retries, failures, busiest origins); the desktop preview
  prints it too.
- Download checkpoints and completion receipts no longer include URLs: a signed link that expired
  can be resolved again and the partial resumes, as long as the size, hash and validator match.
  Servers without a strong ETag download in parallel ranges and resume too: `Last-Modified` guards
  the ranges, and before a resume without a strong ETag the last 64 KiB kept is re-read from the
  server and compared. HTTP 401/403 on a range now reports "provider denied the file" instead of a
  changed resource.
- `recoverCompleted` no longer reads the whole file to hash it when the request has no `sha256`,
  neither after the download nor when recovering it: the receipt's root, inode, size and request
  identity name the file. A requested hash is still verified both times.
- Add `Archives.inspect(sources)`: the kind of file the leading bytes show (RAR, 7z, ZIP, TAR and
  compressed TAR, PKG, exFAT/UFS2/PFS images) and, for RAR and xz/zstd, a decoder-memory refusal
  from the headers read so far, also on a partial download. `DownloadFormats.detected` routes a
  file by that kind; `tar.bz2`, `tar.xz` and `tar.zst` are archive formats.
- Add `FileSystem.removeTree(path)`: removes a directory with its contents without following
  symbolic links, so an app can delete a finished download's whole folder.
- Up to 128 `<Svg>` nodes can be mounted at once, from 64 (288 KB more .bss). Overdrive with two dozen
  favorites mounted more than 64 icons and its legend glyphs drew nothing.
- The idle collector keeps QuickJS's GC threshold at most 28 MiB, an eighth below the 32 MiB JS heap
  limit. QuickJS sets the threshold to 1.5 times what survived a collection and fails an allocation
  past the limit without collecting, so an app with over 21 MiB live (Overdrive's catalog) threw
  "out of memory" during a burst of input and its React tree stopped responding.
- Remote images on screen load newest first, ahead of every prefetch. An image counted as on screen
  once stayed so while a prefetch held it, so a held key queued hundreds of covers ahead of those
  shown; after 150 rows scrolled, on-screen covers waited 24 s (now 0.15 s on an M4). Images take
  32 connections instead of 12. `image.release(id, prefetch)` names the reference it drops.
- Add `Image.warm(uris)`: fills the disk cache in the background on up to four connections while
  no image waits, skipping cached URLs and files over 512 KiB, without decoding. The disk cache
  grows from 64 to 256 MiB.

- `Downloads.enqueue` takes `mirrors`: other URLs serving the same file. Verified ones share the
  ranges with the primary, and one that fails is dropped; servers that limit each host serve more
  together.

- Add `Image.getColor(uri)`: the art's most prominent vivid colour, computed on the
  decode worker, for accents or the controller light bar.

- Fix a PS5 crash when a download finished: titles have no `link()`, whose import
  bound to null. PS5 publication now always reserves the final name and renames.

- Allow up to 64 download connections (was 16) and a 16 MiB transfer buffer of 128 KiB blocks (was 8 MiB),
  written by two writers that join contiguous blocks into writes of up to 2 MiB:
  origins that throttle each connection, such as archive.org at about 1.4 MB/s,
  scale with connection count.

- PS5 notifications use libkernel's `sceKernelSendNotificationRequest` instead of a
  dlopen'd `sceNotificationSend`.

- Download ranges reuse the probe's final URL instead of repeating the redirect
  for every range, and fall back to the original URL if that target returns a
  client error. Adaptive concurrency starts at up to 8 connections and grows by
  2 per step. Resume checkpoints, which fsync the partial file, run on their own
  thread so a slow sync no longer stalls block writes and pauses every transfer.

- Verify PS5 data and temporary roots with exclusive write/read/remove probes
  after filesystem elevation. Readable but unwritable sandbox mounts now fall
  back to the title-owned `/data/ps5-react/<TITLE_ID>` directory, with explicit
  diagnostics if directory creation or the fallback proof fails.

- Expose effective HTTP URLs and allowlisted lowercase transfer headers; add
  `followRedirects: false` and opt-in `rejectHtml` download protection on both
  hosts. Cookies/authentication response headers stay private. Local transport
  tests cover redirect isolation and HTML rejection; PS5 validation is pending.
- Package explicit `resources` from app.json for on-demand data loading without
  embedding large catalogs in the JavaScript heap. Resource paths reject
  traversal, symlinks and collisions with package infrastructure.

- Refresh the README with an original project logo, complete first-app example,
  application configuration, Tailwind themes, focus/list navigation, animation,
  native API examples and troubleshooting. Document external-app editor setup
  and the font-size configuration needed for automatic baking.

- Add the `borderGradient` View style (`{type: 'conic', width, angle, stops}`)
  and the animatable `borderGradientAngle`: a conic gradient seen only through
  the rounded border ring, the classic rotating-gradient border. Turning it
  runs on the native driver and repaints only the border bands. Engine patch.
  See docs/ANIMATION.md.

- Add the `borderSweepColor`, `borderSweepWidth`, `borderSweepLength` and
  `borderSweepPhase` View styles: a light running around the rounded border
  like the PS5 focus ring, bright at its head and fading behind it. The phase
  animates on the native driver and repaints only the border bands. Engine
  patch. See docs/ANIMATION.md.

- Stop a growing list from repainting the whole screen while it scrolls: a
  container that paints nothing and only moved or resized (a `VirtualList`
  filling rows below the screen) damaged its whole box, the full viewport, on
  every frame, so the scroll copy saved nothing. Engine patch.

- Let focus scrolling catch up with a held key: once the target is more than a
  third of the viewport ahead, the speed cap rises with the distance, so tall
  rows no longer leave the screen a page behind focus (and a `VirtualList`
  mounting every row in between).

- Fix black rows in a `VirtualList` while a held key scrolls it: rows still on
  screen behind the scroll target were unmounted when tall rows let the target
  run ahead of the scroll, and a filling row could stop at its first card. The
  window now keeps every row between the scroll position and its target.

- Wrap bold text that is slightly wider than its box: lines broke at the
  regular glyph width, so a bold title a few pixels too wide drew as one line
  cut at the edge instead of continuing on its second line. Engine patch.

- Clip an `Image` to its `borderRadius`: covers drew square corners whatever
  `rounded-*` said. The bitmap now follows the same anti-aliased rounded shape
  as a background; square images draw as before. Fixed by an engine patch.

- Make a remote `<Image>` lighter: one component with one state object, one
  hook to re-render with and one effect, stable layout and load callbacks, and
  the host element rendered directly unless the image is focusable. Mounting
  and loading one takes about a quarter less JavaScript heap.

- Collect JavaScript garbage in idle frames: hosts count the QuickJS heap and
  run its collector half a second after the last input once a third of the
  room before its threshold is garbage, so a collection (40–70 ms on the PS5)
  lands in a pause rather than mid-scroll; the threshold is never raised. Each
  collection is logged as `gc: idle` or `gc: automatic`. `VirtualList` fill
  steps re-render the filling row alone and keep its existing cards, cutting
  the garbage a scroll through a grid leaves by about a third, and focusable elements
  use one effect fewer per render.

- Size a `Text` by the lines it actually wraps into: an auto-height text was one
  line tall (cutting wrapped text to its first line) or exactly `numberOfLines`
  lines whether or not it needed them. It now wraps at the width it gets, at
  most `numberOfLines`, also as a `flex-1` child of a row, which grows to hold
  it. Layouts that relied on `line-clamp-N` reserving N lines need a height.
  Fixed by an engine patch.

- Fix pieces of a sliding element left on screen, such as a header's section
  pill sliding while the screen under it changes: when an opaque element
  covered a repaint elsewhere, a translated element inside a clipping
  container recorded its untranslated position, so its next move erased the
  wrong area. Fixed by an engine patch.

- Add `Sound` (native ABI v5): import a 16-bit PCM WAV and the build bakes it
  into the app; `Sound.play(name, {volume, pan})` posts it to the
  ps5-homebrew-ui mixer, which renders on an audio thread (PS5: sceAudioOut;
  desktop: SDL), one voice per sound so a held D-pad does not stack ticks.
  `Sound.setVolume` sets the master volume. Add `useNavigationEvents`, which
  reports each focus move, blocked direction, press, back and button action
  with whether something handled it; `FocusManager.move` and `press` now
  return those outcomes. The starter and `npm run create` apps play a set
  derived from Google's Material Design sound resources (CC BY 4.0, prepared
  by `tools/ui_sounds.mjs`; attribution in `licenses/material-sounds-NOTICE.txt`)
  through `sounds.js`. Not yet validated on hardware. See docs/NATIVE-API.md.

- Add `Power.keepAwake(enabled)` (native API ABI v4) to keep the console out
  of rest mode during long downloads: the PS5 host ticks the system power
  timer every 30 s while it is on, the desktop preview toggles the screen
  saver. Not yet validated on hardware. See docs/NATIVE-API.md.

- Fix a translated element leaving its children behind: a `y` or `x`
  translate without scale or rotation moved only the element's own paint, so a
  header slid past the top edge stayed frozen on screen as its items, and a
  partial lift left a ghost strip. An engine patch moves the subtree and
  repaints the area it leaves. Sliding a bar off screen no longer needs a fade.

- Entering a `ScrollView` from outside it with the D-pad reaches only elements
  it shows at least in part: Right from the last header item no longer jumps
  to a card scrolled out of a rail. Moves inside a scroll view are unchanged.

- Add `scrollAnchor` on `View` and `Pressable`: a vertical `ScrollView` aligns
  the top of the focused element's nearest anchor (a section with its title,
  the hero) past the margin instead of revealing only the element, falling back
  to minimal movement when that would hide it. Add `ScrollView`
  `onScrollTarget({x, y})`, called with each new focus-scroll target. See
  docs/NAVIGATION.md.

- Deliver L1, R1, L2, R2, Triangle and Square as the `l1`, `r1`, `l2`, `r2`,
  `triangle` and `square` actions (host input protocol v3, versioned apart from the native API ABI): to `useController`, to
  the new `FocusScope.onAction` handler (innermost first, until one returns
  `true`), and to input scripts. Desktop: Q, E, Z, C, T, F and the
  controller's shoulders, triggers, Y and X. See docs/NAVIGATION.md.

- Add `VirtualList` for long lists and grids inside a `ScrollView`: it mounts
  the rows on screen, around focus and a little ahead of the scroll, filling
  rows ahead an item per frame, with spacers for the rest, `onEndReached` for
  incremental loading and optional row recycling. Lists taller than the engine's
  16-bit layout range re-centre the rows the content represents without moving
  anything on screen. `ScrollView` frames gain change listeners and `shift`.
  See [Long lists](docs/LISTS.md).

- Add the `shot:NAME` script step: test deploys save the frame on screen as
  `dev/NAME.bmp` (preview: the sandbox's `temp0/`), and `tools/ps5_shots.py`
  fetches them through PS5Upload as PNG. See docs/ANIMATION.md.

- Load `<Image source={{uri}}>` from http(s) URLs: native fetch and stb_image
  decode on two workers, resampled to the drawn size (cover/contain/stretch,
  never enlarged) as premultiplied ARGB, a 32 MiB LRU decoded cache, an 8 MiB
  encoded cache shared across sizes, cancellation on unmount and
  `Image.prefetch`. Engine patches add image unloading and size a flow child's
  main axis from a definite cross size and `aspectRatio`. See docs/IMAGES.md.

- Add opt-in receipt-backed recovery of published downloads after app interruption.
  Verify the full SHA-256 and original request/storage/file identity without
  contacting the provider; preserve unowned or damaged existing destinations.
  Expose filesystem device/inode IDs as lossless strings for app storage guards.

- Add split-manifest downloads with source-relative HTTP ranges and direct
  output-offset writes, SHA-1 piece and SHA-256 file verification in one read,
  exact expected sizes, storage-root identity guards, and exclusive publication.
  Export `DownloadFormats` for image, package, archive and binary destinations.
  Package installation and archive extraction remain external operations.

- Add native `Http.request` and `Downloads.enqueue` with validated parallel
  ranges, bounded 8 MiB file buffers, an independent disk writer, cancellation,
  durable range checkpoints and optional SHA-256 verification. PS5 networking
  is opt-in with pinned PacBrew ports and native-title compatibility; hardware
  operation and throughput remain unverified. Add localhost native and JS
  lifecycle coverage to `npm test`.

- Focus scrolling steps once per presented frame, through a new host frame
  callback (`globalThis.__ps5ReactFrame`), in whole pixels: it speeds up over
  four frames, cruises at 40 logical px per frame and brakes to the target.
  It used to step from a 16 ms timer with an exponential ease: on the PS5,
  frames with no timer tick presented no motion (about 45 per 330 scrolling
  frames in five Overdrive runs) and every scroll ended in a crawl of 1-3 px
  steps (about 110 frames). Now there are none of either, and a held key
  scrolls at a constant 60 px per frame.
- The PS5 frame log's engine split (`ERUI_PERF_STATS`) reads the time-stamp
  counter (`sceKernelReadTsc`, about 11 ns) instead of `clock_gettime` (about
  0.88 µs). The engine reads that clock around every blit and bridge call, so a
  full-screen frame paid 10-15 ms for its own statistics: opening an Overdrive
  game page went from a 51 ms to a 36 ms frame and going back from 39 to 20 ms.
  Raster figures logged before this change include that overhead.
- On AVX2 targets (the PS5) the software backend blends eight pixels per step,
  bit-identical to the scalar loops.
- When the surface matches the render size, the presenter keeps the frame in
  two buffer textures (`texelFetch`) and uploads changed rows with
  `glBufferSubData`. On the PS5 that costs about 0.46 ms for 1920×540 rows
  against 14.9 ms through `glTexSubImage2D`; opening an Overdrive game page went
  from an 80 ms to a 53 ms frame, and the gallery's 28 ms image-change frame
  fits in 16.7 ms. Scroll moves need no GPU copy there. Other sizes keep the
  scaled texture.
- A horizontal ScrollView beside a transparent container, such as a section
  header whose box overlaps the rail through a negative margin, scrolls by
  copy again instead of repainting its whole viewport each frame. On the PS5
  the Overdrive genre rail went from 23 ms frames (about 43 fps) for the whole
  scroll to 60 fps.
- The PS5 host writes klog lines from a writer thread. A synchronous
  `sceKernelDebugOutText` on the render thread took 0.1-1 ms per line and
  stalled a frame by about 9 ms one to two times a minute (once by 1.45 s).

- `--app-dir <path>` previews, watches, and builds an app outside `apps/`;
  `create --dir <parent>` scaffolds one. Build receipts record app sources as
  `app/<path>` instead of `apps/<name>/<path>`.

- Build the optional filesystem helper with the app payload SDK v0.42 instead
  of the upstream builder's v0.40, which lacks firmware 13.60 initialization.
  Preserve the full 32-byte credential attributes required by the new SDK API.
  The previous helper SIGILL/EOF is documented; the user confirmed the replacement
  filesystem integration on firmware 13.60 with kstuff and ShadowMount.

- Initialize libSceNet and allocate a network pool before the optional Lapy
  helper request. Added stage-specific native transport errors after hardware
  logs showed the previous request failed with status 9 before elevation.
- Optional `filesystemAccess: "console"` packages the pinned upstream Lapy
  exact-title helper and requests filesystem access once before starting React.
  System Explorer enables it. Root aliases are preserved after successful
  elevation. A resident Lapy service or local ELF loader on port 9021 is required;
  the exact tested application/helper hashes are recorded in hardware evidence.
- PS5 storage queries use the native-title `_fstatfs` export, following the
  ProsperoStore reference, with bounded discovery of accessible mount records.
  Removed direct syscalls after hardware logs confirmed a fatal
  `SYSTEM_ILLEGAL_FUNCTION_CALL`. The replacement was user-confirmed on firmware 13.60.
- PS5 directory listing validates record lengths and filename boundaries before
  invoking callbacks; malformed buffers return an I/O error.
- System Explorer queries storage on directory navigation or explicit Refresh,
  rather than on every React render. Desktop tests cover native storage bindings
  and error propagation.

- Build-time `className` styling: a subset of Tailwind CSS v3 utilities compiles
  to literal style objects on any JSX element, scaled to the render width.
- State variants (`focused:`, `selected:`, `disabled:`, `active:`, `checked:`,
  `pressed:`) driven by props of the same name; `hover:`, `focus:`, and
  `focus-visible:` are aliases of `focused:`.
- Pinned dependencies can carry reviewed patches from `patches/`. Embedded React
  is patched so auto-height `flex-wrap` rows grow to hold every wrapped line.
- `tw` tagged templates exported from `@ps5-react/core`.
- Optional per-app `tailwind.config.js` for `baseWidth` and theme overrides,
  including font files that are baked automatically.
- Unsupported classes and runtime-computed class names fail the build with a
  source location.
- The starter uses `className`; its snapshots match the explicit-style version.
- React Native-style native modules in `@ps5-react/core`: `Platform`,
  `DeviceInfo`, `FileSystem`, `Notifications`, `Users`, `Controller` with the
  `useGamepad` hook, `Linking`, and `BackHandler`, implemented by both hosts through the
  `__ps5ReactNative` contract. The desktop preview uses a per-app sandbox. The
  PS5 implementation is not yet hardware-validated. See `docs/NATIVE-API.md`.
- `apps/system-explorer` (`PPSA99056`) demonstrates every native module.
- Motion-style animation in `@ps5-react/core`: `motion.*` components,
  `AnimatePresence`, variants with stagger, and `transitions` presets, driven by
  the engine without per-frame JavaScript. `Animated`, `useAnimatedValue`,
  `Easing`, `LayoutAnimation`, and `Pressable` are re-exported. See
  `docs/ANIMATION.md` for the API, performance rules, and design guidelines.
- Tailwind animation classes (`animate-in`, `fade-in`, `slide-in-from-*`,
  `zoom-in`, `animate-out`, `duration-*`, `delay-*`, `ease-*`, `transition`,
  `animate-spin`/`pulse`/`bounce`/`ping`) compile to motion props at build time.
- Both hosts log a frame-time summary every two seconds (`[PS5-REACT] frame:
  fps=… total avg=… p95=… max=…` with input, update, present, and swap phases);
  on the PS5 it goes to the kernel log.
- `apps/motion-lab` (`PPSA99057`) demonstrates staggered entrances, focus lift
  with a gliding highlight, page transitions, Tailwind animation classes, a
  toast, and idle motion.
- Spatial D-pad navigation (`docs/NAVIGATION.md`): `View`, `Image`, and
  `Pressable` take `focusable`, `onPress`, `onFocus`/`onBlur`, `autoFocus`,
  `focusKey`, and `nextFocus*`; `FocusScope` (with `trap`, `wrap`,
  `restoreFocus`, `onBack`), `useFocusable`, `useFocus`, `useIsFocused`,
  `BackHandler.addEventListener`, and a `ScrollView` that follows focus. Hosts
  send `up`/`down`/`left`/`right`; `useController` still receives
  `previous`/`next` after them.
- The starter, the `npm run create` template, `apps/tailwind-gallery`,
  `apps/system-explorer`, and `apps/motion-lab` navigate with focusable elements
  and scopes instead of manual focus indices. The starter's snapshots are
  unchanged.
- `Svg`, `Path`, `Circle`, `Rect`, `Line`, and `G` are re-exported from
  `@ps5-react/core`.
- The engine profile scales images bilinearly, across the full 2560-pixel
  render width, registers up to 256 images, and holds 64 `<Svg>` nodes with 32
  cached (about 2.9 MB more static memory). The starter's snapshots are
  unchanged.
- `ScrollView` scrolls its focused descendant into view with the engine's
  native scroll offset (Embedded React is patched with
  `NativeUI.scrollTo`) instead of translating a content wrapper, so layout
  props stay on the ScrollView and nested rails scroll innermost first.
- `FocusScope` takes `inert`: its subtree leaves D-pad navigation, autoFocus,
  and focus restoration, and focus leaves it when it becomes inert. Use it for
  mounted but hidden screens. When no scope has a candidate, focus stays put.
- The engine profile raises the node pool and bridge handles to 2048, so two
  full screens fit during a transition; the bridge warns once when node
  creation fails instead of dropping nodes silently.
- Views take a `backgroundGradient` style (CSS linear and radial gradients,
  up to four stops), and Tailwind compiles `bg-gradient-to-*`, `from-*`,
  `via-*`, and `to-*` with stop positions to it. The engine profile enables
  `ERUI_GRADIENT` (about 23 KB more static memory). The starter's snapshots are
  unchanged.
- The frame-time summary adds the engine's own split (`js` with dispatch,
  React render, and marshal; `layout`; `raster` with pre-pass, render, and
  blit) and the repainted and written pixels per frame. Frames over 33 ms print
  a `slow frame:` line with that split and the repaint bounds. The engine
  profile enables `ERUI_PERF_STATS` for this; no overlay is drawn.
- The desktop preview replays `PS5_REACT_INPUT_SCRIPT` (for example
  `wait:3000,right*3,confirm,wait:2000,back,quit`) through the normal input
  path for reproducible profiling; `PS5_REACT_SLOW_FRAME_MS` sets the
  slow-frame threshold. See `docs/ANIMATION.md`. The PS5 host reads the same
  script from `/app0/dev/input-script.txt` when a test deploy adds that file,
  and live commands from `/app0/dev/commands.txt` while it runs.
- Embedded React is patched so a repaint over an image converts and scales only
  the repainted part instead of the whole image, bilinear scaling uses integer
  weights, and a scale animation resting at 1 no longer renders its subtree
  through the transform buffer. The starter's snapshots are unchanged.
- Controller actions reach JavaScript inside React's batch, from the frame's
  microtask drain: a handler that sets several pieces of state renders and
  commits once, and its render counts as `react` in the frame log.
- Scrolling moves the pixels already painted: Embedded React is patched so a
  ScrollView whose offset changes moves its viewport through a new backend
  `move_rect` and repaints only the exposed strip, falling back to a full
  viewport repaint when anything but a solid background shares those pixels.
  Both hosts replay the move on the GPU texture instead of uploading the
  viewport again.

## 0.1.0 — 2026-10-05

Initial experimental source release.

- React/JSX runtime backed by QuickJS and Embedded React software rendering.
- Shared OpenGL framebuffer presenter and independent PS5 application host.
- Native macOS preview with rebuild/restart on save.
- Controller hook, counter starter, app manifests, and app scaffolding.
- Pinned dependency bootstrap, folder/ZIP builds, integrity checks, and receipts.

The baseline proof of concept was user-tested on PS5 firmware 13.60. The
reorganized framework starter is not yet independently hardware-tested.
