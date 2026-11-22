#!/usr/bin/env python3
"""Find trailers on the PlayStation Store and Steam, and bundle them into app/data/trailers.js.

    python -P tools/fetch-trailers.py [--limit N] [--chunk N] [--region US] [--language en]
                                      [--refresh] [--write]

Two sources, in this order per game:

1. The PlayStation Store: the chihiro title container
   (https://store.playstation.com/store/api/chihiro/00_09_000/titlecontainer/{store}/{lang}/999/{title}_00),
   the same API enrich-catalog.py talks to. Without authentication it answers with the product's
   media list -- for many games a top-level "videos" list of direct mp4 links and their names.
2. Steam: the public appdetails endpoint (store.steampowered.com/api/appdetails, filters=movies),
   the same place Hydra Launcher takes its details from. It answers with each film's direct mp4.
   Steam only knows an appid: every catalog game whose art points at cdn.cloudflare.steamstatic.com
   (or any other */steam/apps/<appid>/* URL) carries one in app/data/catalog.js, and the tool reads
   it from there.

What it finds is merged with what app/data/trailers.js already bundles: entries already in the file
stay untouched, the sources fill the gaps (at most 8 per game, as the app reads them), and the
result keeps the catalog's order. Without --refresh a game that already has at least one trailer is
not asked again, so reruns only fill the holes.

Without --write nothing in the repository changes: the tool prints what it found and would save.
EXPERIMENTAL: both APIs answer without authentication today, but they are undocumented and may
change or leave games out; a game both refuse is skipped without any other game or file being
touched.
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, os.pardir, "app", "data", "catalog.js")
TRAILERS = os.path.join(HERE, os.pardir, "app", "data", "trailers.js")

CHIHIRO = "https://store.playstation.com/store/api/chihiro/00_09_000/titlecontainer/{store}/{lang}/999/{title}_00"
STEAM = "https://store.steampowered.com/api/appdetails?appids={appid}&filters=movies&cc={cc}&l={lang}"
STORES = ["US", "GB", "DE", "FR", "ES", "IT", "RU", "JP", "BR", "HK"]
GAME = re.compile(r'\{ "id": "([A-Z]{4}[0-9]{5})"[^\n]*')
TITLE = re.compile(r'"title": "((?:[^"\\]|\\.)*)"')
APPID = re.compile(r"steam/apps/(\d{4,9})")
URL_OK = re.compile(r"^https?://", re.I)
MAX_TRAILERS = 8
MAX_URL = 2048
MAX_TITLE = 80
SLEEP = 1.0
USER_AGENT = "Mozilla/5.0 (Overdrive catalog tool)"

ESCAPES = {"n": "\n", "t": "\t", "r": "\r", "b": "\b", "f": "\f", "'": "'", '"': '"', "\\": "\\", "/": "/"}


def unescape_js(raw):
    out, at = [], 0
    while at < len(raw):
        char = raw[at]
        if char != "\\" or at + 1 >= len(raw):
            out.append(char)
            at += 1
            continue
        code, next = raw[at + 1], at + 2
        if code == "x" and next + 2 <= len(raw):
            out.append(chr(int(raw[next:next + 2], 16)))
            at = next + 2
        elif code == "u" and next + 4 <= len(raw):
            out.append(chr(int(raw[next:next + 4], 16)))
            at = next + 4
        else:
            out.append(ESCAPES.get(code, code))
            at = next
    return "".join(out)


def fetch(url, timeout=15, attempts=2):
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):
                return None
            if error.code not in (429, 500, 502, 503, 504) or attempt + 1 == attempts:
                return None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt + 1 == attempts:
                return None
        time.sleep(SLEEP * (attempt + 1))
    return None


def load_catalog(limit):
    text = open(CATALOG, encoding="utf-8").read()
    games = []
    for match in GAME.finditer(text):
        line = match.group(0)
        title = TITLE.search(line)
        appid = APPID.search(line)
        games.append((match.group(1), unescape_js(title.group(1)) if title else "", appid.group(1) if appid else ""))
    return games[:limit] if limit else games


def read_bundled():
    text = open(TRAILERS, encoding="utf-8").read()
    found = re.search(r"var trailers = (\{.*\});\s*\n", text, re.S)
    if not found:
        return {}
    try:
        data = json.loads(found.group(1))
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def video_urls(node):
    found = []
    if isinstance(node, dict):
        for candidate in [(node.get("ubyte") or {}).get("url"), node.get("url"), node.get("videoUrl")]:
            if isinstance(candidate, str):
                candidate = candidate.strip()
                if URL_OK.match(candidate) and len(candidate) <= MAX_URL:
                    found.append(candidate)
        found.extend(video_urls(node.get("videos")))
        found.extend(video_urls(node.get("ubyte")))
    elif isinstance(node, list):
        for item in node:
            found.extend(video_urls(item))
    return found


def clean_title(raw):
    if not isinstance(raw, str):
        return ""
    return html.unescape(raw).strip().replace("\n", " ")[:MAX_TITLE]


def store_trailers(game_id, region, language):
    fallback = None
    for store in [region] + [store for store in STORES if store != region]:
        body = fetch(CHIHIRO.format(store=store, lang=language, title=game_id))
        try:
            data = json.loads(body) if body else {}
        except ValueError:
            data = {}
        if not data.get("name"):
            continue
        videos = data.get("videos") or []
        names = [clean_title(v.get("name")) for v in videos if isinstance(v, dict)]
        entries = []
        for position, url in enumerate(url for url in dict.fromkeys(video_urls(data))
                                     if url.lower().endswith((".mp4", ".m4v"))):
            name = names[position] if position < len(names) else (names[0] if names else "")
            entries.append({**({"title": name} if name else {}), "url": url})
        if entries:
            return entries
        if fallback is None:
            fallback = entries
    return fallback or []


def steam_trailers(appid, cc, language):
    body = fetch(STEAM.format(appid=appid, cc=cc.lower(), lang=language))
    try:
        data = json.loads(body) if body else {}
    except ValueError:
        data = {}
    entry = data.get(appid) or {}
    if not entry.get("success"):
        return []
    entries = []
    for movie in (entry.get("data") or {}).get("movies") or []:
        if not isinstance(movie, dict):
            continue
        formats = movie.get("mp4") or {}
        url = (formats.get("480") or formats.get("max") or "").strip()
        if url and URL_OK.match(url) and len(url) <= MAX_URL:
            title = clean_title(movie.get("name"))
            entries.append({**({"title": title} if title else {}), "url": url})
    return entries


def main():
    parser = argparse.ArgumentParser(description="Bundle PlayStation Store and Steam trailers into app/data/trailers.js")
    parser.add_argument("--limit", type=int, default=0, help="only the first N catalog games (0: all)")
    parser.add_argument("--chunk", type=int, default=100, help="print a progress line every N games")
    parser.add_argument("--region", default="US", help="store to ask first, also Steam's country (default US)")
    parser.add_argument("--language", default="en", help="store language (default en)")
    parser.add_argument("--refresh", action="store_true", help="ask the sources again for games that already have a trailer")
    parser.add_argument("--write", action="store_true", help="save the merged file (default: print only)")
    args = parser.parse_args()

    games = load_catalog(args.limit)
    bundled = read_bundled()
    merged = {game_id: [entry for entry in (bundled.get(game_id) or []) if isinstance(entry, dict)][:MAX_TRAILERS] for game_id, _title, _appid in games}
    merged.update({key: value for key, value in bundled.items() if key not in merged})

    found_new, skipped = 0, 0
    for index, (game_id, title, appid) in enumerate(games, 1):
        existing = merged[game_id]
        if not args.refresh and existing:
            skipped += 1
            continue
        seen = {entry.get("url") for entry in existing if isinstance(entry.get("url"), str)}
        fresh = []
        sources = [store_trailers(game_id, args.region, args.language)]
        if appid:
            sources.append(steam_trailers(appid, args.region, args.language))
        for source in sources:
            for entry in source:
                if entry["url"] not in seen:
                    seen.add(entry["url"])
                    fresh.append(entry)
        if fresh:
            merged[game_id] = (existing + fresh)[:MAX_TRAILERS]
            found_new += len(fresh)
        if args.chunk and index % args.chunk == 0:
            print(f"... {index}/{len(games)} games, {found_new} new trailer links so far")
        if index < len(games):
            time.sleep(SLEEP)

    kept = {game_id: entries for game_id, entries in merged.items() if entries}
    print(f"catalog: {len(games)} games | already had a trailer: {skipped} | new links: {found_new} | games with trailers: {len(kept)}")

    if args.write:
        payload = json.dumps(kept, ensure_ascii=False, indent=2)
        tmp = f"{TRAILERS}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(f"var trailers = {payload};\n\nexport {{ trailers }};\n")
        os.replace(tmp, TRAILERS)
        print(f"saved {os.path.abspath(TRAILERS)}")
    else:
        for game_id in list(kept)[:20]:
            links = ", ".join(entry.get("title") or entry["url"] for entry in kept[game_id])
            print(f"  {game_id}: {links}")
        if len(kept) > 20:
            print(f"  ... and {len(kept) - 20} more (re-run with --write to keep them)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
