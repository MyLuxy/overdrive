#!/usr/bin/env python3
"""Mark the catalog's VR games: "vr": ["psvr"] on a PS4 game PlayStation VR plays, ["psvr2"] on a
PS5 game for PlayStation VR2. The app's VR filter reads it (issue #92).

    python -P tools/vr-games.py [--write] [--env-file <path>] [--cache <dir>]

Two sources, both by game:
  1. andshrew/PlayStation-Titles (MIT), the PS4 list's psVR column (Required or Supported), by title
     ID and by the other title IDs of the same concept: a game's other regions are VR too.
  2. IGDB, the names of every game of its PlayStation VR (165) and PlayStation VR2 (390) platforms,
     matched by title without the edition's words (tools/catalog_editions.py). A PS4 game takes
     PS VR from it, a PS5 game PS VR2. It needs IGDB_CLIENT_ID and IGDB_CLIENT_SECRET, from the
     environment or --env-file; without them only the PS4 list is read.

Every run sets the field from the sources again, on every catalog entry (games and twins), so it
also runs each night after the importers. Without --write it only prints what it would change.
"""
import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # this folder's own modules, under -P too
from catalog_editions import edition_key  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CATALOG = os.path.join(ROOT, "app", "data", "catalog.js")
ANDSHREW = "https://raw.githubusercontent.com/andshrew/PlayStation-Titles/main/PS4_Titles.tsv"
PLATFORMS = {"psvr": 165, "psvr2": 390}
LINE = re.compile(r'^\s*\{ "id": "([A-Z0-9]+)", "title": "((?:[^"\\]|\\.)*)", "platform": "(\w+)"')
VR = re.compile(r', "vr": \[[^\]]*\]')
FEATURES = re.compile(r'"features": \[[^\]]*\]')
UA = "Mozilla/5.0 (Overdrive catalog tool)"


def get(url, data=None, headers=None):
    request = urllib.request.Request(url, data=data, headers={"User-Agent": UA, **(headers or {})})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def psvr_titles(cache):
    """The PS4 title IDs andshrew's list marks psVR, with the rest of their concepts' IDs."""
    path = os.path.join(cache, "PS4_Titles.tsv")
    if not os.path.exists(path) or time.time() - os.path.getmtime(path) > 7 * 86400:
        os.makedirs(cache, exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(get(ANDSHREW))
    rows = list(csv.DictReader(open(path, encoding="utf-8", errors="replace"), delimiter="\t"))
    concepts = {row["conceptId"] for row in rows if row.get("psVR")}
    return {row["titleId"].split("_")[0] for row in rows if row.get("psVR") or row["conceptId"] in concepts}


def igdb_names(env, cache):
    """{"psvr": {edition keys}, "psvr2": {...}} from IGDB's VR platforms, kept a week in the cache."""
    path = os.path.join(cache, "igdb-vr.json")
    if os.path.exists(path) and time.time() - os.path.getmtime(path) < 7 * 86400:
        return {kind: set(keys) for kind, keys in json.load(open(path, encoding="utf-8")).items()}
    if not env.get("IGDB_CLIENT_ID") or not env.get("IGDB_CLIENT_SECRET"):
        return {}
    query = urllib.parse.urlencode({"client_id": env["IGDB_CLIENT_ID"], "client_secret": env["IGDB_CLIENT_SECRET"],
                                    "grant_type": "client_credentials"})
    token = json.loads(get(f"https://id.twitch.tv/oauth2/token?{query}", data=b""))["access_token"]
    headers = {"Client-ID": env["IGDB_CLIENT_ID"], "Authorization": f"Bearer {token}", "Accept": "application/json"}
    names = {}
    for kind, platform in PLATFORMS.items():
        keys, offset = set(), 0
        while True:
            # Sorted, or pages of the same query can overlap and skip games (Horizon Call of the
            # Mountain fell out of one run).
            body = f"fields name,alternative_names.name; where platforms = ({platform}); sort id asc; limit 500; offset {offset};"
            batch = json.loads(get("https://api.igdb.com/v4/games", data=body.encode(), headers=headers))
            for game in batch:
                for name in [game.get("name")] + [alt.get("name") for alt in game.get("alternative_names") or []]:
                    if name and edition_key(name):
                        keys.add(edition_key(name))
            if len(batch) < 500:
                break
            offset += 500
            time.sleep(0.3)
        names[kind] = keys
    os.makedirs(cache, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({kind: sorted(keys) for kind, keys in names.items()}, handle)
    return names


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--env-file")
    parser.add_argument("--cache", default=os.path.join(os.path.dirname(ROOT), ".enrich-cache"))
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    env = dict(os.environ)
    if args.env_file:
        for line in open(args.env_file, encoding="utf-8"):
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                env.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    psvr = psvr_titles(args.cache)
    names = igdb_names(env, args.cache)
    print("IGDB:", ", ".join(f"{kind} {len(keys)} names" for kind, keys in names.items()) or "off (no IGDB_CLIENT_ID / IGDB_CLIENT_SECRET)")
    lines = open(CATALOG, encoding="utf-8").read().split("\n")
    marked, changed = {"psvr": [], "psvr2": []}, 0
    for index, line in enumerate(lines):
        match = LINE.match(line)
        if not match or not FEATURES.search(line):
            continue
        game_id, platform = match.group(1), match.group(3)
        title = json.loads('"%s"' % re.sub(r"\\(?![\x22\\/bfnrtu])", "", match.group(2)))
        key = edition_key(title)
        kinds = []
        if platform == "ps4" and (game_id in psvr or key in names.get("psvr", ())):
            kinds.append("psvr")
        if platform == "ps5" and key in names.get("psvr2", ()):
            kinds.append("psvr2")
        for kind in kinds:
            marked[kind].append(title)
        new = VR.sub("", line)
        if kinds:
            found = FEATURES.search(new)
            new = new[:found.end()] + ', "vr": ' + json.dumps(kinds) + new[found.end():]
        if new != line:
            lines[index] = new
            changed += 1
    for kind, titles in marked.items():
        print(f"{kind}: {len(titles)} games, e.g. {', '.join(sorted(titles)[:12])}")
    print(f"lines to change: {changed}")
    if args.write and changed:
        with open(CATALOG, "w", encoding="utf-8", newline="") as handle:
            handle.write("\n".join(lines))
        print("written: catalog.js")


if __name__ == "__main__":
    main()
