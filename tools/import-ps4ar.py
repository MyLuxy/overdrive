#!/usr/bin/env python3
"""Import ps4ar.com's torrent sources into Overdrive's catalog.

    python -P tools/import-ps4ar.py crawl [--cache <dir>] [--platform ps4|ps5|both] [--limit N]
                                           [--shard n/total] [--refresh]
    python -P tools/import-ps4ar.py import [--cache <dir>] [--write] [--report <file>]

ps4ar.com lists PS4 and PS5 games as cards on two static pages:

    https://ps4ar.com/indexps4torrentallpagessearch.html   2307 cards
    https://ps4ar.com/indexps5torrentallpagessearch.html    641 cards

A card names the game, its title id, and a MediaFire page holding a .torrent (the PS5 cards reach
MediaFire through an ouo.io short link, whose ?s= parameter is the MediaFire URL). The site has no
seeders or peers of its own: the app shows the health its own engine reports once the torrent is
added to the queue.

crawl decodes the pages (they are document.write(unescape('%XX…'))), reads every card, fetches each
MediaFire page, downloads its .torrent, and keeps in --cache (default ../.ps4ar-cache, outside the
repository) the torrent's name, info hash, files, trackers and a magnet for it. A second run reads
only what it is missing; several crawls can run at once with --shard n/total, each taking its own
slice of the queue and sharing the cache.

import reads only the cache. It matches each card to a catalog game by title id, then by title and
edition on the same platform, and writes one release record tagged source "ps4ar" on that game:
the torrent's largest file, which is the one every download client takes, its real size, its magnet,
and the .torrent's direct URL. Games whose largest file is an update, a patch, a DLC, a piece of an
extracted tree, or one part of a multi-part set are left out. Every run rebuilds the "ps4ar" records from the cache and keeps the other sources'
records byte for byte; the game gains "ps4ar" in its providers, so the app can list it.
Without --write it only prints, and --report saves, what it would change.
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
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # this folder's own modules, under -P too
from catalog_editions import edition_key  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "app", "data")
CATALOG = os.path.join(DATA, "catalog.js")
RELEASES = os.path.join(DATA, "releases")
SOURCE = "ps4ar"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
PAUSE = 1.0
INDEX = {
    "ps4": "https://ps4ar.com/indexps4torrentallpagessearch.html",
    "ps5": "https://ps4ar.com/indexps5torrentallpagessearch.html",
}
# The extensions a game's payload has. A torrent's largest such file is the game; DLC files and
# samples beside it are smaller and sit in a DLC folder.
FORMAT = {
    ".pkg": "pkg", ".fpkg": "fpkg", ".ffpfsc": "ffpfsc", ".ffpfs": "ffpfs", ".ffpkg": "ffpkg",
    ".exfat": "exfat", ".rar": "rar", ".zip": "zip", ".7z": "7z", ".iso": "binary", ".img": "binary",
    ".bin": "binary",
}
# Update, patch and DLC names glue the marker to digits and underscores (`_Patch_v1.20`,
# `UPDATEv1.12`, `PLAYROOM0DLC0`), where a word boundary never fires; "Dispatch" contains "patch"
# but not at a word head. BACKPORT and FIXED/Repack_fix are full games with a compatibility tag,
# which every service still hands over whole, so they are not supplements.
SUPPLEMENT = re.compile(r"(?<![a-z])(?i:dlcs?|updates?|patch(?:es)?|add-?ons?)(?=$|[^a-z]|[vV]?\d)")
# Pieces of a game's structure, never the game's installable payload: an extracted tree or an
# update ships an eboot beside its data, and taking it would hand over 70 MB instead of the game.
SYSTEM_FILES = {"eboot.bin", "eboot.bin.sdat"}
SUPPLEMENT_FOLDERS = {"dlc", "dlcs", "update", "updates", "patch", "bonus", "artwork", "soundtrack"}
VERSION = re.compile(r"[\[(_ ]\s*v?(\d{1,3}\.\d{1,3}(?:\.\d{1,3})?)\s*[\])_ ]", re.I)
# Not \b: scene names put the id between underscores and punctuation ("_CUSA15467_"), and an
# underscore is a word character, so a plain boundary would miss it.
TITLE_ID = re.compile(r"(?<![A-Za-z0-9])([A-Z]{4}\d{5})(?![0-9])")


# --- Fetching -----------------------------------------------------------------


def fetch_bytes(url, attempts=4):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if isinstance(error, urllib.error.HTTPError) and error.code < 500 or attempt == attempts - 1:
                raise
            wait = PAUSE * 8 * (attempt + 1)
            print(f"  {url}: {error}; again in {wait:.0f} s", file=sys.stderr)
            time.sleep(wait)


def fetch_text(url, attempts=4):
    return fetch_bytes(url, attempts).decode("utf-8", "replace")


def read_json(path, default):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (FileNotFoundError, ValueError):
        # ValueError covers a cache file caught mid-write by a crawl running beside an import.
        return default


def write_json(path, value):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    partial = path + ".part"
    with open(partial, "w", encoding="utf-8", newline="") as handle:
        json.dump(value, handle, ensure_ascii=False, separators=(",", ":"))
    os.replace(partial, path)


def decode_page(text):
    """The page behind ps4ar's document.write(unescape('%XX…')) obfuscation."""
    match = re.search(r"unescape\(\s*['\"](.*?)['\"]\s*\)", text, re.S)
    if not match:
        return text
    blob = match.group(1).encode("latin-1", "replace")

    def replace(found):
        return bytes([int(found.group(1), 16)])

    return re.sub(rb"%([0-9A-Fa-f]{2})", replace, blob).decode("utf-8", "replace")


def iri_to_uri(url):
    """A URL from the page (spaces as '+', brackets, percent signs) as urllib sends it."""
    parts = urllib.parse.urlsplit(url)
    path = urllib.parse.quote(parts.path, safe="/%+~!$&'()*+,;=:@-._")
    query = urllib.parse.quote(parts.query, safe="=&%+~!$'()*+,;:@/?-._")
    return urllib.parse.urlunsplit((parts.scheme, parts.netloc, path, query, parts.fragment))


# --- The pages ------------------------------------------------------------------

CARD = re.compile(r'<div class="game-card" onclick="window\.location\.href=\'([^\']*)\'">(.*?)(?=<div class="game-card"|\Z)', re.S)
ALT = re.compile(r'<img[^>]*\balt="([^"]*)"', re.I)
CARD_ID = re.compile(r"ID\s*:\s*\(?([A-Z]{4}\d{5})\)?", re.I)
OUO = re.compile(r"[?&]s=(.+)$", re.S)


def mediafire_of(url):
    """The MediaFire page a card points at, bypassing ouo.io's ad page."""
    url = html.unescape(url).strip()
    if re.match(r"https?://(?:www\.)?mediafire\.com/file/", url, re.I):
        return url
    found = OUO.search(url)
    if found:
        target = urllib.parse.unquote(found.group(1).strip())
        if re.match(r"https?://(?:www\.)?mediafire\.com/file/", target, re.I):
            return target
    return ""


def card_title(alt):
    """A card's title without the platform, the title id, the version and the format brackets."""
    text = html.unescape(alt or "")
    text = re.sub(r"\[[^\]]*\]", " ", text)
    text = re.sub(r"\([A-Z]{4}\d{5}\)", " ", text, flags=re.I)
    text = re.sub(r"\(\s*v?\d{1,3}\.\d{1,3}(?:\.\d{1,3})?\s*\)", " ", text)
    text = re.sub(r"\b(?:PS4|PS5)\b", " ", text, flags=re.I)
    text = re.sub(r"(?:^|[\s\-])(?:USA|EUR|EU|US|JPN|Japan|Asia|RUS|KOR)(?=$|[\s\-])", " ", text, flags=re.I)
    return re.sub(r"\s+", " ", text).strip(" -_")


def parse_cards(page, platform):
    cards = []
    for match in CARD.finditer(page):
        url = html.unescape(match.group(1)).strip()
        body = match.group(2)
        alt = ALT.search(body)
        named = CARD_ID.search(body)
        mediafire = mediafire_of(url)
        if not mediafire:
            continue
        cards.append({
            "platform": platform,
            "page": url,
            "mediafire": mediafire,
            "file": re.search(r"/file/([A-Za-z0-9]+)/", mediafire).group(1) if re.search(r"/file/([A-Za-z0-9]+)/", mediafire) else "",
            "alt": re.sub(r"\s+", " ", html.unescape(alt.group(1))).strip() if alt else "",
            "title": card_title(alt.group(1) if alt else ""),
            "id": named.group(1).upper() if named else "",
        })
    return cards


# --- Bencode --------------------------------------------------------------------


def bdecode(data, pos=0):
    char = data[pos:pos + 1]
    if char == b"i":
        end = data.index(b"e", pos)
        return int(data[pos + 1:end]), end + 1
    if char == b"l":
        pos += 1
        out = []
        while data[pos:pos + 1] != b"e":
            value, pos = bdecode(data, pos)
            out.append(value)
        return out, pos + 1
    if char == b"d":
        pos += 1
        out = {}
        while data[pos:pos + 1] != b"e":
            key, pos = bdecode(data, pos)
            value, pos = bdecode(data, pos)
            out[key.decode("utf-8", "replace") if isinstance(key, bytes) else key] = value
        return out, pos + 1
    end = data.index(b":", pos)
    length = int(data[pos:end])
    return data[end + 1:end + 1 + length], end + 1 + length


def info_span(data):
    """The bytes of the torrent's "info" value, which its info hash is the SHA-1 of."""
    pos = 1
    while data[pos:pos + 1] != b"e":
        key, pos = bdecode(data, pos)
        start = pos
        value, pos = bdecode(data, pos)
        if key == b"info":
            return start, pos
    raise ValueError("torrent has no info dictionary")


def text(value):
    return value.decode("utf-8", "replace") if isinstance(value, bytes) else str(value or "")


def parse_torrent(data):
    torrent, _ = bdecode(data, 0)
    info = torrent.get("info")
    if not isinstance(info, dict):
        raise ValueError("torrent has no info dictionary")
    start, end = info_span(data)
    name = text(info.get("name"))
    files = []
    if isinstance(info.get("files"), list):
        for item in info["files"]:
            if not isinstance(item, dict) or not item.get("length"):
                continue
            path = "/".join(text(part) for part in item.get("path") or [])
            if path:
                files.append({"path": path, "size": int(item["length"])})
    elif info.get("length"):
        files.append({"path": name, "size": int(info["length"])})
    trackers = []
    for value in [torrent.get("announce")] + [item for group in torrent.get("announce-list") or [] for item in group]:
        tracker = text(value).strip()
        if tracker and tracker not in trackers:
            trackers.append(tracker)
    return {
        "name": name,
        "infoHash": hashlib.sha1(data[start:end]).hexdigest(),
        "size": int(info.get("length") or 0) if not info.get("files") else sum(item["size"] for item in files),
        "files": files,
        "trackers": trackers,
    }


def magnet_of(torrent):
    parts = [f"xt=urn:btih:{torrent['infoHash']}", f"dn={urllib.parse.quote(torrent['name'], safe='')}"]
    parts += [f"tr={urllib.parse.quote(tracker, safe='')}" for tracker in torrent["trackers"]]
    return "magnet:?" + "&".join(parts)


def is_supplement(item):
    """Whether a file is a DLC, an update or a piece of a game's structure."""
    parts = item["path"].split("/")
    name = parts[-1]
    return (any(segment.lower() in SUPPLEMENT_FOLDERS for segment in parts[:-1])
            or bool(SUPPLEMENT.search(name)) or name.lower() in SYSTEM_FILES)


# One volume of a set names its part: `part1.rar`, `x CD2.iso`, `disc 3.bin`. Split archives
# number the extension instead (`x.r00` beside `x.rar`, `x.z01` beside `x.zip`, `x.001` beside
# `x.002`). A client takes only the largest, so a set is never a whole game; two volumes are
# enough to prove it, which is why the sum rule below cannot be the only guard (for two parts
# the largest is never the lesser).
PART = re.compile(r"(?i)(?:^|[._ -])(?:part|cd|dvd|disc|disk)[ _-]?\d+(?=[._ -]|$)")
SPLIT = re.compile(r"(?i)\.(r\d{2}|z\d{2}|\d{3})$")
FIRST_VOLUME = (".rar", ".zip")


def volume_key(item):
    """The name two volumes of one set share, or None when the file names no part."""
    directory, _, name = item["path"].rpartition("/")
    base, extension = os.path.splitext(name)
    extension = extension.lower()
    split = SPLIT.match(extension)
    if not PART.search(base) and not split and extension not in FIRST_VOLUME:
        return None
    base = PART.sub("", base).strip(" ._-").lower()
    if split:
        # `.r00` through `.r99` continue the `.rar` volume, `.z01` the `.zip`; `.001` starts its own.
        extension = {"r": ".rar", "z": ".zip"}.get(extension[1:2], ".001")
    return directory.lower(), base, extension


def part_of_set(largest, files):
    """Whether the largest file is one volume of a multi-volume set."""
    key = volume_key(largest)
    if key is None:
        return False
    return any(item is not largest and volume_key(item) == key for item in files)


def main_file(torrent):
    """The one file a client would download: the torrent's largest.

    The app's engine takes the torrent's largest file when the release does not name one, so the
    release is only usable when that file is the game itself. None when it is a DLC, an update, a
    piece of an extracted tree (an eboot, an .rpf) or one part of a multi-part set.
    """
    if not torrent.get("files"):
        return None, ""
    largest = max(torrent["files"], key=lambda item: item["size"])
    name = largest["path"].split("/")[-1]
    if is_supplement(largest):
        return None, ""
    extension = os.path.splitext(name)[1].lower()
    if extension not in FORMAT:
        return None, ""
    if part_of_set(largest, torrent["files"]):
        return None, ""
    # Several files of a game's kind add up to more than the largest: a multi-part set, which one
    # download would hand over only partly. DLCs and updates beside the game are not parts.
    peers = [item for item in torrent["files"]
             if item is not largest and not is_supplement(item)
             and os.path.splitext(item["path"])[1].lower() in FORMAT]
    if peers and largest["size"] < 0.5 * (largest["size"] + sum(item["size"] for item in peers)):
        return None, ""
    # A loose file tree is made of small pieces: its largest file is a sliver of the torrent.
    if len(torrent["files"]) >= 20 and largest["size"] < 0.001 * torrent["size"]:
        return None, ""
    return largest, FORMAT[extension]


def version_of(*values):
    for value in values:
        found = VERSION.search(value or "")
        if found:
            return found.group(1)
    return ""


def region_of(*values):
    for value in values:
        if re.search(r"\b(?:USA|US)\b", value or "", re.I):
            return "USA"
        if re.search(r"\bEUR(?:OPE)?\b", value or "", re.I):
            return "EUR"
    return ""


# --- Crawl ----------------------------------------------------------------------


def shard_arg(value):
    """`n/total` -> (n - 1, total): the slice of the queue this crawl reads."""
    try:
        index, total = (int(part) for part in value.split("/"))
    except ValueError:
        raise argparse.ArgumentTypeError("expected n/total, as 1/4")
    if not 0 < index <= total:
        raise argparse.ArgumentTypeError("expected n/total with 1 <= n <= total")
    return index - 1, total


def crawl(args):
    cache = args.cache
    os.makedirs(cache, exist_ok=True)
    cards_path = os.path.join(cache, "cards.json")
    cached = read_json(cards_path, {})
    platforms = ["ps4", "ps5"] if args.platform == "both" else [args.platform]
    cards = {platform: cached.get(platform, []) for platform in INDEX}
    for platform in platforms:
        page_path = os.path.join(cache, f"index-{platform}.html")
        page = None if args.refresh or not os.path.exists(page_path) else open(page_path, encoding="utf-8").read()
        if page is None:
            print(f"{platform}: reading {INDEX[platform]}")
            page = decode_page(fetch_text(INDEX[platform]))
            with open(page_path, "w", encoding="utf-8", newline="") as handle:
                handle.write(page)
            time.sleep(PAUSE)
        cards[platform] = parse_cards(page, platform)
        print(f"{platform}: {len(cards[platform])} cards")
    write_json(cards_path, cards)

    torrent_dir = os.path.join(cache, "torrents")
    page_dir = os.path.join(cache, "mediafire")
    os.makedirs(torrent_dir, exist_ok=True)
    os.makedirs(page_dir, exist_ok=True)
    queue = []
    seen = set()
    for platform in platforms:
        chosen = cards[platform][:args.limit] if args.limit else cards[platform]
        for card in chosen:
            if not card["file"] or card["file"] in seen:
                continue
            seen.add(card["file"])
            queue.append(card)
    todo = [card for card in queue if args.refresh or not os.path.exists(os.path.join(torrent_dir, card["file"] + ".json"))]
    # Several crawls can share one cache: each takes its own slice of the queue, and a card already
    # cached by another is not read again.
    index, shards = args.shard
    todo = todo[index::shards]
    print(f"{len(queue)} torrents, {len(todo)} to read" + (f" (shard {index + 1}/{shards})" if shards > 1 else ""))
    for done, card in enumerate(todo, 1):
        file_id = card["file"]
        try:
            page_path = os.path.join(page_dir, file_id + ".html")
            if args.refresh or not os.path.exists(page_path):
                body = fetch_text(iri_to_uri(card["mediafire"]))
                with open(page_path, "w", encoding="utf-8", newline="") as handle:
                    handle.write(body)
                time.sleep(PAUSE)
            body = open(page_path, encoding="utf-8", errors="replace").read()
            direct = re.search(r"https://download[^\"'<>\s]+?\.torrent", html.unescape(body), re.I)
            if not direct:
                raise ValueError("MediaFire named no .torrent")
            torrent_url = direct.group(0)
            torrent_path = os.path.join(torrent_dir, file_id + ".torrent")
            if args.refresh or not os.path.exists(torrent_path):
                data = fetch_bytes(iri_to_uri(torrent_url))
                with open(torrent_path, "wb") as handle:
                    handle.write(data)
                time.sleep(PAUSE)
            parsed = parse_torrent(open(torrent_path, "rb").read())
            parsed.update({"file": file_id, "torrentUrl": torrent_url, "page": card["mediafire"],
                           "magnet": magnet_of(parsed)})
            write_json(os.path.join(torrent_dir, file_id + ".json"), parsed)
        except Exception as error:  # a torrent that keeps failing is tried again on the next run
            print(f"  {file_id}: {error}", file=sys.stderr)
        if done % 100 == 0:
            print(f"  {done}/{len(todo)}")


# --- The catalog ----------------------------------------------------------------

GAME = re.compile(r'^\s*\{ "id": "([^"]+)", "title": "((?:[^"\\]|\\.)*)", "platform": "(\w+)", "providers": \[([^\]]*)\]')
PROVIDERS = re.compile(r'"providers": \[[^\]]*\]')
REGION = re.compile(r'"region": "([^"]+)"')


def unquote_title(value):
    # A few titles carry escapes JSON does not know: they are only compared, so drop them.
    return json.loads('"%s"' % re.sub(r"\\(?![\x22\\/bfnrtu])", "", value))


def catalog_games():
    games = {}
    with open(CATALOG, encoding="utf-8") as handle:
        lines = handle.read().split("\n")
    for index, line in enumerate(lines):
        match = GAME.match(line)
        if not match:
            continue
        providers = [item.strip().strip('"') for item in match.group(4).split(",") if item.strip()]
        region = REGION.search(line)
        games[match.group(1)] = {"title": unquote_title(match.group(2)), "platform": match.group(3),
                                 "providers": providers, "region": region.group(1) if region else "",
                                 "index": index}
    return games, lines


def title_key(title):
    title = html.unescape(title or "")
    title = re.sub(r"[™®©]", "", title)
    title = re.sub(r"\s+(?:PS4|PS5|PKG|PS4 PKG)\s*$", "", title, flags=re.I)
    return re.sub(r"[^a-z0-9]", "", title.lower())


def read_torrents(cache):
    directory = os.path.join(cache, "torrents")
    out = {}
    if not os.path.isdir(directory):
        return out
    for name in sorted(os.listdir(directory)):
        if name.endswith(".json"):
            parsed = read_json(os.path.join(directory, name), None)
            if parsed:
                out[parsed.get("file") or name[:-5]] = parsed
    return out


def match_game(card, games, by_edition, by_title):
    """The catalog game a card is for: its title id first, then its title and edition."""
    if card["id"] in games:
        return card["id"]
    platform = card["platform"]
    key = edition_key(card["title"])
    if not key:
        return None
    open_ids = lambda ids: [title_id for title_id in ids if title_id in games]
    candidates = open_ids(by_title.get((platform, title_key(card["title"])), []))
    if len(candidates) != 1:
        candidates = open_ids(by_edition.get((platform, key), []))
    if len(candidates) > 1:
        # The same game of more than one region: the card's own region decides.
        region = region_of(card["alt"], card["mediafire"])
        named = [title_id for title_id in candidates if region and games[title_id]["region"] == region]
        candidates = named or [title_id for title_id in candidates if TITLE_ID.search(card["mediafire"] + " " + card["alt"]) and
                               TITLE_ID.search(card["mediafire"] + " " + card["alt"]).group(1) == title_id]
    if len(candidates) == 1:
        return candidates[0]
    # No guessing from a shared prefix: "Mighty Morphin Power Rangers" is not Rita's Rewind, and
    # "Assetto Corsa" is not Competizione. A wrong match says the game is this one and hands over
    # another game's payload, which is worse than the game simply having no torrent.
    return None


def mentions_game(card, torrent, name):
    """Whether the torrent is really the card's game.

    A card's MediaFire link sometimes points at another game's .torrent (three cards did when this
    was written). The card's title id in the torrent's name or file settles it; failing that, the
    title does, squeezed the way scene names squeeze it ("AliensDarkDescen").
    """
    haystack = f"{torrent['name']} {name}"
    if card["id"] and card["id"] in haystack:
        return True
    key = title_key(card["title"])
    return bool(key) and key in title_key(haystack)


def record_for(target, card, torrent):
    file, extension = main_file(torrent)
    if not file or not extension:
        return None, "split or unknown format"
    name = os.path.basename(file["path"].replace("\\", "/"))
    # A card's label can say "DLC" for a torrent that is plainly the whole game (one file, the
    # size of it); the payload decides then, not the marketing title.
    single_payload = len(torrent["files"]) == 1
    if SUPPLEMENT.search(name) or SUPPLEMENT.search(torrent["name"]) or (not single_payload and SUPPLEMENT.search(card["alt"])):
        return None, "update, patch or DLC"
    if not mentions_game(card, torrent, name):
        return None, "names another game"
    # The file's own title id: a card of one region can link another region's file. The queue looks
    # for it, so the file's id is the one that counts.
    title_id = (TITLE_ID.search(name) or [None, ""])[1] or card["id"]
    release_id = "r" + hashlib.sha256(("%s|%s" % (target, card["page"])).encode("utf-8")).hexdigest()[:12]
    version = version_of(card["alt"], torrent["name"], name)
    return {
        "id": release_id,
        "format": extension,
        "filename": name,
        "url": torrent["magnet"],
        "sizeBytes": file["size"],
        "version": version,
        "category": "game",
        "provider": SOURCE,
        "source": SOURCE,
        "flow": "torrent",
        "label": "Torrent",
        "platform": card["platform"],
        "torrentUrl": torrent["torrentUrl"],
        "torrentPage": card["mediafire"],
        "magnet": torrent["magnet"],
        "trackers": torrent["trackers"],
        "record": "%s-%s-torrent" % (SOURCE, target),
        # Set when it differs from the game's own: the queue then looks for this file's id.
        **({"titleId": title_id} if title_id and title_id != target else {}),
    }, None


def read_releases():
    out = {}
    for name in sorted(os.listdir(RELEASES)):
        if name.endswith(".json"):
            with open(os.path.join(RELEASES, name), encoding="utf-8") as handle:
                out[name[:-5]] = json.load(handle)
    return out


def build_plan(args):
    games, lines = catalog_games()
    by_edition, by_title = {}, {}
    for title_id, game in games.items():
        by_edition.setdefault((game["platform"], edition_key(game["title"])), []).append(title_id)
        by_title.setdefault((game["platform"], title_key(game["title"])), []).append(title_id)
    cards = read_json(os.path.join(args.cache, "cards.json"), {})
    torrents = read_torrents(args.cache)
    releases = read_releases()
    records, unmatched, skipped = {}, [], {"no torrent file": 0, "update, patch or DLC": 0,
                                           "split or unknown format": 0, "names another game": 0,
                                           "duplicate": 0}
    seen = set()
    cards_read = 0
    for platform in ("ps4", "ps5"):
        for card in cards.get(platform, []):
            torrent = torrents.get(card["file"])
            if not torrent:
                skipped["no torrent file"] += 1
                continue
            cards_read += 1
            target = match_game(card, games, by_edition, by_title)
            if not target:
                unmatched.append(f"{card['title']} {card['id'] or card['file']}")
                continue
            record, reason = record_for(target, card, torrent)
            if not record:
                skipped[reason] += 1
                continue
            if record["magnet"] in seen:
                skipped["duplicate"] += 1
                continue
            seen.add(record["magnet"])
            records.setdefault(target, []).append(record)
    # The games that carried ps4ar records before but no longer gain one lose theirs too.
    targets = set(records) | {title_id for title_id, rows in releases.items()
                              if any(row.get("source") == SOURCE for row in rows)}
    return {"games": games, "lines": lines, "releases": releases, "records": records,
            "targets": targets, "unmatched": unmatched, "skipped": skipped, "cards": cards_read}


def apply_plan(plan):
    changed = []
    for title_id in sorted(plan["targets"]):
        kept = [row for row in plan["releases"].get(title_id, []) if row.get("source") != SOURCE]
        rows = kept + plan["records"].get(title_id, [])
        body = json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        path = os.path.join(RELEASES, title_id + ".json")
        old = open(path, encoding="utf-8").read() if os.path.exists(path) else None
        if old != body:
            with open(path, "w", encoding="utf-8", newline="") as handle:
                handle.write(body)
            changed.append(title_id)
    lines = list(plan["lines"])
    for title_id in plan["targets"]:
        game = plan["games"].get(title_id)
        if not game:
            continue
        wanted = bool(plan["records"].get(title_id))
        providers = [item for item in game["providers"] if item != SOURCE]
        if wanted:
            providers.append(SOURCE)
        providers = sorted(set(providers))
        new = '"providers": [%s]' % ", ".join(json.dumps(item) for item in providers)
        lines[game["index"]] = PROVIDERS.sub(lambda _: new, lines[game["index"]], count=1)
    body = "\n".join(lines)
    with open(CATALOG, encoding="utf-8", newline="") as handle:
        old = handle.read()
    if old != body:
        with open(CATALOG, "w", encoding="utf-8", newline="") as handle:
            handle.write(body)
    return changed


def run_import(args):
    plan = build_plan(args)
    games = sum(1 for rows in plan["records"].values() if rows)
    records = sum(len(rows) for rows in plan["records"].values())
    removed = sum(1 for title_id in plan["targets"] if not plan["records"].get(title_id)
                  and any(row.get("source") == SOURCE for row in plan["releases"].get(title_id, [])))
    print(f"{plan['cards']} torrents read, {records} releases on {games} games"
          + (f", {removed} games no longer have one" if removed else ""))
    for reason, count in plan["skipped"].items():
        if count:
            print(f"  {count} {reason}")
    if plan["unmatched"]:
        print(f"  {len(plan['unmatched'])} cards match no catalog game")
        for title in plan["unmatched"][:12]:
            print(f"    {title}")
    if args.report:
        write_json(args.report, {key: (sorted(value) if isinstance(value, set) else value) for key, value in plan.items()
                                 if key in {"records", "unmatched", "skipped", "cards"}})
    if args.write:
        changed = apply_plan(plan)
        print(f"wrote {len(changed)} release files and the catalog")
    else:
        print("nothing written: add --write to apply")


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    default_cache = os.path.join(os.path.dirname(ROOT), ".ps4ar-cache")
    c = sub.add_parser("crawl")
    c.add_argument("--cache", default=default_cache)
    c.add_argument("--platform", choices=("ps4", "ps5", "both"), default="both")
    c.add_argument("--limit", type=int, default=0, help="read at most this many cards of each platform")
    c.add_argument("--shard", type=shard_arg, default=(0, 1),
                   help="read only the nth part of the queue, as 1/4; several crawls share one cache")
    c.add_argument("--refresh", action="store_true", help="read the pages and the torrents again")
    i = sub.add_parser("import")
    i.add_argument("--cache", default=default_cache)
    i.add_argument("--write", action="store_true")
    i.add_argument("--report")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    crawl(args) if args.command == "crawl" else run_import(args)


if __name__ == "__main__":
    main()
