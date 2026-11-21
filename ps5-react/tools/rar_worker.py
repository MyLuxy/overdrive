# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""rar-extract (native/rar_worker): RarLab's UnRAR library and a small MIT-licensed driver, built as a
program of its own. UnRAR's license allows its use to extract RAR archives but is not GPL-compatible,
so it is never linked into the engine; the engine starts this program and reads its reports. The same
program extracts a 7z too large for the engine's heap with libarchive (sevenzip.cpp), so `libraries`
include libarchive and what it links.
"""
import subprocess
import sys
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from common import DEPS, LOCK, ROOT, digest, fetch

# The library objects of UnRAR's makefile, without its command line front end and unrar.dll layer.
SOURCES = ("strlist strfn pathfn smallfn global file filefn filcreat archive arcread unicode system crypt "
           "crc rawread encname resource match timefn rdwrfn consio options errhnd rarvm secpassword "
           "rijndael getbits sha1 sha256 blake2s hash extinfo extract volume list find unpack headers "
           "threadpool rs16 cmddata ui largepage filestr scantree qopen").split()
DEFINES = ["-DRARDLL", "-DSILENT", "-DRAR_SMP", "-DUNRAR_UTF8_NAMES", "-D_FILE_OFFSET_BITS=64", "-D_LARGEFILE_SOURCE"]


def unrar_source():
    """The pinned UnRAR source tree with the repository's patches applied."""
    pinned = LOCK["unrarSource"]
    root = DEPS / f"unrar-{pinned['version']}"
    marker = root / ".patched"
    patches = [ROOT / p for p in pinned["patches"]]
    expected = "\n".join(digest(p) for p in patches) + "\n"
    if not marker.exists() or marker.read_text() != expected:
        archive = fetch(pinned["url"], DEPS / f"unrarsrc-{pinned['version']}.tar.gz", pinned["sha256"])
        root.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive) as package:
            for member in package.getmembers():
                member.name = member.name.removeprefix("unrar/")
                if member.isfile() and "/" not in member.name:
                    package.extract(member, root, filter="data")
        for patch in patches:
            subprocess.run(["patch", "-p1", "--forward", "--quiet", "-i", str(patch)], cwd=root, check=True)
        marker.write_text(expected)
    return root


def up_to_date(target, command, inputs):
    """Whether `target` was made by `command` (recorded beside it) and is newer than every input."""
    recorded = target.with_name(target.name + ".cmd")
    if not target.exists() or not recorded.exists() or recorded.read_text() != "\0".join(command):
        return False
    built = target.stat().st_mtime
    return all(Path(p).exists() and Path(p).stat().st_mtime <= built for p in inputs)


def depfile_inputs(depfile):
    """The files listed in a compiler -MMD depfile, or None when it is missing."""
    if not depfile.exists():
        return None
    text = depfile.read_text().replace("\\\n", " ")
    return text.split(":", 1)[1].split() if ":" in text else None


def build(output, compiler, flags=(), libraries=(), env=None):
    """Compiles UnRAR and the driver with `compiler` (a command list) and links `output`, skipping objects
    and the link when their command and inputs are unchanged since the last build."""
    source = unrar_source()
    objects = output.parent / (output.name + ".obj")
    objects.mkdir(parents=True, exist_ok=True)
    common = [*compiler, "-O2", "-fexceptions", *DEFINES, *flags]

    def compile_one(item):
        path, extra = item
        obj = objects / (path.stem + ".o")
        depfile = obj.with_suffix(".d")
        # UnRAR's headers are a system include for the driver, which builds with the engine's warnings.
        command = [*map(str, common), *extra, "-isystem", str(source), "-MMD", "-MF", str(depfile),
                   "-c", str(path), "-o", str(obj)]
        inputs = depfile_inputs(depfile)
        if inputs is not None and up_to_date(obj, command, inputs):
            return obj
        result = subprocess.run(command, capture_output=True, text=True, env=env)
        if result.returncode:
            raise RuntimeError(f"{path.name}: {result.stderr[-4000:]}")
        obj.with_name(obj.name + ".cmd").write_text("\0".join(command))
        return obj

    library = ["-std=c++17", "-w"]
    driver = ["-std=c++20", "-Wall", "-Wextra", "-Werror"]
    items = [(source / f"{name}.cpp", library) for name in SOURCES] + [
        (ROOT / "native/rar_worker" / name, driver) for name in ("rar_worker.cpp", "sevenzip.cpp")]
    with ThreadPoolExecutor(8) as pool:
        built = list(pool.map(compile_one, items))
    command = [*map(str, compiler), *map(str, flags), *map(str, built), *map(str, libraries), "-o", str(output)]
    if up_to_date(output, command, [*built, *libraries]):
        return output
    result = subprocess.run(command, capture_output=True, text=True, env=env)
    if result.returncode:
        raise RuntimeError(f"rar-extract link: {result.stderr[-4000:]}")
    output.with_name(output.name + ".cmd").write_text("\0".join(command))
    return output


def archive_prefix():
    """The prefix holding archive.h, as pkg-config, Homebrew or MacPorts reports it."""
    for command in (["pkg-config", "--variable=prefix", "libarchive"], ["brew", "--prefix", "libarchive"]):
        try:
            candidate = subprocess.check_output(command, text=True, stderr=subprocess.DEVNULL).strip()
        except (OSError, subprocess.CalledProcessError):
            continue
        if candidate and (Path(candidate) / "include/archive.h").exists():
            return candidate
    for candidate in ("/opt/local", "/usr/local", "/opt/homebrew"):
        if (Path(candidate) / "include/archive.h").exists():
            return candidate
    raise RuntimeError("libarchive not found: install it with Homebrew or MacPorts")


def build_host(output):
    """rar-extract for the desktop preview and the archive tests."""
    # macOS hashes with CommonCrypto and keeps Homebrew's libarchive keg-only; elsewhere the driver uses
    # OpenSSL's EVP and the system's libarchive. MacPorts' libarchive is found through pkg-config too.
    if sys.platform == "darwin":
        prefix = archive_prefix()
        return build(output, ["clang++"], ["-pthread", "-I", f"{prefix}/include"], ["-L", f"{prefix}/lib", "-larchive"])
    return build(output, ["clang++"], ["-pthread"], ["-larchive", "-lcrypto"])
