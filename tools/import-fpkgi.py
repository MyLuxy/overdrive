#!/usr/bin/env python3
"""Import the fPKG collection's PS4 packages into Overdrive's catalog.

    python -P tools/import-fpkgi.py [--json <file>] [--write] [--report <file>]

GAMES.json is the fPKG collection's index, a map of package URLs to

    {"title_id": "CUSA09267", "region": "USA", "name": "A Hat in Time",
     "version": "01.04", "release": "11-15-2013", "size": 7746420736,
     "min_fw": "9.00", "cover_url": "https://..."}

The catalog is app/data/catalog.js and app/data/releases. The script only adds what is missing:

- a game the catalog lacks is added, or the PS4 edition of a PS5 game already in the catalog as its
  twin (tools/catalog_editions.py), never as a second game; a same-title PS4 game of another region
  keeps the package in its own release list, with "titleId" naming the package;
- a game that already has archive.org gains the provider only when it is missing, so a game hidden
  for want of a source is listed again;
- a package the releases do not have is added as a record tagged source "fpkgi", with the exact size
  from the JSON;
- a package whose URL, or whose item and file name, is already in a release file is left exactly as
  it is (the user's choice, 2026-10-25): its old "unavailableReason" may stay, since the app ignores
  it while an Archive.org account is signed in (app/state/archive-account.js).

The script writes nothing without --write. --report saves what it would change. After --write it
asks tools/enrich-catalog.py for what the PlayStation Store holds and the catalog lacks (the
description and its screenshots, genres, publisher, release date, art), for the games it added or
changed: --enrich-all fills every game of the index, --no-enrich skips it. Without --write it only
looks the details up when --enrich is given, and writes nothing.
"""
import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
from urllib.parse import unquote

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # this folder's own modules, under -P too
import catalog_editions as editions  # noqa: E402
from catalog_editions import edition_key  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "app", "data")
CATALOG = os.path.join(DATA, "catalog.js")
RELEASES = os.path.join(DATA, "releases")
DEFAULT_JSON = os.path.join(ROOT, "GAMES.json")
SOURCE = "fpkgi"
TITLE_ID = re.compile(r"^(?:CUSA|PPSA)\d{5}$")
LINE = re.compile(
    r'^\s*\{ "id": "([^"]+)", "title": "((?:[^"\\]|\\.)*)", "platform": "(\w+)", '
    r'"providers": \[([^\]]*)\]'
)
ARCHIVE_DOWNLOAD = re.compile(r"^https?://archive\.org/download/[^/?#]+/.+$", re.I)
ARCHIVE_FILE = re.compile(r"^https?://(?:www\.)?archive\.org/download/([^/?#]+)/(.+?)(?:[?#].*)?$", re.I)
NODE_COVER = re.compile(r"^https?://[^/]+\.archive\.org/\d+/items/(.+)$", re.I)
# The catalog's region names, by the fPKG index's own.
REGIONS = {"USA": "USA", "EUR": "EUR", "JAP": "JPN", "JPN": "JPN", "ASI": "ASIA", "ASIA": "ASIA"}


def title_key(title):
    """A title without its marks and a trailing console name, for finding another region's entry."""
    title = html.unescape(title)
    title = re.sub(r"[\u2122\u00ae\u00a9]", "", title)
    title = re.sub(r"\s+(?:PS4|PS5)\s*$", "", title, flags=re.I)
    return re.sub(r"[^a-z0-9]", "", title.lower())


def parse_line(line):
    """A catalog entry's line as a dict; the bundle's \\xNN escapes read as JSON's."""
    text = re.sub(r"\\x([0-9a-fA-F]{2})", r"\\u00\1", line.strip().rstrip(","))
    return json.loads(text)


def catalog_games():
    """{id: {line, index, block, title, platform, providers}} and the file's lines."""
    with open(CATALOG, encoding="utf-8") as handle:
        lines = handle.read().split("\n")
    games, block = {}, None
    for index, line in enumerate(lines):
        opened = re.match(r"^\s*var (\w+) = \[$", line)
        if opened:
            block = opened.group(1)
            continue
        match = LINE.match(line)
        if not match or block not in ("games", "twins"):
            continue
        title = parse_line(line)["title"]
        providers = [item.strip().strip('"') for item in match.group(4).split(",") if item.strip()]
        games[match.group(1)] = {
            "index": index, "line": line, "block": block, "title": title,
            "platform": match.group(3), "providers": providers,
        }
    return games, lines


def read_releases():
    out = {}
    for name in sorted(os.listdir(RELEASES)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(RELEASES, name), encoding="utf-8") as handle:
            rows = json.load(handle)
        if isinstance(rows, list):
            out[name[:-5]] = rows
    return out


def archive_file(url):
    """The item and file an Archive.org download URL names, decoded; None for another URL."""
    match = ARCHIVE_FILE.match(url or "")
    return (unquote(match.group(1)), unquote(match.group(2))) if match else None


def same_link(rows, url):
    """Whether a release record already holds this package, however its URL is spelled."""
    wanted = archive_file(url)
    for row in rows:
        for field in ("url", "browserUrl"):
            value = row.get(field)
            if value == url:
                return True
            if wanted and isinstance(value, str) and archive_file(value) == wanted:
                return True
    return False


def archival_cover(url):
    """The archival form of an item's icon, which survives the node that served it."""
    url = (url or "").strip()
    match = NODE_COVER.match(url)
    if match:
        return "https://archive.org/download/" + match.group(1)
    return url if url.startswith("https://") else ""


def size_gb(bytes_count):
    return round(bytes_count / 1024 ** 3, 3)


def entry_of(url, value):
    """The index's entry checked and normalised; (entry, None) or (None, why it was left out)."""
    if not isinstance(value, dict):
        return None, "not an entry"
    title_id = str(value.get("title_id") or "").strip().upper()
    if not TITLE_ID.match(title_id):
        return None, "no title id"
    name = html.unescape(str(value.get("name") or "")).strip()
    if not name:
        return None, "no name"
    if not ARCHIVE_DOWNLOAD.match(url or ""):
        return None, "other host"
    size = value.get("size")
    if not isinstance(size, int) or size <= 0:
        return None, "no size"
    version = str(value.get("version") or "").strip()
    if not version:
        return None, "no version"
    region = REGIONS.get(str(value.get("region") or "").strip().upper(), "")
    return {
        "title_id": title_id,
        "title": name,
        "version": version,
        "size": size,
        "region": region,
        "cover": archival_cover(value.get("cover_url")),
        "sizeGb": size_gb(size),
        "platform": "ps5" if title_id.startswith("PPSA") else "ps4",
    }, None


def record_for(entry, game_id, url):
    """A release record for one package, as the other importers write them."""
    release_id = "r" + hashlib.sha256(("%s|%s" % (game_id, url)).encode("utf-8")).hexdigest()[:12]
    version = entry["version"]
    label = "%s Base (v%s) - Direct" % (entry["region"], version) if entry["region"] else "Base (v%s) - Direct" % version
    record = {
        "id": release_id,
        "format": "pkg",
        "filename": "%s-game-%s-%s.pkg" % (entry["title_id"], version, release_id),
        "url": url,
        "requiresBrowser": False,
        "sizeBytes": entry["size"],
        "version": version,
        "category": "game",
        "provider": "archive.org",
        "source": SOURCE,
        "flow": "direct",
        "label": label,
        "platform": entry["platform"],
        "record": "%s-%s-%s" % (SOURCE, entry["title_id"], version),
        "health": "ok",
    }
    # Another region's package on this game: the file's own title id, as tools/import-pegasus.py.
    if entry["title_id"] != game_id:
        record["titleId"] = entry["title_id"]
    return record


def new_line(entry, game_id, work=None):
    """A catalog entry with what the app needs to list the game; enrich-catalog.py fills the rest."""
    fields = [
        ("id", game_id), ("title", entry["title"]), ("platform", entry["platform"]),
        ("providers", ["archive.org"]), ("direct", False), ("developer", ""), ("publisher", ""),
        ("releaseDate", ""), ("genres", []), ("features", []), ("recommendations", 0),
        ("sizeGb", entry["sizeGb"]),
        ("art", {"cover": entry["cover"]} if entry["cover"] else {}),
    ]
    if entry["region"]:
        fields.append(("region", entry["region"]))
    fields += [("added", editions.today()), ("source", SOURCE)]
    return editions.render_line(editions.with_work(fields, work))


# The hosts the app hides today (app/state/paused-hosts.js): a game with only these is not listed.
PAUSED = {"1fichier", "datavaults", "buzzheavier", "gofile", "rapidgator", "filecrypt", "ranoz",
          "transfer", "mega", "urlvanish", "fileditchfiles", "tinyurl", "fuckingfast", "rootz.so",
          "1024terabox", "mediafire"}


def hidden_by_hosts(providers):
    return not providers or all(provider in PAUSED for provider in providers)


def build_plan(path):
    """What the import would change, without writing anything."""
    with open(path, encoding="utf-8") as handle:
        index = json.load(handle)
    entries = index.get("DATA") if isinstance(index, dict) else None
    if not isinstance(entries, dict):
        raise SystemExit("%s does not hold a DATA map" % path)
    games, lines = catalog_games()
    releases = read_releases()
    ids = set(games)
    by_title, by_edition = {}, {}
    for game_id, game in games.items():
        by_title.setdefault((game["platform"], title_key(game["title"])), []).append(game_id)
        by_edition.setdefault((game["platform"], edition_key(game["title"])), []).append(game_id)
    new_games, new_twins, records = [], [], {}
    added, revived, updated, unchanged = set(), set(), set(), set()
    skipped, titles = {}, {}
    changed_lines = False
    same_links = records_added = 0

    def find(mapping, platform, key):
        found = mapping.get((platform, key), [])
        return found[0] if len(found) == 1 else None

    for url, value in sorted(entries.items(), key=lambda item: (str((item[1] or {}).get("title_id") or ""), item[0])):
        entry, why = entry_of(url, value)
        if not entry:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        tid, platform = entry["title_id"], entry["platform"]
        target = tid if tid in ids else None
        twin_of = None
        if target is None:
            target = find(by_title, platform, title_key(entry["title"]))
            if target is None:
                target = find(by_edition, platform, edition_key(entry["title"]))
        if target is None:
            other = "ps5" if platform == "ps4" else "ps4"
            twin_of = find(by_title, other, title_key(entry["title"]))
            if twin_of is None:
                twin_of = find(by_edition, other, edition_key(entry["title"]))
            # A game this run already added has no line yet for editions.work_of to read.
            if twin_of is not None and twin_of not in games:
                twin_of = None
        if target is None:
            target = tid
            work = editions.work_of(lines, twin_of) if twin_of else None
            (new_twins if twin_of else new_games).append(new_line(entry, target, work))
            ids.add(target)
            by_title.setdefault((platform, title_key(entry["title"])), []).append(target)
            by_edition.setdefault((platform, edition_key(entry["title"])), []).append(target)
            added.add(target)
            titles[target] = entry["title"]
            rows = releases.setdefault(target, [])
            if same_link(rows, url):
                same_links += 1
            else:
                records.setdefault(target, []).append(record_for(entry, target, url))
                records_added += 1
            continue
        if target not in games:
            # A game created earlier in this run: the package only joins its releases.
            titles.setdefault(target, entry["title"])
            rows = releases.setdefault(target, [])
            if same_link(rows, url):
                same_links += 1
            else:
                records.setdefault(target, []).append(record_for(entry, target, url))
                records_added += 1
            continue
        info = games[target]
        fields = parse_line(info["line"])
        old_providers = list(fields.get("providers") or [])
        was_hidden = hidden_by_hosts(old_providers)
        rows = releases.setdefault(target, [])
        same = same_link(rows, url)
        if same:
            same_links += 1
        else:
            records.setdefault(target, []).append(record_for(entry, target, url))
            records_added += 1
        titles.setdefault(target, info["title"])
        changed = False
        if not same:
            # A new source: the provider the app needs, and what the index knows when the catalog
            # does not. A same link is left exactly as it is (the user's choice, 2026-10-25).
            providers = sorted(set(old_providers) | {"archive.org"})
            if providers != old_providers:
                fields["providers"] = providers
                changed = True
            if fields.get("sizeGb") is None:
                fields["sizeGb"] = entry["sizeGb"]
                changed = True
            if not fields.get("region") and entry["region"]:
                fields["region"] = entry["region"]
                changed = True
            art = fields.get("art")
            if entry["cover"] and (not isinstance(art, dict) or not art.get("cover")):
                fields["art"] = {**(art if isinstance(art, dict) else {}), "cover": entry["cover"]}
                changed = True
        elif "archive.org" not in old_providers:
            # The same package, but the game does not list Archive.org yet: without the provider the
            # app keeps it out of the library, so this is the one change a same link needs.
            fields["providers"] = sorted(set(old_providers) | {"archive.org"})
            changed = True
        if changed:
            if was_hidden and not fields.get("added"):
                fields["added"] = editions.today()
            fields["updated"] = editions.today()
            lines[info["index"]] = editions.render_line(list(fields.items()))
            changed_lines = True
            (revived if was_hidden else updated).add(target)
        else:
            unchanged.add(target)
    editions.insert(lines, "games", new_games)
    editions.insert(lines, "twins", new_twins)
    return {
        "entries": len(entries), "lines": lines, "games": games, "releases": releases,
        "new_games": new_games, "new_twins": new_twins, "records": records,
        "added": added, "revived": revived, "updated": updated, "unchanged": unchanged,
        "titles": titles, "skipped": skipped, "same_links": same_links,
        "records_added": records_added, "catalog_changed": changed_lines or bool(new_games or new_twins),
    }


def apply_plan(plan):
    """Write the catalog and the release files the plan changed; returns the files written."""
    if plan["catalog_changed"]:
        with open(CATALOG, "w", encoding="utf-8", newline="") as handle:
            handle.write("\n".join(plan["lines"]))
    written = 0
    for game_id, extra in plan["records"].items():
        rows = plan["releases"].get(game_id, []) + extra
        body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        path = os.path.join(RELEASES, game_id + ".json")
        with open(path, "w", encoding="utf-8", newline="") as handle:
            handle.write(body)
        written += 1
    return written


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--json", default=DEFAULT_JSON, help="the fPKG index (default GAMES.json)")
    parser.add_argument("--write", action="store_true", help="write the catalog and the release files")
    parser.add_argument("--report", help="save what it would change as JSON")
    parser.add_argument("--no-enrich", action="store_true", help="do not fill missing details from the PlayStation Store")
    parser.add_argument("--enrich", action="store_true", help="look the missing details up even without --write")
    parser.add_argument("--enrich-all", action="store_true", help="fill every game of the index, not only the changed ones")
    parser.add_argument("--enrich-cache", help="where enrich-catalog.py keeps its answers")
    parser.add_argument("--env-file", help="a .env file holding IGDB_CLIENT_ID and IGDB_CLIENT_SECRET")
    parser.add_argument("--workers", type=int, default=4, help="enrich-catalog.py lookups in parallel")
    args = parser.parse_args(argv)
    plan = build_plan(args.json)
    print("fpkgi: %d entries" % plan["entries"])
    print("  games: %d added (%d twins), %d revived, %d updated, %d unchanged" % (
        len(plan["added"]), len(plan["new_twins"]), len(plan["revived"]), len(plan["updated"]),
        len(plan["unchanged"])))
    print("  releases: %d added, %d already there (left as they are)" % (
        plan["records_added"], plan["same_links"]))
    if plan["skipped"]:
        print("  left out: " + ", ".join("%s %d" % (why, count) for why, count in sorted(plan["skipped"].items())))
    if args.report:
        report = {
            "added": {game_id: plan["titles"].get(game_id, game_id) for game_id in sorted(plan["added"])},
            "revived": {game_id: plan["titles"].get(game_id, game_id) for game_id in sorted(plan["revived"])},
            "updated": {game_id: plan["titles"].get(game_id, game_id) for game_id in sorted(plan["updated"])},
            "records": {game_id: [row["id"] for row in extra] for game_id, extra in sorted(plan["records"].items())},
            "skipped": plan["skipped"],
        }
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump(report, handle, ensure_ascii=False, indent=1)
        print("  report: %s" % args.report)
    if args.write:
        written = apply_plan(plan)
        if plan["catalog_changed"] or written:
            print("  wrote %s and %d release files" % (os.path.relpath(CATALOG, ROOT), written))
        else:
            print("  nothing to write")
    else:
        print("  nothing written (use --write)")
    run_enrichment(args, plan)


def run_enrichment(args, plan):
    """Ask enrich-catalog.py for what the catalog lacks, for the games this import touched."""
    if args.no_enrich:
        print("  details: not filled (--no-enrich)")
        return
    if not (args.write or args.enrich or args.enrich_all):
        print("  details: with --write (or --enrich)")
        return
    ids = sorted(plan["titles"]) if args.enrich_all else sorted(
        set(plan["added"]) | set(plan["revived"]) | set(plan["updated"]))
    if not ids:
        print("  details: no changed games to fill")
        return
    command = [sys.executable, "-P", os.path.join(ROOT, "tools", "enrich-catalog.py"), "--ids", ",".join(ids)]
    if args.write:
        command.append("--write")
    if args.enrich_cache:
        command += ["--cache", args.enrich_cache]
    if args.env_file:
        command += ["--env-file", args.env_file]
    command += ["--workers", str(args.workers)]
    if args.report:
        command += ["--report", os.path.splitext(args.report)[0] + ".enrich.json"]
    print("  details: %d game(s) through enrich-catalog.py" % len(ids))
    try:
        result = subprocess.run(command, cwd=ROOT)
    except OSError as error:
        print("  details: enrich-catalog.py not run: %s" % error)
        return
    if result.returncode:
        print("  details: enrich-catalog.py exited with %d; run it again when the store answers" % result.returncode)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
