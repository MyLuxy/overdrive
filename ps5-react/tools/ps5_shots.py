# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Fetches `shot:NAME` screenshots from a test deploy's dev/ folder through a running PS5Upload app.

    PS5_ADDR=<console IP> python3 tools/ps5_shots.py PPSA99058 shots/ [NAME ...]

Downloads dev/NAME.bmp (every .bmp when no names are given) from /data/homebrew/<TITLE_ID> with
PS5Upload's local API (PS5UPLOAD_URL, default http://127.0.0.1:19113) and writes NAME.png next to
it. Only reads from the console; it never uploads, launches or deletes.
"""
import argparse
import json
import os
from pathlib import Path
import time
import urllib.parse
import urllib.request

from PIL import Image


def call(api, path, body=None):
    request = urllib.request.Request(api + path, data=None if body is None else json.dumps(body).encode(),
                                     headers={"content-type": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("title")
    parser.add_argument("out", type=Path)
    parser.add_argument("names", nargs="*")
    args = parser.parse_args()
    address = os.environ.get("PS5_ADDR")
    if not address:
        raise SystemExit("Set PS5_ADDR to the console's IP address")
    api = os.environ.get("PS5UPLOAD_URL", "http://127.0.0.1:19113")
    dev = f"/data/homebrew/{args.title}/dev"
    listing = call(api, "/api/ps5/list-dir?" + urllib.parse.urlencode({"addr": address, "path": dev}))
    if "entries" not in listing:
        raise SystemExit(f"list {dev}: {listing.get('error', listing)}")
    names = args.names or [e["name"][:-4] for e in listing["entries"] if e["name"].endswith(".bmp")]
    args.out.mkdir(parents=True, exist_ok=True)
    for name in names:
        bmp = args.out / f"{name}.bmp"
        bmp.unlink(missing_ok=True)
        job = call(api, "/api/transfer/download", {"addr": f"{address}:9113", "src_path": f"{dev}/{name}.bmp",
                                                    "kind": "file", "dest_dir": str(args.out.resolve())})
        for _ in range(60):
            status = call(api, f"/api/jobs/{job['job_id']}")
            if status.get("status") not in ("queued", "running"):
                break
            time.sleep(0.5)
        if status.get("status") != "done" or not bmp.exists():
            raise SystemExit(f"download {dev}/{name}.bmp: {status.get('error', status.get('status'))}")
        Image.open(bmp).save(args.out / f"{name}.png")
        bmp.unlink()
        print(args.out / f"{name}.png")


if __name__ == "__main__":
    main()
