<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/logo-dark.svg">
    <img src=".github/readme/logo-light.svg" alt="Overdrive" width="440">
  </picture>
</p>

<p align="center">
  <b>English</b> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Your PS5 game store.</b><br>
  Back from the dead, rebuilt from its own binary, with every line of source in the open.
</p>

<p align="center">
  <a href="https://github.com/MyLuxy/overdrive/releases/latest"><img src="https://img.shields.io/github/v/release/MyLuxy/overdrive?style=for-the-badge&label=release&labelColor=0b0b0d&color=2a2a2f" alt="Latest release" width="197"></a>
  <a href="https://github.com/MyLuxy/overdrive/releases"><img src="https://img.shields.io/github/downloads/MyLuxy/overdrive/total?style=for-the-badge&label=downloads&labelColor=0b0b0d&color=2a2a2f" alt="Downloads" width="183"></a>
  <a href="https://github.com/sponsors/MyLuxy"><img src="https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2?style=for-the-badge&logo=githubsponsors&logoColor=white&labelColor=0b0b0d" alt="Sponsor MyLuxy on GitHub" width="180"></a>
</p>

<p align="center">
  <a href="#install-in-four-steps">Install</a> ·
  <a href="#features">Features</a> ·
  <a href="#updates">Updates</a> ·
  <a href="#troubleshooting">Troubleshooting</a> ·
  <a href="#build-it-yourself">Build it yourself</a>
</p>

> [!NOTE]
> The original Overdrive project has been shut down so I decompiled the last released build,
> recovered the complete source and rebuilt it.

<p align="center">
  <img src=".github/readme/discover.jpg" alt="Overdrive's Discover page: a featured game with its description, the picks beside it, and the You might like row" width="100%">
</p>
<p align="center">
  <img src=".github/readme/browse.jpg" alt="Browse library: 2,105 games with filters, sorting, scores and sizes" width="49.5%">
  <img src=".github/readme/downloads.jpg" alt="Downloads page with the From a link, From a torrent and Debrid services cards, activity and storage for internal storage and a USB drive" width="49.5%">
</p>

## Debrid services

TorBox, Real-Debrid and Premiumize fetch a link or a magnet for you: pick one under
**Downloads → Debrid services**, paste the link, and the console downloads what the service
prepares. Each uses your own account key, typed once and kept on the console.

<p align="center">
  <img src=".github/readme/debrid.webp" alt="Debrid services dialog on the Downloads page: TorBox, Real-Debrid and Premiumize, each asking for its own key" width="70%">
</p>

## Features

- **2,100+ games** to discover, with **Top rated**, a hand-picked row and a featured spotlight
- **Homebrew**: native PS5 apps and games from the community catalog at [prosperostore.net](https://prosperostore.net/), always up to date, installed from each developer's GitHub release
- **Browse the whole library** with filters, sorting, scores and download sizes at a glance
- **Downloads straight to the console**, to internal storage or any USB drive, with live speed and storage stats
- **Favorites**, **search** with an on-screen keyboard, and a **Files** page to see and clean up what's on your drives
- **18 languages**: English, Deutsch, Español, Français, Italiano, Nederlands, Português (Brasil), Português (Portugal), Русский, Bahasa Indonesia, 日本語, 简体中文, 繁體中文, العربية, فارسی, اردو, हिन्दी, বাংলা
- **Updates itself**: a new version installs from the console, no PC needed
- Made for the controller: <kbd>L1</kbd> <kbd>R1</kbd> to switch sections, <kbd>✕</kbd> to select, <kbd>○</kbd> to go back

## Install in four steps

<p align="center">
  <img src=".github/readme/install-steps.svg" alt="1 Download Overdrive.exfat · 2 Copy it into a homebrew folder on a USB drive · 3 Plug it in: ShadowMount+ installs it · 4 Play" width="100%">
</p>

### Before you start

You need a **jailbroken PS5** running two payloads: **[ShadowMount+](https://github.com/drakmor/ShadowMountPlus)**,
which installs `.exfat` images by itself, and **[kstuff](https://github.com/EchoStretch/kstuff-lite/releases)**.
If ShadowMount+ shows its notification when the console starts, you are ready. You also need a
**USB drive** and a **PC**.

<p align="center">
  <a href="https://github.com/MyLuxy/overdrive/releases/latest/download/Overdrive.exfat"><img src="https://img.shields.io/badge/Download-Overdrive.exfat-f2f2f3?style=for-the-badge&labelColor=0b0b0d" alt="Download Overdrive.exfat" width="347"></a>
</p>

<table>
<tr>
<td width="64" align="center" valign="top"><img src=".github/readme/step-1.svg" alt="1" width="40"></td>
<td>

**Download `Overdrive.exfat`** with the button above, or from the
[latest release](https://github.com/MyLuxy/overdrive/releases/latest). It is the only file you
need. Leave it as it is: don't unzip it and don't change the `.exfat` at the end of its name.

</td>
</tr>
<tr>
<td align="center" valign="top"><img src=".github/readme/step-2.svg" alt="2" width="40"></td>
<td>

**Copy it onto a USB drive, inside a folder called `homebrew`.** Plug the drive into your PC,
create a new folder named exactly `homebrew` (all lowercase) at the top level of the drive, and
copy `Overdrive.exfat` into it:

```text
USB drive
└── homebrew
    └── Overdrive.exfat
```

The drive must be formatted as **exFAT**, which is how most drives come and what the PS5 reads.

</td>
</tr>
<tr>
<td align="center" valign="top"><img src=".github/readme/step-3.svg" alt="3" width="40"></td>
<td>

**Plug the drive into the PS5.** ShadowMount+ checks for new files every few seconds: it finds
Overdrive, mounts it and installs it, and a notification tells you when it's done. There is
nothing to click.

</td>
</tr>
<tr>
<td align="center" valign="top"><img src=".github/readme/step-4.svg" alt="4" width="40"></td>
<td>

<img src="app/sce_sys/icon0.png" alt="Overdrive's icon" width="64" align="right">

**Open Overdrive from the home screen.** Look for this icon. Enjoy!

</td>
</tr>
</table>

You can also use **any FTP client** to move the file onto the console's internal storage
instead, again inside a `homebrew` folder: `/data/homebrew/Overdrive.exfat`.

## Updates

You only install Overdrive by hand once. When a new version comes out, the app tells you by
itself a few seconds after it opens:

1. A window shows the new version and what changed. Press **Install**.
2. Overdrive downloads the update, checks it and puts it in place of the old one.
3. When it's done, the app **closes itself**. Open it again and you are on the new version.

The update needs about **600 MB free** on the drive that holds Overdrive. `update.zip` in each
release is the package the app downloads for this; you never need it yourself.

## Support the project

Overdrive is free and open source. If you enjoy it, sponsoring helps me keep it updated.

<p align="center">
  <a href="https://github.com/sponsors/MyLuxy"><img src=".github/readme/sponsor.svg" alt="Sponsor Overdrive on GitHub Sponsors" width="358"></a>
</p>

## Troubleshooting

<details>
<summary><b>Overdrive doesn't appear on the home screen</b></summary>
<br>

- Make sure **ShadowMount+ is running**: it shows a notification when it starts.
- Check the folder: it must be called exactly `homebrew` and sit at the **top level** of the
  drive, not inside another folder.
- Check the file still ends in **`.exfat`**. Some PCs hide extensions: a file renamed to
  `Overdrive.exfat.zip` or unzipped into a folder won't be found.
- Give it a minute: ShadowMount+ waits until the file has finished copying before it installs it.

</details>

<details>
<summary><b>Overdrive opens but the page doesn't load</b></summary>
<br>

The copy of `Overdrive.exfat` on the console is damaged. This usually happens when it is copied
through a USB drive. Deleting the app's folders doesn't help: Overdrive creates them again at
every start.

1. Delete `Overdrive.exfat` from the `homebrew` folder, then its icon from the home screen.
2. Download `Overdrive.exfat` again from the
   [latest release](https://github.com/MyLuxy/overdrive/releases/latest).
3. Copy it to the console with [PS5Upload](https://github.com/phantomptr/ps5upload) instead of a
   USB drive, and check that its size on the console matches the downloaded file's.

</details>

<details>
<summary><b>After an update, the app still shows the old version</b></summary>
<br>

The new version is installed but the console still has the old one loaded. **Restart the
console** and open Overdrive again; the app tells you this itself if it happens twice in a row.

</details>

<details>
<summary><b>The update says there isn't enough space</b></summary>
<br>

The update is downloaded next to the installed app, so the drive holding Overdrive needs about
600 MB free. Free some space on that drive and press **Retry**. Nothing has been changed yet
when this happens.

</details>

<details>
<summary><b>The update says it couldn't replace the app</b></summary>
<br>

Install it by hand: download `Overdrive.exfat` from the
[latest release](https://github.com/MyLuxy/overdrive/releases/latest), close Overdrive, and copy
the new file over the old one in the `homebrew` folder.

</details>

<details>
<summary><b>How do I remove Overdrive?</b></summary>
<br>

Delete `Overdrive.exfat` from the `homebrew` folder first, then delete its icon from the home
screen. In the other order ShadowMount+ finds the file again and puts the icon back.

</details>

## Build it yourself

<details>
<summary><b>What's in this repository</b></summary>
<br>

| Path | What it is |
| --- | --- |
| `app/` | The application: JSX sources, state, assets, catalog data, and `app.json` (title id `PPSA99058`, version, capabilities) |
| `ps5-react/` | The framework it runs on, vendored from [half144/ps5-react](https://github.com/half144/ps5-react) |
| `packaging/make-exfat.sh` | Builds the exFAT image ShadowMount+ installs |
| `packaging/make-exfat-mac.sh` | The same image, built locally on macOS without `update.zip` |
| `.github/workflows/build.yml` | The build |

</details>

<details>
<summary><b>How the source was recovered</b></summary>
<br>

Overdrive is a React app running on [ps5-react](https://github.com/half144/ps5-react), and its
whole JavaScript bundle sits in plain text inside `eboot.bin`. A bundler merges every module into
one scope, so imports between modules turn into bare names; since each top-level name stays
unique, the module that declares a name can be worked out again. That split the bundle back into
its 137 original modules with their real `import`/`export` lines, checked against the original
bundle until every import edge matched.

What a bundler throws away could not come back: most comments, the JSX syntax (it reads as
`jsx(View, {…})` calls), and `const`/`let` (now `var`). None of that changes how the app behaves.

</details>

<details>
<summary><b>Developing</b></summary>
<br>

Everything runs from the repository root through npm. Once after cloning, `npm run setup`
(`packaging/setup.sh`) installs every dependency: on Linux the apt packages for the desktop preview,
the PS5 build and the tests (it asks for `sudo` once); on macOS the Homebrew formulae, a
`ps5-react/.venv` with Pillow (Homebrew's `python3` refuses a global `pip install`) and the
framework's npm packages. Read the script first if you'd rather install them yourself.

```sh
git clone https://github.com/MyLuxy/overdrive.git
cd overdrive
npm run setup        # once; asks for sudo on Linux
npm run dev          # the app in a window on your PC, rebuilt on every save under app/
```

| Command | What it does |
| --- | --- |
| `npm run setup` | Installs every dependency, once after cloning |
| `npm run dev` | Opens the app in the desktop preview and rebuilds it on every save (state resets on restart) |
| `npm run preview` | Opens the desktop preview once, without watching |
| `npm test` | The framework's checks; needed after changes under `ps5-react/`, not for `app/` only |
| `npm run build` | The PS5 app, then `Overdrive.exfat` and `update.zip` (see Building) |
| `npm run build:app` | The PS5 app only, in `ps5-react/dist/PPSA99058` |

The preview is the console's UI on your PC, so it takes a controller or the keyboard, and a mouse
as a developer's shortcut. The first `npm run dev` downloads and compiles the framework's pinned
dependencies, which takes a while; later starts are quick.

| Action | Keyboard | Mouse | PS5 |
| --- | --- | --- | --- |
| Move focus | Arrow keys | Wheel (up/down) | D-pad |
| Select | Enter or Space | Left click on the element | ✕ |
| Back | Backspace | Right click | ○ |
| Sections | Q / E | — | L1 / R1 |
| Favorite | F | — | □ |
| Quit the preview | Escape | — | PS button |

The app's code is under `app/` (see "What's in this repository"); a change there needs no rebuild
of the framework. Keep new user-facing strings in every file of `app/i18n/locales/`. On Linux the
preview is compiled with clang (`CC=clang CXX=clang++`, set by the npm scripts), since GCC stops on
a bounds warning in `archive_preflight.cpp`. Linux support for the preview is this fork's addition;
upstream ps5-react supports macOS only.

</details>

<details>
<summary><b>Developing on macOS</b></summary>
<br>

The preview and the PS5 build run on a Mac with Xcode's command line tools, Homebrew, Node 18 or
newer and Python 3.9 or newer. `npm run setup` installs the Homebrew formulae (CMake, LLVM 18,
SDL2, ninja, nasm, libarchive, xz, OpenSSL), creates `ps5-react/.venv` with Pillow, and installs the
framework's npm packages. Homebrew's `python3` is externally managed, so Pillow goes in the venv
rather than a global `pip install`.

```sh
xcode-select --install     # once, if you have never built anything on this Mac
npm run setup              # Homebrew formulae, ps5-react/.venv, framework npm packages
npm run preview:mac        # the desktop preview
```

The `:mac` commands leave `preview`, `dev`, `test` and `build` untouched: those remain the ones
Linux and the other developers use. `preview:mac` and `dev:mac` run through `ps5-react/.venv`, put
LLVM 18 and Node on `PATH`, and prefer MacPorts at `/opt/local` with an SDL2 built in
`~/.local/overdrive-sdl2` when they exist. In that case `/usr/local/bin` is left out of `PATH`, so
CMake does not mix Homebrew's OpenSSL/CURL with the MacPorts copies and break the link.

| Command | What it does |
| --- | --- |
| `npm run setup:mac` | Creates `ps5-react/.venv` with Pillow when the native libraries are already installed |
| `npm run preview:mac` | Opens the desktop preview once |
| `npm run dev:mac` | Opens it and rebuilds on every save under `app/` |
| `npm run doctor:mac` | Checks the venv, Pillow, LLVM 18, Node, CMake and clang |

If the preview does not start: `npm run doctor:mac` first; `brew install llvm@18` when LLVM is
missing; `brew install sdl2` or `CMAKE_PREFIX_PATH=$HOME/.local/overdrive-sdl2` when SDL2 is
missing; and keep Homebrew's `/usr/local/bin` out of `PATH` when a link error mentions OpenSSL or
CURL and MacPorts supplies CMake.

</details>

<details>
<summary><b>Building</b></summary>
<br>

Builds run on `ubuntu-24.04` with clang 18, only from **Run workflow**: a push builds nothing.
Each run puts `Overdrive.exfat` and `update.zip` in a draft release named after
`app/version.js`, which only maintainers can see.

The same build locally, from the repository root, after `npm run setup` (see Developing):

```sh
npm run build        # the app, then Overdrive.exfat and update.zip here
npm run build:app    # the app only, in ps5-react/dist/PPSA99058
```

`packaging/build.sh` behind them finds LLVM 18 where apt or Homebrew put it (set
`LLVM=<its bin directory>` otherwise), builds through `ps5-react/tools/build_ps5.py`, then runs
`packaging/make-exfat.sh` under `sudo`, since the image is mounted to be filled. The build
downloads its pinned dependencies into `ps5-react/.deps` and writes the app folder, a `.zip` and a
`.receipt.json` into `ps5-react/dist`. It verifies the result itself (`tools/verify.py`), so a
green build means the payload structure and signatures check out.

On macOS, `npm run build:mac` does the same app build through `ps5-react/.venv` (Pillow for
`verify.py`) and LLVM 18, without `sudo` and without packaging. The image is a separate,
local-only step: `packaging/make-exfat-mac.sh` uses macOS's `newfs_exfat` and `hdiutil`, writes
`Overdrive.exfat` alone and **no `update.zip`**. The CI keeps using `packaging/make-exfat.sh` on
Ubuntu and still produces both files.

```sh
npm run build:mac      # the PS5 app only, in ps5-react/dist/PPSA99058
npm run package:mac    # Overdrive.exfat from the app already built
npm run image:mac      # both, in one go
```

`npm run package:mac` overwrites `Overdrive.exfat` in the repository root, so keep a copy of the
image you had before. It checks the filesystem with `fsck_exfat` and that every file of the app is
in the image; `fsck_exfat -n Overdrive.exfat` checks it again afterwards. The image keeps the same
64 KiB clusters and `OVERDRIVE` label as the Linux one.

The image is a plain exFAT volume whose root is the app folder, with 64 KiB clusters and the
label `OVERDRIVE`. To release a new version, raise the version in `app/version.js` and
`app/app.json`, run the workflow, test the draft's image on a console, then publish the draft:
that creates its tag, and installed apps offer exactly the tested files on their next start.

</details>

<details>
<summary><b>Fixes over upstream ps5-react</b></summary>
<br>

Two fixes in the vendored framework, both in the build tooling and both reported by a Linux build:

- `ps5-react/tools/common.py` read the `git apply --summary` line with a fixed space count, which
  glued the file mode onto the path (`100644 <path>`) and made every fresh dependency checkout
  fail on the first patch that creates a file. It now splits on whitespace.
- `ps5-react/tools/build_ps5.py` opened the pinned LLVM package's `data.tar.zst` with `tarfile`,
  which reads zstd only from Python 3.14 while the documented minimum is 3.12. It now falls back
  to the `zstd` command.

Nothing else in the framework is changed.

</details>

## Credits

- **[MyLuxy](https://github.com/MyLuxy)**, current maintainer, who decompiled Overdrive, recovered its source and rebuilt it.
- **[ps5-react](https://github.com/half144/ps5-react)**, the framework it runs on.
- **[ShadowMount+](https://github.com/drakmor/ShadowMountPlus)** by drakmor, which installs it.
- **[kstuff](https://github.com/EchoStretch/kstuff-lite)** by EchoStretch, the kernel payload that lets the console run homebrew and the games it installs.
- **[PS5 Homebrew Catalog](https://github.com/darkxex/ps5-homebrew-catalog)** by darkxex, the store API behind the Homebrew section, and every developer listed in it.
- **[QR Code generator](https://github.com/nayuki/QR-Code-generator)** by Project Nayuki (MIT), which draws the QR codes of the phone login; its notice ships in the app as `third_party/qrcodegen-LICENSE.txt`.

`ps5-react/` is GPL-3.0-or-later and carries its own `LICENSE`, `LICENSE-ATTRIBUTION` and
`NOTICE`. Every dependency notice is copied into `notices/` inside the built app, and
`ps5-react/docs/DEPENDENCIES.md` lists them with their sources.

<sub>Overdrive is an unofficial homebrew project and is not affiliated with or endorsed by Sony
Interactive Entertainment. PlayStation and PS5 are trademarks of Sony Interactive Entertainment.</sub>
