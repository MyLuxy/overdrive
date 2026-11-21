# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Build the pinned exact-title Lapy helper with the application's payload SDK."""
import argparse
import json
from pathlib import Path
import re
import shutil

from common import ROOT, DEPS, LOCK, dependency, digest, fetch, run


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("title")
    parser.add_argument("output", type=Path)
    parser.add_argument("--sdk", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"PPSA[0-9]{5}", args.title):
        parser.error("title must use PPSA followed by five digits")

    source = dependency("filesystemHelper")
    run(["python3", ROOT / "tools/test_helper_credentials.py", source,
         args.output / "credential-tests"])
    logging = DEPS / "filesystemHelperLogging"
    pinned = LOCK["filesystemHelperLogging"]
    fetch(pinned["url"], logging / "ps5log.h", pinned["sha256"])
    run(["python3", source / "tools/build_owned_daemon.py",
         "--sdk", args.sdk.resolve(), "--logging-client", logging,
         "--elf-helper", "--title", args.title])
    built = source / f"build/owned_root_helper-{args.title}"
    elf = built / "lapy.elf"
    manifest_path = built / "lapy-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    expected = {"schema": "lapy-owned-build/1", "target_title": args.title,
                "mode": "elf-helper", "max_requests": 1, "service": False,
                "require_client_result": False, "console_validated": False,
                "features": ["root_layout_probe_retry"],
                "elf_sha256": digest(elf),
                "protocol_sha256": "bb02c4aa814eaba7a7a423a31b29ff41f786212c2953678cf29434e85fa0f869"}
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise RuntimeError(f"Lapy manifest {key}: expected {value!r}, got {manifest.get(key)!r}")
    if elf.read_bytes()[:6] != b"\x7fELF\x02\x01":
        raise RuntimeError("Lapy helper is not a little-endian ELF64")
    args.output.mkdir(parents=True, exist_ok=True)
    for path in (elf, manifest_path):
        shutil.copy2(path, args.output / path.name)
    shutil.copy2(source / "LICENSE", args.output / "Lapy-MIT.txt")
    print(f"Lapy helper verified: {manifest['elf_sha256']}")


if __name__ == "__main__":
    main()
