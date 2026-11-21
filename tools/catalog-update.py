#!/usr/bin/env python3
"""Write catalog-update.json: what the importers changed in app/data since a release.

    python -P tools/catalog-update.py --base <tag> --version <x.y.z> --out <file> [--max-mb 4]

The nightly catalog workflow (.github/workflows/catalog.yml) runs the importers on a checkout of main,
then this, against the latest published release: the players have that release's catalog, so the
update holds what an importer, or main since, changed in it. The app (app/state/catalog-update.js)
applies it only when it is that version. It holds

    format     1
    version    the release it applies to ("1.0.9")
    base       that release's commit
    generated  when, in UTC
    games      every catalog entry added or changed, whole, with the block it belongs in
               ({"block": "games" | "twins", "line": {...}})
    removed    the ids of the entries gone
    releases   {id: [records]} for every release file added or changed (null: removed)
    pages      {id: page} for every page file added or changed (null: removed)

An update over --max-mb is not written, with a warning: main then holds more than the release (an
import not released yet), and the app should not download that every day; the next release folds it.
"""
import argparse
import datetime
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = "app/data"
ID = re.compile(r'^\s*\{ "id": "([^"]+)"')


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], capture_output=True, check=True).stdout


def entries(text):
    """{id: (block, line text)} for every catalog entry."""
    out, block = {}, None
    for line in text.split("\n"):
        opened = re.match(r"^\s*var (\w+) = \[$", line)
        if opened:
            block = opened.group(1)
            continue
        found = ID.match(line)
        if found and block in ("games", "twins"):
            out[found.group(1)] = (block, line.strip().rstrip(","))
    return out


def parse(line):
    # The bundle's \xNN escapes read as JSON's.
    return json.loads(re.sub(r"\\x([0-9a-fA-F]{2})", r"\\u00\1", line))


def changed_files(base, folder):
    """{id: content or None} for the files of app/data/<folder> that differ from the base: changed
    since it (committed or not), new, or gone."""
    path = f"{DATA}/{folder}"
    names = set(git("diff", "--name-only", base, "--", path).decode("utf-8").split())
    names |= set(git("ls-files", "--others", "--exclude-standard", "--", path).decode("utf-8").split())
    out = {}
    for name in sorted(names):
        if not name.endswith(".json"):
            continue
        full = os.path.join(ROOT, name)
        out[os.path.basename(name)[:-5]] = json.load(open(full, encoding="utf-8")) if os.path.exists(full) else None
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--base", required=True, help="the latest published release's tag")
    parser.add_argument("--version", required=True, help="that release's app version")
    parser.add_argument("--out", required=True)
    parser.add_argument("--max-mb", type=float, default=4)
    args = parser.parse_args()
    base = git("rev-parse", f"{args.base}^{{commit}}").decode().strip()
    before = entries(git("show", f"{base}:{DATA}/catalog.js").decode("utf-8"))
    after = entries(open(os.path.join(ROOT, DATA, "catalog.js"), encoding="utf-8").read())
    games = [{"block": block, "line": parse(line)} for game_id, (block, line) in after.items() if before.get(game_id) != (block, line)]
    update = {
        "format": 1,
        "version": args.version,
        "base": base,
        "generated": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "games": games,
        "removed": sorted(game_id for game_id in before if game_id not in after),
        "releases": changed_files(base, "releases"),
        "pages": changed_files(base, "pages"),
    }
    body = json.dumps(update, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    added = sum(1 for game in games if game["line"]["id"] not in before)
    print(f"update for {args.version} ({base[:7]}): {added} games added, {len(games) - added} changed, {len(update['removed'])} removed, "
          f"{len(update['releases'])} release files, {len(update['pages'])} pages, {len(body) / 1048576:.2f} MB")
    if len(body) > args.max_mb * 1048576:
        print(f"::warning::the update is over {args.max_mb} MB, not published: main holds more than {args.version} "
              "(an import not released yet); the next release folds it in")
        return
    with open(args.out, "wb") as handle:
        handle.write(body)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
