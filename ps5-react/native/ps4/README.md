# PS4 native host

The PS4 build of ps5-react: the desktop preview's file set compiled with the
Open Orbis toolchain instead of LLVM 18 + the PS5 payload SDK. The React engine
(QuickJS, embedded-react, the software renderer) carries over unchanged from
`native/ps5`; this directory holds what differs.

| File | State | Notes |
| --- | --- | --- |
| `host_platform.cpp` | Implemented, untested on hardware | SDL pad LED/rumble, audio, sandbox under `/data/overdrive/sandbox`; mounts probed at `/data`, `/app0`, `/mnt/usb0..7` because `/proc/self/mounts` is unavailable |
| `rar_worker_process.cpp` | Stub | Open Orbis has no `posix_spawn`/`fork`; RAR extraction fails with an honest message until an in-process worker lands |
| `package_installer.cpp` | Stub | PKG install stays with the console's HEN tooling; Overdrive on PS4 downloads files only |
| `browser_capture.cpp` | Stub | The PS5 capture asks the ELF loader on port 9021; the PS4 has no equivalent service |
| `video_decoder.cpp` | Shared with desktop (`../desktop/video_decoder.cpp`) | FFmpeg software decode, only when the FFmpeg port is provided |
| `network_platform.cpp` | Shared with desktop | libcurl initialized on the console's socket stack through the curl port |
| `CMakeLists.txt` | Written, not yet compiled | Mirrors `native/desktop/CMakeLists.txt`; video optional (`-DPS4_REACT_VIDEO=ON` + `-DFFMPEG_PREFIX=...`) |
| `toolchain-openorbis.cmake` | Written, not yet compiled | Set `OO_PS4_TOOLCHAIN` to the toolchain root |

Not ported from the PS5 build: the libc runtime `.prx`, the payload ELFs
(pkg-installer, relauncher, browser capture, pkg-helper, rar-extract), the
filesystem-helper elevation, and the fake-fPKG assembly. The port plan, build
environment and the console bring-up checklist live in [`docs/PS4.md`](../../../docs/PS4.md).

Known risks for the first hardware run, in order:

1. `SDL_GL_CreateContext` may be unsupported by the PS4 SDL2 port; the fallback is a
   `SDL_GetWindowSurface` blit of the software framebuffer, replacing `gl_presenter.cpp`.
2. Threads, sockets and locale need the Open Orbis libc surface the engine already
   compiles against on the console; expect small gaps around locale and `getrusage`.
3. Font subsetting and HarfBuzz rendering run on the console's side of memory
   (no flexible/direct memory split), so the heap budget differs from the PS5 build.
