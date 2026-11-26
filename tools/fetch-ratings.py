"""Gather PlayStation Store star ratings into app/data/ratings.js.

    python -P tools/fetch-ratings.py [--limit N] [--chunk N] [--region US] [--language en]
                                     [--jobs N] [--refresh] [--write]

One source: the PlayStation Store's GraphQL API (anonymous, no keys). The chain per game is the
same as fetch-trailers.py up to the product, then wcaProductStarRatingRetrive answers with the
store's star rating: an average (0-5) and the total ratings count. Both go into app/data/ratings.js
keyed by the catalog's game id.

Progress is cached in the system temp dir (per region and language): every chunk the answers so far
land in a cache file, so an interrupted run picks up where it stopped and already asked games are
not asked again. --fresh throws that cache away and asks every game again.

The two persisted-query hashes live in PRODUCT_HASH/RATING_HASH below; if Sony ever rejects them
(HTTP 400/403), grab the fresh extensions.persistedQuery.sha256Hash from any store.playstation.com
page (browser devtools, Network tab) and drop it in.

What is already in the file stays untouched, the source fills the gaps; without --refresh a game
that already has a rating is not asked again. Without --write nothing changes: the tool prints
what it found. EXPERIMENTAL: undocumented API, may change or leave games out; a game it refuses is
skipped without any other game or file being touched.
"""
import argparse
import http.client
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
RATINGS = os.path.join(HERE, os.pardir, "app", "data", "ratings.js")

SEARCH = "https://store.playstation.com/store/api/chihiro/00_09_000/search/{store}/{lang}/24/{query}?size=30"
GRAPHQL = "https://web.np.playstation.com/api/graphql/v1/op"
PRODUCT_OP = "productRetrieveForCtasWithPrice"
PRODUCT_HASH = "8532da7eda369efdad054ca8f885394a2d0c22d03c5259a422ae2bb3b98c5c99"
RATING_OP = "wcaProductStarRatingRetrive"
RATING_HASH = "cedd370c39e89da20efa7b2e55710e88cb6e6843cc2f8203f7e73ba4751e7253"
STORES = ["US", "GB", "DE", "FR", "ES", "IT", "RU", "JP", "BR", "HK"]
GAME = re.compile(r'\{ "id": "([A-Z]{4}[0-9]{5})"[^\n]*')
TITLE = re.compile(r'"title": "((?:[^"\\]|\\.)*)"')
SLEEP = 1.0
USER_AGENT = "Mozilla/5.0 (Overdrive catalog tool)"


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
        except (http.client.HTTPException, urllib.error.URLError, TimeoutError, OSError):
            if attempt + 1 == attempts:
                return None
        time.sleep(SLEEP * (attempt + 1))
    return None


def load_catalog(limit):
    text = open(CATALOG, encoding="utf-8").read()
    games = []
    for match in GAME.finditer(text):
        title = TITLE.search(match.group(0))
        games.append((match.group(1), title.group(1) if title else ""))
    return games[:limit] if limit else games


def read_bundled():
    text = open(RATINGS, encoding="utf-8").read()
    found = re.search(r"var ratings = (\{.*\});\s*\n", text, re.S)
    if not found:
        return {}
    try:
        data = json.loads(found.group(1))
    except ValueError:
        return {}
    return data if isinstance(data, dict) else {}


def clean_rating(record):
    if not isinstance(record, dict):
        return None
    average, count = record.get("averageRating"), record.get("totalRatingsCount")
    if not isinstance(average, (int, float)) or isinstance(average, bool) or not 0 <= average <= 5:
        return None
    if not isinstance(count, (int, float)) or isinstance(count, bool) or count < 1:
        return None
    return {"average": round(average, 2), "count": int(count)}


def graphql(operation, variables, sha, locale):
    query = (GRAPHQL + "?operationName=" + operation
             + "&variables=" + urllib.parse.quote(json.dumps(variables))
             + "&extensions=" + urllib.parse.quote(json.dumps({"persistedQuery": {"version": 1, "sha256Hash": sha}})))
    body = fetch(query, timeout=20, headers={"x-psn-store-locale-override": locale, "content-type": "application/json"})
    try:
        return json.loads(body) if body else {}
    except ValueError:
        return {}


def product_ids(game_id, title, store, language):
    body = fetch(SEARCH.format(store=store, lang=language, query=urllib.parse.quote(title or game_id)))
    try:
        data = json.loads(body) if body else {}
    except ValueError:
        data = {}
    return [link.get("id") for link in (data.get("links") or [])
            if isinstance(link, dict) and f"{game_id}_00" in link.get("id", "")]


def store_rating(game_id, title, region, language):
    for store in [region] + [store for store in STORES if store != region]:
        products = product_ids(game_id, title, store, language)
        if not products:
            continue
        locale = f"{language}-{store.lower()}"
        for product in products:
            answer = graphql(RATING_OP, {"productId": product}, RATING_HASH, locale)
            node = ((answer.get("data") or {}).get("productRetrieve") or {}).get("starRating")
            rating = clean_rating(node)
            if rating:
                return rating
    return None


def main():
    parser = argparse.ArgumentParser(description="Bundle PlayStation Store star ratings into app/data/ratings.js")
    parser.add_argument("--limit", type=int, default=0, help="only the first N catalog games (0: all)")
    parser.add_argument("--chunk", type=int, default=100, help="print a progress line every N games")
    parser.add_argument("--region", default="US", help="store to ask first (default US)")
    parser.add_argument("--language", default="en", help="store language (default en)")
    parser.add_argument("--jobs", type=int, default=1, help="games asked in parallel (default 1; 4-8 is gentle)")
    parser.add_argument("--refresh", action="store_true", help="ask again for games that already have a rating")
    parser.add_argument("--fresh", action="store_true", help="ignore the resume cache and ask every game again")
    parser.add_argument("--write", action="store_true", help="save the merged file (default: print only)")
    args = parser.parse_args()

    games = load_catalog(args.limit)
    bundled = read_bundled()
    merged = {game_id: value for game_id, value in bundled.items()}

    cache = {"asked": {}}
    cache_file = os.path.join(tempfile.gettempdir(), f"overdrive-ratings-{args.region.lower()}-{args.language.lower()}.json")
    if not args.fresh:
        try:
            loaded = json.load(open(cache_file, encoding="utf-8"))
        except (OSError, ValueError):
            loaded = None
        if isinstance(loaded, dict) and isinstance(loaded.get("asked"), dict):
            cache["asked"] = {game_id: rating for game_id, rating in loaded["asked"].items()
                              if isinstance(game_id, str) and isinstance(rating, dict)
                              and (not rating or (isinstance(rating.get("average"), (int, float)) and isinstance(rating.get("count"), int)))}
    for game_id, rating in list(cache["asked"].items()):
        if not rating or game_id in merged or args.refresh:
            continue
        merged[game_id] = rating
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
        game_id, title = game
        existing = merged.get(game_id)
        if not args.refresh and (existing or game_id in asked):
            return existing, None
        return existing, store_rating(game_id, title, args.region, args.language)

    jobs = max(1, args.jobs)
    found_new, skipped = 0, 0
    if jobs == 1:
        def walk():
            for index, game in enumerate(games, 1):
                quiet = not args.refresh and (merged.get(game[0]) or game[0] in asked)
                yield index, collect(game)
                if index < len(games) and not quiet:
                    time.sleep(SLEEP)
        stream = walk()
    else:
        from concurrent.futures import ThreadPoolExecutor
        pool = ThreadPoolExecutor(max_workers=jobs)
        stream = enumerate(pool.map(collect, games), 1)
    for index, (existing, rating) in stream:
        game_id = games[index - 1][0]
        if rating is None:
            if existing is None:
                cache["asked"][game_id] = {}
                continue
            skipped += 1
        else:
            cache["asked"][game_id] = rating
            merged[game_id] = rating
            if not existing:
                found_new += 1
        if args.chunk and index % args.chunk == 0:
            save_cache()
            print(f"... {index}/{len(games)} games, {found_new} new ratings so far")
    if jobs > 1:
        pool.shutdown(wait=True)
    save_cache()

    kept = {game_id: value for game_id, value in merged.items() if value}
    print(f"catalog: {len(games)} games | already had a rating: {skipped} | new ratings: {found_new} | games with ratings: {len(kept)}")

    if args.write:
        payload = json.dumps(kept, ensure_ascii=False, indent=2)
        tmp = f"{RATINGS}.tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            handle.write(f"var ratings = {payload};\n\nexport {{ ratings }};\n")
        os.replace(tmp, RATINGS)
        print(f"saved {os.path.abspath(RATINGS)}")
    else:
        for game_id in list(kept)[:20]:
            print(f"  {game_id}: {kept[game_id]['average']}/5, {kept[game_id]['count']} ratings")
        if len(kept) > 20:
            print(f"  ... and {len(kept) - 20} more (re-run with --write to keep them)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
