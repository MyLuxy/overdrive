# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Shared configuration and pinned dependency handling. No console transport."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DEPS = ROOT / ".deps"
LOCK = json.loads((ROOT / "dependencies.lock.json").read_text())


def run(command, env=None, log=None, cwd=None):
    print("→ " + " ".join(str(x) for x in command[:3]), flush=True)
    if log:
        Path(log).parent.mkdir(parents=True, exist_ok=True)
        with open(log, "w") as output:
            result = subprocess.run([str(x) for x in command], env=env, cwd=cwd,
                                    stdout=output, stderr=subprocess.STDOUT)
        if result.returncode:
            print(Path(log).read_text()[-6000:])
            raise RuntimeError(f"Failed. Full log: {log}")
    else:
        subprocess.run([str(x) for x in command], env=env, cwd=cwd, check=True)


def digest(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def verify(path, expected):
    if digest(path) != expected:
        raise RuntimeError(f"Checksum mismatch: {path}")


def fetch(url, path, expected):
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        print(f"Downloading {path.name}", flush=True)
        temporary = path.with_suffix(path.suffix + ".download")
        with urllib.request.urlopen(url, timeout=120) as source, open(temporary, "wb") as output:
            while chunk := source.read(1024 * 1024): output.write(chunk)
        verify(temporary, expected)
        temporary.replace(path)
    verify(path, expected)
    return path


def checkout(path, url, revision, patches=()):
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", url, path])
        # Pinned commits may no longer belong to an advertised branch.
        if subprocess.run(["git", "cat-file", "-e", revision + "^{commit}"],
                          cwd=path, capture_output=True).returncode:
            run(["git", "fetch", "origin", revision], cwd=path)
        run(["git", "checkout", "--detach", revision], cwd=path)
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=path, text=True).strip()
    if actual != revision:
        raise RuntimeError(f"Dependency at {actual}, expected {revision}: {path}")
    # The tree must be the pinned revision plus a prefix of the repository's patches, in order; the rest
    # are applied. Trees are compared rather than reverse-checking each patch, because a later patch may
    # change lines an earlier one added.
    patches = [ROOT / p for p in patches]
    with tempfile.TemporaryDirectory() as scratch:
        def tree(index, *steps):
            env = {**os.environ, "GIT_INDEX_FILE": str(Path(scratch) / index)}
            git = lambda *args: subprocess.run(["git", *map(str, args)], cwd=path, env=env, capture_output=True,
                                               text=True, check=True).stdout.strip()
            git("read-tree", "HEAD")
            for step in steps: git(*step)
            return git("write-tree")
        # Tracked files, plus the files the patches create (an untracked node_modules is not the tree).
        touched = {line.split("\t")[-1] for patch in patches for line in subprocess.run(
            ["git", "apply", "--numstat", patch], cwd=path, capture_output=True, text=True).stdout.splitlines()}
        current = tree("current", ("add", "-u"), ("add", "--", *[f for f in touched if (path / f).exists()]))
        prefix = [tree("pinned")]
        for count in range(1, len(patches) + 1):
            prefix.append(tree(f"stack{count}", *[("apply", "--cached", patch) for patch in patches[:count]]))
    if current not in prefix:
        raise RuntimeError(f"Unexpected local changes in {path}: not the pinned revision plus its patches")
    for patch in patches[prefix.index(current):]:
        run(["git", "apply", patch], cwd=path, log=ROOT / ".build/dependency-patch.log")
        # Intent-to-add, so files a patch creates show up in git diff like the rest. Not through
        # `git apply --intent-to-add`: that leaves only the patch's files in the index (git 2.48, 2.50),
        # and the next run then finds every other file deleted.
        # Local fix over upstream: a summary line reads " create mode 100644 <path>", so a fixed space
        # count left the mode glued to the path ("100644 <path>") and every fresh checkout failed on
        # the first patch that creates a file. Splitting on whitespace keeps a path with spaces whole.
        created = [line.split(None, 3)[-1] for line in subprocess.run(["git", "apply", "--summary", patch], cwd=path,
                   capture_output=True, text=True, check=True).stdout.splitlines() if line.startswith(" create mode ")]
        if created: run(["git", "add", "--intent-to-add", "--", *created], cwd=path)


def dependency(name, override=None):
    item = LOCK[name]
    path = Path(override).resolve() if override else DEPS / name
    checkout(path, item["url"], item["revision"], item.get("patches", ()))
    return path


def stb_image():
    """Directory holding the pinned single-file image decoder (public domain or MIT)."""
    pinned = LOCK["stbImage"]
    return fetch(pinned["url"], DEPS / "stbImage/stb_image.h", pinned["sha256"]).parent


def app_files(app):
    """App sources; an external app directory may also be its own repository."""
    for directory, folders, files in os.walk(app):
        folders[:] = sorted(f for f in folders if f not in (".git", "node_modules"))
        yield from (Path(directory) / f for f in sorted(files))



def resource_files(app, config):
    """Explicit read-only package resources, kept outside the JavaScript heap."""
    entries = config.get("resources", [])
    if not isinstance(entries, list) or len(entries) > 16:
        raise ValueError("resources must be an array of at most 16 relative paths")
    files = {}
    for entry in entries:
        if not isinstance(entry, str) or not entry or "\\" in entry or "\0" in entry:
            raise ValueError("resources must contain safe relative paths")
        relative = Path(entry)
        if relative.is_absolute() or any(part in (".", "..") for part in entry.split("/")):
            raise ValueError("resources cannot escape the app directory")
        source = app / relative
        if not source.exists(): raise ValueError(f"Missing resource: {entry}; generate it before building")
        candidates = [source, *sorted(source.rglob("*"))] if source.is_dir() else [source]
        for path in candidates:
            if path.is_symlink() or not path.resolve().is_relative_to(app.resolve()):
                raise ValueError(f"Resource symlinks are not supported: {entry}")
            target = path.relative_to(app)
            reserved = ("sce_sys", "sce_module", "notices", "certs", *(("fonts",) if config.get("textFonts") else ()))
            if target.parts[0] in reserved or str(target) in ("eboot.bin", "lapy.elf", "lapy-manifest.json"):
                raise ValueError(f"Resource would overwrite package infrastructure: {target}")
            if path.is_file(): files[target] = path
            elif not path.is_dir(): raise ValueError(f"Resource is not a regular file: {target}")
    return files

def app_config(app, config=None):
    """`app` is the app directory: apps/<name> or an external folder named <name>."""
    if not re.fullmatch(r"[a-z][a-z0-9-]*", app.name):
        raise ValueError("App directory name must use lowercase letters, numbers and hyphens")
    local = ROOT / "apps" / app.name
    if local.exists() and local.resolve() != app.resolve():
        raise ValueError(f"App name {app.name} already belongs to apps/{app.name}; rename the directory")
    if config is None:
        config = json.loads((app / "app.json").read_text())
    title = config["titleId"]
    if not re.fullmatch(r"PPSA\d{5}", title):
        raise ValueError("titleId must look like PPSA99053")
    if not re.fullmatch(r"[A-Z]{2}\d{4}-" + title + r"_00-[A-Z0-9]{16}", config["contentId"]):
        raise ValueError("contentId needs the same titleId and exactly 16 suffix characters")
    if not re.fullmatch(r"\d{2}\.\d{3}\.\d{3}", config["version"]):
        raise ValueError("version must look like 01.000.000")
    if "resolution" in config:
        if config["resolution"] != "auto":
            raise ValueError('resolution must be "auto"')
        if "render" in config or "surface" in config:
            raise ValueError('resolution "auto" chooses the render and surface sizes; remove render and surface')
    else:
        for field in ("render", "surface"):
            if field not in config:
                raise ValueError(f'{field} is required unless resolution is "auto"')
            for axis in ("width", "height"):
                value = config[field][axis]
                if type(value) is not int or not 1 <= value <= 3840:
                    raise ValueError(f"{field}.{axis} must be an integer between 1 and 3840")
    refresh = config.get("refreshRate", 60)
    if type(refresh) is not int or refresh not in (60, 120):
        raise ValueError("refreshRate must be 60 or 120")
    rates = config.get("refreshRates", [refresh])
    if (not isinstance(rates, list) or len(set(rates)) != len(rates)
            or any(type(rate) is not int or rate not in (60, 120) for rate in rates)):
        raise ValueError("refreshRates must list distinct rates from 60 and 120")
    if refresh not in rates:
        raise ValueError(f"refreshRates must include the starting refreshRate {refresh}")
    if type(config["timeoutSeconds"]) is not int or not 0 <= config["timeoutSeconds"] <= 3600:
        raise ValueError("timeoutSeconds must be 0 (disabled) or 1..3600")
    if not config["name"].strip() or len(config["name"]) > 80:
        raise ValueError("name must contain 1..80 characters")
    if config.get("filesystemAccess", "sandbox") not in ("sandbox", "console"):
        raise ValueError("filesystemAccess must be sandbox or console")
    if type(config.get("networking", False)) is not bool:
        raise ValueError("networking must be a boolean")
    if type(config.get("video", False)) is not bool:
        raise ValueError("video must be a boolean")
    if config.get("networking") and config.get("filesystemAccess", "sandbox") != "console":
        raise ValueError('networking requires filesystemAccess: "console" for the PS5 native transport')
    resource_files(app, config)
    from text_fonts import SCRIPTS
    fonts = config.get("textFonts", [])
    if not isinstance(fonts, list) or len(set(fonts)) != len(fonts) or not set(fonts) <= SCRIPTS.keys():
        raise ValueError(f"textFonts must list distinct scripts from: {', '.join(SCRIPTS)}")
    for other in (ROOT / "apps").glob("*/app.json"):
        if other.parent.resolve() != app.resolve() and json.loads(other.read_text())["titleId"] == title:
            raise ValueError(f"titleId already belongs to {other.parent.name}")
    return app, config


def refresh_rate_mask(config):
    """The rates Display.setRefreshRate may switch to: bit 0 for 60 Hz, bit 1 for 120 Hz."""
    rates = config.get("refreshRates", [config.get("refreshRate", 60)])
    return (1 if 60 in rates else 0) | (2 if 120 in rates else 0)


# Output sizes a "resolution": "auto" app is built for, smallest first; the PS5 picks one at launch.
AUTO_LAYOUTS = ((1920, 1080), (3840, 2160))


def layouts(config):
    """(render width, render height, surface width, surface height) of each layout the app is built for."""
    if config.get("resolution") == "auto":
        return [(width, height, width, height) for width, height in AUTO_LAYOUTS]
    render, surface = config["render"], config["surface"]
    return [(render["width"], render["height"], surface["width"], surface["height"])]


def layout_directory(generated, layout):
    """Bundle and baked assets of one layout, under the app's generated directory."""
    return generated / f"{layout[0]}x{layout[1]}"


def generated_config(config, directory):
    directory.mkdir(parents=True, exist_ok=True)
    definitions = {"TIMEOUT": config["timeoutSeconds"], "REFRESH_RATE": config.get("refreshRate", 60),
                   "REFRESH_RATES": refresh_rate_mask(config),
                   "NAME": config["name"], "TITLE": config["titleId"],
                   "CONSOLE_FILESYSTEM": int(config.get("filesystemAccess", "sandbox") == "console"),
                   "NETWORKING": int(config.get("networking", False)),
                   "VIDEO": int(config.get("video", False))}
    (directory / "app_config.hpp").write_text("#pragma once\n" + "".join(
        f"#define PS5_REACT_{key} {json.dumps(value)}\n" for key, value in definitions.items()))


def bundle(app, er):
    app, config = app_config(app)
    output = ROOT / ".build" / app.name / "generated"
    generated_config(config, output)
    package = er / "bridges/quickjs/js"
    if not (package / "node_modules").exists():
        run(["npm", "ci", "--omit=optional"], cwd=package, log=ROOT / ".build/npm-upstream.log")
    for layout in layouts(config):
        directory = layout_directory(output, layout)
        directory.mkdir(exist_ok=True)
        run(["node", ROOT / "tools/bundle.mjs", er, app, directory, str(layout[0]), str(layout[1])],
            log=output.parent / f"bundle-{directory.name}.log")
    from text_fonts import text_fonts
    text_fonts(config, output / "fonts")
    return app, config, output
