#!/usr/bin/env python3
"""Write each game's package formats into catalog.js, for the library's "Package format" filter.

    python -I tools/sync-formats.py [--check]

A game's page lists its sources from data/releases/<id>.json, a file the app only reads when that
game is opened. The filter drawer counts every game at once, so the formats it needs sit in the
catalog itself, as a "formats" list next to "providers":

    "providers": ["1fichier", "vikingfile"], "formats": ["exfat", "pkg"], "direct": true, ...

The list holds the lower-case formats of the game's sources (pkg, exfat, ffpfsc, rar, ...), sorted.
"binary" is left out: it means the source did not say, and the app only learns what it is after the
download. A game with no known format gets no "formats" key. Run it again whenever a release file
changes: it rewrites only the lines whose list changed, and --check exits 1 instead of writing when
the catalog is out of date (for CI).
"""
import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "app" / "data"
CATALOG = DATA / "catalog.js"
RELEASES = DATA / "releases"

GAME_LINE = re.compile(r'^\s*\{ "id": "([^"]+)"')
PROVIDERS = re.compile(r'"providers": \[[^\]]*\]')
FORMATS = re.compile(r', "formats": \[[^\]]*\]')
UNKNOWN = {"binary", ""}
# The same file type under another name; app/game/sources.js reads both as one kind.
ALIASES = {"fpkg": "pkg"}


def formats_of(game_id):
    """The sorted known formats of a game's sources; empty when it has no release file."""
    path = RELEASES / (game_id + ".json")
    if not path.exists():
        return []
    found = set()
    for release in json.loads(path.read_text(encoding="utf-8")):
        name = str(release.get("format") or "").lower().lstrip(".")
        name = ALIASES.get(name, name)
        if name not in UNKNOWN:
            found.add(name)
    return sorted(found)


def with_formats(line, formats):
    """The catalog line with its "formats" list set to `formats` (the key is dropped when empty)."""
    bare = FORMATS.sub("", line, count=1)
    if not formats:
        return bare
    providers = PROVIDERS.search(bare)
    if not providers:
        raise ValueError("no providers list to put formats after: " + bare[:80])
    text = ', "formats": [%s]' % ", ".join(json.dumps(name) for name in formats)
    return bare[:providers.end()] + text + bare[providers.end():]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--check", action="store_true", help="exit 1 if catalog.js is out of date, write nothing")
    args = parser.parse_args()

    lines = CATALOG.read_text(encoding="utf-8").split("\n")
    updated, changed = [], 0
    for line in lines:
        match = GAME_LINE.match(line)
        new = with_formats(line, formats_of(match.group(1))) if match else line
        changed += new != line
        updated.append(new)

    if args.check:
        print("%d catalog lines out of date" % changed)
        return 1 if changed else 0
    if changed:
        CATALOG.write_text("\n".join(updated), encoding="utf-8")
    print("%d catalog lines updated" % changed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
