# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Mozilla's root certificates as curl publishes them (MPL-2.0), pinned in the lock file.

Old firmwares' own certificate store lacks roots that sites use today; networking apps ship this
bundle and the console merges it with the system store at start (native/ps5/network_platform.cpp).
`python3 tools/ca_bundle.py` pins the newest dated copy from curl.se, after the same checks a build runs.
"""
import base64
import binascii
import json
import re
import ssl
import sys
import urllib.request
from common import DEPS, LOCK, ROOT, digest, fetch

PAGE = "https://curl.se/docs/caextract.html"
BLOCK = re.compile(rb"-----BEGIN CERTIFICATE-----\r?\n(.+?)-----END CERTIFICATE-----", re.S)


def validate(path):
    """Every block decodes, OpenSSL loads every one, and the count looks like Mozilla's store."""
    data = path.read_bytes()
    if len(data) > 1024 * 1024 or b"\0" in data:
        raise RuntimeError(f"{path.name}: not a PEM bundle")
    blocks = BLOCK.findall(data)
    if data.count(b"-----BEGIN") != len(blocks) or not 100 <= len(blocks) <= 400:
        raise RuntimeError(f"{path.name}: {len(blocks)} certificates, expected 100-400")
    try:
        for block in blocks: base64.b64decode(block, validate=False)
    except binascii.Error as error:
        raise RuntimeError(f"{path.name}: undecodable certificate: {error}")
    loaded = ssl.create_default_context(cafile=str(path)).cert_store_stats()["x509_ca"]
    if loaded != len(blocks):
        raise RuntimeError(f"{path.name}: OpenSSL loaded {loaded} of {len(blocks)} certificates")
    return len(blocks)


def ca_bundle():
    item = LOCK["caBundle"]
    path = fetch(item["url"], DEPS / "ca-bundle" / f"cacert-{item['version']}.pem", item["sha256"])
    validate(path)
    return path


def update():
    with urllib.request.urlopen(PAGE, timeout=60) as page:
        dates = sorted(set(re.findall(r"cacert-(\d{4}-\d{2}-\d{2})\.pem", page.read().decode())))
    if not dates: raise RuntimeError(f"No dated bundle listed on {PAGE}")
    version = dates[-1]
    url = f"https://curl.se/ca/cacert-{version}.pem"
    path = DEPS / "ca-bundle" / f"cacert-{version}.pem"
    path.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=120) as source:
        path.write_bytes(source.read())
    count = validate(path)
    lock_path = ROOT / "dependencies.lock.json"
    lock = json.loads(lock_path.read_text())
    previous = lock.get("caBundle", {}).get("version")
    lock["caBundle"] = {"version": version, "url": url, "sha256": digest(path)}
    lock_path.write_bytes((json.dumps(lock, indent=2) + "\n").encode())
    print(f"caBundle {previous} -> {version}: {count} certificates")


if __name__ == "__main__":
    if sys.argv[1:] not in ([], ["--check"]):
        sys.exit("usage: ca_bundle.py [--check]")
    if sys.argv[1:] == ["--check"]: print(f"{ca_bundle().name}: {validate(ca_bundle())} certificates")
    else: update()
