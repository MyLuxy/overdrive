<p align="center">
  <img src="docs/brand/logo.png" width="160" alt="PS5 React — JSX brackets and a framebuffer pixel inside a display">
</p>

<h1 align="center">PS5 React</h1>

<p align="center">
  <strong>React interfaces. Controller navigation. Standalone PS5 homebrew.</strong><br>
  Write JSX, preview natively on macOS, and build a fullscreen application for PS5.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#your-first-app">First app</a> ·
  <a href="#tailwind-style-styling">Styling</a> ·
  <a href="#native-apis">APIs</a> ·
  <a href="#documentation">Documentation</a>
</p>

PS5 React is an open-source framework for standalone console homebrew. React runs
inside **QuickJS** through **Embedded React**. The software renderer draws the
interface into a framebuffer; **OpenGL presents that framebuffer** on screen.
The application runs in its own native host, without a browser or Sony RNPS hooks.

**Status: experimental v0.1.0.** The original proof of concept and a specific
System Explorer filesystem integration were user-confirmed on firmware 13.60
with kstuff and ShadowMount. Those results apply to the exact artifacts recorded
in [Hardware evidence](docs/HARDWARE.md). New apps, networking and other native
features need their own console validation.

## What you can build

| Capability | What the framework provides |
| --- | --- |
| React interfaces | JSX, hooks, state, reusable components and fullscreen application hosts |
| Controller navigation | Spatial D-pad focus, Cross activation, Circle back navigation and focus scopes |
| Styling | A build-time subset of Tailwind CSS v3, custom themes and explicit style objects |
| Animation and media | Motion-style components, local assets, native remote images and short WAV feedback sounds |
| Native services | Filesystem, HTTP, large-file downloads, controller state, notifications, users and power control |

This is a focused console renderer, not the complete official React Native
runtime. Use the supported primitives and native modules from `@ps5-react/core`.

## Quick start

### Prerequisites

The supported development environment is **macOS on Apple Silicon**.

| Dependency | Purpose |
| --- | --- |
| Python 3.12+ and Pillow | CLI, asset baking and packaging |
| Node.js and npm | React dependencies and JavaScript bundling |
| Git, CMake, SDL2 and a C++ compiler | Dependency bootstrap and native desktop preview |
| LLVM 18 | PS5 cross-compilation |
| libcurl 7.85+ development files | Native desktop HTTP and image transport |
| libarchive 3.7+ development files | Streaming ZIP, TAR, 7z and RAR extraction |

1. Install native tools:

   ```sh
   brew install python node git cmake sdl2 llvm@18 curl libarchive openssl@3
   ```

2. Clone the project and install dependencies:

   ```sh
   git clone https://github.com/half144/ps5-react.git
   cd ps5-react
   python3 -m venv .venv
   source .venv/bin/activate
   python3 -m pip install -r requirements.txt
   npm ci
   ```

3. Check the environment and open the starter:

   ```sh
   npm run doctor
   npm run dev
   ```

Edit `apps/starter/index.jsx`. Saving JSX, assets or app configuration rebuilds
and restarts the native preview. **State resets on restart; this is not Fast
Refresh.** The first run fetches and builds pinned dependencies when needed.

### Controls

| Action | Desktop preview | PS5 |
| --- | --- | --- |
| Move focus | Arrow keys, mouse wheel | D-pad |
| Activate focused element | Enter, left click on it | Cross |
| Navigate back | Backspace, right click | Circle |
| Options (the `options` action) | O | Options |
| Exit application | Escape | PS button |
| Stop the development watcher | Ctrl+C in the terminal | — |

The starter exits automatically 30 seconds after its first displayed frame.
Set `timeoutSeconds` to `0` in its `app.json` to disable that timeout. Scaffolded
apps already use `0`.

## Your first app

Choose a title ID unused by your local apps and your console:

```sh
npm run create -- --name my-app --title-id PPSA99100 --title "My App"
npm run dev -- --app my-app
```

Replace `apps/my-app/index.jsx` with this complete example. The scaffold includes
its font asset and the `font-inter` theme mapping.

```jsx
import {useState} from 'react';
import {AppRegistry, FocusScope, Text, View} from '@ps5-react/core';

function App() {
  const [count, setCount] = useState(0);

  return (
    <FocusScope autoFocus wrap>
      <View className="w-screen h-screen items-center justify-center gap-6 bg-slate-950">
        <Text className="font-inter text-4xl font-bold text-white">
          My first PS5 app
        </Text>
        <Text className="font-inter text-2xl text-slate-300">Count: {count}</Text>
        <View onPress={() => setCount(value => value + 1)}
          className="w-72 items-center rounded-xl border-2 border-transparent
            bg-slate-800 px-6 py-4 focused:border-cyan-400 focused:bg-slate-700">
          <Text className="font-inter text-xl text-white">Add one</Text>
        </View>
        <View onPress={() => setCount(0)}
          className="w-72 items-center rounded-xl border-2 border-transparent
            bg-slate-800 px-6 py-4 focused:border-cyan-400 focused:bg-slate-700">
          <Text className="font-inter text-xl text-white">Reset</Text>
        </View>
      </View>
    </FocusScope>
  );
}

AppRegistry.registerComponent('my-app', () => App);
```

The scaffold pins the starter's baked font sizes. To let this example and future
literal sizes be discovered automatically, replace `apps/my-app/assets.config.js`
with:

```js
export default {
  fonts: {'Inter-Regular': {extraGlyphs: '—–'}},
};
```

`onPress` makes each `View` focusable. Navigation chooses the next element from
its laid-out position; the app does not manage manual focus indices.
`FocusScope` groups navigation and supports focus memory, wrapping and trapping.

### Apps in another repository

```sh
npm run create -- --name my-store --title-id PPSA99101 --dir ../my-projects
npm run dev -- --app-dir ../my-projects/my-store
npm run build -- --app-dir ../my-projects/my-store
```

The bundler resolves React and `@ps5-react/core` from this checkout; an external
app does not need its own `node_modules`. Its directory name must not collide
with a folder in `apps/`. See [external-app editor setup](docs/EXTERNAL-APPS.md).

PNG and DDS files in the app's `sce_sys/` go into the title's `sce_sys/`:
`icon0.png` (512×512) is the home-screen icon, `pic0.dds` the background while
the app is selected and `pic1.dds` the one while it launches, both 3840×2160
BC7 DX10 DDS (`DXGI_FORMAT_BC7_UNORM`, one surface, no mipmaps). The home screen
ignores a `pic0.png`. Without an `icon0.png` the build draws a placeholder icon.

### Application configuration

`app.json` controls the title identity, display name, version, display size,
refresh rate and automatic exit. A configuration for the example app is:

```json
{
  "$schema": "../../app.schema.json",
  "titleId": "PPSA99100",
  "contentId": "UP9000-PPSA99100_00-MYAPP00000000000",
  "name": "My App",
  "version": "01.000.000",
  "render": {"width": 1920, "height": 1080},
  "surface": {"width": 1920, "height": 1080},
  "timeoutSeconds": 0
}
```

The render size determines software rasterization cost and styling scale; the
surface size is the displayed framebuffer size. Keep them equal: different
sizes go through a bilinear texture scale that softens text. 3840×2160 gives
sharp text on 4K TVs; 1920×1080 costs a quarter of the rasterization and
uploads changed rows through the faster buffer-texture path, which matters for
apps that redraw large areas every frame.

`"resolution": "auto"` replaces `render` and `surface`, and is what the starter
uses. The build compiles the
app twice, at 1920×1080 and 3840×2160, and the title picks the layout matching
the console's video output when it starts: 4K and 1440p output get 3840×2160,
everything else 1920×1080. Classes and baked font sizes are per layout, so the
design looks the same at either size; raw numeric `style` values are render
pixels and do not scale. Leave `sizes` out of `assets.config.js` so each layout
bakes the font sizes its classes use. The eboot carries both bundles and font
sets (about 0.4 MB more for the starter). Preview the small layout with
`npm run dev -- --resolution 1080p`.

`"refreshRate": 120` asks for 120 Hz output (default 60). The display must
accept 120 Hz at the surface size, which for 3840×2160 means HDMI 2.1;
otherwise the console stays at 60 Hz. Each frame then has 8.3 ms, so frames
that fit 60 Hz can miss at 120, and switching the TV into the mode delays the
first frame by about 1.5 s. Motion keeps its speed at either rate.
`"refreshRates": [60, 120]` lets the app switch between the listed rates while
it runs with `Display.setRefreshRate` (docs/NATIVE-API.md); it must include
`refreshRate`, and listing 120 sets the same `param.json` bits.

`"video": true` links FFmpeg and the PS5's hardware decoder for `<Video>`: H.264,
HEVC and VP9 up to 4K, more formats up to 1080p ([docs/VIDEO.md](docs/VIDEO.md)).

Configuration errors are reported before expensive builds. Add networking and filesystem opt-ins only
when your app needs those capabilities.

## Tailwind-style styling

`className` and `tw` compile a **supported subset of Tailwind CSS v3 utilities**
into literal style objects at build time. No stylesheet, CSS parser or class
lookup runs on the console.

### Layout, focus and state

```jsx
import {Text, View} from '@ps5-react/core';

function GameCard({title, selected, onOpen}) {
  return (
    <View selected={selected} onPress={onOpen}
      className="w-64 gap-3 rounded-xl border-2 border-transparent bg-slate-800 p-5
        selected:bg-sky-900 focused:border-cyan-400">
      <Text className="font-inter text-xl font-semibold text-white">{title}</Text>
      <Text className="font-inter text-sm text-slate-300">Cross to open</Text>
    </View>
  );
}
```

`focused:` and `pressed:` read a focusable element's interaction state. Other
variants read props on the same element, including `selected:`, `disabled:`,
`active:` and `checked:`. Text styles do not cascade from a parent `View`.

### Reusable styles

```jsx
import {Text, tw} from '@ps5-react/core';

const heading = tw`font-inter text-3xl font-semibold text-white`;

function Heading({children}) {
  return <Text style={heading}>{children}</Text>;
}
```

### Custom themes

Extend `apps/my-app/tailwind.config.js`:

```js
export default {
  baseWidth: 1280,
  theme: {
    extend: {
      colors: {brand: '#45d4de', canvas: '#101820'},
      spacing: {18: 72},
      fontSize: {hero: '48px'},
      fontFamily: {inter: './assets/Inter-Regular.ttf'},
    },
  },
};
```

```jsx
<View className="bg-canvas p-18">
  <Text className="font-inter text-hero text-brand">Your library</Text>
</View>
```

Lengths use logical pixels at a default base width of 1280. The compiler scales
lengths to the app's render width: `p-4` becomes 48 physical pixels at 3840.
Later classes win; explicit `style` wins over classes.

| Supported approach | Avoid |
| --- | --- |
| Flexbox, gaps, spacing, borders, colors and supported gradients | CSS Grid, child selectors, shadows and browser filters |
| Documented state variants such as `focused:` and `selected:` | Responsive breakpoints, `dark:` and CSS pseudo-classes |
| Complete alternatives: `selected ? 'bg-sky-900' : 'bg-slate-800'` | Class construction: `` `bg-${color}-500` `` |
| `tw` for shared compiled style objects | Runtime class compilation and CSS stylesheets |

Unsupported utilities fail the build with a source location and explanation.
See [the complete supported-utility reference](docs/TAILWIND.md).

## Navigation and long lists

Group a page or dialog with a focus scope and handle Circle through `onBack`:

```jsx
import {FocusScope, Text, View} from '@ps5-react/core';

function Settings({close}) {
  return (
    <FocusScope autoFocus trap onBack={() => { close(); return true; }}>
      <View className="gap-4 rounded-xl bg-slate-900 p-8">
        <Text className="font-inter text-2xl text-white">Settings</Text>
        <View onPress={close} className="rounded-lg bg-slate-700 p-4 focused:bg-sky-800">
          <Text className="font-inter text-xl text-white">Done</Text>
        </View>
      </View>
    </FocusScope>
  );
}
```

Use `VirtualList` inside a `ScrollView` for large catalogs. It mounts rows near
focus and the viewport rather than creating every card at once.

```jsx
import {useCallback} from 'react';
import {ScrollView, Text, View, VirtualList} from '@ps5-react/core';

function Library({games, openGame}) {
  const renderItem = useCallback(({item}) => (
    <View onPress={() => openGame(item)}
      className="h-[200px] w-[150px] rounded-lg bg-slate-800 p-4 focused:bg-sky-800">
      <Text className="font-inter text-lg text-white">{item.title}</Text>
    </View>
  ), [openGame]);

  return (
    <ScrollView className="flex-1 px-8">
      <VirtualList data={games} keyExtractor={game => game.id}
        renderItem={renderItem} numColumns={5}
        itemHeight={200} rowGap={24} columnGap={24} />
    </ScrollView>
  );
}
```

Rows have a fixed height in logical pixels. Keep keys consistent and
`renderItem` stable. See [Navigation](docs/NAVIGATION.md) for explicit focus
links, back handling and events, and [Long lists](docs/LISTS.md) for recycling,
pagination and renderer limits.

## Animation

The Motion-style API drives animation in the C engine, without per-frame React
state updates:

```jsx
import {motion, Text, transitions} from '@ps5-react/core';

function AnimatedCard({open}) {
  return (
    <motion.View onPress={open}
      initial={{y: 16}} animate={{y: 0}}
      whileFocus={{y: -4, scale: 1.04}} transition={transitions.focus}
      className="w-48 rounded-xl bg-slate-800 p-6">
      <Text className="font-inter text-xl text-white">Open library</Text>
    </motion.View>
  );
}
```

Simple animation classes compile to the same motion props:

```jsx
import {View} from '@ps5-react/core';

<View onPress={open}
  className="w-48 h-28 rounded-xl bg-slate-800 transition-transform duration-150
    focused:scale-105 animate-in slide-in-from-bottom-4" />
```

`AnimatePresence` supports exit transitions for keyed children. Prefer small
moving elements; fullscreen fades are expensive on the CPU renderer. Scale and
rotation have scratch-buffer size limits. See [Animation](docs/ANIMATION.md).

## Native APIs

Import public modules from `@ps5-react/core`; apps do not access the host's
internal global object. Filesystem/controller calls are synchronous; HTTP and
downloads submit work to native workers.

| Module | Typical usage |
| --- | --- |
| `FileSystem` | Read/write app data, create directories and inspect storage |
| `Http`, `Downloads`, `DownloadFormats` | Fetch JSON/text, stream files, normalize split manifests and route artifacts |
| `Platform`, `DeviceInfo`, `Users` | Choose platform behavior and inspect device/user information |
| `Controller`, `useGamepad`, `useController` | Feedback, analog state and raw input subscriptions |
| `Notifications`, `Sound` | System notifications and short baked feedback sounds |
| `Power`, `BackHandler`, `Linking` | Request awake behavior, exit the app and open an HTTP(S) URL |

Availability and hardware evidence vary by API. The [native API reference](docs/NATIVE-API.md)
contains signatures, limits, error behavior and desktop equivalents.

### Persistent app data

```js
import {FileSystem} from '@ps5-react/core';

const directory = `${FileSystem.dataDir}/preferences`;
const path = `${directory}/settings.json`;

export function saveSettings(settings) {
  FileSystem.mkdir(directory, {recursive: true});
  FileSystem.writeFile(path, JSON.stringify(settings));
}

export function loadSettings() {
  return FileSystem.exists(path)
    ? JSON.parse(FileSystem.readFile(path))
    : {volume: 0.5};
}
```

Filesystem failures and malformed JSON throw; handle them where your app can
show a useful error or choose a fallback.

| Logical path | Purpose |
| --- | --- |
| `FileSystem.appDir` / `/app0` | Application files; treat as read-only on PS5 |
| `FileSystem.dataDir` / `/download0` | Persistent writable app data |
| `FileSystem.tempDir` / `/temp0` | Temporary app files |

Desktop paths map into `.build/<app>/sandbox/`. Console paths such as `/data`
and external drives require the console-access opt-in and successful startup
elevation. A running jailbreak alone does not grant every title payload access.

### HTTP requests

Use `Http.request` for bounded JSON or text responses:

```js
import {Http} from '@ps5-react/core';

export async function loadCatalog(url) {
  const response = await Http.request(url, {
    method: 'GET',
    maxBytes: 1024 * 1024,
  });
  if (!response.ok) throw new Error(`Catalog request failed: HTTP ${response.status}`);
  return response.json();
}

// Async handler: const catalog = await loadCatalog('https://example.com/catalog.json');
```

Replace the example URL with your endpoint. Non-2xx responses resolve normally;
transport and size-limit errors reject. There is no global browser `fetch` or
`AbortController`. This API returns text/JSON, not arbitrary binary buffers.

### Large-file downloads

File bytes stay in native memory and stream directly to disk. JavaScript
receives progress and a completion promise:

```js
import {Downloads, FileSystem, Power} from '@ps5-react/core';

export async function downloadArchive(url, reportProgress) {
  const directory = `${FileSystem.dataDir}/archives`;
  FileSystem.mkdir(directory, {recursive: true});

  const task = Downloads.enqueue({
    url,
    destination: `${directory}/archive.zip`,
    connections: 8,
    adaptive: true,
    resume: true,
    // sha256: 'trusted 64-character hexadecimal digest',
  });
  const unsubscribe = task.subscribe(reportProgress);
  Power.keepAwake(true);
  try {
    await task.done;
    return task.snapshot;
  } finally {
    unsubscribe();
    Power.keepAwake(false);
  }
}

// Listener: progress => console.log(progress.state, progress.written, progress.total)
```

The parent directory must exist; existing final files are preserved. Partial
files use `.part` and eligible checkpoints. Resume depends on provider support
and file identity. One task runs at a time with multiple connections within it.
`task.cancel()` requests cancellation; `task.done` rejects with `AbortError` on
cancellation.

Own tasks at the right lifetime: component cleanup cancels a component-owned
download; an app-wide queue can survive screen navigation. Downloads stop when
the app exits. The `Power` example assumes one active job; coordinate awake
ownership if several features use it.

For PS5 HTTP, downloads and remote images, add these fields to `app.json`:

```json
{
  "networking": true,
  "filesystemAccess": "console"
}
```

The build includes an exact-title filesystem helper. Startup needs resident
Lapy or an ELF loader on localhost port `9021`, successful filesystem elevation
and the console trust store. HTTPS certificate verification remains enabled.
Desktop networking works without the PS5 opt-in.

`DownloadFormats.artifact` routes package/image/archive destinations;
`Downloads.enqueueManifest` handles supported contiguous split-file manifests.
Downloading a file does not install, register or launch it. See
[Networking](docs/NETWORKING.md) for options and complete examples, and
[Download performance](docs/DOWNLOAD-PERFORMANCE.md) for resource budgets and
hardware benchmark planning.

### Device information and controller feedback

```jsx
import {useEffect} from 'react';
import {Controller, DeviceInfo, Platform, Text, useGamepad} from '@ps5-react/core';

function ControllerStatus() {
  const pad = useGamepad();
  useEffect(() => {
    Controller.setLightBar('#45d4de');
    return () => Controller.resetLightBar();
  }, []);

  return (
    <Text className="font-inter text-lg text-white">
      {Platform.OS}: {pad.connected ? 'Controller connected' : 'No controller'}
    </Text>
  );
}

// Inspect on demand: const device = DeviceInfo.get();
// Trigger feedback from an action: Controller.vibrate(0.4, 100);
```

Use raw input for analog controls and specialized interactions. Menus should
use the focus navigation system.

## Images, fonts and sound

Local imports are baked into the app at build time:

```jsx
import {Image, Sound} from '@ps5-react/core';
import cover from './assets/cover.png';
import confirm from './assets/confirm.wav';

function Cover({open}) {
  return (
    <Image source={cover} resizeMode="cover"
      className="w-48 h-64 rounded-xl"
      onPress={() => { Sound.play(confirm); open(); }} />
  );
}
```

Create those files before using the snippet. WAV imports accept short 16-bit PCM
mono/stereo sounds, up to 10 seconds. Fonts use imported TTF/OTF files or theme
mappings. Literal font sizes are discovered during bundling when the font's
`sizes` array is not pinned in `assets.config.js`. An explicit nonempty array
replaces automatic discovery; include every physical size you use. Declare
runtime-selected sizes and extra glyphs there as well, and resolve font-baker
warnings before shipping. For text in other languages, see
[International text](docs/TEXT.md).

Remote images load through native workers and a bounded cache:

```jsx
<Image source={{uri: coverUrl}} resizeMode="cover"
  className="w-48 h-64 rounded-xl" />
```

The PS5 networking opt-in applies to remote images too. See
[Remote images](docs/IMAGES.md), [Sound](docs/NATIVE-API.md#sound) and
[font styling](docs/TAILWIND.md).

## Build for PS5

```sh
npm run build -- --app my-app
```

The build bundles JS, bakes assets, compiles the host and verifies the package.
Public dependencies are pinned and hash-verified. Use an existing public SDK
with `npm run build -- --app my-app --sdk /path/to/ps5-payload-sdk`.

| Output for this example | Contents |
| --- | --- |
| `dist/PPSA99100/` | Complete application folder |
| `dist/PPSA99100.zip` | ZIP containing that folder |
| `dist/PPSA99100.receipt.json` | Configuration, dependency/toolchain provenance and file hashes |

Install the **complete folder** under `/data/homebrew/PPSA99100/` using PS5Upload
or your loader's supported workflow. Keep `sce_sys/`, `sce_module/`, notices and
any helper alongside `eboot.bin`. Follow your title-registering loader's
registration procedure before launching.

The supported packaging workflow is an extracted folder, not a PKG. Build and
preview tools do not connect to, upload to or launch on a console. Host/SDK
changes and new artifacts require their own hardware validation.

## Project structure

```text
apps/<app>/                 JSX, app.json, themes, assets and font configuration
runtime/js/                 Public @ps5-react/core APIs, focus and motion
native/shared/              Native bridge, workers and framebuffer presentation
native/desktop/             macOS graphics, lifecycle and input
native/ps5/                 PS5 graphics, lifecycle, input and filesystem access
tools/                     Bootstrap, bundling, styles, baking and builds
docs/                      API references, architecture and hardware evidence
```

The rendering pipeline is:

```text
React / JSX
    ↓ QuickJS + Embedded React
Software renderer
    ↓ ARGB framebuffer
OpenGL presenter
    ↓
Native macOS preview / fullscreen PS5 application
```

OpenGL presents the software-rendered result; it does not directly render React
widgets. Ordinary application changes belong in JSX and configuration, without
copied hosts or edits to C++.

## Development commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install locked JavaScript dependencies |
| `npm run doctor` | Check the native development environment |
| `npm run dev -- --app my-app` | Watch sources and rebuild/restart the preview |
| `npm run preview -- --app my-app` | Run one native preview |
| `npm run preview -- --app my-app --resolution 1080p` | Preview the 1920×1080 layout of a `"resolution": "auto"` app (default 2160p) |
| `npm test` | Run local runtime/compiler/transport tests and starter UI checks |
| `npm run build -- --app my-app` | Build and verify a PS5 application folder |
| `npm run create -- --name my-app --title-id PPSA99100` | Scaffold an app |

The scripted UI self-test belongs to the starter. Local tests and ELF/SELF
checks do not establish PS5 execution, measured throughput or firmware support.
Logs/artifacts live in `.build/`; dependencies are cached in `.deps/`. Both are
excluded from version control.

## Troubleshooting

| Symptom | Next check |
| --- | --- |
| Preview prerequisites are missing | Run `npm run doctor`; activate the Python virtual environment |
| CMake reports an old libcurl | Install current development files; inspect CMake's selected headers/libraries |
| A utility class fails compilation | Check its source location against [supported utilities](docs/TAILWIND.md) |
| An element cannot receive D-pad focus | Add `onPress` or `focusable`; check its scope and layout |
| PS5 filesystem calls report permission errors | Check console-access opt-in, the complete helper package and startup access log; see [Storage](docs/STORAGE.md) |
| A download cannot resume | Check provider range support, validators/hash and partial/checkpoint ownership; see [Networking](docs/NETWORKING.md) |

## Documentation

| Guide | Read it for |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | Rendering, threading, platform boundaries and reproducibility |
| [External apps](docs/EXTERNAL-APPS.md) | Separate repositories and editor configuration |
| [Navigation](docs/NAVIGATION.md) · [Long lists](docs/LISTS.md) | Focus, back handling, scrolling and large catalogs |
| [Tailwind](docs/TAILWIND.md) · [Animation](docs/ANIMATION.md) | Utilities, themes, transitions and renderer limits |
| [Native APIs](docs/NATIVE-API.md) · [Remote images](docs/IMAGES.md) | Platform services, signatures and media |
| [Networking](docs/NETWORKING.md) · [Download performance](docs/DOWNLOAD-PERFORMANCE.md) | HTTP, downloads, resume, formats and resource budgets |
| [Storage](docs/STORAGE.md) · [Hardware evidence](docs/HARDWARE.md) | Filesystem access and exact console validation results |
| [Dependencies](docs/DEPENDENCIES.md) · [Contributing](CONTRIBUTING.md) | Setup, provenance, licenses and contribution workflow |

## Credits and license

Created by **[half144](https://github.com/half144)** and PS5 React contributors.
Built on [Embedded React](https://github.com/TheMasterCoder007/embedded-react),
ps5-homebrew-ui and ps5-opengl by BlackBearReloaded (their repositories are gone; copies are kept at
[MyLuxy/overdrive-deps](https://gitlab.com/myluxy/overdrive-deps)),
[PS5 Payload SDK](https://github.com/ps5-payload-dev/sdk),
[QuickJS-ng](https://github.com/quickjs-ng/quickjs) and React. The utility palette
and scales come from Tailwind CSS v3.4.17 under the MIT License.

Framework-owned material uses **GPL-3.0-or-later** with the reasonable
attribution-preservation term in [LICENSE-ATTRIBUTION](LICENSE-ATTRIBUTION).
Preserve [NOTICE](NOTICE) in redistributions. Third-party material retains its
own licenses and notices; no proprietary Sony modules are redistributed.
The public release is source-only. Binary redistribution must follow the
corresponding-source and notice requirements in [Dependencies](docs/DEPENDENCIES.md).

The project is independent of Sony Interactive Entertainment. See
[brand assets](docs/brand/README.md) for the original project logo.
