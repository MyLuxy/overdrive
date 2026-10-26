# Native modules

`@ps5-react/core` exposes platform services as React Native-style modules.
Apps import them like any other export; they never touch the SDK, libkernel,
or SDL directly.

```jsx
import {Platform, DeviceInfo, FileSystem, Controller, useGamepad} from '@ps5-react/core';

const {model, firmware} = DeviceInfo.get();
FileSystem.writeFile(`${FileSystem.dataDir}/save.json`, JSON.stringify(state));
Controller.setLightBar('#38bdf8');
```

[`apps/system-explorer`](../apps/system-explorer) exercises every module.

## Contract

The modules in `runtime/js/native.js` wrap `globalThis.__ps5ReactNative`, which
each host installs before the bundle runs. Its exact shape (ABI v21) is
documented in [`native/shared/host_api.hpp`](../native/shared/host_api.hpp).
`native/shared/host_api.cpp` implements the filesystem with POSIX and the object
itself; `native/ps5/` and `native/desktop/` implement the platform functions.

- **Synchronous bridge.** Each native call returns directly. Networking calls
  only submit/cancel/poll bounded tasks; `Http.request` and `task.done` expose
  promises in the JavaScript wrapper while native workers perform I/O.
- **Render thread.** Calls run on the same thread as React and the rasterizer.
  Keep them cheap: avoid listing large directories or reading files every
  frame. Call them from event handlers, effects, or state initializers rather
  than repeatedly during render.
- **Errors.** A failed call throws an `Error` whose message names the call, the
  path, and the system error, for example
  `fs.readDir /download0/missing: No such file or directory`. Wrap calls in
  `try`/`catch` and show the message.
- **Missing host.** If `__ps5ReactNative` does not exist (for example when a
  module is evaluated outside a PS5 React host), every call throws an error
  explaining that a PS5 React host is required.
- **QuickJS runtime.** The runtime has no `Date` objects (`Date.now()` works),
  typed arrays, or `Proxy`; values cross the boundary as strings, numbers,
  booleans, plain objects, arrays, and `null`.

## Platform

| Member | Returns | Notes |
| --- | --- | --- |
| `Platform.OS` | `'ps5' \| 'desktop'` | The running host |
| `Platform.select(spec)` | `spec[OS]`, else `spec.default` | Keys: `ps5`, `desktop`, `default` |

```js
const label = Platform.select({ps5: 'Console', desktop: 'Preview', default: 'Unknown'});
```

## DeviceInfo

`DeviceInfo.get()` returns:

| Field | Unit | Notes |
| --- | --- | --- |
| `model` | string | Console model, or `Desktop preview (<Mac model>)` |
| `firmware` | string | System software version, or `macOS <version>` |
| `cpuTemperature` | °C | `null` on desktop |
| `socTemperature` | °C | `null` on desktop |
| `cpuFrequency` | Hz | `null` when unknown (always on Apple silicon) |
| `freeMemory` | bytes | Memory available to the app |
| `processTime` | µs | CPU time used by this process |
| `language` | string | System language as a BCP 47 tag (`en-US`, `pt-BR`, `zh-Hans`) |

Any value the host cannot read is `null`.

`DeviceInfo.utcOffset(time = Date.now())` (ABI v14) returns the system time
zone's offset from UTC at that instant in minutes, summer time included: `120`
for Central European Summer Time, `-300` for US Eastern Standard Time. With no
`Date` objects in the runtime, local time is arithmetic on
`time + utcOffset(time) * 60000`. Pass the instant you are converting, not the
current time, when it may fall on the other side of a summer-time change. The
PS5 reads the zone set in the console's settings; the desktop preview the Mac's.

## FileSystem

By default, the title runs sandboxed. App paths are logical roots; explicit
console paths become accessible only after opt-in filesystem access succeeds.

| Constant | Path | Access |
| --- | --- | --- |
| `FileSystem.appDir` | `/app0` | The installed application folder; read-only |
| `FileSystem.dataDir` | `/download0` | Writable, persists between launches |
| `FileSystem.tempDir` | `/temp0` | Writable scratch space |

On the console, listing `/app0` may return an empty array even though files
inside it can be read by path. Paths containing `..` components are rejected.

| Function | Returns | Notes |
| --- | --- | --- |
| `readDir(path)` | `FileStat[]` | Entries of a directory, without `.` and `..` |
| `stat(path)` | `FileStat \| null` | `null` when the path does not exist |
| `exists(path)` | `boolean` | `stat(path) !== null` |
| `readFile(path)` | `string` | UTF-8; throws above 8 MiB |
| `writeFile(path, text, {sync})` | — | Creates or truncates; `sync: true` flushes it to the disk before returning, for a file saved then renamed into place |
| `appendFile(path, text)` | — | Creates or appends |
| `mkdir(path, {recursive})` | — | `recursive` defaults to `false` |
| `remove(path)` | — | A file or an empty directory |
| `removeTree(path)` | — | A file, or a directory and everything in it; symbolic links are unlinked, never followed. Synchronous: for small app-owned trees |
| `removeAsync(path)` | `Promise<void>` | What `removeTree` removes, on a worker thread, one path at a time in the order asked. Resolves once the path is gone, or if it never existed; rejects with an `Error` naming the path and the system error. For large files and trees, whose removal holds the screen for seconds |
| `rename(from, to)` | — | Both are app paths |
| `copyFile(from, to)` | — | Copies the bytes (`readFile` and `writeFile` carry text only); written beside `to`, then renamed over it, mode `0644` |
| `chmod(path, mode)` | — | Permission bits, such as `0o777`; a file or directory the console's own services must read (a title's files) needs them open to every user |
| `mounts()` | `{device, path, type}[]` | Up to 64 mounted filesystems visible to this process, as host paths; see [Hardware status](#hardware-status) |
| `diskUsage(path)` | `{total, free}` | Bytes for the filesystem holding `path`; `free` is available to the app, clamped to `0..total` |

`FileStat` is `{name, isDirectory, isFile, size, modified, device, inode}`, where
`size` is in bytes and `modified` is milliseconds since the Unix epoch.
`device` and `inode` are decimal strings that preserve native 64-bit identities.
Use both to detect replacement of a directory or file, including another drive
mounted at the same path; these identities are filesystem-local, not universal
drive serial numbers.

Files are text only; there is no binary read or write.

For console-wide filesystem access, add this to the app manifest:

```json
{ "filesystemAccess": "console" }
```

Then query storage from an event handler or effect:

```js
const entries = FileSystem.readDir('/data');
const mounts = FileSystem.mounts();
const {total, free} = FileSystem.diskUsage('/data');
```

Keep `filesystemAccess` set to `"sandbox"` (the default) for apps that only
need their own files. The opt-in helper requires resident Lapy or a local ELF
loader; see [access requirements](#hardware-status). On failure, filesystem
calls retain their normal permission errors rather than returning fake values.


## Http and Downloads

`Http.request(url, options)` provides bounded text/JSON HTTP responses, effective
URLs and allowlisted lowercase response headers. Set `followRedirects: false`
to inspect redirect metadata; cookies and authentication headers stay private.
HTTP requests accept a custom `Range` header for bounded probes; downloads own
their ranges and reject it. Custom headers disable automatic redirects. Response
headers include `etag` and `last-modified` for stable file identity checks.
`Downloads.enqueue({url, destination, ...options})` returns a cancellable task
with progress subscriptions and a completion promise. Binary downloads stay
native, use parallel validated ranges when eligible, and resume durable ranges.
Progress snapshots expose `written` for live disk throughput and `completedBytes`
for whole completed ranges. `completedBytes` excludes incomplete in-flight ranges,
so use it for resumable progress displays.
`Downloads.enqueueManifest({manifest, destination, ...options})` supports split
byte manifests with per-piece SHA-1 and whole-file SHA-256 verification.
`DownloadFormats` validates manifests and routes image, package, archive and
binary filenames to their appropriate destinations. Native download options
include opt-in `rejectHtml`, exact `expectedBytes`, `storageRoot` identity checks, `recoverCompleted`
for receipt-backed SHA-256 verification of published files, and normalized
`pieces: [{url, offset, size, sha1}]`. These options share ABI v2 on both hosts;
there are no additional global native functions.
`Downloads.setRateLimit(bytesPerSecond)` (ABI v17) caps what all file downloads
receive together, 0 for no limit. It applies at once, running downloads included;
a capped download opens about one connection per MB/s. A download enqueued with
`unlimited: true`, such as an app's own update, is exempt.
PS5 builds require `networking: true` and `filesystemAccess: "console"`; desktop
networking is available by default. See [NETWORKING.md](NETWORKING.md) for
options, resource limits, errors, lifecycle and the hardware-validation gap.

## LocalNetwork (ABI v9)

`LocalNetwork.broadcast({port, message, timeoutMs, maxReplies, signal})` sends one UDP
datagram to `255.255.255.255:port` and resolves with the replies gathered for
`timeoutMs` (100–10000, default 1500) or until `maxReplies` (1–64, default 16) arrive:
`[{address, port, text}]`, where `address` is the sender's IPv4 address. It is for
service discovery, such as Jellyfin's:

```js
import {LocalNetwork} from '@ps5-react/core';
const replies = await LocalNetwork.broadcast({port: 7359, message: 'who is JellyfinServer?'});
```

The query runs on a native worker of its own; the bridge (`lan.broadcast`, `lan.cancel`,
`lan.poll`) only submits, cancels and polls. Messages are at most 1 KiB and each reply
is cut at 4 KiB; four queries run at a time, and a fifth throws. A `signal` cancels the
query and rejects with an `AbortError`. Anyone on the network can reply with anything:
check a reply against its sender before using an address it names. It needs
`networking: true` (and on PS5 `filesystemAccess: "console"`), like HTTP. Only IPv4
limited broadcast is sent; multicast (SSDP, mDNS) and unicast UDP are not available.

## Torrents (ABI v21)

The app carries its own BitTorrent client: no external client, daemon or service
is involved. `Torrents.download({magnet, torrentPath, destination, wanted, seeding,
connections, listenPort})` starts one job and returns a task like the download
tasks (`id`, `done`, `cancel()`, `snapshot`, `subscribe(listener)`); pass exactly one of
`magnet` or `torrentPath`. `destination` and `torrentPath` are app paths, named as
everywhere else (`/download0`, `/app0`), and the host resolves them — on the desktop
preview they land inside its sandbox.

```js
import {Torrents} from '@ps5-react/core';
const job = Torrents.download({magnet, destination: `${FileSystem.dataDir}/Game.pkg`});
job.subscribe(({state, verified, total, pieces, piecesDone, seeds, leechers}) => { /* draw it */ });
await job.done;
```

The task snapshot updates every 250 ms, while the job runs too. `state` is
`starting`, `metadata` (reading a magnet's info dictionary, BEP 9), `downloading`,
`completed`, `failed` or `cancelled`. It also carries `name`, `file`, `infoHash`,
`metadata` and `seeding` flags, `size` (the wanted file), `total` (the torrent),
`downloaded`, `verified` (SHA-1-checked bytes), `uploaded`, `bytesPerSecond`,
`pieces`, `piecesDone`, `peers` (connected), `seeds`/`leechers` (how many of those
we can download from / upload to) and the tracker's `swarmSeeds`/`swarmLeechers`
(0 until a tracker answers). `listenPort` is nonzero once inbound peers are accepted.

Limits are deliberate: one file per job (`wanted` picks it by path or basename,
else the largest), IPv4 peers only, HTTP(S) and UDP trackers from the torrent or
magnet plus the magnet's `x.pe` peers — there is no DHT, PEX-only discovery or
web seed, so a magnet with neither trackers nor peers fails. A cancelled or failed
job leaves `<destination>.torrent-parts` and the next job for that destination
resumes from it; completing one deletes it. Files are written as pieces verify, so
a partial destination is usable only through a resumed job.

A completed job keeps serving its pieces while the app is open, but only when its
`seeding` option is set and `Torrents.setSeeding(true)` is in force — the user's
setting, which applies to running jobs. While it seeds, the task keeps reporting
snapshots (`uploaded` grows) and its `done` resolves at completion; the subscription
ends with one final snapshot whose `seeding` is false, when the seeder stops. Up to 8 jobs transfer at once, and up to
16 in all count finished jobs that still seed; when that table is full the oldest
finished seeder stops to make room for a new download (nobody is polling it any
more). `Torrents.supported` is false on hosts
older than ABI v21. It needs `networking: true` (and on PS5
`filesystemAccess: "console"`), like HTTP. Seeding is exercised by
`tools/test_torrent_engine.py` against a local peer, not on hardware.

## Images

`<Image source={{uri}}>` loads `http://` and `https://` URLs natively: fetched
and decoded by two workers off the render thread, at the size the element is
drawn, into a bounded LRU cache. `Image.prefetch(uri, {width, height,
resizeMode})` warms that cache. `Image.getColor(uri)` resolves to the art's most
prominent vivid colour as `'#rrggbb'`, or `null` for grey or dark art, computed
while decoding a small copy. The bridge (`image.load`, `image.release`,
`image.poll`, ABI v3; results carry that `color`; `image.warm` and `image.defer(ms)`, which
ScrollViews call while they move to hold network requests back) is internal to the `Image` component. See
[IMAGES.md](IMAGES.md) for sizing, formats, memory budgets and errors.

## Notifications

`Notifications.show(message, subMessage?)` shows a system notification and
returns `true` when the host accepted it.
On PS5 it uses libkernel's `sceKernelSendNotificationRequest`: a plain toast whose
subMessage follows the message on a second line.

## Users

| Function | Returns |
| --- | --- |
| `Users.getForeground()` | `{id, name} \| null` — the user who launched the app |
| `Users.getLoggedIn()` | `{id, name}[]` |

## Controller

| Function | Notes |
| --- | --- |
| `setLightBar(color)` | `'#rrggbb'` or `{r, g, b}` with 0–255 channels |
| `resetLightBar()` | Restores the system color |
| `vibrate(strength = 1, ms = 200)` | `strength` 0–1 |
| `setTriggerEffect(trigger, effect)` | ABI v12. A DualSense adaptive trigger effect on `'l2'`, `'r2'` or `'both'`, replacing the last one; effects below. The PS5 turns the triggers off when the app quits; the desktop preview logs the request without sending it |
| `setTriggerResistance(trigger, strength, from = 0)` | `setTriggerEffect(trigger, {type: 'resistance', from, strength})` |
| `getState()` | `GamepadState`, the latest polled state |
| `subscribe(listener, {frames = false})` | Calls `listener(event)` once per frame with the controller's events, below; returns the function that stops it |

Trigger effects take positions as fractions of the travel (0 top, 1 bottom) and
strengths 0–1 in the controller's eight steps, where 0 turns the effect off. An
invalid effect throws a `RangeError` naming the field:

| Effect | Feel |
| --- | --- |
| `{type: 'off'}` | A free trigger |
| `{type: 'resistance', from = 0, strength}` | Pushes back from `from` to the bottom (libScePad mode 1, feedback) |
| `{type: 'weapon', start, end, strength}` | Resists between `start` and `end`, then gives way with a click, like a gun trigger (mode 2). The controller places them in tenths of the travel: `start` lands in 0.2–0.8 and `end` at least a tenth past it, at most 0.9 |
| `{type: 'vibration', from = 0, amplitude, frequency}` | Buzzes from `from` on, at `frequency` Hz, 1–255 (mode 3) |

`GamepadState` is:

```ts
{
  connected: boolean;
  leftX: number; leftY: number;    // -1..1, deadzone applied
  rightX: number; rightY: number;  // -1..1, deadzone applied
  l2: number; r2: number;          // 0..1
  buttons: string[];               // held: up down left right cross circle triangle
                                   // square l1 r1 l2 r2 l3 r3 options touchpad
}
```

The host updates the state once per frame, before JavaScript timers and
controller actions run.

### Controller events

`useControllerEvents(handler, {frames = false})` (or `Controller.subscribe`) diffs
the state once per frame, in the frame callback that steps motion, and calls the
handler for each change: what an action cannot tell, such as a release, how far a
trigger is in, or the touchpad and L3/R3, which send no action. All listeners
share one read of the state, made only while any listens.

| Event | When |
| --- | --- |
| `{type: 'press', button, state}` | A `GamepadState` button went down; L2 and R2 at the host's press threshold (half travel) |
| `{type: 'release', button, heldMs, state}` | It came up, after `heldMs` of frame time |
| `{type: 'trigger', trigger, value, previous, state}` | `'l2'` or `'r2'` travel changed, 0–1 |
| `{type: 'frame', elapsedMs, state}` | With `frames`, after the others every frame, for work that steps while something is held |

A frame delivers releases, then presses, then trigger changes, so a release ends
before the next press starts. A button already held when a listener starts is not
a press for it (it may be the press that mounted the listener); its release is.
Pass `null` as the handler to stop listening. The events are a diff of per-frame
states: a press and release within one frame are not seen, while the host's
actions (`useController`) still arrive.

```jsx
function SkipIntro({onSkip}) {
  useControllerEvents(event => {
    if (event.type === 'press' && event.button === 'touchpad') onSkip();
  });
  return <Text>Press the touchpad to skip</Text>;
}
```

`useGamepad(intervalMs = 0)` reads the state on the same per-frame reader while
the component is mounted (at most once per `intervalMs` when given) and
re-renders only when it changes:

```jsx
function Sticks() {
  const pad = useGamepad();
  return <Text>{pad.leftX} {pad.leftY} {pad.buttons.join(' ')}</Text>;
}
```

Menus use focus navigation ([NAVIGATION.md](NAVIGATION.md)). `useController`
receives the raw `up`, `down`, `left`, `right`, `confirm`, `back`, `l1`, `r1`,
`l2`, `r2`, `triangle`, and `square` actions (plus `previous`/`next` for
compatibility); `useControllerEvents` is for releases, holds and analog travel,
and `useGamepad` for drawing raw state. Options arrives as the `options` action, and the PS button
leaves the app ([NAVIGATION.md](NAVIGATION.md#host-input-input-protocol-v5)).

## Sound

Short interface sounds: focus ticks, confirm, back, errors, notifications.
Import a WAV like an image; the build bakes it into the app and the import is
the sound's name:

```jsx
import {Sound, useNavigationEvents} from '@ps5-react/core';
import tick from './assets/sounds/focus.wav';

useNavigationEvents(event => { if (event.type === 'move') Sound.play(tick); });
```

| Function | Notes |
| --- | --- |
| `Sound.play(name, {volume = 1, pan = 0})` | Returns `true` when the sound started; `volume` 0–1, `pan` -1 (left) to 1 (right) |
| `Sound.setVolume(volume)` | Master volume 0–1 for every sound (0 mutes) |

- **Format.** 16-bit PCM WAV, mono or stereo, 8–96 kHz, at most 10 seconds;
  other files fail the build with the file name. Keep sounds short: they stay
  decoded in memory (8 bytes per frame). An app that imports no WAV opens no
  audio output.
- **One voice per sound.** While a sound still plays, playing it again is
  skipped and returns `false`, so a held D-pad keeps ticking without stacking.
  Different sounds overlap.
- **Cheap and non-blocking.** `play` posts a command to a lock-free queue and
  returns; mixing runs on an audio thread (the ps5-homebrew-ui mixer: 32 voices,
  48 kHz stereo, a soft limiter). It returns `false` when there is no audio
  output. An unknown name throws `sound.play <name>: no imported .wav has this
  name`.
- **Feedback for navigation.** `useNavigationEvents` ([NAVIGATION.md](NAVIGATION.md#navigation-events))
  reports each move, blocked direction, press, back and button action, so one
  hook at the root gives every screen its sounds.

`apps/starter/sounds.js` wires the framework's sound set (`focus`, `confirm`,
`back`, `error`, `page`, `notify`) this way, and `npm run create` copies it. The
set is derived from Google's Material Design sound resources (CC BY 4.0): keep
`licenses/material-sounds-NOTICE.txt` with an app that ships it. `node
tools/ui_sounds.mjs <material wav directory> <output directory>` rebuilds it from
the pack's WAV files.

## Linking

`Linking.openURL(url)` opens an `http://` or `https://` URL in the system
browser and returns `true` when the host launched it. Other schemes throw.

## Power

`Power.keepAwake(enabled)` keeps the console out of rest mode for inactivity
while `true`, for work that runs with nobody touching the controller, such as a
download of several hours. Turn it on when the work starts and off when it
ends; the last call wins, so an app with several jobs keeps one count of its
own.

The PS5 host calls `sceSystemServicePowerTick` every 30 seconds while it is on,
which restarts the inactivity timer as input does (the method FTP and download
homebrew use). The desktop preview disables or enables the SDL screen saver and
prints `[power] keep awake on|off`. **Not yet validated on hardware**: no test
has shown a console staying awake through its rest-mode timeout.

## Video (ABI v10)

`<Video>` ([VIDEO.md](VIDEO.md)) is built on `video.open(source, options)`, which returns the
player's id and the name of the placeholder image its `<Image layer>` draws, `video.close(id)`,
setters for pause, seek, volume, mute, loop, resize mode, audio delay, audio output (ABI v13), audio and subtitle track,
`video.addSubtitle(id, source, language, title)` for a subtitle file, and `video.poll()`, every open
player's status, read each frame while one is open. Apps use the component.

## AudioOutput (ABI v13)

`AudioOutput.capabilities()` returns what the TV or AV receiver the console outputs to takes, read
from its EDID at the call: `{known, name, formats, passthrough, pcmChannels}`. `formats` lists each
codec the EDID's audio descriptors name (`{codec, channels, sampleRates, bitDepths?, maxBitrate?}`),
`passthrough` the codecs a `<Video audioOutput="auto">` sends it undecoded (`'ac3'`, `'eac3'`,
`'dts'`), `pcmChannels` the most PCM channels it takes. [VIDEO.md](VIDEO.md#audio-output) has the
fields and how passthrough plays. The PS5 host reads the EDID with `sceVideoOutGetHdmiRawEdid_`; the
desktop preview has none and returns `known: false` with empty lists.

## Display

`Display.refreshRate()` returns the rate in Hz the display presents at.
`Display.setRefreshRate(hz)` (ABI v11) switches between 60 and 120 Hz while the
app runs, for example 120 Hz for film playback, where 24 fps divides evenly,
and 60 Hz for a heavy interface. The rate must be listed in app.json
`"refreshRates"`; any other throws.

The switch happens after the current frame. The PS5 host can change the rate
only while EGL is shut down, so it releases the presenter, closes and reopens
the display at the new rate, and builds the presenter again. JavaScript state,
React and the engine's framebuffer live in CPU memory and are kept; the first
frame afterwards uploads the whole framebuffer. The screen is black while the
TV resyncs, a second or two, and motion does not advance across that gap. A TV
without 120 Hz input stays at 60, and `refreshRate()` reports the accepted mode
once a frame has been presented at it. Asking for the current rate cancels a
switch that has not happened yet.

The desktop preview keeps the monitor's rate, rebuilds its presenter the same
way, reports the requested rate and prints
`[PS5-REACT] refresh switch to <hz> Hz`. **Not yet validated on hardware**: no
console has switched rates at runtime yet.

## Fonts

`Fonts.setLanguage(tag)` sets the interface language (a BCP 47 tag such as
`'ja'`, `'zh-Hans'` or `'ar'`) for text drawn from the runtime fonts an app
packages with `textFonts` ([International text](TEXT.md)). It chooses the
Japanese or the Chinese form of Han characters and the language text is shaped
for. It starts as `DeviceInfo` `language`; call it before text renders, since
text already laid out keeps its layout until it changes. **Not yet validated on
hardware.**

## BackHandler

`BackHandler.exitApp()` asks the host to close the app after the current frame,
exactly like pressing Options in an app that leaves Options to the host (React Native's name for
the same call).

`BackHandler.exitApp({relaunch: true})` also opens the app again once it has closed, and returns
whether that was arranged. An app cannot launch itself after it exits, so on PS5 it sends
`relauncher.elf` (`native/ps5/payloads/relauncher.c`, shipped in the app folder) to the payload
loader on `127.0.0.1:9021`; the payload waits for the title to close, then launches it for the
foreground user. Without the loader it returns `false`, logs why, and the app only closes. The
desktop preview runs itself again.

## Desktop preview behavior

`npm run dev` and `npm run preview` implement the same API on macOS:

- Files live in `.build/<app>/sandbox/`: `download0/` and `temp0/` are
  directories, and `app0` is a link to `apps/<app>/`. `/` lists the sandbox
  root. Unlike the console, `/app0` is writable on desktop; do not rely on it.
- `mounts()` lists the Mac's mounted filesystems.
- `Notifications.show` prints `[notify] message: subMessage` to the terminal.
- `Users` reports the macOS user (`$USER`) with id `1`.
- Temperatures are `null`; `cpuFrequency` is `null` on Apple silicon.
- `language` comes from `PS5_REACT_LANGUAGE`, else `LC_ALL`, `LC_MESSAGES` or
  `LANG` (`pt_BR.UTF-8` reads `pt-BR`); `null` for the `C`/`POSIX` locale.
- `openURL` opens the URL in the default macOS browser.
- With an SDL game controller connected, the light bar and rumble use it;
  otherwise the calls print a `[pad]` line. Trigger effects always print one.
  Without a controller, `getState()` reports `connected: false`, with the keys'
  buttons and travel ([NAVIGATION.md](NAVIGATION.md#host-input-input-protocol-v4)):
  Z and C are L2 and R2 at full travel, or 0.4 with Shift, and P the touchpad.
- Tools hold buttons and set trigger travel with the control channel's `hold`,
  `release` and `trigger` (`tools/ps5_drive.py`) or the same input-script steps.
- Sounds play through SDL's default output. `SDL_AUDIODRIVER=dummy` keeps the
  preview silent; the self-test sets it.
- `AudioOutput.capabilities()` reports `known: false`, and `<Video>` decodes
  every track: there is no HDMI sink to read or to pass a bitstream to.

## Hardware status

The PS5 host implements this API against the public PS5 Payload SDK.
It has **not yet been validated on hardware** except where
[HARDWARE.md](HARDWARE.md) records a test for a specific artifact, firmware,
and loader. Desktop behavior and successful PS5 builds do not establish console
behavior; individual calls may fail or return `null` on a given firmware.

Some PS5 calls load a system module at runtime. It is unverified whether a
title can load these modules; when one cannot, only the dependent call degrades:

| Call | Module | Without it |
| --- | --- | --- |
| `DeviceInfo.get().model` | `libkernel_sys.sprx` | `null` |
| `Notifications.show()` | `libSceNotification.sprx` | Returns `false` |

PS5 `diskUsage()` uses the native-title `_fstatfs` export on a descriptor opened
with `sceKernelOpen`. `mounts()` discovers kernel-provided records through
accessible descriptors, deduplicates them, and returns up to 64 records. Discovery
checks sandbox roots, common storage paths, and immediate children of `/` and
`/mnt`, with at most 96 metadata queries. It is not the privileged global mount
table returned by a payload's `getmntinfo`; inaccessible or deeper mounts can be
absent. No mount records or capacities are invented.

Hardware logs confirmed that our removed direct-syscall prototype terminated the
title with `SYSTEM_ILLEGAL_FUNCTION_CALL`. The replacement uses libkernel's
native wrapper, following a community title reference. The replacement
filesystem integration was confirmed by the user on firmware 13.60 with kstuff
and ShadowMount; exact application/helper hashes are recorded in
[Hardware evidence](HARDWARE.md#system-explorer-filesystem-success--2026-10-05). Directory records from `sceKernelGetdents` are bounds-checked before
names reach JavaScript. See [Storage investigation](STORAGE.md).

Standalone titles can still receive `EPERM` even with kstuff running. For a
console filesystem explorer, set `"filesystemAccess": "console"` in `app.json`
(default: `"sandbox"`). The build packages a pinned upstream Lapy one-shot
helper restricted to that title. Startup requests access before creating the
React thread and accepts success only after a write/read/remove proof in `/data`.
The console must provide resident Lapy or an ELF loader on localhost port 9021.
Startup can take several seconds; no access requests run during React renders.

After success, `/app0`, `/download0`, and `/temp0` remain logical app paths mapped
to their accessible sandbox mounts. Data and temporary roots must pass an
exclusive file creation, write, read and removal proof; opening a directory
for reading alone does not establish write access. If the original roots fail
that proof after the root change, data falls back to
`/data/ps5-react/<TITLE_ID>` and temporary files to its `tmp` directory. Directory
creation and fallback proofs are checked and failures log the path and errno.
That fallback persists until explicitly removed.
Failure leaves console path mapping disabled and logs the upstream status.
Optional native API modules are resolved before requesting the root change.
Desktop behavior is unchanged. The opt-in integration was user-confirmed on
firmware 13.60 with kstuff and ShadowMount. Other firmware/loader combinations
require their own validation.

`diskUsage` measures a filesystem, not recursive directory size or the console
Settings storage categories. On desktop it reports the real Mac filesystem
backing the per-app sandbox.

System Explorer caches these queries when its Files page opens. Navigate to a
directory or select **Refresh** to query again; focus changes do not query storage.

## Not yet available

- Global `fetch`, raw sockets, multicast and WebSocket (UDP broadcast queries: `LocalNetwork`).
- Music, streamed or long audio, and decoding compressed formats at run time.
- The system on-screen keyboard (IME) for text input.
- System save data; use `FileSystem.dataDir` for now.

## Package installation

```js
import {Packages} from '@ps5-react/core';
const task = Packages.install({path: '/data/downloads/packages/CUSA04286-game.pkg', name: 'BATTLESHIP'});
const unsubscribe = task.subscribe(({status, written, total}) => console.log(status, written, total));
try { await task.done; } finally { unsubscribe(); }
```

Installs a `.pkg` or `.fpkg` under `/data`, `/mnt/usb*` or `/mnt/ext*` through
the console's install service (`sceAppInstUtilInstallByPackage`), PS4 and PS5
packages alike. An app may not call that service, so each install sends
`pkg-installer.elf`, built from `native/ps5/payloads/pkg_installer.c` and
shipped in the app folder, to the payload loader on `127.0.0.1:9021`; a jailbroken
console without that loader fails with an error naming the port. The snapshot
carries the console's install `status` (`transferring`, `promoting`,
`playable`), `written`/`total` bytes and the package's `contentId`; the task
completes once the title is playable. One install runs at a time. `cancel()`
stops reporting only: the console finishes an install it accepted. The preview
fails each request. Fake packages need a kernel that accepts them (kstuff); on
firmware above 11.60, PS5 fake game packages install but do not launch.

`Packages.install({url, name, contentId})` hands an `http://` or `https://` link
to the console's own download queue instead: the console fetches and installs
the package in the background, also once the app has closed, with no copy on a
drive first. The console sends no cookies or headers of the app's, so only a
link that works on its own fits. A PS4 package needs its `contentId` (36
characters at offset 0x40 of its header, which the app reads with a ranged
request); a PS5 one goes without. Its progress shows in the console's
Downloads; `cancel()` stops reporting here only.

`Packages.proxy({url, total, file, token, port})` (ABI v21) serves `url` for
the console's queue and returns `{url, localUrl, token, port}`: `url` is
`http://<LAN address>:<port>/<token>/<file>.pkg` (empty when the console has no
route out) and `localUrl` the same on `127.0.0.1`. The console asks a link with
a `HEAD` before it fetches, and a pre-signed S3 or R2 link signs only the `GET`
it was made for: the origin answers that `HEAD` 403 and the console refuses the
package (`0x80B22403`). The app answers the `HEAD` from `total`, the size it read
with a ranged `GET`, and fetches each `GET` range the console asks from `url`,
with the same transport as downloads. The server listens on every interface, so
each link carries a 256-bit token. Answers carry `Content-Type: application/pkg`,
`Accept-Ranges: bytes` and `Cache-Control: no-store`; past 16 connections the
console gets `503` with `Retry-After: 1`. The link works only while the app
runs. A later session passes the `token` and `port` it got back to serve the same
URL again, which the console's queue reconnects to; a taken port is logged and
replaced. `Packages.proxyStats()` returns `{token, total, delivered, requests,
idleMs}` for each link (`delivered` counts body bytes sent, a range asked twice
twice) and `Packages.proxyRemove(token)` forgets one. Its first requests and any
origin error are logged as `pkg-proxy:` lines.

`Packages.startHelper({port, secret, log})` (ABI v21, PS5 only) runs the same
server as a payload of its own, `pkg-helper.elf`, sent to the loader on
`127.0.0.1:9021`, so the console's queue keeps fetching after the app closes. It
resolves to `{port}`; the app then adds links to the helper and reads them over
HTTP at `http://127.0.0.1:<port>/control/<secret>/` (`ping`, `stats`, `add`,
`remove`; see `native/shared/pkg_proxy.hpp`), which answers only to the console
itself. A later session reaches the same helper on the same port and secret. The
helper writes `log`, uses the app's certificate store, resolves names over
DNS-over-HTTPS, and ends once every link was fetched whole and nothing asked for
ten minutes, or nothing asked for an hour.

## Archive extraction

```js
import {Archives} from '@ps5-react/core';
const task = Archives.extract({
  sources: ['/data/downloads/part-1.bin', '/data/downloads/part-2.bin'],
  destination: '/data/downloads/extracted/my-release',
  maxBytes: 100 * 1024 ** 3,
  password: 'published-archive-password', // optional; case and brackets are significant
});
const unsubscribe = task.subscribe(({state, written}) => console.log(state, written));
try { const {artifacts} = await task.done; console.log(artifacts); }
finally { unsubscribe(); }
```

`cancel()` requests cancellation. ZIP, TAR, 7z and RAR/RAR5 use libarchive in a
worker thread. Supply ordered archive volumes; no full joined copy enters JS or
RAM. One extraction may run at a time. Source files are preserved. Output paths,
links, entry counts and byte budgets are validated. Extraction publishes a staged
directory only after successful reading and SHA-256 output receipts. A matching
published directory is reverified; matching interrupted staging is restarted.
Unowned destinations/staging are preserved. Image artifacts are flattened to the
output root for ShadowMount scan depth; duplicate filenames fail without overwrite.

`password` is optional, with at most 1024 UTF-8 bytes and no NUL. Wrong or missing
passwords fail without publishing partial output or removing source volumes.
ZIP decryption uses libarchive's passphrase support. RAR5 AES-256 headers/data are
decrypted in bounded buffers by the native reader before libarchive decompresses
them. Header CRCs, file checksums, decoder-memory limits and output-path validation
remain enforced. CBC padding is removed using compressed-block framing; no joined
or decrypted archive copy is written to disk. Ordered encrypted RAR5 volumes use
the same API. Optional quick-open (`QO`) service indexes are skipped; extraction
reads the original headers and verifies every file password and output CRC32.
An incomplete index payload or invalid enclosing header CRC still fails.
RAR5 files without CRC32, keyed CRC/BLAKE checksums, encrypted older RAR formats and
encrypted 7z are not supported. Password derivation is capped at 2^20 iterations
and runs on the extraction worker, never the render thread.

Unsupported encryption/compression methods and RAR5 dictionaries above
libarchive's supported limit fail explicitly. Before extracting, the headers are
read to refuse archives whose declared decoder windows (7z LZMA/LZMA2/PPMd/zstd
and BCJ2 buffers, RAR5 windows, RAR PPMd, ZIP LZMA/XZ/zstd/PPMd, and an outer
xz/zstd/lzip/lzma layer) exceed 64 MiB, since libarchive has no memory limit
and the title's heap is fixed. That budget assumes nothing else large runs during extraction: don't
extract while downloading. A 7z refused for that alone, whose largest folder declares at most 288 MiB
(the 256 MiB LZMA2 dictionary repacks use), is extracted by `rar-extract` instead, in a process of its
own started through the payload loader, with the console's memory rather than the title's heap. It first
takes that memory and writes to every page; when the console needs over a second to hand it over (it is
freeing memory from everything else: a probe froze a console from 512 MiB on), it fails with "The console
has too little free memory to extract this archive now. Close other apps and retry." before decoding.
Without a payload loader it fails with "This archive needs the payload loader to extract: none answered
on port 9021." Over 288 MiB the memory refusal stands. Self-extracting executables are refused. This API does not install PKGs or
register games. Desktop extraction and successful PS5 linking are not console
execution evidence.

`Archives.inspect(sources)` reads headers synchronously and returns
`{kind, refusal, title}`. For a `pkg`, `title` is the title id its content id
names (the header's `UP0001-CUSA01234_00-...` at 0x40), or `''`. `kind` names the leading bytes: `rar`, `7z`, `zip`, `tar`,
`tar.gz`, `tar.bz2`, `tar.xz`, `tar.zst`, `pkg` (`\x7FCNT`), `exfat`, `ffpkg` (a
UFS2 superblock), `ffpfs`, `ffpfsc`, or `''`. For an archive, `refusal` is the
decoder-memory message above when the headers read so far already declare a
window over 64 MiB: an xz/zstd first block, or a RAR's file headers. A RAR's
first file header is always read; the walk then stops at the first header it
reaches after about 100 ms (each sits after the previous file's data, so a
volume of many files may be cut short). An extraction refuses the rest: its
preflight reads every header, and in a streamed set, which is checked by
`inspect` too, the RAR worker refuses any later header over its limits. It
works on a download's growing `.part` file: a hole or a missing end is not an
error, so a first volume can be refused before the remaining volumes download.
7z and ZIP keep their directories at the end and show no refusal until complete.
An empty kind is not proof of anything; image kinds are recognized by superblock
magic only, not validated as mountable.

`Archives.inspectAsync(sources)` (ABI v19) does the same on a native worker
thread and resolves with `{kind, refusal, title, waitedMs, tookMs}`; inspections
run one at a time in the order asked, `waitedMs` behind the earlier ones. Use it
while the file is being written: a read of a download's growing file waits
behind the writes while they keep the drive at its write rate, and on the
console one waited until the download ended (minutes on the render thread with
`inspect`). Each inspection logs `archive inspect queued` and `archive inspect
done` with both times. On a host without it, it falls back to `inspect`.
If you're in a render sensitive path, call `Archives.supportsAsyncInspection`
before trying `inspectAsync`, as the compatibility fallback will do the sync
read on old hosts. Catch the worker error (if it fails), and don't retry
`inspect` on render thread.


## Browser download capture (ABI v7)

```js
import {BrowserCapture} from '@ps5-react/core';
const task = BrowserCapture.capture({
  prefix: 'https://vikingfile.com/d/',
  suffix: '/Selected file.pkg',
  timeoutSeconds: 180,
});
// Anchor mode: every host whose check only the console browser passes.
const other = BrowserCapture.capture({prefix: 'https://', suffix: '/PPSA01285', timeoutSeconds: 180});
const off = task.subscribe(({state}) => console.log(state));
try { const {url} = await task.done; /* Validate with HTTP before transferring. */ }
finally { off(); }
```

PS5-only, one capture at a time. Sends bundled `browser-capture.elf` to the
localhost ELF loader on port 9021. The desktop returns a failed task explaining
that a PS5 is required. Two prefixes are permitted. The Vikingfile HTTPS download
host (and its `vik1ngfile.site` alias) captures that page's own download route;
its suffix is `/` plus the filename the page will use, and an empty filename
accepts any safe one. The scheme alone, `https://`, is anchor mode: the suffix is
`/` plus the game's title id of 4 to 160 bytes, and the capture returns the file
link that carries that id in its own name, or, on a host known to serve files,
one that names its archive freely. The last path segment alone is the name, and
only the app's own probe decides whether a captured URL really is the file.
Either way the suffix is at most 160 UTF-8 bytes without controls, slashes,
backslashes or `..`, and the deadline is an integer from 1 to 300 seconds.
`rejected` lists up to six links the app already probed and refused (each an
`https://` URL of at most 2047 printable bytes); the scan passes over them, so a
page that keeps a wrong link in memory does not stop the next capture on it.
The browser's network process keeps the addresses of files it fetched earlier
in memory it never clears, so a capture first fingerprints every link already
there that names no game (a known host's free name, a route with no name) while
its state is still `queued`; it turns `capturing` once that pass ends, and only a
new such link is taken after it. The app opens the page only then. A link bound
to the game (the title id, or Vikingfile's expected filename) is accepted however
old. `resume: true` restarts after a refused link with the last fresh capture's
fingerprints instead of a new pass, which would count the links that appeared
since as already known.
The page prefix, `https://vikingfile.com/f/` with the suffix `/`, returns the
Vikingfile file page (`/f/<10-character id>`, or its `vik1ngfile.site` alias) a
LinkVault vault opens; the app reads that page's public metadata and captures
the named file next, with `resume: true`.
Anchor mode also accepts the generated routes with no file name of their own,
1fichier's `a-<n>.1fichier.com/<token>` and Datanodes' `tunnel<n>.dlproxy.uk`
gateway, and never a host's own page: LinkVault, MediaFire's `www` page, an
AkiraBox path outside `/download/`, Vikingfile's `/f/` and the `/<12-character id>`
pages of Datanodes, Filekeeper and Datavaults.
Snapshots have `id`, `state`, `error` and a matching `url` on
completion. `cancel()` shuts down the connection, stops the payload's next
read, and rejects `done` with `AbortError`. Host exit stops and joins the worker.

The user must complete the provider's verification in the system browser; the
link is captured from the browser's memory as the page makes it, so the user need
not hunt for it. Vikingfile's own page holds it before any Download (a JSON
string, slashes escaped); an anchored host shows it, or starts the download with
it, only after the check, and a download the browser begins can be cancelled. This API does not bypass verification or open the page; the app
opens it with `Linking.openURL` after submitting capture. Only a uniquely
identified browser network process is read, with identity checked before every
read. Scanning is limited to anonymous readable/writable nonexecutable user
pages, 64 KiB every 8 ms, 3 GiB per session. No dumps, cookies, arbitrary
process selection or writes. Only complete ASCII/UTF-16 matching routes are
returned. Provenance: `native/ps5/payloads/browser/README.md` (Orbit Store 1.0.1 and 1.3.5).

A captured URL may already be stale; the app must validate host, decoded
filename, HTTP status, content type and length before starting immediately.
Local tests and compilation do not establish console/firmware support.

Native shape: `browser.capture(prefix, suffix, timeoutSeconds, rejected, resume)` returns a task
ID; `browser.cancel(id)` requests cancellation; `browser.poll()` consumes
terminal results. Calls submit/poll synchronously on the render thread; all
payload transport runs on the worker.
