#!/usr/bin/env python3
"""Find trailers on the PlayStation Store and Steam, and bundle them into app/data/trailers.js.

    python -P tools/fetch-trailers.py [--limit N] [--chunk N] [--region US] [--language en]
                                      [--jobs N] [--refresh] [--write]

Two sources, in this order per game:

1. The PlayStation Store: the old chihiro title container is gone (it now answers 204/404), but
   the chihiro *search* still lives, and the storefront's GraphQL API answers anonymously with
   persisted-query hashes: search a title, keep the link whose id carries the title id, resolve
   it to a concept, then ask conceptRetrieveForMedia -- direct mp4 previews from
   vulcan.dl.playstation.net. The two hashes live in PRODUCT_HASH/MEDIA_HASH below; if Sony ever
   returns HTTP 400/403 for them, grab the fresh extensions.persistedQuery.sha256Hash from any
   store.playstation.com page (browser devtools, Network tab) and drop it in.
2. Steam: the public appdetails endpoint (store.steampowered.com/api/appdetails, filters=movies).
   Steam retired its direct mp4 links in late 2026 and now serves HLS and DASH only; the engine
   builds FFmpeg with --enable-demuxer=hls, so the tool takes hls_h264 (an .m3u8 playlist, h264)
   and falls back to mp4/"max" if an answer still carries them. This one is the most experimental:
   HLS playback on the console is untested -- ship it last in a game's list, which is what the
   merging below does. Steam is keyed by appid; every catalog game whose art points at
   */steam/apps/<appid>/* carries one in app/data/catalog.js, and the tool reads it from there.

What it finds is merged with what app/data/trailers.js already bundles: entries already in the file
stay untouched, the sources fill the gaps (at most three per game, as the app reads them), and the
result keeps the catalog's order. Without --refresh a game that already has at least one trailer is
not asked again, so reruns only fill the holes.

Progress is cached in the system temp dir (per region and language): every chunk the answers so far land
on disk, so if a run dies or is stopped, the next one picks up where it left off without re-asking the
sources. --fresh throws that cache away and asks every source again.

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
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CATALOG = os.path.join(HERE, os.pardir, "app", "data", "catalog.js")
TRAILERS = os.path.join(HERE, os.pardir, "app", "data", "trailers.js")

SEARCH = "https://store.playstation.com/store/api/chihiro/00_09_000/search/{store}/{lang}/24/{query}?size=30"
GRAPHQL = "https://web.np.playstation.com/api/graphql/v1/op"
PRODUCT_OP = "productRetrieveForCtasWithPrice"
PRODUCT_HASH = "8532da7eda369efdad054ca8f885394a2d0c22d03c5259a422ae2bb3b98c5c99"
MEDIA_OP = "conceptRetrieveForMedia"
MEDIA_HASH = "615a2c4618229aa2f11c10fe497eaf4fdc151e4dcc0b6b82e154aeacb0123c2d"
STEAM = "https://store.steampowered.com/api/appdetails?appids={appid}&filters=movies&cc={cc}&l={lang}"
STORES = ["US", "GB", "DE", "FR", "ES", "IT", "RU", "JP", "BR", "HK"]
GAME = re.compile(r'\{ "id": "([A-Z]{4}[0-9]{5})"[^\n]*')
TITLE = re.compile(r'"title": "((?:[^"\\]|\\.)*)"')
APPID = re.compile(r"steam/apps/(\d{4,9})")
URL_OK = re.compile(r"^https?://", re.I)
MAX_TRAILERS = 3
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


def fetch(url, timeout=15, attempts=2, headers=None):
    for attempt in range(attempts):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
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


def graphql(operation, variables, sha, locale):
    query = (GRAPHQL + "?operationName=" + operation
             + "&variables=" + urllib.parse.quote(json.dumps(variables))
             + "&extensions=" + urllib.parse.quote(json.dumps({"persistedQuery": {"version": 1, "sha256Hash": sha}})))
    body = fetch(query, timeout=20, headers={"x-psn-store-locale-override": locale, "content-type": "application/json"})
    try:
        return json.loads(body) if body else {}
    except ValueError:
        return {}


def concept_videos(product, store, language):
    locale = f"{language}-{store.lower()}"
    product_info = graphql(PRODUCT_OP, {"productId": product}, PRODUCT_HASH, locale)
    retrieved = (product_info.get("data") or {}).get("productRetrieve") or {}
    concept = (retrieved.get("concept") or {}).get("id")
    if not concept:
        return []
    media_info = graphql(MEDIA_OP, {"conceptId": str(concept)}, MEDIA_HASH, locale)
    node = (media_info.get("data") or {}).get("conceptRetrieve") or {}
    return [{"url": url} for url in dict.fromkeys(video_urls(node))
            if url.lower().endswith((".mp4", ".m4v"))]


def store_trailers(game_id, title, region, language):
    fallback = None
    for store in [region] + [store for store in STORES if store != region]:
        body = fetch(SEARCH.format(store=store, lang=language, query=urllib.parse.quote(title or game_id)))
        try:
            data = json.loads(body) if body else {}
        except ValueError:
            data = {}
        product = next((link.get("id") for link in (data.get("links") or [])
                        if isinstance(link, dict) and f"{game_id}_00" in link.get("id", "")), None)
        if not product:
            continue
        videos = concept_videos(product, store, language)
        if videos:
            return videos
        if fallback is None:
            fallback = videos
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
        url = (movie.get("hls_h264") or formats.get("480") or formats.get("max") or "").strip()
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
    parser.add_argument("--jobs", type=int, default=1, help="games asked in parallel (default 1; 4-8 is gentle)")
    parser.add_argument("--sleep", type=float, default=SLEEP, help="pause between single-job games in seconds (default 1; use 0 with high --jobs)")
    parser.add_argument("--fresh", action="store_true", help="ignore the resume cache and ask the sources for every game again")
    parser.add_argument("--refresh", action="store_true", help="ask the sources again for games that already have a trailer")
    parser.add_argument("--write", action="store_true", help="save the merged file (default: print only)")
    args = parser.parse_args()

    games = load_catalog(args.limit)
    bundled = read_bundled()
    merged = {game_id: [entry for entry in (bundled.get(game_id) or []) if isinstance(entry, dict)][:MAX_TRAILERS] for game_id, _title, _appid in games}
    merged.update({key: value for key, value in bundled.items() if key not in merged})

    cache = {"asked": {}}
    cache_file = os.path.join(tempfile.gettempdir(), f"overdrive-trailers-{args.region.lower()}-{args.language.lower()}.json")
    if not args.fresh:
        try:
            loaded = json.load(open(cache_file, encoding="utf-8"))
        except (OSError, ValueError):
            loaded = None
        if isinstance(loaded, dict) and isinstance(loaded.get("asked"), dict):
            cache["asked"] = {game_id: [entry for entry in entries if isinstance(entry, dict) and isinstance(entry.get("url"), str) and URL_OK.match(entry["url"])]
                              for game_id, entries in loaded["asked"].items()
                              if isinstance(game_id, str) and isinstance(entries, list)}
    for game_id, entries in list(cache["asked"].items()):
        if game_id not in merged or not entries or args.refresh:
            continue
        fresh = [entry for entry in entries if entry not in merged[game_id]]
        if fresh:
            merged[game_id] = (merged[game_id] + fresh)[:MAX_TRAILERS]
    asked = set(cache["asked"])

    def save_cache():
        try:
            tmp = f"{cache_file}.tmp"
            with open(tmp, "w", encoding="utf-8") as handle:
                json.dump(cache, handle, ensure_ascii=False)
            os.replace(tmp, cache_file)
        except OSError:
            pass

    def collect(game):
        game_id, title, appid = game
        existing = merged[game_id]
        if not args.refresh and (existing or game_id in asked):
            return existing, None
        seen = {entry.get("url") for entry in existing if isinstance(entry.get("url"), str)}
        names = {(entry.get("title") or "").strip().lower() for entry in existing if entry.get("title")}
        fresh = []
        sources = [store_trailers(game_id, title, args.region, args.language)]
        if appid:
            sources.append(steam_trailers(appid, args.region, args.language))
        for source in sources:
            for entry in source:
                name = (entry.get("title") or "").strip().lower()
                if entry["url"] not in seen and not (name and name in names):
                    seen.add(entry["url"])
                    if name:
                        names.add(name)
                    fresh.append(entry)
        return existing, fresh

    jobs = max(1, args.jobs)
    found_new, skipped = 0, 0
    if jobs == 1:
        def walk():
            for index, game in enumerate(games, 1):
                quiet = not args.refresh and (merged[game[0]] or game[0] in asked)
                yield index, collect(game)
                if index < len(games) and not quiet:
                    time.sleep(args.sleep)
        stream = walk()
    else:
        from concurrent.futures import ThreadPoolExecutor
        pool = ThreadPoolExecutor(max_workers=jobs)
        stream = enumerate(pool.map(collect, games), 1)
    for index, (existing, fresh) in stream:
        game_id = games[index - 1][0]
        if fresh is None:
            skipped += 1
        else:
            cache["asked"][game_id] = fresh
            if fresh:
                merged[game_id] = (merged[game_id] + fresh)[:MAX_TRAILERS]
                found_new += len(fresh)
        if args.chunk and index % args.chunk == 0:
            save_cache()
            print(f"... {index}/{len(games)} games, {found_new} new trailer links so far")
    if jobs > 1:
        pool.shutdown(wait=True)
    save_cache()

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
