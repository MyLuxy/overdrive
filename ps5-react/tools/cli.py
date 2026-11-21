# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Developer entry point. Build and preview only; no console communication."""
import argparse
import fcntl
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys
import time

from common import ROOT, app_config, app_files, bundle, dependency, layout_directory, layouts, run, stb_image
from rar_worker import build_host
from text_fonts import harfbuzz, sheenbidi
import ffmpeg


def sandbox(app):
    """Desktop stand-in for the console mounts that fs paths resolve against."""
    root = ROOT / ".build" / app.name / "sandbox"
    for mount in ("download0", "temp0"):
        (root / mount).mkdir(parents=True, exist_ok=True)
    app0 = root / "app0"
    if app0.is_symlink() and app0.resolve() != app.resolve(): app0.unlink()
    if not app0.is_symlink(): app0.symlink_to(app)
    return root


def preview_env(app):
    return {**os.environ, "PS5_REACT_SANDBOX": str(sandbox(app))}


def preview_layout(config, resolution=None):
    """The layout a preview shows: `resolution` ("1080p", "2160p") picks one of an auto app's."""
    candidates = layouts(config)
    if resolution is None: return candidates[-1]
    if config.get("resolution") != "auto": raise ValueError('--resolution needs an app with "resolution": "auto"')
    return next(layout for layout in candidates if f"{layout[1]}p" == resolution)


def desktop(app, test=False, target="ps5-react-preview", resolution=None):
    er = dependency("embeddedReact")
    _, config, generated = bundle(app, er)
    layout = preview_layout(config, resolution)
    directory = layout_directory(generated, layout)
    build = ROOT / ".build" / app.name / "desktop"
    quickjs = dependency("quickjsSource")
    hui = dependency("platform")
    run(["cmake", "-S", ROOT / "native/desktop", "-B", build,
         f"-DER_ROOT={er}", f"-DHUI_ROOT={hui}", f"-DFETCHCONTENT_SOURCE_DIR_QUICKJS={quickjs}", f"-DAPP_GENERATED={generated}", f"-DAPP_LAYOUT={directory}",
         f"-DAPP_LAYOUT_WIDTH={layout[0]}", f"-DAPP_LAYOUT_HEIGHT={layout[1]}", f"-DSTB_IMAGE_DIR={stb_image()}", f"-DHB_ROOT={harfbuzz()}", f"-DSB_ROOT={sheenbidi()}", f"-DFFMPEG_PREFIX={ffmpeg.desktop()}", "-DCMAKE_BUILD_TYPE=Release"],
        log=build / "configure.log")
    run(["cmake", "--build", build, "--target", target, "-j", "6"], log=build / "build.log")
    # RAR sets extract in this separate program, which the preview finds beside itself.
    build_host(build / "rar-extract")
    command = [build / "ps5-react-preview", directory / "app.bundle.js"]
    if test:
        run(["node", "--test", *sorted((ROOT / "tools/tailwind").glob("*.test.mjs")),
                *sorted((ROOT / "runtime/js/motion").glob("*.test.mjs")),
                *sorted((ROOT / "runtime/js/focus").glob("*.test.mjs")),
                *sorted((ROOT / "runtime/js").glob("*.test.mjs"))], env={**os.environ, "PS5_REACT_ER": str(er)},
            log=ROOT / ".build/tailwind-test.log")
        if app != ROOT / "apps/starter":
            raise ValueError("The scripted UI test belongs to starter; use preview for other apps")
        run(["python3", ROOT / "tools/test_resources.py"], log=ROOT / ".build/resource-test.log")
        run(["python3", ROOT / "tools/test_archives.py"], log=ROOT / ".build/archive-test.log")
        run(["python3", ROOT / "tools/test_removals.py"], log=ROOT / ".build/removal-test.log")
        run(["python3", ROOT / "tools/test_network.py"], log=ROOT / ".build/network-test.log")
        run(["python3", ROOT / "tools/test_images.py"], log=ROOT / ".build/image-test.log")
        run(["python3", ROOT / "tools/test_text.py"], log=ROOT / ".build/text-test.log")
        run(["python3", ROOT / "tools/test_video.py"], log=ROOT / ".build/video-test.log")
        run(["python3", ROOT / "tools/test_passthrough.py"], log=ROOT / ".build/passthrough-test.log")
        run(["python3", ROOT / "tools/test_browser_capture.py"], log=ROOT / ".build/browser-capture-test.log")
        command.append("--self-test")
    return command, build


def doctor():
    print("PS5 React 0.1 — macOS developer environment")
    missing = []
    for command in ("python3", "node", "npm", "cmake", "git", "clang++"):
        path = shutil.which(command)
        print(f"{'OK' if path else 'MISSING'} {command}: {path or 'install required'}")
        if not path: missing.append(command)
    print("PS5 toolchain: LLVM 18 and the pinned SDK are needed only for npm run build")
    print("Preview: SDL2/OpenGL; install with brew install cmake sdl2 llvm@18")
    print("Assets: python3 -m pip install -r requirements.txt")
    if sys.version_info < (3, 12): missing.append("Python 3.12+")
    try:
        import PIL
        print(f"OK Pillow {PIL.__version__}")
    except ImportError:
        missing.append("Pillow")
    if missing: raise RuntimeError("Missing: " + ", ".join(missing))


def source_stamp(app):
    entries = []
    for path in (*app_files(app), *sorted((ROOT / "runtime").rglob("*")), *sorted((ROOT / "native").rglob("*"))):
        if path.name.startswith(".") or not path.is_file(): continue
        try:
            stat = path.stat()
            entries.append((str(path), stat.st_mtime_ns, stat.st_size))
        except FileNotFoundError:
            pass  # Editors may atomically rename files during a save.
    return tuple(entries)


def stop_preview(process):
    if process and process.poll() is None:
        process.terminate()  # SDL handles SIGTERM as a quit event.
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def watch(app, command, directory, resolution=None):
    process = subprocess.Popen([str(x) for x in command], cwd=directory, env=preview_env(app))
    stamp = source_stamp(app)
    print("Watching JSX/assets/config. Save to rebuild; Esc closes; Ctrl+C stops.", flush=True)
    try:
        while True:
            if process and process.poll() is not None:
                if process.returncode == 0: return
                print("Preview exited with an error; edit and save to retry.", flush=True)
                process = None
            time.sleep(0.25)
            changed = source_stamp(app)
            if changed == stamp: continue
            # Debounce until the editor has finished its save/rename sequence.
            time.sleep(0.25)
            stamp = source_stamp(app)
            stop_preview(process)
            process = None
            print("Source changed — rebuilding…", flush=True)
            try:
                with open(ROOT / ".build/build.lock", "w") as lock:
                    fcntl.flock(lock, fcntl.LOCK_EX)
                    command, directory = desktop(app, resolution=resolution)
                process = subprocess.Popen([str(x) for x in command], cwd=directory, env=preview_env(app))
                print("Preview restarted.", flush=True)
            except (ValueError, RuntimeError, subprocess.CalledProcessError) as error:
                print(f"{error}\nFix the source and save to retry.", flush=True)
    finally:
        stop_preview(process)


def create(name, title, display=None, parent=ROOT / "apps"):
    destination = parent / name
    if destination.exists(): raise ValueError(f"App already exists: {destination}")
    display = display or name.replace("-", " ").title()
    # Validate identity before touching the new app directory.
    config = json.loads((ROOT / "apps/starter/app.json").read_text())
    suffix = (re.sub(r"[^A-Z0-9]", "", name.upper()) + "0" * 16)[:16]
    config.update(titleId=title, contentId=f"UP9000-{title}_00-{suffix}", name=display, timeoutSeconds=0)
    config["$schema"] = os.path.relpath(ROOT / "app.schema.json", destination)
    app_config(destination, config)
    stage = ROOT / ".build" / ("create-" + name)
    if stage.exists(): raise ValueError(f"Staging directory exists: {stage}")
    # Starter assets and theme, but a clean entry point instead of the starter's test hooks.
    shutil.copytree(ROOT / "apps/starter", stage, ignore=shutil.ignore_patterns(".*", "index.jsx"))
    (stage / "app.json").write_text(json.dumps(config, indent=2) + "\n")
    template = (ROOT / "tools/templates/index.jsx").read_text()
    (stage / "index.jsx").write_text(template.replace("__TITLE__", display).replace("__NAME__", name))
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(stage, destination)
    option = f"--app {name}" if parent == ROOT / "apps" else f"--app-dir {destination}"
    print(f"Created {destination}\nNext: npm run dev -- {option}")


def main():
    parser = argparse.ArgumentParser(description="React JSX → desktop preview or independent PS5 title")
    parser.add_argument("command", choices=("doctor", "preview", "build", "test", "create"))
    source = parser.add_mutually_exclusive_group()
    source.add_argument("--app", default="starter", help="app folder name under apps/")
    source.add_argument("--app-dir", type=Path, help="app directory outside this repository")
    parser.add_argument("--name", help="new app folder name")
    parser.add_argument("--title-id", help="unique PPSAxxxxx ID for a new app")
    parser.add_argument("--title", help="display name of a new app (default: from --name)")
    parser.add_argument("--dir", type=Path, help="parent directory for a new app (default: apps/)")
    parser.add_argument("--sdk", type=Path, help="use an existing public PS5 payload SDK")
    parser.add_argument("--watch", action="store_true", help="rebuild/restart desktop preview when sources change")
    parser.add_argument("--resolution", choices=("1080p", "2160p"),
                        help='layout a "resolution": "auto" app previews (default: 2160p)')
    args = parser.parse_args()
    if args.command == "doctor": return doctor()
    if args.command == "create":
        if not args.name or not args.title_id: raise ValueError("Use npm run create -- --name my-app --title-id PPSA99054")
        # Prevent traversals before creating directories.
        if not re.fullmatch(r"[a-z][a-z0-9-]*", args.name): raise ValueError("name must use lowercase letters/numbers/hyphens")
    else:
        app = args.app_dir.expanduser().resolve() if args.app_dir else ROOT / "apps" / args.app
        app_config(app)  # Fast actionable config errors before downloads/builds.
    (ROOT / ".build").mkdir(exist_ok=True)
    # The asset tooling and caches are shared; serialize build mutations.
    command = None
    with open(ROOT / ".build/build.lock", "w") as lock:
        print("Waiting for build lock…", flush=True)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == "create":
            parent = args.dir.expanduser().resolve() if args.dir else ROOT / "apps"
            return create(args.name, args.title_id, args.title, parent)
        if args.command == "build":
            cmd = ["python3", ROOT / "tools/build_ps5.py", "--app-dir", app]
            sdk = args.sdk or os.environ.get("PS5_PAYLOAD_SDK")
            if sdk: cmd.extend(["--payload-sdk", sdk])
            run(cmd)
        else:
            command, directory = desktop(app, args.command == "test", resolution=args.resolution)
    if command:
        if args.watch and args.command == "preview":
            watch(app, command, directory, args.resolution)
        elif args.command == "test":
            render_worker_parity(command, directory, app)
        else:
            run(command, cwd=directory, env=preview_env(app))


def render_worker_parity(command, directory, app):
    """Runs the self-test single-core, then across every render worker: the snapshots must match byte for byte."""
    single = directory / "single-core"
    shutil.rmtree(single, ignore_errors=True)
    single.mkdir()
    run(command, cwd=single, env={**preview_env(app), "PS5_REACT_RENDER_WORKERS": "1"})
    run(command, cwd=directory, env=preview_env(app))
    snapshots = sorted(path.name for path in single.glob("texture-*.ppm"))
    if not snapshots: raise RuntimeError("The single-core self-test wrote no snapshots")
    differ = [name for name in snapshots if (single / name).read_bytes() != (directory / name).read_bytes()]
    if differ: raise RuntimeError(f"Parallel rendering differs from single-core in {', '.join(differ)} ({directory})")
    print(f"PASS: {len(snapshots)} snapshots identical single-core and across render workers.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("Preview stopped.")
    except (ValueError, RuntimeError, FileNotFoundError, subprocess.CalledProcessError) as error:
        print(f"PS5 React: {error}", file=sys.stderr)
        sys.exit(1)
