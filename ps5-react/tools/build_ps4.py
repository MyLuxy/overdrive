# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Offline PS4 build of the Overdrive store through the Open Orbis toolchain.

The React engine, the JS bundle and the staged data tree are shared with the PS5 build
(tools/build_ps5.py); the native host is native/ps4. The console bring-up plan and the
per-component status live in docs/PS4.md. This script stops after the staged tree
(dist/<title>-ps4/) — fPKG packaging for PS4 homebrew is an external, hardware-validated step.
"""
import argparse
import json
import os
import shutil
from pathlib import Path

from common import ROOT, run, dependency, bundle, layouts, layout_directory, resource_files, stb_image, digest
from text_fonts import harfbuzz, sheenbidi

BUILD = None


def main():
    global BUILD
    parser = argparse.ArgumentParser()
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--app", default="starter")
    source.add_argument("--app-dir", type=Path)
    parser.add_argument("--title-id", help="Override the PS4 homebrew title ID for the staged folder name")
    parser.add_argument("--toolchain", type=Path, help="Open Orbis toolchain root; defaults to $OO_PS4_TOOLCHAIN")
    parser.add_argument("--ffmpeg", type=Path, help="PS4 FFmpeg port prefix; required only with --video")
    parser.add_argument("--video", action="store_true", help="Link the FFmpeg port (needs --ffmpeg)")
    args = parser.parse_args()

    toolchain = args.toolchain or os.environ.get("OO_PS4_TOOLCHAIN") or None
    if not toolchain:
        raise SystemExit("Set OO_PS4_TOOLCHAIN to the Open Orbis-PS4-Toolchain root (docs/PS4.md)")
    toolchain = Path(toolchain).resolve()
    if not (toolchain / "bin/clang").exists():
        raise SystemExit(f"clang not found under {toolchain}; check the toolchain installation (docs/PS4.md)")
    if args.video and not args.ffmpeg:
        raise SystemExit("--video needs --ffmpeg pointing at the PS4 FFmpeg port prefix")

    app_dir = (args.app_dir.resolve() if args.app_dir else ROOT / "apps" / args.app)
    BUILD = ROOT / ".build" / app_dir.name / "ps4"
    for directory in (BUILD, BUILD / "runtime"):
        directory.mkdir(parents=True, exist_ok=True)

    hui = dependency("platform")
    er = dependency("embeddedReact")
    _, config, generated = bundle(app_dir, er)
    title = args.title_id or config["titleId"]
    app_layouts = layouts(config)
    layout_dirs = [layout_directory(generated, layout) for layout in app_layouts]
    env = dict(os.environ, OO_PS4_TOOLCHAIN=str(toolchain))

    configure = ["cmake", "-S", ROOT / "native/ps4", "-B", BUILD / "runtime",
                 "-DCMAKE_TOOLCHAIN_FILE=" + str(ROOT / "native/ps4/toolchain-openorbis.cmake"),
                 f"-DOO_PS4_TOOLCHAIN={toolchain}",
                 f"-DER_ROOT={er}", f"-DHUI_ROOT={hui}", f"-DAPP_GENERATED={generated}",
                 f"-DAPP_LAYOUT={layout_dirs[0]}",
                 f"-DAPP_LAYOUT_WIDTH={app_layouts[0][0]}", f"-DAPP_LAYOUT_HEIGHT={app_layouts[0][1]}",
                 f"-DSTB_IMAGE_DIR={stb_image()}", f"-DHB_ROOT={harfbuzz()}", f"-DSB_ROOT={sheenbidi()}",
                 "-DCMAKE_BUILD_TYPE=Release"]
    if args.video:
        configure += ["-DPS4_REACT_VIDEO=ON", f"-DFFMPEG_PREFIX={args.ffmpeg}"]
    run(configure, env=env, log=BUILD / "configure.log")
    run(["cmake", "--build", BUILD / "runtime", "--target", "overdrive-ps4", "-j", "6"],
        env=env, log=BUILD / "build.log")

    elf = BUILD / "runtime/overdrive-ps4.elf"
    if not elf.exists():
        raise SystemExit("The build produced no overdrive-ps4.elf; see .build/" + app_dir.name + "/ps4/runtime/build.log")
    app = ROOT / "dist" / f"{title}-ps4"
    shutil.rmtree(app, ignore_errors=True)
    app.mkdir(parents=True)
    shutil.copy2(elf, app / "eboot.elf")
    for relative, source in resource_files(app_dir, config).items():
        target = app / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    fonts = sorted((generated / "fonts").glob("*"))
    if fonts:
        (app / "fonts").mkdir()
        for font in fonts:
            shutil.copy2(font, app / "fonts" / font.name)
    for path in sorted([*(app_dir / "sce_sys").glob("*.png"), *(app_dir / "sce_sys").glob("*.dds")]):
        target = app / "sce_sys" / path.name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    receipt = {"title": title, "app": app_dir.name, "platform": "ps4", "toolchain": str(toolchain),
               "config": config, "hardware_tested": False,
               "bundle_sha256": {d.name: digest(d / "app.bundle.js") for d in layout_dirs},
               "files": {str(p.relative_to(app)): digest(p) for p in sorted(app.rglob("*")) if p.is_file()}}
    (ROOT / "dist" / f"{title}-ps4.receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(f"PS4 staging tree complete: {app}")
    print("Next: fPKG packaging and console install follow docs/PS4.md (hardware-validated steps).")


if __name__ == "__main__":
    main()
