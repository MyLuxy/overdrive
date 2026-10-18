#!/usr/bin/env python3
"""Fill the catalog's missing game details from the PlayStation Store, with IGDB as a fallback.

    python -I tools/enrich-catalog.py --since HEAD [--write] [--env-file <path>] [--report <file>]
    python -I tools/enrich-catalog.py --ids PPSA01474,CUSA00001 [--write] ...

It is meant for the games an import adds: --since <git ref> takes the games in catalog.js now that
were not in it at that ref (after an import, before committing it: --since HEAD), --ids names them.
The games already in the catalog are left alone. For each it fills only what is missing, never
replacing what the catalog already has:

  catalog.js   genres, art.cover, art.hero, releaseDate (+ year), publisher, developer
  pages/<id>   about (description paragraphs), summary, shots (screenshot + thumbnail)

Sources, in order:
  1. PlayStation Store, by title ID: Sony's unofficial "chihiro" API, which can change or vanish. The
     storefront of the title's own region is asked first (its content ID's prefix, from
     andshrew/PlayStation-Titles, MIT), then the others; then the same game's other title IDs
     (same concept ID). Its images are asked from image.api.playstation.com resized to 1920 wide, as
     JPEG: the console decodes JPEG and PNG up to 5 megapixels only, and the originals can be 4K.
     A description from a storefront not in English is left out; its images and genre are kept.
  2. IGDB, by name on PS4/PS5, only for what the store did not give, and only when the name matches
     and the release year agrees. It needs a Twitch app: IGDB_CLIENT_ID and IGDB_CLIENT_SECRET from
     the environment or from --env-file (never written anywhere). Without them, IGDB is skipped.

Without --write nothing is written: it prints and saves (--report) what it would change. Answers are
cached in --cache (default ../.enrich-cache, outside the repository) so a second run asks again
only for what failed. Text stays in the language the source gives.
"""
import argparse
import concurrent.futures
import html
import json
import os
import pathlib
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "app" / "data"
CHIHIRO = "https://store.playstation.com/store/api/chihiro/00_09_000/titlecontainer/{store}/{lang}/999/{title}_00"
ANDSHREW = "https://raw.githubusercontent.com/andshrew/PlayStation-Titles/main/{platform}_Titles.tsv"
# Storefronts by a content ID's region prefix, the title's own first; then the rest.
REGION_STORES = {"UP": [("US", "en")], "EP": [("GB", "en"), ("DE", "de")], "JP": [("JP", "ja")], "HP": [("HK", "en")],
                 "KP": [("KR", "ko")], "IP": [("US", "en")]}
STORES = [("US", "en"), ("GB", "en"), ("HK", "en"), ("AU", "en"), ("CA", "en"), ("SG", "en"), ("DE", "de"), ("FR", "fr"),
          ("JP", "ja"), ("KR", "ko"), ("TW", "zh"), ("IT", "it"), ("ES", "es")]
ENGLISH = {"en"}
# The catalog's own genre names, so new games join the genres the app already lists.
STORE_GENRES = {"ACTION": "Action", "ADVENTURE": "Adventure", "ROLE_PLAYING_GAMES": "Role Playing Games", "HORROR": "Horror",
                "SHOOTER": "Shooter", "SIMULATION": "Simulation", "SIMULATOR": "Simulation", "DRIVING_RACING": "Driving/Racing",
                "RACING": "Driving/Racing", "STRATEGY": "Strategy", "PUZZLE": "Puzzle", "SPORTS": "Sport", "SPORT": "Sport",
                "FIGHTING": "Fighting", "FAMILY": "Family", "CASUAL": "Casual", "ARCADE": "Arcade", "MUSIC_RHYTHM": "Music/Rhythm",
                "MUSIC": "Music/Rhythm", "PARTY": "Party", "BRAIN_TRAINING": "Brain Training", "EDUCATIONAL": "Educational",
                "QUIZ": "Quiz", "FIRST_PERSON_SHOOTER": "Shooter", "THIRD_PERSON_SHOOTER": "Shooter", "SURVIVAL_HORROR": "Horror"}
IGDB_GENRES = {"Role-playing (RPG)": "Role Playing Games", "Shooter": "Shooter", "Adventure": "Adventure", "Indie": "Indie",
               "Puzzle": "Puzzle", "Racing": "Driving/Racing", "Sport": "Sport", "Strategy": "Strategy",
               "Real Time Strategy (RTS)": "Strategy", "Turn-based strategy (TBS)": "Strategy", "Tactical": "Strategy",
               "Simulator": "Simulation", "Fighting": "Fighting", "Arcade": "Arcade", "Music": "Music/Rhythm",
               "Hack and slash/Beat 'em up": "Action", "Platform": "Action", "Quiz/Trivia": "Quiz", "Card & Board Game": "Board Game"}
BOILERPLATE = re.compile(r"(?i)system may need to be updated|playstation\.com/bc|playable on ps5|ps4 version of this game|"
                         r"internet connection required|network features|online features require|terms of service|"
                         r"one-time license fee|all rights reserved|©|\(c\)\s*\d{4}|^\s*\*+\s*$|"
                         r"entitles you to|this product (?:includes|contains)|cross-buy|digital ps4.{0,20}digital ps5|"
                         r"pre-?order|purchase of this|may be purchased separately|sold separately|no longer be available|"
                         r"available for purchase|"
                         r"playstation plus (?:membership|subscription)|ps plus (?:membership|subscription)")
ABOUT_PARAGRAPHS = 12
USER_AGENT = "Mozilla/5.0 (Overdrive catalog tool)"

_lock = threading.Lock()


def fetch(url, data=None, headers=None, timeout=15, attempts=2):
    """Bytes of a GET (or POST with data), or None on a 404/410; retries what looks transient."""
    for attempt in range(attempts):
        request = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, **(headers or {})})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code in (404, 410):
                return error.read() or None
            if error.code not in (429, 500, 502, 503, 504) or attempt + 1 == attempts:
                return None
        except (urllib.error.URLError, TimeoutError, OSError):
            if attempt + 1 == attempts:
                return None
        time.sleep(1.5 * (attempt + 1))
    return None


class Cache:
    """Answers by key in one JSON file per source, so a rerun only asks for what is missing."""

    def __init__(self, directory):
        self.directory = pathlib.Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.files = {}

    def _load(self, name):
        if name not in self.files:
            path = self.directory / f"{name}.json"
            self.files[name] = json.loads(path.read_bytes()) if path.exists() else {}
        return self.files[name]

    def get(self, name, key):
        with _lock:
            return self._load(name).get(key)

    def put(self, name, key, value):
        with _lock:
            self._load(name)[key] = value

    def save(self):
        with _lock:
            for name, values in self.files.items():
                (self.directory / f"{name}.json").write_bytes(json.dumps(values, ensure_ascii=False).encode("utf-8"))


# --- the PlayStation Store ---------------------------------------------------------------------

def load_titles(cache):
    """title ID -> concept ID, content region and store name; concept ID -> title IDs (andshrew's lists)."""
    concept, region, names, by_concept = {}, {}, {}, {}
    for platform in ("PS5", "PS4"):
        path = cache.directory / f"{platform}_Titles.tsv"
        if not path.exists() or time.time() - path.stat().st_mtime > 7 * 86400:
            body = fetch(ANDSHREW.format(platform=platform), timeout=60)
            if body:
                path.write_bytes(body)
        if not path.exists():
            print(f"warning: no {platform} title list; other regions' title IDs are not tried", file=sys.stderr)
            continue
        lines = path.read_bytes().decode("utf-8", "replace").splitlines()
        header = lines[0].split("\t")
        at = {name: header.index(name) for name in ("titleId", "conceptId", "name", "contentId")}
        for line in lines[1:]:
            cells = line.split("\t")
            if len(cells) <= max(at.values()):
                continue
            title = cells[at["titleId"]].split("_")[0]
            concept[title] = cells[at["conceptId"]]
            region[title] = cells[at["contentId"]][:2]
            names.setdefault(title, cells[at["name"]])
            by_concept.setdefault(cells[at["conceptId"]], []).append(title)
    return concept, region, names, by_concept


def chihiro(cache, title, region):
    """The store's container for a title ID, from the first storefront that lists it, with its language."""
    cached = cache.get("chihiro", title)
    if cached is not None:
        return cached or None
    stores = REGION_STORES.get(region, []) + [store for store in STORES if store not in REGION_STORES.get(region, [])]
    found = {}
    for store, lang in stores:
        body = fetch(CHIHIRO.format(store=store, lang=lang, title=title))
        try:
            data = json.loads(body) if body else {}
        except ValueError:
            data = {}
        if data.get("name"):
            # Only what the catalog takes, so the cache stays small.
            keep = {"name": data.get("name"), "images": data.get("images"), "long_desc": data.get("long_desc"),
                    "release_date": data.get("release_date"), "provider_name": data.get("provider_name"),
                    "metadata": {k: (data.get("metadata") or {}).get(k) for k in ("game_genre", "game_subgenre")},
                    "mediaList": {"screenshots": [{"url": s.get("url")} for s in (data.get("mediaList") or {}).get("screenshots") or []]},
                    "star_rating": data.get("star_rating")}
            found = {"store": store, "lang": lang, "data": keep}
            break
    cache.put("chihiro", title, found)
    return found or None


def resized(url, width):
    """image.api.playstation.com's resized JPEG for a store image (vulcan.dl.playstation.net/...)."""
    match = re.match(r"https?://(?:vulcan\.dl\.playstation\.net|image\.api\.playstation\.com/vulcan)/(ap/rnd/[^?#]+)", url or "")
    return f"https://image.api.playstation.com/vulcan/{match.group(1)}?w={width}&thumb=false" if match else None


def paragraphs(markup):
    """A store description's HTML as plain paragraphs, without platform notices or legal lines."""
    text = re.sub(r"(?i)<br\s*/?>|</p>|</li>|</h\d>", "\n", markup or "")
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    out = []
    for line in (re.sub(r"\s+", " ", part).strip() for part in text.split("\n")):
        if len(line) < 3 or BOILERPLATE.search(line):
            continue
        out.append(line)
    return out


def summary_of(about):
    """A short line from a description: its first real paragraph, cut at a sentence if long."""
    # A sentence, not an edition's list of contents ("Choice of 2 Elite Players") or a bullet.
    sentence = lambda p: len(p) > 60 and p != p.upper() and re.search(r"[.!?…]['\"”’)]?$", p) and not re.match(r"^[-•*–]", p)
    first = next((p for p in about if sentence(p)), next((p for p in about if len(p) > 40 and p != p.upper()), about[0] if about else ""))
    if len(first) <= 220:
        return first
    cut = first[:220]
    end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[: end + 1] if end > 60 else cut.rsplit(" ", 1)[0] + "…"


def from_store(found):
    data, lang = found["data"], found["lang"]
    images = {image.get("type"): image.get("url") for image in data.get("images") or []}
    genres = []
    for key in ("game_genre", "game_subgenre"):
        for value in ((data.get("metadata") or {}).get(key) or {}).get("values") or []:
            name = STORE_GENRES.get(value)
            if name and name not in genres:
                genres.append(name)
    shots = []
    for shot in (data.get("mediaList") or {}).get("screenshots") or []:
        big, small = resized(shot.get("url"), 1920), resized(shot.get("url"), 600)
        if big:
            shots.append({"url": big, "thumb": small})
    about = paragraphs(data.get("long_desc"))[:ABOUT_PARAGRAPHS] if lang in ENGLISH else []
    date = (data.get("release_date") or "")[:10]
    return {
        "source": f"store {found['store']}/{lang}",
        "cover": resized(images.get(10) or images.get(1), 440),
        "hero": resized(images.get(12) or images.get(13), 1920),
        "genres": genres,
        "shots": shots[:10],
        "about": about,
        "summary": summary_of(about) if about else "",
        "releaseDate": date if re.fullmatch(r"\d{4}-\d{2}-\d{2}", date) else "",
        "publisher": data.get("provider_name") or "",
        "developer": "",
    }


# --- IGDB ---------------------------------------------------------------------------------------

class Igdb:
    TOKEN = "https://id.twitch.tv/oauth2/token"
    GAMES = "https://api.igdb.com/v4/games"
    PLATFORMS = "48,167"  # PS4, PS5

    def __init__(self, client_id, secret, cache):
        self.client_id, self.secret, self.cache = client_id, secret, cache
        self.token = None
        self.last = 0.0

    def _token(self):
        if self.token is None:
            query = urllib.parse.urlencode({"client_id": self.client_id, "client_secret": self.secret, "grant_type": "client_credentials"})
            body = fetch(f"{self.TOKEN}?{query}", data=b"")
            self.token = (json.loads(body) if body else {}).get("access_token") or ""
        return self.token

    def search(self, name):
        cached = self.cache.get("igdb", name)
        if cached is not None:
            return cached
        token = self._token()
        if not token:
            return []
        with _lock:  # IGDB allows four requests a second
            wait = self.last + 0.3 - time.time()
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
        query = (f'search "{name.replace(chr(34), "")}"; fields id,name,summary,storyline,first_release_date,genres.name,'
                 f"cover.image_id,screenshots.image_id,artworks.image_id,involved_companies.developer,"
                 f"involved_companies.publisher,involved_companies.company.name; where platforms = ({self.PLATFORMS}); limit 5;")
        body = fetch(self.GAMES, data=query.encode("utf-8"), headers={"Client-ID": self.client_id, "Authorization": f"Bearer {token}"})
        try:
            games = json.loads(body) if body else []
        except ValueError:
            games = []
        self.cache.put("igdb", name, games if isinstance(games, list) else [])
        return games if isinstance(games, list) else []


def fold(text):
    text = re.sub(r"[™®©]", "", (text or "").lower()).replace("&", " and ")
    text = re.sub(r"\b(deluxe|ultimate|definitive|complete|gold|standard|digital|game of the year|goty|remastered|edition|ps4|ps5)\b", " ", text)
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def from_igdb(igdb, game, store_name=None):
    # The catalog's title, the store's own name for the title ID ("Lost Records: Bloom & Rage" for
    # "Lost Records Bloom and Rage") and the title without its edition words, searched in turn.
    names = [game["title"], store_name, fold(game["title"])]
    want = {fold(name) for name in names if name}
    year = game.get("year")
    hits, seen = [], set()
    for name in dict.fromkeys(re.sub(r"[™®©]", "", name).strip() for name in names if name):
        for hit in igdb.search(name):
            key = hit.get("id") or (hit.get("name"), hit.get("first_release_date"))
            if key not in seen:
                seen.add(key)
                hits.append(hit)
        if any(fold(hit.get("name")) in want for hit in hits):
            break
    for hit in hits:
        if fold(hit.get("name")) not in want:
            continue
        released = time.gmtime(hit["first_release_date"]).tm_year if hit.get("first_release_date") else None
        if year and released and abs(released - year) > 1:
            continue
        image = lambda kind, image_id: f"https://images.igdb.com/igdb/image/upload/{kind}/{image_id}.jpg"
        shots = [{"url": image("t_1080p", s["image_id"]), "thumb": image("t_screenshot_med", s["image_id"])}
                 for s in hit.get("screenshots") or [] if s.get("image_id")]
        about = [p.strip() for p in re.split(r"\n\s*\n|\n", hit.get("summary") or "") if p.strip()]
        companies = hit.get("involved_companies") or []
        name_of = lambda role: next((c["company"]["name"] for c in companies if c.get(role) and c.get("company")), "")
        genres = []
        for g in hit.get("genres") or []:
            mapped = IGDB_GENRES.get(g.get("name"))
            if mapped and mapped not in genres:
                genres.append(mapped)
        return {
            "source": "igdb",
            "cover": image("t_cover_big", hit["cover"]["image_id"]) if (hit.get("cover") or {}).get("image_id") else None,
            "hero": image("t_1080p", hit["artworks"][0]["image_id"]) if hit.get("artworks") else None,
            "genres": genres,
            "shots": shots[:10],
            "about": about,
            "summary": summary_of(about) if about else "",
            "releaseDate": time.strftime("%Y-%m-%d", time.gmtime(hit["first_release_date"])) if hit.get("first_release_date") else "",
            "publisher": name_of("publisher"),
            "developer": name_of("developer"),
        }
    return None


# --- the catalog --------------------------------------------------------------------------------

LINE = re.compile(r'^    \{ "id": "([A-Z0-9]+)"')


def parse_line(line):
    """A catalog line's fields, reading the bundle's \\xNN escapes as JSON's."""
    text = line.strip().rstrip(",")
    return json.loads(re.sub(r"\\x([0-9a-fA-F]{2})", r"\\u00\1", text))


def lacking(game, page):
    has_text = any(len(p) > 40 for p in page.get("about") or [])
    return {
        "genres": not game.get("genres"),
        "cover": not (game.get("art") or {}).get("cover"),
        "hero": not (game.get("art") or {}).get("hero"),
        "releaseDate": not game.get("releaseDate"),
        "publisher": not game.get("publisher"),
        "developer": not game.get("developer"),
        "about": not has_text,
        "summary": not (page.get("summary") or "").strip(),
        "shots": not page.get("shots"),
    }


def edit_line(line, game, fill):
    """The catalog line with the filled fields written in place, the rest byte for byte as it was."""
    js = lambda value: json.dumps(value, ensure_ascii=True)
    if "genres" in fill:
        line = line.replace('"genres": []', f'"genres": [{", ".join(js(g) for g in fill["genres"])}]', 1)
    for key in ("developer", "publisher"):
        if key in fill:
            line = line.replace(f'"{key}": ""', f'"{key}": {js(fill[key])}', 1)
    if "releaseDate" in fill:
        date = fill["releaseDate"]
        year = f', "year": {int(date[:4])}' if '"year":' not in line else ""
        line = line.replace('"releaseDate": ""', f'"releaseDate": {js(date)}{year}', 1)
    art = re.search(r'"art": \{([^{}]*)\}', line)
    if art and ("cover" in fill or "hero" in fill):
        body = art.group(1).strip()
        # An empty "cover"/"hero" left by a new game's skeleton line would stay after the filled one and,
        # as the later key, win: the filled value replaces it instead.
        for key in ("cover", "hero"):
            if key in fill:
                body = re.sub(rf'(?:^|,\s*)"{key}": ""', "", body).strip().lstrip(",").strip()
        if "cover" in fill:
            body = f'"cover": {js(fill["cover"])}' + (f", {body}" if body else "")
        if "hero" in fill:
            body = f'{body}, "hero": {js(fill["hero"])}' if body else f'"hero": {js(fill["hero"])}'
        line = line[: art.start()] + f'"art": {{ {body} }}' + line[art.end():]
    return line


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--write", action="store_true", help="write the changes (default: only report them)")
    parser.add_argument("--ids", help="these title IDs, comma-separated")
    parser.add_argument("--since", help="the games added to catalog.js since this git ref (an import: HEAD)")
    parser.add_argument("--cache", default=str(ROOT.parent / ".enrich-cache"), help="where answers are kept between runs")
    parser.add_argument("--env-file", help="a .env file holding IGDB_CLIENT_ID and IGDB_CLIENT_SECRET")
    parser.add_argument("--report", help="save every change as JSON to this file")
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args(argv)

    env = dict(os.environ)
    if args.env_file:
        for line in pathlib.Path(args.env_file).read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                env.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    cache = Cache(args.cache)
    igdb = Igdb(env["IGDB_CLIENT_ID"], env["IGDB_CLIENT_SECRET"], cache) if env.get("IGDB_CLIENT_ID") and env.get("IGDB_CLIENT_SECRET") else None
    print("IGDB fallback:", "on" if igdb else "off (no IGDB_CLIENT_ID / IGDB_CLIENT_SECRET)")

    catalog_path = DATA / "catalog.js"
    lines = catalog_path.read_bytes().decode("utf-8").split("\n")
    if not args.ids and not args.since:
        raise SystemExit("name the games: --since <git ref> for the ones an import added, or --ids")
    wanted = set(args.ids.split(",")) if args.ids else set()
    if args.since:
        import subprocess
        before = subprocess.run(["git", "-C", str(ROOT), "show", f"{args.since}:app/data/catalog.js"], capture_output=True)
        if before.returncode:
            raise SystemExit(f"git could not read catalog.js at {args.since}")
        known = set(re.findall(r'^    \{ "id": "([A-Z0-9]+)"', before.stdout.decode("utf-8"), re.M))
        wanted |= {m.group(1) for m in map(LINE.match, lines) if m and m.group(1) not in known}
        print(f"games added since {args.since}: {len(wanted)}")
    if not wanted:
        print("no games to fill")
        return
    targets = []
    for index, line in enumerate(lines):
        match = LINE.match(line)
        if not match or (wanted and match.group(1) not in wanted):
            continue
        game = parse_line(line)
        page_path = DATA / "pages" / f"{game['id']}.json"
        page = json.loads(page_path.read_bytes()) if page_path.exists() else {"about": [], "shots": [], "summary": ""}
        need = {key for key, missing in lacking(game, page).items() if missing}
        if need:
            targets.append((index, game, page, page_path, need))
    print(f"games missing something: {len(targets)}")
    concept, region, names, by_concept = load_titles(cache)

    def resolve(target):
        _, game, _, _, need = target
        title = game["id"]
        found = chihiro(cache, title, region.get(title))
        if not found:
            for sibling in by_concept.get(concept.get(title), []):
                if sibling != title:
                    found = chihiro(cache, sibling, region.get(sibling))
                    if found:
                        break
        results = [from_store(found)] if found else []
        if igdb and any(not any(r.get(k) for r in results) for k in need):
            hit = from_igdb(igdb, game, names.get(title))
            if hit:
                results.append(hit)
        fill, sources = {}, {}
        for key in need:
            for result in results:
                value = result.get(key)
                if value:
                    fill[key] = value
                    sources[key] = result["source"]
                    break
        return fill, sources

    changes = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        for done, (target, (fill, sources)) in enumerate(zip(targets, pool.map(resolve, targets)), 1):
            if fill:
                changes.append((target, fill, sources))
            if done % 50 == 0:
                print(f"  {done}/{len(targets)} looked up, {len(changes)} with something to add")
                cache.save()
    cache.save()

    tally = {}
    report = []
    for (index, game, page, page_path, need), fill, sources in changes:
        for key in fill:
            tally[key] = tally.get(key, 0) + 1
        report.append({"id": game["id"], "title": game["title"], "filled": sorted(fill), "sources": sources,
                       "missing": sorted(need - set(fill)), "genres": fill.get("genres")})
        if args.write:
            lines[index] = edit_line(lines[index], game, fill)
            if parse_line(lines[index])["id"] != game["id"]:
                raise SystemExit(f"{game['id']}: the edited catalog line no longer parses")
            page_fill = {key: fill[key] for key in ("about", "summary", "shots") if key in fill}
            if page_fill:
                page_path.write_bytes(json.dumps({**{"about": [], "shots": [], "summary": ""}, **page, **page_fill},
                                                 ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    untouched = len(targets) - len(changes)
    print(f"\ngames with something added: {len(changes)} | nothing found: {untouched}")
    for key in ("genres", "cover", "hero", "about", "summary", "shots", "releaseDate", "publisher", "developer"):
        print(f"  {key:12} {tally.get(key, 0)}")
    if args.report:
        pathlib.Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    if args.write:
        catalog_path.write_bytes("\n".join(lines).encode("utf-8"))
        print("written: catalog.js and the pages")
    else:
        print("dry run: nothing written (add --write)")


if __name__ == "__main__":
    main()
