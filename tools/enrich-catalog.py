#!/usr/bin/env python3
"""Fill the catalog's missing game details from the PlayStation Store, with IGDB as a fallback.

    python -I tools/enrich-catalog.py --since HEAD [--write] [--env-file <path>] [--report <file>]
    python -I tools/enrich-catalog.py --ids PPSA01474,CUSA00001 [--write] ...

It is meant for the games an import adds: --since <git ref> takes the games in catalog.js now that
were not in it at that ref (after an import, before committing it: --since HEAD), --ids names them.
The games already in the catalog are left alone. For each it fills only what is missing, never
replacing what the catalog already has:

  catalog.js   genres, art.cover, art.hero, art.tint, releaseDate (+ year), publisher, developer
  pages/<id>   about (description paragraphs), summary, shots (screenshot + thumbnail)

Sources, in order:
  1. PlayStation Store, by title ID: Sony's unofficial "chihiro" API, which can change or vanish. The
     storefront of the title's own region is asked first (its content ID's prefix, from
     andshrew/PlayStation-Titles, MIT), then the others; then the same game's other title IDs
     (same concept ID). A title ID the store does not answer for is searched by name, which finds a
     renamed, delisted or cross-gen product: the game's own product (or its cross-gen sibling) wins,
     and an enhanced edition is taken only when the store has no product with the game's title ID.
     Its images are asked from image.api.playstation.com resized to 1920 wide, as JPEG: the console
     decodes JPEG and PNG up to 5 megapixels only, and the originals can be 4K. Older PS4 titles
     whose images live on apollo2.dl.playstation.net are used as they are (1920x1080 heroes and
     1280x720 screenshots). A description from a storefront not in English is left out; its images
     and genre are kept.
  2. IGDB, by name on PS4/PS5, only for what the store did not give, and only when the name matches
     and the release year agrees. It needs a Twitch app: IGDB_CLIENT_ID and IGDB_CLIENT_SECRET from
     the environment or from --env-file (never written anywhere). Without them, IGDB is skipped.

art.tint, the colour behind the game's page, is the cover's average colour, as the catalog's own
tints are (within a few levels of 255 on 26 of 30 checked): it needs Pillow, and is skipped without it.

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

try:
    from PIL import Image
except ImportError:
    Image = None

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "app" / "data"
CHIHIRO = "https://store.playstation.com/store/api/chihiro/00_09_000/titlecontainer/{store}/{lang}/999/{title}_00"
# A storefront search for a game the title ID lookup did not give (a renamed, delisted or cross-gen
# product); ?game_content_type=games keeps add-ons out of the answer.
SEARCH = "https://store.playstation.com/store/api/chihiro/00_09_000/search/{store}/{lang}/24/{query}{filter}"
SEARCH_GAMES = "?game_content_type=games"
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
                "MUSIC": "Music/Rhythm", "PARTY": "Party", "BRAIN_TRAINING": "Educational", "EDUCATIONAL": "Educational",
                "QUIZ": "Educational", "FIRST_PERSON_SHOOTER": "Shooter", "THIRD_PERSON_SHOOTER": "Shooter", "SURVIVAL_HORROR": "Horror"}
# The store's "genre" field is already display text; accept only the names the catalog uses, plus the
# few spellings the store has for them.
STORE_GENRES.update({name: name for name in set(STORE_GENRES.values())})
STORE_GENRES.update({"Role Playing": "Role Playing Games", "Racing": "Driving/Racing", "Sports": "Sport"})
# Words that can follow a title in a store name without it being another game in the series.
TITLE_CONNECTORS = {"and", "the", "of", "a", "for"}
TITLE_EDITIONS = {"enhanced", "director", "s", "cut", "collection", "trilogy", "hd", "bundle", "remaster"}
STORE_SKIP_CATEGORIES = {"add_on", "demo", "theme", "avatar", "application", "virtual_currency", "season_pass"}
ROMAN = re.compile(r"(?i)(?:i{1,3}|iv|v|vi{0,3}|ix|x)")
IGDB_GENRES = {"Role-playing (RPG)": "Role Playing Games", "Shooter": "Shooter", "Adventure": "Adventure", "Indie": "Indie",
               "Puzzle": "Puzzle", "Racing": "Driving/Racing", "Sport": "Sport", "Strategy": "Strategy",
               "Real Time Strategy (RTS)": "Strategy", "Turn-based strategy (TBS)": "Strategy", "Tactical": "Strategy",
               "Simulator": "Simulation", "Fighting": "Fighting", "Arcade": "Arcade", "Music": "Music/Rhythm",
               "Hack and slash/Beat 'em up": "Action", "Platform": "Action", "Quiz/Trivia": "Educational", "Card & Board Game": "Educational"}
BOILERPLATE = re.compile(r"(?i)system may need to be updated|playstation\.com/bc|playable on ps5|ps4 version of this game|"
                         r"internet connection required|network features|online features require|terms of service|"
                         r"one-time license fee|all rights reserved|©|\(c\)\s*\d{4}|^\s*\*+\s*$|"
                         r"entitles you to|this product (?:includes|contains)|cross-buy|digital ps4.{0,20}digital ps5|"
                         r"pre-?order|purchase of this|may be purchased separately|sold separately|no longer be available|"
                         r"available for purchase|"
                         r"playstation plus (?:membership|subscription)|ps plus (?:membership|subscription)")
ABOUT_PARAGRAPHS = 12
# As many screenshots as the catalog's own games have: each is an image a game's page loads.
SHOTS = 3
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
                    "metadata": {k: (data.get("metadata") or {}).get(k) for k in ("genre", "game_genre", "game_subgenre")},
                    "mediaList": {"screenshots": [{"url": s.get("url")} for s in (data.get("mediaList") or {}).get("screenshots") or []]},
                    "star_rating": data.get("star_rating")}
            found = {"store": store, "lang": lang, "data": keep}
            break
    cache.put("chihiro", title, found)
    return found or None


def resized(url, width):
    """A store image the console can load: image.api.playstation.com's resized JPEG, or the older CDN's own."""
    match = re.match(r"https?://(?:vulcan\.dl\.playstation\.net|image\.api\.playstation\.com/vulcan)/(ap/rnd/[^?#]+)", url or "")
    if match:
        return f"https://image.api.playstation.com/vulcan/{match.group(1)}?w={width}&thumb=false"
    # Older PS4 titles have their images only on apollo2.dl.playstation.net: 1920x1080 heroes and
    # 1280x720 screenshots, within what the console decodes, and the CDN ignores ?w=.
    if re.match(r"https?://[\w.-]+\.dl\.playstation\.net/cdn/", url or ""):
        return url
    return None


def tint_of(cache, cover):
    """The cover's average colour as "#rrggbb", or None when it cannot be read."""
    cached = cache.get("tints", cover)
    if cached is not None:
        return cached or None
    small = re.sub(r"([?&]w=)\d+", r"\g<1>128", cover) if "image.api.playstation.com" in cover else cover
    body = fetch(small, timeout=30)
    tint = ""
    try:
        import io
        # The raw RGB bytes, three to a pixel (Image.getdata goes in Pillow 14).
        raw = Image.open(io.BytesIO(body)).convert("RGB").resize((32, 32)).tobytes() if body else b""
        if raw:
            tint = "#" + "".join("%02x" % round(sum(raw[i::3]) / (len(raw) // 3)) for i in range(3))
    except (OSError, ValueError):
        pass
    cache.put("tints", cover, tint)
    return tint or None


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
    for key in ("genre", "game_genre", "game_subgenre"):
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
        "shots": shots[:SHOTS],
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


def title_id_of(product):
    match = re.search(r"(?:CUSA|PPSA)\d+", product or "")
    return match.group(0) if match else ""


def platform_rank(platforms, platform):
    """How well a product's platforms fit the catalog's: 2 the same, 1 the other one, -1 a PS3-only one."""
    if isinstance(platforms, str):
        platforms = [platforms]
    text = " ".join(platforms or []).lower()
    if not text:
        return 0
    if platform == "ps4":
        return 2 if "ps4" in text else 1 if "ps5" in text else -1
    if platform == "ps5":
        return 2 if "ps5" in text else 1 if "ps4" in text else -1
    return 0


def year_rank(date, year):
    """1 when the product's year is the catalog's (or close), 0 when one is unknown, -1 otherwise."""
    if not date or not year:
        return 0
    try:
        return 1 if abs(int(str(date)[:4]) - int(year)) <= 1 else -1
    except (TypeError, ValueError):
        return 0


def name_rank(store_name, title):
    """3 the same name, 2 an edition connector ("PS4 & PS5"), 1 an edition, 0 another game."""
    left, right = fold(store_name), fold(title)
    if not left or not right:
        return 0
    if left == right or left.replace(" ", "") == right.replace(" ", ""):
        return 3
    if not left.startswith(right + " "):
        return 0
    rest = left[len(right):].split()
    # A number or a roman numeral after the title is the next game in the series ("… 2", "… II").
    if any(re.fullmatch(r"\d+", word) or (ROMAN.fullmatch(word) and word not in right.split()) for word in rest):
        return 0
    if all(word in TITLE_CONNECTORS for word in rest):
        return 2
    return 1 if all(word in TITLE_CONNECTORS | TITLE_EDITIONS for word in rest) else 0


def store_candidates(links, game, ids):
    """The search hits that are this game (its title ID or, failing that, its name), best first."""
    found = []
    for link in links or []:
        if not link.get("url") or link.get("parent_name"):
            continue
        if (link.get("top_category") or "").lower() in STORE_SKIP_CATEGORIES:
            continue
        places = platform_rank(link.get("playable_platform"), game.get("platform"))
        if places < 0:
            continue
        product = title_id_of(link.get("id"))
        exact = product == game["id"]
        same = bool(product and product in ids)
        score = name_rank(link.get("name"), game.get("title"))
        # The title ID alone is not enough for a sibling: a double pack of the same concept has a
        # different name, date and publisher. The game's own title ID always is.
        if exact or score:
            found.append((exact, same, score, places, year_rank(link.get("release_date"), game.get("year")), link))
    return found


def search_store(cache, game, ids, names, region, need):
    """A product for a game the title ID lookup did not give, found by name on the storefronts."""
    cached = cache.get("search", game["id"])
    if cached is not None:
        return cached or None
    stores = REGION_STORES.get(region, []) + [("US", "en"), ("GB", "en")] + STORES
    stores = list(dict.fromkeys(stores))
    queries = list(dict.fromkeys(re.sub(r"[™®©]", "", name).strip() for name in [game.get("title"), *(names or [])] if name))
    merged, source = {}, ""
    for store, lang in stores:
        candidates = []
        for only_games in (True, False):
            for query in queries:
                body = fetch(SEARCH.format(store=store, lang=lang, query=urllib.parse.quote(query),
                                           filter=SEARCH_GAMES if only_games else ""))
                try:
                    data = json.loads(body) if body else {}
                except ValueError:
                    data = {}
                candidates += store_candidates(data.get("links"), game, ids)
        if not candidates:
            continue
        # The game's own product (or its cross-gen sibling) first; another edition only when the store
        # has no product with the game's title ID. A same-name product from another concept is a remake.
        chosen = [candidate for candidate in candidates if candidate[1]] or [candidate for candidate in candidates if candidate[2] >= 1]
        for _exact, _same, _score, _places, _years, link in sorted(chosen, key=lambda candidate: candidate[:5], reverse=True)[:3]:
            body = fetch(link["url"])
            try:
                data = json.loads(body) if body else {}
            except ValueError:
                data = {}
            if not data.get("name"):
                continue
            found = {"store": store, "lang": lang, "data": {
                "name": data.get("name"), "images": data.get("images"), "long_desc": data.get("long_desc"),
                "release_date": data.get("release_date"), "provider_name": data.get("provider_name"),
                "metadata": {k: (data.get("metadata") or {}).get(k) for k in ("genre", "game_genre", "game_subgenre")},
                "mediaList": {"screenshots": [{"url": shot.get("url")} for shot in (data.get("mediaList") or {}).get("screenshots") or []]},
                "star_rating": data.get("star_rating")}}
            result = from_store(found)
            source = source or result["source"]
            for key, value in result.items():
                if key != "source" and value and not merged.get(key):
                    merged[key] = value
            if all(merged.get(key) for key in need - {"developer", "tint"}):
                break
        if merged and all(merged.get(key) for key in need - {"developer", "tint"}):
            break
    if merged:
        merged["source"] = source
    cache.put("search", game["id"], merged)
    return merged or None


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
            "shots": shots[:SHOTS],
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
        "tint": Image is not None and not (game.get("art") or {}).get("tint"),
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
    art = re.search(r'"art": \{([^{}]*)\}', line)
    if art and "tint" in fill:
        # Before the hero, as the catalog's own lines have it.
        body = art.group(1).strip()
        entry = f'"tint": {js(fill["tint"])}'
        hero = body.find('"hero":')
        body = (body[:hero] + entry + ", " + body[hero:]) if hero >= 0 else (f"{body}, {entry}" if body else entry)
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
    if Image is None:
        print("tint: off (no Pillow: pip install pillow)")

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
        missing = {key for key in need if key not in {"developer", "tint"} and not any(result.get(key) for result in results)}
        if missing:
            ids = {title, *by_concept.get(concept.get(title), [])}
            searched = search_store(cache, game, ids, [names.get(title)], region.get(title), missing)
            if searched:
                results.append(searched)
        if igdb and any(not any(r.get(k) for r in results) for k in need):
            hit = from_igdb(igdb, game, names.get(title))
            if hit:
                results.append(hit)
        fill, sources = {}, {}
        for key in need - {"tint"}:
            for result in results:
                value = result.get(key)
                if value:
                    fill[key] = value
                    sources[key] = result["source"]
                    break
        cover = fill.get("cover") or (game.get("art") or {}).get("cover")
        if "tint" in need and cover:
            tint = tint_of(cache, cover)
            if tint:
                fill["tint"], sources["tint"] = tint, "cover"
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
    for key in ("genres", "cover", "hero", "tint", "about", "summary", "shots", "releaseDate", "publisher", "developer"):
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
