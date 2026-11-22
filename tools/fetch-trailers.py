#!/usr/bin/env python3
"""Find trailers on the PlayStation Store and bundle them into app/data/trailers.js.

    python -P tools/fetch-trailers.py [--limit N] [--chunk N] [--region US] [--language en] [--write]

This uses the same store API enrich-catalog.py already talks to: the chihiro title container
(https://store.playstation.com/store/api/chihiro/00_09_000/titlecontainer/{store}/{lang}/999/{title}_00),
which answers, without authentication, with the product's media list -- for many games a top-level
"videos" list of direct mp4 links and their names. For every game in app/data/catalog.js the tool
asks the store of --region first, then the others; what it finds is merged with what
app/data/trailers.js already bundles: entries already in the file stay untouched, the store fills
the gaps (at most 8 per game, as the app reads them), and the result keeps the catalog's order.

Without --write nothing in the repository changes: the tool prints what it found and would save.
EXPERIMENTAL: the store answers this API today, but it is undocumented and may change or leave out
games; a game the store refuses is skipped without any other game or file being touched.
"""
import argparse
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
STORES = ["US", "GB", "DE", "FR", "ES", "IT", "RU", "JP", "BR", "HK"]
GAME = re.compile(r'\{ "id": "([A-Z]{4}[0-9]{5})", "title": "((?:[^"\\]|\\.)*)"')
URL_OK = re.compile(r"^https?://", re.I)
MAX_TRAILERS = 8
MAX_URL = 2048
MAX_TITLE = 80
SLEEP = 1.0
USER_AGENT = "Mozilla/5.0 (Overdrive catalog tool)"


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


def load_catalog(limit):
    text = open(CATALOG, encoding="utf-8").read()
    games = [(match.group(1), unescape_js(match.group(2))) for match in GAME.finditer(text)]
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
    return raw.strip().replace("\n", " ")[:MAX_TITLE]


def main():
    parser = argparse.ArgumentParser(description="Bundle PlayStation Store trailers into app/data/trailers.js")
    parser.add_argument("--limit", type=int, default=0, help="only the first N catalog games (0: all)")
    parser.add_argument("--chunk", type=int, default=100, help="print a progress line every N games")
    parser.add_argument("--region", default="US", help="store to ask first (default US)")
    parser.add_argument("--language", default="en", help="store language (default en)")
    parser.add_argument("--write", action="store_true", help="save the merged file (default: print only)")
    args = parser.parse_args()

    games = load_catalog(args.limit)
    bundled = read_bundled()
    merged = {game_id: [entry for entry in (bundled.get(game_id) or []) if isinstance(entry, dict)][:MAX_TRAILERS] for game_id, _title in games}
    merged.update({key: value for key, value in bundled.items() if key not in merged})

    found_new = 0
    for index, (game_id, title) in enumerate(games, 1):
        seen = {entry.get("url") for entry in merged[game_id] if isinstance(entry.get("url"), str)}
        for store in [args.region] + [store for store in STORES if store != args.region]:
            body = fetch(CHIHIRO.format(store=store, lang=args.language, title=game_id))
            try:
                data = json.loads(body) if body else {}
            except ValueError:
                data = {}
            if not data.get("name"):
                continue
            store_urls = [url for url in dict.fromkeys(video_urls(data))
                          if url.lower().endswith((".mp4", ".m4v")) and url not in seen]
            if store_urls:
                names = [clean_title(v.get("name")) for v in (data.get("videos") or []) if isinstance(v, dict)]
                picked = []
                for position, url in enumerate(store_urls):
                    name = names[position] if position < len(names) else (names[0] if names else title)
                    picked.append({**({"title": name} if name else {}), "url": url})
                    seen.add(url)
                merged[game_id] = (merged[game_id] + picked)[:MAX_TRAILERS]
                found_new += len(picked)
            break
        if args.chunk and index % args.chunk == 0:
            print(f"... {index}/{len(games)} games, {found_new} new trailer links so far")
        time.sleep(SLEEP)

    kept = {game_id: entries for game_id, entries in merged.items() if entries}
    print(f"catalog: {len(games)} games | new links from the store: {found_new} | games with trailers: {len(kept)}")

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
