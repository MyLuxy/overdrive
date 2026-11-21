#!/usr/bin/env python3
"""Import the Pegasus catalogs' package sources into Overdrive's catalog.

    python -P tools/import-pegasus.py fetch [--cache <dir>]
    python -P tools/import-pegasus.py import [--cache <dir>] [--new] [--write] [--force] [--report <file>]

Pegasus (https://pegasus-dl.dev) publishes open catalogs, listed at /api/catalogs: DLPSGame, Pippo,
PFS and ZER0GAME, each a JSON feed of packages {titleId, title, version, category, sizeBytes,
originalPosterUrl, description, downloadLinks: [{name, url}]}. The catalog's pegasus-0..3 records
come from older copies of them (pegasus-1 is Pippo's, pegasus-2 PFS's, pegasus-3 ZER0GAME's); they
are left as they are.

fetch downloads every feed into --cache (default ../.pegasus-cache, outside the repository). The
site is slow, so a feed has minutes to arrive, and one that arrives cut or broken keeps the last
good copy.

import reads only the cache. It keeps the links on hosts the app downloads from (VikingFile,
FileKeeper, DataNodes, AkiraBox), leaves out DLC, the parts of multi-part sets ("... part 2") and
links whose file the catalog already has (the same file on its host, whatever the URL's spelling),
and writes the rest as release records tagged source "pegasus-<feed>". A package goes to the catalog
game with its title id, or, for another region's, to the one game of the same title and platform, or
of the same title but for its edition's words ("Persona 5 Royal" is "Persona 5 Royal Ultimate
Edition"); --new adds the games the catalog lacks, and the other platform's edition of a catalog game
as its twin (tools/catalog_editions.py), never as a second game. Every run rebuilds the "pegasus-<feed>" records from the
cache, so a link gone upstream goes here too, and keeps the other sources' records byte for byte. A
run that would take away more than 5% of them stops unless --force: a feed that shrank by mistake
must not empty the catalog. Without --write it only prints, and --report saves, what it would change.
"""
import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # this folder's own modules, under -P too
import catalog_editions as editions  # noqa: E402
from catalog_editions import edition_key  # noqa: E402

ROOT =os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "app", "data")
CATALOG = os.path.join(DATA, "catalog.js")
RELEASES = os.path.join(DATA, "releases")
SITE = "https://pegasus-dl.dev"
UA = "Mozilla/5.0 (Overdrive catalog tool)"
PREFIX = "pegasus-"
# The feeds this tool reads; pegasus-0..3, the catalog's older Pegasus sources, are not among them.
FEEDS = ("dlps", "pippo", "pfs", "zer0")
BRAKE = 0.05

# provider, flow, catalog "providers" key: as import-pippo.py and import-superpsx.py write them.
HOSTS = {
    "vikingfile.com": ("VikingFile", "vikingfile", "vikingfile"),
    "vik1ngfile.site": ("VikingFile", "vikingfile", "vikingfile"),
    "filekeeper.net": ("filekeeper.net", "browser", "filekeeper"),
    "datanodes.to": ("DataNodes", "datanodes", "datanodes"),
    "datanodes.co": ("DataNodes", "datanodes", "datanodes"),
    "akirabox.com": ("AkiraBox", "akirabox", "akirabox"),
    "akirabox.to": ("AkiraBox", "akirabox", "akirabox"),
}
FILE_IDS = (
    (("vikingfile.com", "vik1ngfile.site"), re.compile(r"^/[fd]/([A-Za-z0-9]+)")),
    (("filekeeper.net", "datanodes.to", "datanodes.co"), re.compile(r"^/([a-z0-9]{12})")),
    (("akirabox.com", "akirabox.to"), re.compile(r"^/([A-Za-z0-9]+)")),
)
TITLE_ID = re.compile(r"^(?:CUSA|PPSA)\d{5}$")
REGIONS = ("USA", "EUR", "JPN", "ASIA", "HK", "KOR")
RAW_COVER = "%s?w=440&thumb=false"
# "USA 4.xx Base - Akirabox part 2", "FPKG · Akirabox - pt.3".
PART = re.compile(r"\b(?:part|pt\.?)\s*\d+\b", re.I)
# The label's host suffix, as the app reads it (app/game/sources.js:19 strips a suffix that starts
# with the provider's first four letters): "AKIA (exFAT)" would stay in the edition it shows.
SUFFIX = {"VikingFile": "Vikingfile", "AkiraBox": "AkiraBox", "DataNodes": "DataNodes", "filekeeper.net": "FileKeeper"}


# --- Fetch ----------------------------------------------------------------------


def fetch(url, timeout=900, attempts=3):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt == attempts - 1:
                raise
            print(f"  {url}: {error}; again", file=sys.stderr)
            time.sleep(10 * (attempt + 1))


def fetch_feeds(args):
    os.makedirs(args.cache, exist_ok=True)
    listed = {item["slug"]: item for item in json.loads(fetch(f"{SITE}/api/catalogs"))["catalogs"]}
    for slug in FEEDS:
        if slug not in listed:
            print(f"  {slug}: no longer listed, its last copy stays")
            continue
        started = time.time()
        try:
            body = fetch(listed[slug].get("sourceUrl") or f"{SITE}/catalogs/{slug}.json")
            feed = json.loads(body)
            count = len(feed["packages"])
        except Exception as error:  # cut, broken or gone: the last good copy stays
            print(f"  {slug}: {error}; its last copy stays", file=sys.stderr)
            continue
        path = os.path.join(args.cache, f"{slug}.json")
        with open(path + ".partial", "wb") as handle:
            handle.write(body)
        os.replace(path + ".partial", path)
        print(f"  {slug}: {count} packages (listed {listed[slug].get('packageCount')}), {len(body)} bytes in {time.time() - started:.0f} s")


# --- The catalog ----------------------------------------------------------------

LINE = re.compile(r'^\s*\{ "id": "([^"]+)", "title": "((?:[^"\\]|\\.)*)", "platform": "(\w+)", "providers": \[([^\]]*)\]')
PROVIDERS = re.compile(r'"providers": \[[^\]]*\]')


def title_key(title):
    title = html.unescape(title)
    title = re.sub(r"[™®©]", "", title)
    title = re.sub(r"\s+(?:PS4|PS5)\s*$", "", title, flags=re.I)
    return re.sub(r"[^a-z0-9]", "", title.lower())


def catalog_games():
    games = {}
    with open(CATALOG, encoding="utf-8") as handle:
        lines = handle.read().split("\n")
    for index, line in enumerate(lines):
        match = LINE.match(line)
        if not match:
            continue
        title = json.loads('"%s"' % re.sub(r"\\(?![\x22\\/bfnrtu])", "", match.group(2)))
        providers = [item.strip().strip('"') for item in match.group(4).split(",") if item.strip()]
        games[match.group(1)] = {"title": title, "platform": match.group(3), "providers": providers, "index": index,
                                 "ours": bool(re.search(r'"source": "%s[a-z0-9]+" \},?$' % PREFIX, line.rstrip()))}
    return games, lines


def read_releases():
    out = {}
    for name in sorted(os.listdir(RELEASES)):
        if name.endswith(".json"):
            with open(os.path.join(RELEASES, name), encoding="utf-8") as handle:
                out[name[:-5]] = json.load(handle)
    return out


def ours(record):
    return record.get("source", "")[len(PREFIX):] in FEEDS and record.get("source", "").startswith(PREFIX)


# --- Import ---------------------------------------------------------------------


def host_of(url):
    match = re.match(r"https?://([^/?#]+)(/[^?#]*)?", url, re.I)
    return (match.group(1).lower().removeprefix("www."), match.group(2) or "/") if match else ("", "")


def spec_of(url):
    host, _ = host_of(url)
    return next((s for d, s in HOSTS.items() if host == d or host.endswith("." + d)), None)


def file_id(url):
    host, path = host_of(url)
    for domains, pattern in FILE_IDS:
        if any(host == d or host.endswith("." + d) for d in domains):
            found = pattern.match(path)
            if found:
                return domains[0] + ":" + found.group(1)
    return url.split("#")[0].rstrip("/")


def known_files(releases):
    seen = set()
    for records in releases.values():
        for record in records:
            if ours(record):
                continue
            for item in [record] + [s for part in record.get("parts") or [] for s in part.get("sources") or [part]]:
                for field in ("url", "browserUrl"):
                    if isinstance(item.get(field), str):
                        seen.add(file_id(item[field]))
    return seen


def region_of(package, name):
    text = f"{name} {package.get('description') or ''}"
    for region in REGIONS:
        if re.search(r"(?<![A-Z])%s(?![A-Z])" % region, text):
            return region
    return "USA" if re.search(r"Region:\s*US\b", text) else ""


def label_of(name, provider):
    label = re.sub(r"\s+", " ", html.unescape(name)).strip()
    split = label.rfind(" - ")
    if split >= 0 and not label[split + 3:].lower().startswith(provider.lower()[:4]):
        label = label[:split] + " - " + SUFFIX[provider]
    return label


def clean_title(title):
    """A feed's title as the catalog's: "[exFAT] Mortal Shell 2" reads "Mortal Shell 2"."""
    title = re.sub(r"^\s*\[[^\]]*\]\s*", "", html.unescape(title))
    return re.sub(r"\s+", " ", title).strip()


def record_for(slug, game_id, package, name, url):
    title_id = package["titleId"]
    version = (package.get("version") or "").strip()
    release_id = "r" + hashlib.sha256(("%s|%s" % (game_id, url)).encode("utf-8")).hexdigest()[:12]
    provider, flow, _ = spec_of(url)
    # The filename's extension must be the declared format's (ps5-react download-formats.js refuses
    # "x.7z" declared "binary"): a .pkg or .rar is declared so, anything else is "binary" with a
    # .binary name, which the app tells apart by its content, as the catalog's own pegasus-1 records.
    extension = re.search(r"\.(rar|pkg)$", host_of(url)[1], re.I)
    kind = extension.group(1).lower() if extension else "binary"
    return {
        "id": release_id,
        "format": kind,
        "filename": "%s-game-%s-%s.%s" % (title_id, version or "unknown", release_id, kind),
        "url": url,
        "browserUrl": url,
        "requiresBrowser": True,
        "sizeBytes": package.get("sizeBytes"),
        "version": version,
        "category": "game",
        "provider": provider,
        "source": PREFIX + slug,
        "flow": flow,
        "label": label_of(name, provider),
        "platform": "ps5" if title_id.startswith("PPSA") else "ps4",
        "record": "%s%s-%s-%s" % (PREFIX, slug, title_id, version or "0"),
        **({"titleId": title_id} if title_id != game_id else {}),
    }


def build_plan(args):
    games, lines = catalog_games()
    by_title, by_edition = {}, {}
    for game_id, game in games.items():
        by_title.setdefault((game["platform"], title_key(game["title"])), []).append(game_id)
        by_edition.setdefault((game["platform"], edition_key(game["title"])), []).append(game_id)
    releases = read_releases()
    seen = known_files(releases)
    records, new_games, feeds, skipped = {}, {}, {}, {}
    skip = lambda why: skipped.__setitem__(why, skipped.get(why, 0) + 1)
    for slug in FEEDS:
        path = os.path.join(args.cache, f"{slug}.json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as handle:
            feeds[slug] = json.load(handle)["packages"]
        for package in feeds[slug]:
            title_id = (package.get("titleId") or "").strip().upper()
            package["titleId"] = title_id
            if package.get("category") != "game":
                skip("dlc package")
                continue
            if not TITLE_ID.match(title_id):
                skip("no title id")
                continue
            platform = "ps5" if title_id.startswith("PPSA") else "ps4"
            title = clean_title(package.get("title") or title_id)
            # The same title, else the same game in another edition ("Persona 5 Royal" is the
            # catalog's "Persona 5 Royal Ultimate Edition"): one catalog game of this platform each.
            same = by_title.get((platform, title_key(title)), [])
            if len(same) != 1 and len(by_edition.get((platform, edition_key(title)), [])) == 1:
                same = by_edition[(platform, edition_key(title))]
            target = title_id if title_id in games or title_id in new_games else (same[0] if len(same) == 1 else None)
            # Single files only: multi-part sets are left out (the user's choice), as in import-superpsx.py.
            links = []
            for link in package.get("downloadLinks") or []:
                name, url = (link.get("name") or "").strip(), (link.get("url") or "").strip()
                if re.search(r"\bDLC\b", name, re.I):
                    skip("dlc link")
                elif PART.search(name):
                    skip("part of a set")
                elif not spec_of(url):
                    skip("other host")
                elif file_id(url) in seen:
                    skip("known")
                else:
                    seen.add(file_id(url))
                    links.append((name, url))
            if not links:
                continue
            if not target:
                if not args.new or len(same) > 1:
                    skip("no catalog game")
                    continue
                target = title_id
                # The same game under another region's id later in the feeds joins this one.
                by_title[(platform, title_key(title))] = [target]
                by_edition[(platform, edition_key(title))] = [target]
                # The other platform's edition of a catalog game is its twin: one game, two editions.
                other = by_edition.get(("ps4" if platform == "ps5" else "ps5", edition_key(title)), [])
                cover = package.get("originalPosterUrl") or ""
                new_games[target] = {
                    "title": title, "platform": platform, "slug": slug, "region": region_of(package, links[0][0]),
                    "cover": RAW_COVER % cover if cover.startswith("https://image.api.playstation.com/") else cover,
                    "twin": other[0] if len(other) == 1 and other[0] in games else None,
                }
            for name, url in links:
                records.setdefault(target, []).append(record_for(slug, target, package, name, url))
    # Feeds missing from the cache keep their records: nothing was read to replace them.
    kept_feeds = {PREFIX + slug for slug in FEEDS if slug not in feeds}
    before = sum(1 for rows in releases.values() for r in rows if ours(r) and r["source"] not in kept_feeds)
    after = sum(len(rows) for rows in records.values())
    return {"games": games, "lines": lines, "releases": releases, "records": records, "new": new_games,
            "kept_feeds": kept_feeds, "before": before, "after": after, "skipped": skipped}


def keys_of(rows):
    return {spec_of(r.get("browserUrl") or r.get("url") or "")[2] for r in rows if spec_of(r.get("browserUrl") or r.get("url") or "")}


def new_line(game_id, game, rows, work=None):
    """A catalog entry with what the app needs to list the game; enrich-catalog.py fills the rest."""
    fields = [("id", game_id), ("title", game["title"]), ("platform", game["platform"]), ("providers", sorted(keys_of(rows))),
              ("direct", False), ("developer", ""), ("publisher", ""), ("releaseDate", ""), ("genres", []), ("features", []),
              ("recommendations", 0), ("art", {"cover": game["cover"]})]
    fields += [("region", game["region"])] if game["region"] else []
    fields += [("added", editions.today()), ("source", PREFIX + game["slug"])]
    return editions.render_line(editions.with_work(fields, work))


def apply_plan(plan):
    changed = []
    touched = set(plan["records"]) | {tid for tid, rows in plan["releases"].items() if any(ours(r) for r in rows)}
    final = {}
    for title_id in sorted(touched):
        kept = [r for r in plan["releases"].get(title_id, []) if not ours(r) or r["source"] in plan["kept_feeds"]]
        rows = kept + plan["records"].get(title_id, [])
        final[title_id] = rows
        body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        path = os.path.join(RELEASES, title_id + ".json")
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if old != body:
            with open(path, "w", encoding="utf-8", newline="") as handle:
                handle.write(body)
            changed.append(title_id)
    lines = plan["lines"]
    for title_id, rows in final.items():
        game = plan["games"].get(title_id)
        if not game:
            continue
        # A game this tool added lists only the hosts its records have now; any other gains ours.
        keys = sorted(keys_of(rows)) if game["ours"] else sorted(set(game["providers"]) | keys_of(plan["records"].get(title_id, [])))
        if keys != game["providers"]:
            rendered = "[" + ", ".join(json.dumps(key) for key in keys) + "]"
            lines[game["index"]] = PROVIDERS.sub('"providers": ' + rendered, lines[game["index"]], count=1)
    new = plan["new"]
    twins = [new_line(tid, new[tid], plan["records"][tid], editions.work_of(lines, new[tid]["twin"]))
             for tid in sorted(new) if new[tid]["twin"]]
    editions.insert(lines, "twins", twins)
    editions.insert(lines, "games", [new_line(tid, new[tid], plan["records"][tid]) for tid in sorted(new) if not new[tid]["twin"]])
    with open(CATALOG, "w", encoding="utf-8", newline="") as handle:
        handle.write("\n".join(lines))
    return changed


def run_import(args):
    plan = build_plan(args)
    records, new = plan["records"], plan["new"]
    by_feed, by_host = {}, {}
    for rows in records.values():
        for row in rows:
            by_feed[row["source"]] = by_feed.get(row["source"], 0) + 1
            by_host[row["provider"]] = by_host.get(row["provider"], 0) + 1
    print(f"games with Pegasus links of ours: {len(records)} (new to the catalog: {len(new)})")
    print(f"records: {plan['after']} (now {plan['before']}) by feed {by_feed}, by host {by_host}")
    print("links left out:", plan["skipped"])
    if plan["kept_feeds"]:
        print("feeds not in the cache, their records kept:", sorted(plan["kept_feeds"]))
    print(f"  of which other platforms' editions of a catalog game (twins): {sum(1 for g in new.values() if g['twin'])}")
    for tid in sorted(new):
        twin = f", edition of {new[tid]['twin']} {plan['games'][new[tid]['twin']]['title']}" if new[tid]["twin"] else ""
        print(f"  new: {tid} {new[tid]['title']} ({new[tid]['platform']}, {len(records[tid])} links{twin})")
    if args.report:
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump({"new": {tid: g["title"] for tid, g in sorted(new.items())}, "records": records,
                       "skipped": plan["skipped"]}, handle, ensure_ascii=False, indent=1)
    if args.write:
        if plan["before"] and plan["after"] < plan["before"] * (1 - BRAKE) and not args.force:
            raise SystemExit(f"stopped: {plan['before'] - plan['after']} of {plan['before']} Pegasus records would go "
                             f"(more than {BRAKE:.0%}); check the feeds, or run again with --force")
        changed = apply_plan(plan)
        print(f"wrote {len(changed)} release files and the catalog")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    default_cache = os.path.join(os.path.dirname(ROOT), ".pegasus-cache")
    f = sub.add_parser("fetch")
    f.add_argument("--cache", default=default_cache)
    i = sub.add_parser("import")
    i.add_argument("--cache", default=default_cache)
    i.add_argument("--new", action="store_true", help="add the games the catalog lacks")
    i.add_argument("--write", action="store_true")
    i.add_argument("--force", action="store_true", help="write even when more than 5%% of the records would go")
    i.add_argument("--report")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    fetch_feeds(args) if args.command == "fetch" else run_import(args)


if __name__ == "__main__":
    main()
