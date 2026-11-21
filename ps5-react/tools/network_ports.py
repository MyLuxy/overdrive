# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Extract only the pinned networking ports, never replace the payload SDK."""
import json
import shutil
import tarfile
from common import DEPS, LOCK, fetch, verify


def ports():
    item = LOCK["networkPorts"]
    root = DEPS / "network-ports" / item["version"]
    marker = root / ".complete"
    if not marker.exists() or marker.read_text().strip() != item["sha256"] or not (root / "lib/libarchive.a").exists() or not (root / "include/lzma.h").exists() or not (root / "include/zlib.h").exists():
        archive = fetch(item["url"], DEPS / "network-ports.tar.gz", item["sha256"])
        prefix = "opt/ps5-payload-sdk/target/user/homebrew/"
        libraries = {"libcurl.a", "libssl.a", "libcrypto.a", "libz.a", "libzstd.a", "libpsl.a", "libarchive.a", "liblzma.a", "libbz2.a"}
        root.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive) as package:
            for member in package:
                name = member.name.removeprefix("./")
                if not name.startswith(prefix):
                    continue
                relative = name[len(prefix):]
                if relative in {"include/archive.h", "include/archive_entry.h", "include/lzma.h", "include/zlib.h", "include/zconf.h"} or relative.startswith(("include/curl/", "include/openssl/", "include/lzma/")) or relative in {
                    "lib/" + name for name in libraries
                }:
                    member.name = relative
                    package.extract(member, root, filter="data")
        if any(not (root / "lib" / name).is_file() for name in libraries):
            raise RuntimeError("Pinned networking archive has an unexpected layout")
        marker.write_text(item["sha256"] + "\n")
    return root


def copy_notices(reference, destination):
    destination.mkdir(parents=True, exist_ok=True)
    for entry in json.loads((reference / "third_party/PACBREW_LICENSES.json").read_text()):
        source = reference / entry["file"]
        verify(source, entry["sha256"])
        shutil.copy2(source, destination / (entry["component"] + "-LICENSE"))
    shutil.copy2(reference / "third_party/PACBREW_LICENSES.json", destination / "SOURCES.json")
