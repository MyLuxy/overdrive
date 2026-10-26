# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Offline-console PS5 title build. Network is used only for public dependencies."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import tarfile
import urllib.request
import zipfile

from rar_worker import build as build_rar_worker, unrar_source
from common import layouts, layout_directory, resource_files, ROOT, DEPS, LOCK, run, digest, verify, fetch, app_files, bundle, dependency, stb_image, refresh_rate_mask
from network_ports import ports, copy_notices
from ca_bundle import ca_bundle
import ffmpeg
from text_fonts import harfbuzz, sheenbidi

BUILD = ROOT / ".build/starter/ps5"
TITLE = "PPSA99053"
HUI_REV = LOCK["platform"]["revision"]
ER_REV = LOCK["embeddedReact"]["revision"]
GL_HASH = LOCK["ps5OpenGL"]["sha256"]
GL_MANIFEST = LOCK["ps5OpenGL"]["manifestSha256"]
RT_HASH = LOCK["runtimeShim"]["sha256"]
BUILTINS_PACKAGE = LOCK["compilerRt"]["package"]
BUILTINS_HASH = LOCK["compilerRt"]["sha256"]

def main():
    global BUILD, TITLE
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--app", default="starter")
    source.add_argument("--app-dir", type=Path)
    parser.add_argument("--compile-only", action="store_true", help="Validate the PS5 ELF without generating an application package")
    parser.add_argument("--ui-reference", type=Path, default=DEPS / "platform")
    parser.add_argument("--embedded-react", type=Path, default=DEPS / "embeddedReact")
    parser.add_argument("--payload-sdk", type=Path, default=DEPS / "sdk/ps5-payload-sdk")
    parser.add_argument("--llvm", type=Path, default=Path("/opt/homebrew/opt/llvm@18/bin"))
    parser.add_argument("--opengl-archive", type=Path)
    args = parser.parse_args()
    app_dir = args.app_dir.resolve() if args.app_dir else ROOT / "apps" / args.app
    BUILD = ROOT / ".build" / app_dir.name / "ps5"
    for directory in (BUILD, DEPS, BUILD / "obj", BUILD / "host"):
        directory.mkdir(parents=True, exist_ok=True)
    hui = dependency("platform", args.ui_reference)
    er = dependency("embeddedReact", args.embedded_react)
    sdk = args.payload_sdk.resolve()
    llvm = args.llvm.resolve()
    if not (sdk / "bin/prospero-lld").exists():
        package = fetch(LOCK["sdk"]["url"], DEPS / "sdk.zip", LOCK["sdk"]["sha256"])
        with zipfile.ZipFile(package) as archive:
            archive.extractall(DEPS / "sdk")
        for path in (sdk / "bin").iterdir():
            path.chmod(path.stat().st_mode | 0o111)
        if not (sdk / "bin/prospero-lld").exists():
            raise RuntimeError("SDK archive layout differs; set --payload-sdk")
    env = dict(os.environ, LLVM_CONFIG=str(llvm / "llvm-config"),
               PS5_CLANG=str(llvm / "clang"), PS5_PAYLOAD_SDK=str(sdk), USE_CCACHE="0")

    archive = args.opengl_archive or DEPS / "ps5-opengl-sdk-1.0.0.tar.gz"
    # The original release (github.com/blackbearreloaded/ps5-opengl) is gone; the same archive, checked by
    # its hash, is kept at MyLuxy/overdrive-deps.
    fetch("https://github.com/MyLuxy/overdrive-deps/releases/download/ps5-opengl-v1.0.0/ps5-opengl-sdk-1.0.0.tar.gz",
          archive, GL_HASH)
    gl = DEPS / "ps5-opengl-sdk-1.0.0/sdk"
    if not gl.exists():
        with tarfile.open(archive) as package:
            selected = [m for m in package.getmembers() if "/sdk/" in m.name or
                        m.name.endswith(("LICENSE", "THIRD_PARTY_NOTICES.md"))]
            package.extractall(DEPS, members=selected, filter="data")
    with tarfile.open(archive) as package:
        package.extractall(DEPS, members=[m for m in package.getmembers() if "/LICENSES/" in m.name], filter="data")
    verify(gl / "manifest.sha256", GL_MANIFEST)
    for line in (gl / "manifest.sha256").read_text().splitlines():
        checksum, name = line.split(maxsplit=1)
        verify(gl / name.lstrip("*"), checksum)

    deb = fetch("https://apt.llvm.org/jammy/pool/main/l/llvm-toolchain-18/" + BUILTINS_PACKAGE,
                DEPS / "compiler-rt-18.deb", BUILTINS_HASH)
    builtins = DEPS / "libclang_rt.builtins-x86_64.a"
    if not builtins.exists():
        entries = subprocess.check_output(["ar", "t", str(deb)], text=True).splitlines()
        name = next(x for x in entries if x.startswith("data.tar"))
        data = subprocess.check_output(["ar", "p", str(deb), name])
        try:
            package = tarfile.open(fileobj=io.BytesIO(data))
        except tarfile.ReadError:
            # Local fix over upstream: the pinned LLVM package carries data.tar.zst, and tarfile reads
            # zstd only from Python 3.14 while the documented minimum is 3.12. Use the zstd CLI there.
            try:
                data = subprocess.check_output(["zstd", "-dc"], input=data)
            except FileNotFoundError as error:
                raise RuntimeError(f"Unpacking {name} needs the zstd command on this Python") from error
            package = tarfile.open(fileobj=io.BytesIO(data))
        with package:
            member = next(m for m in package.getmembers() if m.name.endswith("/libclang_rt.builtins-x86_64.a"))
            builtins.write_bytes(package.extractfile(member).read())

    _, config, generated = bundle(app_dir, er)
    TITLE = config["titleId"]
    access_client = dependency("filesystemHelperClient") if config.get("filesystemAccess") == "console" else None
    helper = BUILD / "filesystem-helper"
    if access_client:
        run(["python3", ROOT / "tools/test_filesystem_access.py", access_client, BUILD / "access-tests"],
            log=BUILD / "filesystem-access-tests.log")
        run(["python3", ROOT / "tools/build_filesystem_helper.py", TITLE, helper, "--sdk", sdk],
            env=env, log=BUILD / "filesystem-helper.log")
    archive_ports = ports()
    network_ports = archive_ports if config.get("networking") else None
    native = hui / "tooling/native"
    host_tool = BUILD / "host/ps5-native-tool"
    run(["clang++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror",
         *[native / (n + ".cpp") for n in ("native_app_builder", "self_container", "elf_object", "sce_module_writer")],
         "-lz", "-o", host_tool], log=BUILD / "host-tool.log")
    libc_builder = BUILD / "host/libc-builder"
    run(["clang++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror",
         native / "libc_builder.cpp", "-o", libc_builder], log=BUILD / "libc-tool.log")
    raw_runtime, runtime = BUILD / "libc.raw.elf", BUILD / "libc.prx"
    run([libc_builder, native / "runtime/api-surface.txt", native / "runtime/imports.txt", raw_runtime])
    verify(raw_runtime, "8ee6e124993e1af26420cb455890fd002f5d6c7e78883c860ce45734e7d002bb")
    run([host_tool, "self", "--sign", "--in", raw_runtime, "--out", runtime])
    verify(runtime, RT_HASH)

    cross = BUILD / "runtime"
    quickjs = dependency("quickjsSource")
    run([sdk / "bin/prospero-cmake", "-S", ROOT / "native/ps5", "-B", cross,
         f"-DER_ROOT={er}",
         f"-DFETCHCONTENT_SOURCE_DIR_QUICKJS={quickjs}",
         "-DCMAKE_VERBOSE_MAKEFILE=OFF", "-DCMAKE_BUILD_TYPE=Release"], env=env, log=BUILD / "runtime-configure.log")
    run(["cmake", "--build", cross, "--target", "er-bridge-quickjs", "er-software", "-j", "6"],
        env=env, log=BUILD / "runtime-build.log")

    # native/ps5/layouts.h: each layout's bundle, and its baked assets under their own register function.
    app_layouts = layouts(config)
    layout_dirs = [layout_directory(generated, layout) for layout in app_layouts]
    layouts_c = BUILD / "layouts.c"
    table = ['#include "layouts.h"']
    for i, directory in enumerate(layout_dirs):
        js_bundle = (directory / "app.bundle.js").read_bytes()
        table += [f"void ps5_react_register_assets_{i}(void);",
                  f"static const char bundle_{i}[] = {{" + ",".join(str(x) for x in js_bundle) + ",0};"]
    table += ["const Ps5ReactLayout ps5_react_layouts[] = {" + ",".join(
                  f"{{{w}, {h}, {sw}, {sh}, bundle_{i}, sizeof bundle_{i} - 1, ps5_react_register_assets_{i}}}"
                  for i, (w, h, sw, sh) in enumerate(app_layouts)) + "};",
              f"const unsigned ps5_react_layout_count = {len(app_layouts)};", ""]
    layouts_c.write_text("\n".join(table))
    layout_assets = {directory / "assets.generated.c": [f"-Der_register_assets=ps5_react_register_assets_{i}"]
                     for i, directory in enumerate(layout_dirs)}
    definitions = next(line.split("=", 1)[1] for line in
                       (cross / "bridge/engine/CMakeFiles/embedded-react.dir/flags.make").read_text().splitlines()
                       if line.startswith("C_DEFINES ="))
    sources = [ROOT / "native/ps5/native_host.cpp", ROOT / "native/ps5/async_log.cpp", ROOT / "native/ps5/host_platform.cpp", ROOT / "native/ps5/video_output.cpp", ROOT / "native/ps5/time_compat.c", ROOT / "native/ps5/archive_compat.c",
               ROOT / "native/ps5/filesystem_access.cpp",
               ROOT / "native/ps5/elevation_transport.cpp",
               ROOT / "native/shared/host_api.cpp", ROOT / "native/shared/removals.cpp", ROOT / "native/shared/network.cpp",
               ROOT / "native/shared/network_api.cpp", ROOT / "native/shared/archives.cpp", ROOT / "native/shared/archive_preflight.cpp", ROOT / "native/shared/rar5_password.cpp", ROOT / "native/shared/archive_writer.cpp", ROOT / "native/shared/archive_api.cpp", ROOT / "native/shared/browser_capture_api.cpp", ROOT / "native/shared/lan.cpp", ROOT / "native/shared/lan_api.cpp", ROOT / "native/shared/torrent_bencode.cpp", ROOT / "native/shared/torrent_meta.cpp", ROOT / "native/shared/torrent_peer.cpp", ROOT / "native/shared/torrent_tracker.cpp", ROOT / "native/shared/torrent_engine.cpp", ROOT / "native/shared/torrent_api.cpp", ROOT / "native/ps5/browser_capture.cpp", ROOT / "native/shared/package_api.cpp", ROOT / "native/shared/pkg_proxy.cpp", ROOT / "native/ps5/package_installer.cpp", ROOT / "native/ps5/payload_loader.cpp", ROOT / "native/ps5/relaunch.cpp", ROOT / "native/ps5/crash_log.cpp", ROOT / "native/ps5/utf8_locale.cpp", ROOT / "native/ps5/network_platform.cpp",
               ROOT / "native/shared/image_loader.cpp", ROOT / "native/shared/image_api.cpp",
               ROOT / "native/shared/sound_api.cpp", layout_dirs[0] / "sounds.generated.c",
               ROOT / "native/shared/audio_sink.cpp", ROOT / "native/shared/audio_output_api.cpp", ROOT / "native/ps5/bitstream_output.cpp",
               ROOT / "native/shared/gl_presenter.cpp", ROOT / "native/shared/gl_video.cpp", ROOT / "native/shared/gl_upscale.cpp", ROOT / "native/shared/video_api.cpp",
               ROOT / "native/shared/frame_stats.cpp", ROOT / "native/shared/js_heap.cpp", ROOT / "native/shared/js_profiler.cpp", ROOT / "native/shared/damage_tracker.cpp", ROOT / "native/shared/render_workers.cpp", ROOT / "native/shared/input_script.cpp", ROOT / "native/shared/screenshot.cpp", ROOT / "native/shared/text_shaper.cpp", *layout_assets,
               layouts_c, *[hui / ("src/platform/ps5/" + n + ".cpp") for n in ("display_egl", "pad", "system", "audio_out")],
               hui / "src/core/input.cpp", hui / "src/audio/mixer.cpp", hui / "src/runtime/app_heap.c", hui / "src/runtime/runtime_shims.c",
               native / "app_crt.cpp", native / "app_cpp_runtime.cpp"]
    hb = harfbuzz() / "src"
    # HarfBuzz (MIT): OpenType shaping and outline rasterization for runtime text, single-threaded.
    harfbuzz_sources = [hb / "harfbuzz.cc", hb / "hb-raster-draw.cc", hb / "hb-raster-image.cc"]
    # SheenBidi (Apache-2.0): the Unicode bidirectional algorithm, as one translation unit.
    sb = sheenbidi()
    sources.extend([*harfbuzz_sources, sb / "Source/SheenBidi.c"])
    includes = [hui / "src", ROOT / "native/shared", ROOT / "native/ps5", generated, gl / "include", er / "engine/include", er / "bridges/quickjs",
                er / "backends/software", er / "engine/text", hb, sb / "Headers", sb / "Source", quickjs, stb_image(), archive_ports / "include"]
    if access_client:
        sources.append(access_client / "examples/sandbox-elevation/src/elevation.cpp")
        includes.append(access_client / "examples/sandbox-elevation")
    compatibility_client = access_client or dependency("filesystemHelperClient")
    sources.append(compatibility_client / "examples/pacbrew-curl/compat.c")
    if network_ports:
        sources.extend(access_client / "examples/pacbrew-curl" / name for name in ("netdb.c",))
        includes.append(network_ports / "include")
    # Video: the player and the pinned FFmpeg, only in apps that ask for them.
    video_libs, video_stubs = [], []
    if config.get("video"):
        video_prefix = ffmpeg.ps5(sdk, archive_ports, env)
        sources.extend([ROOT / "native/shared/video_player.cpp", ROOT / "native/shared/video_subtitles.cpp",
                        ROOT / "native/ps5/video_decoder.cpp"])
        includes.append(video_prefix / "include")
        video_libs = [video_prefix / "lib" / name for name in ffmpeg.LIBRARIES] + [archive_ports / "lib/libssl.a"]
        # The SDK has no import stub for the hardware decoder: one empty function per call we make, under the
        # module's name. Only these: an import the firmware lacks would keep the whole eboot from loading.
        stub_source = BUILD / "libSceVideodec2.c"
        stub_source.write_text("".join(f"void sceVideodec2{name}(void) {{}}\n" for name in (
            "QueryComputeMemoryInfo", "AllocateComputeQueue", "ReleaseComputeQueue", "QueryDecoderMemoryInfo",
            "CreateDecoder", "DeleteDecoder", "Reset", "Decode", "Flush")))
        video_stubs = [BUILD / "libSceVideodec2.so"]
        run([sdk / "bin/prospero-clang", "-shared", "-nostdlib", "-nodefaultlibs", "-fPIC",
             "-Wl,-soname,libSceVideodec2.sprx", "-o", video_stubs[0], stub_source], env=env, log=BUILD / "videodec2-stub.log")
    objects = []
    for i, source in enumerate(sources):
        obj = BUILD / "obj" / f"{i}-{source.name}.o"
        cpp = source.suffix in (".cpp", ".cc")
        flags = ["-std=c++20", "-fno-exceptions", "-fno-rtti"] if cpp else ["-std=c11"]
        # A video app keeps 448 MiB of flexible memory outside its heap for the hardware decoders' workspaces.
        if source.name == "app_heap.c" and config.get("video"):
            flags = flags + ["-DHUI_HEAP_RESERVE=(448u * 1024u * 1024u)"]
        warnings = (["-w", "-DHB_TINY", "-DHB_HAS_RASTER"] if source in harfbuzz_sources else
                    ["-w", "-DSB_CONFIG_UNITY"] if source.name == "SheenBidi.c" else ["-Wall", "-Wextra", "-Werror"])
        run(["sh", hui / "tooling/prospero-clang18", *flags, "-O2", *warnings, *layout_assets.get(source, []),
             "-DPROSPERO=1", "-DGL_GLEXT_PROTOTYPES=1", *shlex.split(definitions),
             *[flag for path in includes for flag in ("-I", path)], "-c", source, "-o", obj],
            env=env, log=BUILD / (f"compile-{i}.log"))
        objects.append(obj)
    libs = sdk / "target/lib"
    agc_stubs = [gl / "lib/libSceAgc.so", gl / "lib/libSceAgcDriver.so"]
    network_libs = [network_ports / "lib" / name for name in ("libcurl.a", "libssl.a", "libcrypto.a", "libz.a", "libzstd.a", "libpsl.a")] if network_ports else []
    archive_libs = [archive_ports / "lib" / name for name in ("libarchive.a", "liblzma.a", "libbz2.a", "libzstd.a", "libz.a", "libcrypto.a")]
    pie = BUILD / "llvm-pie.elf"
    wraps = ["malloc", "calloc", "realloc", "free", "posix_memalign", "malloc_usable_size",
             "sceSystemServiceHideSplashScreen", "sceKernelDebugOutText",
             "nl_langinfo", "___mb_cur_max", "mbrtowc", "wcrtomb"]
    if access_client:
        wraps += ["sceNetSocket", "sceNetSetsockopt", "sceNetConnect", "sceNetSend", "sceNetRecv"]
    run([sdk / "bin/prospero-lld", "-L", libs, "-T", native / "ps5-pie.ld", "--eh-frame-hdr",
         "--version-script", native / "app-symbols.map", "-e", "_start", "-o", pie,
         *[f"--wrap={symbol}" for symbol in wraps], "--undefined=ps5_agc_gate2_run", *objects,
         "--start-group", cross / "liber-software.a", cross / "bridge/liber-bridge-quickjs.a",
         cross / "bridge/engine/libembedded-react.a", cross / "_deps/quickjs-build/libqjs.a",
         gl / "lib/libPS5OpenGL.a", libs / "libunwind.a", libs / "libc++abi.a", libs / "libc++.a",
         *video_libs, *network_libs, *archive_libs, builtins, "--end-group", *video_stubs, "--as-needed", *agc_stubs,
         *sorted(libs.glob("*.so"))],
        env=env, log=BUILD / "link.log")
    elf = BUILD / "eboot.elf"
    run([host_tool, "link", "--in", pie, "--out", elf, "--stub-dir", libs,
         *[flag for path in [*agc_stubs, *video_stubs] for flag in ("--stub", path)], "--module-sdk", "0x02000009",
         "--companion-sdk", "0x08050001", "--file-name", "eboot.elf"])
    # The PKG installer runs as a loader payload: an app may not use the console's install service.
    installer = BUILD / "pkg-installer.elf"
    run([sdk / "bin/prospero-clang", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror", "-o", installer,
         ROOT / "native/ps5/payloads/pkg_installer.c", "-lkernel_sys", "-lSceUserService"],
        env=env, log=BUILD / "pkg-installer.log")
    # RAR sets extract in a payload of their own: UnRAR's license keeps its code out of this GPL app. So
    # does a 7z that needs more memory than the app's heap gives, with the engine's own libarchive.
    rar_extract = build_rar_worker(BUILD / "rar-extract.elf", [sdk / "bin/prospero-clang++"],
                                   ["-I", archive_ports / "include"], [*archive_libs, builtins], env)
    # Opens the app again after it closes, which the app itself cannot do.
    relauncher = BUILD / "relauncher.elf"
    run([sdk / "bin/prospero-clang", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror", "-o", relauncher,
         ROOT / "native/ps5/payloads/relauncher.c", "-lSceUserService", "-lSceSystemService"],
        env=env, log=BUILD / "relauncher.log")
    capture = BUILD / "browser-capture.elf"
    browser = ROOT / "native/ps5/payloads/browser"
    run([sdk / "bin/prospero-clang", "-std=gnu11", "-O2", "-Wall", "-Wextra", "-Werror", "-o", capture,
         ROOT / "native/ps5/payloads/browser_capture.c", browser / "browser_platform.c",
         browser / "browser_scan.c", browser / "browser_match.c", browser / "browser_url.c", "-lkernel_sys"],
        env=env, log=BUILD / "browser-capture.log")
    # The package server as a payload of its own: the console keeps fetching a streamed PKG after the
    # app has closed (native/ps5/payloads/pkg_helper.cpp), with the app's own curl and OpenSSL.
    pkg_helper = BUILD / "pkg-helper.elf"
    if network_ports:
        run([sdk / "bin/prospero-clang++", "-std=c++20", "-O2", "-fexceptions", "-Wall", "-Wextra",
             "-I", network_ports / "include", "-o", pkg_helper,
             ROOT / "native/ps5/payloads/pkg_helper.cpp", ROOT / "native/shared/pkg_proxy.cpp", *network_libs, builtins],
            env=env, log=BUILD / "pkg-helper.log")
    if args.compile_only:
        print(f"PS5 ELF linked: {elf}; no application package generated")
        return
    app = ROOT / "dist" / TITLE
    (app / "sce_sys").mkdir(parents=True, exist_ok=True)
    (app / "sce_module").mkdir(exist_ok=True)
    run([host_tool, "self", "--sign", "--in", elf, "--out", app / "eboot.bin", "--magic", "0x1D3D154F"])
    shutil.copy2(runtime, app / "sce_module/libc.prx")
    shutil.copy2(installer, app / "pkg-installer.elf")
    run([sdk / "bin/prospero-strip", "-o", app / "rar-extract.elf", rar_extract], env=env)
    shutil.copy2(relauncher, app / "relauncher.elf")
    shutil.copy2(capture, app / "browser-capture.elf")
    (app / "pkg-helper.elf").unlink(missing_ok=True)
    if network_ports: run([sdk / "bin/prospero-strip", "-o", app / "pkg-helper.elf", pkg_helper], env=env)
    param = json.loads((hui / "sce_sys/param.json").read_text())
    if refresh_rate_mask(config) & 2:
        param["attribute3"] = param.get("attribute3", 0) | 0x80040  # The console grants 120 Hz output only with these bits.
    if config.get("video"):
        # The most the console gives (from the default 448 MiB); the rest comes out of direct memory.
        param.setdefault("kernel", {})["flexibleMemorySize"] = 1 << 30
    param.update(titleId=TITLE, conceptId=TITLE[4:], contentId=config["contentId"], contentVersion=config["version"])
    param["localizedParameters"]["en-US"]["titleName"] = config["name"]
    (app / "sce_sys/param.json").write_text(json.dumps(param, indent=2) + "\n")
    # An app's own home-screen art replaces the proof icon: icon0.png 512x512, and the backgrounds the home
    # screen shows, pic0.dds (app selected) and pic1.dds (launching), 3840x2160 BC7 DX10 DDS.
    art = sorted([*(app_dir / "sce_sys").glob("*.png"), *(app_dir / "sce_sys").glob("*.dds")])
    for path in art:
        shutil.copy2(path, app / "sce_sys" / path.name)
    if not any(path.name == "icon0.png" for path in art):
        # A reproducible proof icon in the demo's existing colors, without kit artwork.
        from PIL import Image, ImageDraw, ImageFont
        image = Image.new("RGB", (512, 512), "#101820")
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype(str(er / "assets/fonts/Inter-Regular.ttf"), 64)
        draw.text((48, 140), "PS5", font=font, fill="#45d4de")
        draw.text((48, 225), "React", font=font, fill="white")
        image.save(app / "sce_sys/icon0.png")
    shutil.rmtree(app / "fonts", ignore_errors=True)
    for relative, source in resource_files(app_dir, config).items():
        target = app / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    # Mozilla's roots beside the console's own store, which old firmwares let fall behind (network_platform.cpp).
    shutil.rmtree(app / "certs", ignore_errors=True)
    if network_ports:
        (app / "certs").mkdir()
        shutil.copy2(ca_bundle(), app / "certs/cacert.pem")
    fonts = sorted((generated / "fonts").glob("*"))
    if fonts:
        (app / "fonts").mkdir()
        for font in fonts: shutil.copy2(font, app / "fonts" / font.name)
    notices = app / "notices"
    notices.mkdir(exist_ok=True)
    (notices / "Noto-fonts-LICENSE.txt").unlink(missing_ok=True)
    if fonts: shutil.copy2(ROOT / "licenses/Noto-fonts-LICENSE.txt", notices / "Noto-fonts-LICENSE.txt")
    if access_client:
        for name in ("lapy.elf", "lapy-manifest.json"):
            shutil.copy2(helper / name, app / name)
        shutil.copy2(helper / "Lapy-MIT.txt", notices / "Lapy-MIT.txt")
        shutil.copy2(access_client / "LICENSE", notices / "filesystem-helper-client-LICENSE")
    else:
        for name in ("lapy.elf", "lapy-manifest.json"):
            (app / name).unlink(missing_ok=True)
    shutil.copy2(unrar_source() / "license.txt", notices / "unRAR-license.txt")
    stb = (stb_image() / "stb_image.h").read_text()
    (notices / "stb_image-LICENSE").write_text(stb[stb.index("This software is available under 2 licenses"):])
    copy_notices(compatibility_client, notices / "networking")
    (notices / "cacert-MPL-2.0.txt").unlink(missing_ok=True)
    if network_ports: shutil.copy2(ROOT / "licenses/MPL-2.0.txt", notices / "cacert-MPL-2.0.txt")
    shutil.copy2(compatibility_client / "LICENSE", notices / "networking-compat-LICENSE")
    for entry in json.loads((ROOT / "licenses/archives-SOURCES.json").read_text()):
        source = ROOT / "licenses" / entry["file"]
        verify(source, entry["sha256"])
        shutil.copy2(source, notices / entry["file"])
    shutil.copy2(ROOT / "licenses/archives-SOURCES.json", notices / "archives-SOURCES.json")
    for name, source in {
        "ps5-react-LICENSE": ROOT / "LICENSE",
        "ps5-react-LICENSE-ATTRIBUTION": ROOT / "LICENSE-ATTRIBUTION",
        "ps5-react-NOTICE": ROOT / "NOTICE",
        "ps5-homebrew-ui-LICENSE": hui / "LICENSE",
        "embedded-react-LICENSE": er / "LICENSE",
        "embedded-react-engine-LICENSE": er / "engine/LICENSE",
        "QuickJS-LICENSE": quickjs / "LICENSE",
        "harfbuzz-COPYING": hb.parent / "COPYING",
        "SheenBidi-LICENSE": sb / "LICENSE",
        "Inter-LICENSE": hui / "assets/fonts/Inter-LICENSE.txt",
        "material-sounds-NOTICE.txt": ROOT / "licenses/material-sounds-NOTICE.txt",
        "ArtCNN-LICENSE": ROOT / "licenses/ArtCNN-LICENSE",
        "Anime4K-LICENSE": ROOT / "licenses/Anime4K-LICENSE",
        "ps5-opengl-LICENSE": gl.parent / "LICENSE",
        "ps5-opengl-NOTICES.md": gl.parent / "THIRD_PARTY_NOTICES.md",
    }.items():
        shutil.copy2(source, notices / name)
    if (gl.parent / "LICENSES").exists():
        shutil.copytree(gl.parent / "LICENSES", notices / "ps5-opengl", dirs_exist_ok=True)
    for name in ("ffmpeg-LICENSE.md", "ffmpeg-COPYING.LGPLv3", "video-decoder-NOTICE.txt", "audio-passthrough-NOTICE.txt"):
        (notices / name).unlink(missing_ok=True)
    if config.get("video"):
        # FFmpeg as configured is LGPL-3.0-or-later (tools/ffmpeg.py).
        shutil.copy2(ffmpeg.source() / "LICENSE.md", notices / "ffmpeg-LICENSE.md")
        shutil.copy2(ffmpeg.source() / "COPYING.LGPLv3", notices / "ffmpeg-COPYING.LGPLv3")
        shutil.copy2(ROOT / "licenses/video-decoder-NOTICE.txt", notices / "video-decoder-NOTICE.txt")
        shutil.copy2(ROOT / "licenses/audio-passthrough-NOTICE.txt", notices / "audio-passthrough-NOTICE.txt")
    shutil.copy2(ROOT / "docs/DEPENDENCIES.md", notices / "SOURCES.md")
    run([host_tool, "self", "--inspect", "--file", app / "eboot.bin"])
    run([host_tool, "self", "--inspect", "--file", app / "sce_module/libc.prx"])
    receipts = {"title": TITLE, "app": app_dir.name, "framework_version": "0.1.0",
                "hardware_tested": False, "dependencies": LOCK,
                "config": config, "bundle_sha256": {d.name: digest(d / "app.bundle.js") for d in layout_dirs},
                "llvm_version": subprocess.check_output([llvm / "clang", "--version"], text=True).splitlines()[0],
                "sdk_root": str(sdk),
                "network_libraries": {p.name: digest(p) for p in network_libs},
                "sdk_libraries": {p.name: digest(p) for p in sorted(libs.iterdir()) if p.suffix in (".a", ".so")},
                "ui_reference": HUI_REV, "embedded_react": ER_REV,
                "opengl_version": "1.0.0", "opengl_archive_sha256": GL_HASH,
                "compiler_builtins_package_sha256": BUILTINS_HASH,
                "sources": {**{str(p.relative_to(ROOT)): digest(p) for base in (ROOT / "native", ROOT / "runtime", ROOT / "tools", ROOT / "patches")
                               for p in sorted(base.rglob("*")) if p.is_file() and "__pycache__" not in str(p)},
                            **{"app/" + str(p.relative_to(app_dir)): digest(p) for p in app_files(app_dir)}},
                "files": {str(p.relative_to(app)): digest(p) for p in sorted(app.rglob("*")) if p.is_file()}}
    (ROOT / "dist" / (TITLE + ".receipt.json")).write_text(json.dumps(receipts, indent=2) + "\n")
    with zipfile.ZipFile(ROOT / "dist" / (TITLE + ".zip"), "w", zipfile.ZIP_DEFLATED) as package:
        for path in sorted(app.rglob("*")):
            if path.is_file(): package.write(path, path.relative_to(app.parent))
    run(["python3", ROOT / "tools/verify.py", TITLE])
    print(f"Local title build complete: {app}")

if __name__ == "__main__":
    main()
