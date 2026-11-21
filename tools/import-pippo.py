#!/usr/bin/env python3
"""Import the Pippo Library sources into Overdrive's catalog.

Pippo Library (https://pippo26442999.github.io/.exFAT/) publishes its whole
library as one JSON file, exFAT.json, whose download links are wrapped in
"Link Lock": a page URL carrying an AES-GCM-256 payload in its fragment, keyed by
PBKDF2-SHA256 with a fixed password. This tool decrypts those links, keeps the
ones this catalog does not already have, and writes them as release records
tagged source "pippo", plus a minimal catalog entry for any game the catalog is
missing altogether.

Usage, from the repository root:

    curl -fsSL -o /tmp/pippo/exFAT.json \\
      https://raw.githubusercontent.com/Pippo26442999/.exFAT/main/exFAT.json
    python -P tools/import-pippo.py --pippo /tmp/pippo/exFAT.json --check
    python -P tools/import-pippo.py --pippo /tmp/pippo/exFAT.json --dry-run
    python -P tools/import-pippo.py --pippo /tmp/pippo/exFAT.json --report /tmp/pippo/report.json
    python -P tools/import-pippo.py --pippo /tmp/pippo/exFAT.json --covers
    python -P tools/import-pippo.py --pippo /tmp/pippo/exFAT.json --shots

--shots gives the games this import added the screenshots their page needs, taken
from the Steam storefront, and from the PlayStation Store for the five titles that
are PlayStation classics and have no Steam page. It writes app/data/pages/<id>.json
only where that file has no screenshots yet, so it leaves a curated page alone.

It needs the "cryptography" package, and Pillow only for --covers. Use -P, not -I:
the script directory must stay off sys.path (it reads an untrusted file) while
cryptography keeps coming from the user's site-packages.

What it writes, and what it never touches
------------------------------------------
Each run replaces every record it wrote before: records whose source is "pippo"
are dropped and rebuilt from the input file, in every release file that has them,
so a game dropped upstream loses its records here too. Records from the other
sources (pegasus-*, orbit, blackbox, archive-discovery) keep their bytes and their
order, so re-running the tool with an unchanged input leaves the working tree
clean.

The catalog lines this tool adds carry "source": "pippo" as well, and are only
replaced when they are still exactly the line this tool generates; a line edited
by hand is kept and its game is left alone.

The counts of the 2026-10-15 import are recorded in EXPECTED below. --check compares
against them, and a write run refuses to touch anything until a moved count is
reviewed (--ignore-expect once it has been). Running it again right after an import
is expected to be quiet: every count but the one that the import itself clears stays
where it was.
"""

import argparse
import base64
import collections
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

try:
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
except ImportError:  # pragma: no cover - the message is the point
    sys.exit("import-pippo needs the cryptography package: python -m pip install cryptography")


# --- Link Lock --------------------------------------------------------------

PASSWORD = b"pippo"
SCHEMES = {
    # The scheme is named by the path of the page that wraps the payload.
    "library-decrypt": {"iterations": 600000, "salt": bytes(16), "iv": bytes(12)},
    "link-lock-pippo": {
        "iterations": 100000,
        "salt": bytes([236, 231, 167, 249, 207, 95, 201, 235, 164, 98, 246, 26, 176, 174, 72, 249]),
        "iv": bytes([255, 237, 148, 105, 6, 255, 123, 202, 115, 130, 16, 116]),
    },
}
MAX_LAYERS = 8
_keys = {}


def unb64(text):
    text = text.strip()
    return base64.b64decode(text + "=" * (-len(text) % 4))


def key_for(salt, iterations):
    key = _keys.get((salt, iterations))
    if key is None:
        key = PBKDF2HMAC(algorithm=hashes.SHA256(), length=32, salt=salt, iterations=iterations).derive(PASSWORD)
        _keys[(salt, iterations)] = key
    return key


def scheme_of(url):
    for name in SCHEMES:
        if name in url:
            return name
    return None


def unlock(url):
    """One layer: the wrapped URL, which may itself be wrapped again."""
    name = scheme_of(url)
    payload = json.loads(unb64(url.split("#", 1)[1]))
    defaults = SCHEMES[name]
    salt = unb64(payload["s"]) if payload.get("s") else defaults["salt"]
    iv = unb64(payload["i"]) if payload.get("i") else defaults["iv"]
    secret = unb64(payload["e"])
    # The iteration count is the one thing the payload does not carry, so try
    # this scheme's first and the other one second: a re-keyed page then shows up
    # as a count in the report instead of importing nothing at all.
    counts = [defaults["iterations"]]
    counts += [spec["iterations"] for spec in SCHEMES.values() if spec["iterations"] not in counts]
    for count in counts:
        try:
            plain = AESGCM(key_for(salt, count)).decrypt(iv, secret, None)
            break
        except Exception as error:  # noqa: BLE001 - re-raised below as the last failure
            last = error
    else:
        raise last
    text = plain.decode("utf-8")
    try:
        value = json.loads(text)
    except ValueError:
        return text, name, count
    if isinstance(value, dict):
        return value.get("u") or value.get("url") or text, name, count
    return text, name, count


def decrypt(url):
    """Every layer of Link Lock between the stored link and the real one."""
    layers = []
    for _ in range(MAX_LAYERS):
        name = scheme_of(url)
        if not name:
            return url, layers
        url, name, count = unlock(url)
        layers.append("%s@%d" % (name, count))
    raise ValueError("more than %d layers of Link Lock" % MAX_LAYERS)


# --- Pippo's fields, hosts and tags -----------------------------------------

MIRRORS = ("akia", "viki", "data", "filek", "vault", "filed", "buzz")
# What each field group holds, and how it reads in a label.
GROUPS = {
    "files": "Base",
    "standard": "Standard",
    "backport": "BackPort",
    "backport4xx": "BackPort",
    "backport7xx": "BackPort",
    "fpkg": "Fpkg",
    "fpkg_standard": "Fpkg Standard",
    "fpkg_backport": "Fpkg BackPort",
    "dump": "Dump",
    "dlc": "DLC",
    "fix": "Fix",
}
BACKPORT_GROUPS = ("backport", "backport4xx", "backport7xx", "fpkg_backport")
# The order a game's records are listed in, and the order duplicates are dropped.
GROUP_ORDER = ("files", "standard", "fpkg", "fpkg_standard", "backport", "backport4xx",
               "backport7xx", "fpkg_backport", "dump", "dlc", "fix")
MIRROR_ORDER = ("akia", "viki", "data", "filek", "vault", "buzz", "filed")
# provider, flow, label suffix, catalog "providers" key. The label suffix has to
# start with the provider's first four letters: app/game/sources.js edition()
# strips it back off to leave the edition text.
HOSTS = {
    "akirabox.com": ("AkiraBox", "akirabox", "AkiraBox", "akirabox"),
    "akirabox.to": ("AkiraBox", "akirabox", "AkiraBox", "akirabox"),
    "vikingfile.com": ("VikingFile", "vikingfile", "VikingFile", "vikingfile"),
    "datanodes.to": ("DataNodes", "datanodes", "DataNodes", "datanodes"),
    "datanodes.co": ("DataNodes", "datanodes", "DataNodes", "datanodes"),
    "filekeeper.net": ("filekeeper.net", "browser", "FileKeeper", "filekeeper"),
    "datavaults.co": ("datavaults.co", "browser", "DataVaults", "datavaults"),
    "fileditchfiles.st": ("fileditchfiles.st", "browser", "FileDitch", "fileditchfiles"),
    "theditch.st": ("theditch.st", "browser", "TheDitch", "theditch"),
    "buzzheavier.com": ("Buzzheavier", "buzzheavier", "Buzzheavier", "buzzheavier"),
    "link-vault.org": ("link-vault.org", "browser", "LinkVault", "link-vault.org"),
}
# A link-vault.org link is a page listing several mirrors and its #fragment picks
# one, so the mirror, not the host, names the source (the catalog's own
# link-vault.org records read "Dump - DataNodes" for exactly that reason).
LINKVAULT = "link-vault.org"
# Only Pippo's VikingFile links are imported, directly or behind a vault: VikingFile is the one
# mirror the console's capture names exactly (2026-10-16, the user's call). The rest - AkiraBox,
# DataNodes, FileKeeper, FileDitch, DataVaults - could not be told to work, so they are left out.
KEPT_MIRRORS = ("VikingFile",)
# Links Pippo still lists whose file the host has deleted, checked by hand and taken out of
# the catalog (2026-10-17): an import must not bring them back.
DEAD_LINKS = frozenset((
    "https://vikingfile.com/f/HNrZCSKbfz",
    "https://vikingfile.com/f/jSw8RclFYf",
    "https://vikingfile.com/f/GsQZLkn32m",
    "https://vik1ngfile.site/f/SDlchIQVC5",
    "https://datanodes.to/rsz11moa0qci",
    "https://datanodes.to/t0z00hv27z8j",
    "https://filekeeper.net/xnni4n40qc2x",
))
INNER_MIRRORS = {
    "AkiraBox": "AkiraBox",
    "DataNodes": "DataNodes",
    "VikingFile": "VikingFile",
    "VikikngFile": "VikingFile",  # Pippo's own typo, one link
    "FileKeeper": "FileKeeper",
    "FileDitch": "FileDitch",
    "DataVaults": "DataVaults",
    "FuckingFast": "FuckingFast",
}
REGIONS = ("EUR", "USA", "JPN", "ASIA", "KOR", "CHN", "WORLD")
TITLE_ID = re.compile(r"^[A-Z]{4}\d{5}$")
VERSION_TAG = re.compile(r"^v?\d+(?:\.\d+)*$")
FW_TAG = re.compile(r"(\d{1,2})\.xx", re.I)
BACK_TAG = re.compile(r"(\d{1,2})\.xx[^0-9]{0,12}back\s*por[kt]", re.I)
STANDARD_TAG = re.compile(r"standard\s*\(\s*(\d{1,2})\.xx\s*\)", re.I)
# Nothing this tool writes may name an archive part: app/state/release-sets.js
# would fold such releases into a multi-part set.
PART_IN_LABEL = re.compile(r"\bpart\s*\d+\b", re.I)
# app/state/download-sources.js webURL() rejects these.
BAD_URL = re.compile(r"[\s\\\x00-\x1f]")
MAX_URL = 8192

SOURCE = "pippo"
RAW_BASE = "https://raw.githubusercontent.com/MyLuxy/overdrive/main"
COVERS_DIRNAME = "covers"

# The counts of the 2026-10-15 input, which --check compares against. "fields"
# counts the link fields of games that name a title id (one game in the input
# names none, and is skipped); "new" counts the records this tool writes: 1427 of
# every mirror on 2026-10-15, 132 since only VikingFile is kept (2026-10-16).
EXPECTED = {"fields": 4705, "undecryptable": 1, "present": 3276, "duplicate": 1, "new": 132, "absent_games": 26}
# absent_games is reported but not compared: the import itself takes it to 0, which
# says nothing about the input file. Every other count comes from the input and the
# other sources alone, so the import leaves them where they were.
STRICT = ("fields", "undecryptable", "present", "duplicate", "new")


def title_id_of(game):
    for tag in game.get("tags") or []:
        if TITLE_ID.match(str(tag)):
            return str(tag)
    return None


def link_fields(game):
    """(field, group, mirror, wrapped value) for every download link of a game.

    A bare "<mirror>_url" is the plainest build of the game, the group "files".
    """
    for field, value in game.items():
        if not isinstance(value, str):
            continue
        if field.endswith("_url"):
            mirror, group = field[:-4], "files"
        else:
            group, _, mirror = field.rpartition("_")
        if mirror in MIRRORS and group in GROUPS:
            yield field, group, mirror, value


def region_of(tags):
    for tag in tags:
        word = re.split(r"[^A-Za-z]", str(tag).strip(), 1)[0].upper()
        if word in REGIONS:
            return word
    return None


def version_of(tags):
    for tag in tags:
        text = str(tag)
        if VERSION_TAG.match(text):
            return text[1:] if text[:1] in "vV" else text
    return None


def firmware_of(group, tags):
    """The firmware to name in the label, or None when no tag names one.

    A backport runs from the lowest firmware it names, anything else needs the
    highest, so a backport label carries the number next to "BackPort" and a
    plain one the number next to "Standard" (or the bare "N.xx and beyond").
    """
    pinned = re.search(r"(\d{1,2})xx", group)
    if pinned:
        return pinned.group(1) + ".xx"
    backport = group in BACKPORT_GROUPS
    for tag in tags:
        text = str(tag)
        if not FW_TAG.search(text):
            continue
        match = BACK_TAG.search(text) if backport else STANDARD_TAG.search(text)
        match = match or FW_TAG.search(text)
        return match.group(1) + ".xx"
    return None


def firmware_pair(group, tags):
    """A backport's two firmwares, the plain build it comes from and the one it runs on.

    A tag like "Standard (9.xx) + 4.xx BackPort" names both, in that order; the group
    name wins when it pins one ("backport4xx" is the 4.xx build). requiredFirmware()
    takes the lowest number a backport label names, so both belong in the label.
    """
    pinned = re.search(r"(\d{1,2})xx", group)
    if pinned:
        return None, pinned.group(1) + ".xx"
    for tag in tags:
        text = str(tag)
        if not (FW_TAG.search(text) and BACK_TAG.search(text)):
            continue
        numbers = []
        for match in re.finditer(r"\b(\d{1,2})\.xx\b", text, re.I):
            if match.group(1) not in numbers:
                numbers.append(match.group(1))
        if len(numbers) >= 2:
            return numbers[0] + ".xx", numbers[-1] + ".xx"
        if numbers:
            return None, numbers[0] + ".xx"
    return None, None


def label_for(group, tags, provider, owner, strict=True):
    """A label in the shape the catalog already uses, e.g. "EUR 5.xx BackPort 4.xx - Mediafire"."""
    region = region_of(tags)
    kind = GROUPS[group]
    if group in BACKPORT_GROUPS:
        before, after = firmware_pair(group, tags)
        head = [region, before, kind, after] if before and after else [region, after, kind]
    else:
        head = [region, firmware_of(group, tags), kind]
    text = " ".join(part for part in head if part)
    assert not PART_IN_LABEL.search(text), text
    if strict:
        prefix = provider.lower().removeprefix("www.")[:4]
        assert owner.lower().startswith(prefix), (text, owner, provider)
    return "%s - %s" % (text, owner)


def facet_key(provider):
    """The short key the catalog's provider facet uses for a release provider."""
    for spec in HOSTS.values():
        if spec[0].lower() == provider.lower():
            return spec[3]
    return provider.lower().removeprefix("www.")


# The bucket behind Pippo's covers answers 403 to a bare urllib User-Agent.
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# The app downloads these by itself, with no browser check: the same test
# app/state/download-sources.js applies to a link, as far as the catalog needs it.
DIRECT_URL = re.compile(r"\.(?:ffpfsc|ffpfs|ffpkg|exfat|pkg|zip|rar|7z)(?:[?#]|$)", re.I)


def is_direct(url):
    host, _ = host_of(url)
    if host == "archive.org":
        return "/download/" in url
    if host in ("github.com", "raw.githubusercontent.com"):
        return "/releases/download/" in url
    return bool(DIRECT_URL.search(url))


def host_of(url):
    match = re.match(r"(https?)://([^/?#]+)", url, re.I)
    return (match.group(2).lower(), match.group(1).lower()) if match else (None, None)


def valid_url(url):
    if not isinstance(url, str) or not url or len(url) > MAX_URL or BAD_URL.search(url):
        return False
    host, scheme = host_of(url)
    return bool(host) and scheme in ("http", "https") and not host.startswith(".")


def record_for(candidate, version):
    title_id, url, group = candidate["title"], candidate["url"], candidate["group"]
    release_id = "r" + hashlib.sha256(("%s|%s" % (title_id, url)).encode("utf-8")).hexdigest()[:12]
    return {
        "id": release_id,
        "format": "binary",
        "filename": "%s-game-%s-%s.binary" % (title_id, version or "unknown", release_id),
        "url": url,
        "browserUrl": url,
        "requiresBrowser": True,
        "sizeBytes": None,
        "version": version,
        "category": "game",
        "provider": candidate["provider"],
        "source": SOURCE,
        "flow": candidate["flow"],
        "label": candidate["label"],
        "record": "%s-%s-%s" % (SOURCE, title_id, group),
    }


# --- Reading and writing the catalog ----------------------------------------


def read_text(path):
    with open(path, "rb") as handle:
        return handle.read().decode("utf-8")


def write_text(path, text):
    with open(path, "wb") as handle:
        handle.write(text.encode("utf-8"))


def read_lines(path):
    return read_text(path).split("\n")


BLOCK_START = r"^\s*var %s = \[$"
BLOCK_END = re.compile(r"^\s*\];$")
GAME_LINE = re.compile(r'^\s*\{ "id": "([^"]+)"')
PROVIDERS = re.compile(r'"providers": \[[^\]]*\]')
# The key order new_page writes, for recognising a line this tool wrote earlier.
PAGE_KEYS = ("id", "title", "platform", "providers", "direct", "developer", "publisher",
             "releaseDate", "genres", "features", "recommendations", "sizeGb", "art", "region", "source")


def written_by_us(line):
    """Whether a catalog line still has exactly the shape new_page gives it."""
    keys = re.findall(r'"([A-Za-z]+)":', line)
    shape = [key for key in PAGE_KEYS if key in keys]
    return keys == shape and keys[-1:] == ["source"] and line.rstrip().endswith('"source": "pippo" },')


def block_bounds(lines, name):
    start = next(i for i, line in enumerate(lines) if re.match(BLOCK_START % name, line))
    end = next(i for i in range(start + 1, len(lines)) if BLOCK_END.match(lines[i]))
    return start, end


def catalog_entries(lines):
    """Every entry of the catalog by id: which block it is in, which line, which provider keys.

    The catalog has two blocks: "games" is the library the app lists, "twins" holds
    the other edition of a work (app/state/catalog.js:51,64). An id can be in either.
    """
    entries = {}
    for block in ("games", "twins"):
        start, end = block_bounds(lines, block)
        for index in range(start + 1, end):
            match = GAME_LINE.match(lines[index])
            if not match:
                continue
            found = PROVIDERS.search(lines[index])
            entries[match.group(1)] = {
                "block": block, "index": index, "line": lines[index],
                "keys": json.loads(found.group(0).split(":", 1)[1]) if found else [],
            }
    return entries


def read_releases(directory):
    out = {}
    for name in sorted(os.listdir(directory)):
        if name.endswith(".json"):
            out[name[:-5]] = json.loads(read_text(os.path.join(directory, name)))
    return out


def write_releases(directory, title_id, records):
    """Rewrite one release file, keeping every byte of the records it already had."""
    path = os.path.join(directory, title_id + ".json")
    body = json.dumps(records, ensure_ascii=False, separators=(",", ":"))
    if os.path.exists(path) and read_text(path) == body:
        return False
    write_text(path, body)
    return True


def render(value):
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=True)
    if isinstance(value, bool):
        return "true" if value else "false"
    if value is None:
        return "null"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (int, float)):
        return json.dumps(value)
    if isinstance(value, list):
        return "[" + ", ".join(render(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{ " + ", ".join("%s: %s" % (json.dumps(key), render(item)) for key, item in value.items()) + " }"
    raise TypeError(value)


def render_game(page):
    return "    { " + ", ".join("%s: %s" % (json.dumps(key), render(value)) for key, value in page.items()) + " },"


def existing_sources(directory):
    """Every URL the other sources publish, and the same set without its fragments."""
    everything, bare = set(), set()
    for records in read_releases(directory).values():
        for release in records:
            if release.get("source") == SOURCE:
                continue
            for field in ("url", "browserUrl"):
                if isinstance(release.get(field), str):
                    everything.add(release[field])
                    bare.add(release[field].split("#", 1)[0])
    return everything, bare


# --- Working out what to write ----------------------------------------------


def build_plan(args):
    data = args.data
    catalog_path = os.path.join(data, "catalog.js")
    releases_dir = os.path.join(data, "releases")
    with open(args.pippo, "rb") as handle:
        raw = handle.read()
    games = json.loads(raw.decode("utf-8"))
    if not isinstance(games, list):
        sys.exit("the input is not the Pippo game list")

    known, known_bare = existing_sources(releases_dir)
    all_releases = read_releases(releases_dir)
    lines = read_lines(catalog_path)
    entries = catalog_entries(lines)

    info = {
        "input": {"path": os.path.abspath(args.pippo), "bytes": len(raw), "games": len(games),
                  "sha256": hashlib.sha256(raw).hexdigest()},
        "fields": 0, "decrypted": 0, "present": 0, "near_fragment": 0, "duplicate": 0,
        "undecryptable": [], "unknown_hosts": collections.Counter(), "warnings": [],
        "layers": collections.Counter(), "groups": collections.Counter(), "hosts": collections.Counter(),
        "owners": collections.Counter(), "keys": collections.Counter(), "titles": 0, "editions": 0,
        "left_out": collections.Counter(),
        "no_title_id": [],
    }
    by_title = collections.defaultdict(list)
    versions = {}
    for game in games:
        title_id = title_id_of(game)
        if not title_id:
            info["no_title_id"].append(str(game.get("title")))
            continue
        tags = game.get("tags") or []
        versions[title_id] = version_of(tags)
        seen = set()
        for field, group, mirror, wrapped in link_fields(game):
            info["fields"] += 1
            try:
                url, layers = decrypt(wrapped)
            except Exception as error:  # noqa: BLE001 - reported, never fatal
                info["undecryptable"].append({"title": title_id, "field": field, "error": str(error)[:90]})
                continue
            info["decrypted"] += 1
            info["layers"].update(layers)
            if not valid_url(url):
                info["warnings"].append("unusable URL in %s.%s: %r" % (title_id, field, url[:60]))
                continue
            host, _ = host_of(url)
            spec = HOSTS.get(host)
            if spec is None:
                info["unknown_hosts"][host] += 1
                info["warnings"].append("unknown host %r in %s.%s" % (host, title_id, field))
                continue
            if url in DEAD_LINKS:
                info["left_out"]["dead"] += 1
                continue
            if url in known:
                info["present"] += 1
                continue
            if url.split("#", 1)[0] in known_bare:
                # The same page as a record the catalog already has, another mirror.
                info["near_fragment"] += 1
            if (title_id, url) in seen:
                info["duplicate"] += 1
                continue
            seen.add((title_id, url))
            provider, flow, default_owner, key = spec
            fragment = url.split("#", 1)[1] if "#" in url else ""
            inner = INNER_MIRRORS.get(fragment) if host == LINKVAULT else None
            if (inner or default_owner) not in KEPT_MIRRORS:
                info["left_out"][inner or default_owner] += 1
                continue
            info["groups"][group] += 1
            info["hosts"][host] += 1
            info["owners"][inner or default_owner] += 1
            info["keys"][key] += 1
            by_title[title_id].append({
                "title": title_id, "group": group, "mirror": mirror, "url": url,
                "provider": provider, "flow": flow, "key": key,
                "label": label_for(group, tags, provider, inner or default_owner, inner is None),
            })

    records = {}
    for title_id, candidates in by_title.items():
        candidates.sort(key=lambda c: (GROUP_ORDER.index(c["group"]), MIRROR_ORDER.index(c["mirror"])))
        rows = [record_for(candidate, versions[title_id]) for candidate in candidates]
        rows.sort(key=lambda row: (row["record"], row["provider"], row["id"]))
        records[title_id] = rows
    info["titles"] = len(records)
    info["new"] = sum(len(rows) for rows in records.values())
    info["editions"] = sum(1 for title_id in records if entries.get(title_id, {}).get("block") == "twins")

    absent = sorted(set(records) - set(entries))
    provider_additions = collections.OrderedDict()
    for title_id in sorted(set(records) & set(entries)):
        merged = sorted(set(entries[title_id]["keys"]) | {c["key"] for c in by_title[title_id]})
        if merged != entries[title_id]["keys"]:
            provider_additions[title_id] = merged
    pages = {}
    for title_id in absent:
        existing = all_releases.get(title_id, [])
        keys = {facet_key(release["provider"]) for release in existing}
        keys |= {candidate["key"] for candidate in by_title[title_id]}
        urls = [release.get("url") for release in existing] + [row["url"] for row in records[title_id]]
        pages[title_id] = new_page(title_id, next(g for g in games if title_id_of(g) == title_id), keys, urls)
    return {
        "info": info, "games": games, "records": records, "absent": absent, "entries": entries,
        "provider_additions": provider_additions, "pages": pages, "releases": all_releases,
        "releases_dir": releases_dir, "catalog_path": catalog_path,
    }


def new_page(title_id, game, keys, urls):
    """A catalog entry with only what the app needs to show the game and its sources."""
    page = collections.OrderedDict()
    page["id"] = title_id
    page["title"] = game["title"]
    page["platform"] = "ps5"
    page["providers"] = sorted(keys)
    page["direct"] = any(is_direct(url) for url in urls if isinstance(url, str))
    page["developer"] = ""
    page["publisher"] = ""
    page["releaseDate"] = ""
    page["genres"] = []
    page["features"] = []
    page["recommendations"] = 0
    size = re.match(r"\s*([0-9.]+)\s*GB", str(game.get("size") or ""), re.I)
    if size:
        page["sizeGb"] = float(size.group(1))
    page["art"] = collections.OrderedDict([("cover", "%s/%s/%s.jpg" % (RAW_BASE, COVERS_DIRNAME, title_id))])
    region = region_of(game.get("tags") or [])
    if region:
        page["region"] = region
    page["source"] = SOURCE
    return page


def apply_plan(plan):
    """Write the release files and the catalog lines. Returns what changed."""
    changed, emptied = [], []
    titles = set(plan["records"])
    titles |= {title for title, records in plan["releases"].items()
               if any(record.get("source") == SOURCE for record in records)}
    for title_id in sorted(titles):
        kept = [record for record in plan["releases"].get(title_id, []) if record.get("source") != SOURCE]
        rows = kept + plan["records"].get(title_id, [])
        path = os.path.join(plan["releases_dir"], title_id + ".json")
        if not rows:
            if os.path.exists(path):
                os.remove(path)
                emptied.append(title_id)
            continue
        if write_releases(plan["releases_dir"], title_id, rows):
            changed.append(title_id)

    lines = read_lines(plan["catalog_path"])
    for title_id, merged in plan["provider_additions"].items():
        index = plan["entries"][title_id]["index"]
        assert PROVIDERS.search(lines[index]), title_id
        lines[index] = PROVIDERS.sub('"providers": %s' % render(merged), lines[index], count=1)
    # A game Pippo dropped keeps no entry of ours behind: a line this tool wrote is
    # dropped with it, while a line somebody edited by hand is kept.
    stale = sorted((entry["index"] for title_id, entry in plan["entries"].items()
                    if title_id not in plan["records"] and written_by_us(entry["line"])), reverse=True)
    for index in stale:
        del lines[index]
    _, end = block_bounds(lines, "games")
    inserted = [render_game(plan["pages"][title]) for title in plan["absent"]]
    if inserted:
        # The last entry before "];" may have no trailing comma.
        if re.match(r"^\s*\{ ", lines[end - 1]) and not lines[end - 1].rstrip().endswith(","):
            lines[end - 1] = lines[end - 1].rstrip() + ","
        lines[end:end] = inserted
    if inserted or plan["provider_additions"] or stale:
        write_text(plan["catalog_path"], "\n".join(lines))
    return changed, inserted, emptied


# --- Covers -----------------------------------------------------------------


def covered_games(plan):
    """The games whose catalog line points at covers/, so --covers can run on its own.

    After an import the plan has no absent games left to cover, but the lines that
    were written still say which covers belong in the repository.
    """
    ids = []
    for line in read_lines(plan["catalog_path"]):
        if '"source": "pippo"' not in line or "/%s/" % COVERS_DIRNAME not in line:
            continue
        match = re.search(r'"id": "([^"]+)"', line)
        if match:
            ids.append(match.group(1))
    return ids


def fetch_covers(plan, covers_dir):
    """Store one JPEG per game the catalog lists with a cover in the repository.

    The console's image loader decodes JPEG and PNG only while Pippo's covers are
    AVIF and WebP, so they are re-encoded here and committed under covers/.
    """
    try:
        from PIL import Image
    except ImportError:
        sys.exit("--covers needs Pillow: python -m pip install pillow")
    import io

    images = {}
    for game in plan["games"]:
        title_id = title_id_of(game)
        if title_id and game.get("image"):
            images[title_id] = game["image"]
    os.makedirs(covers_dir, exist_ok=True)
    written, failed = [], []
    for title_id in covered_games(plan):
        source = images.get(title_id)
        if not source:
            failed.append((title_id, "", "no image for this game in the input"))
            continue
        destination = os.path.join(covers_dir, title_id + ".jpg")
        try:
            # The bucket answers 403 to a bare urllib User-Agent, as it does to curl
            # only when asked for one; the cover itself needs no cookie.
            request = urllib.request.Request(source, headers={"User-Agent": BROWSER_UA})
            with urllib.request.urlopen(request, timeout=60) as response:
                image = Image.open(io.BytesIO(response.read()))
            image = image.convert("RGB")
            if max(image.size) > 1200:
                image.thumbnail((1200, 1200))
            buffer = io.BytesIO()
            # No metadata and no optimize: the same input gives the same bytes, so
            # an unchanged cover leaves the file alone.
            image.save(buffer, "JPEG", quality=85, optimize=False)
            body = buffer.getvalue()
            if os.path.exists(destination) and open(destination, "rb").read() == body:
                continue
            with open(destination, "wb") as handle:
                handle.write(body)
            written.append((title_id, "%s %dx%d %dKB" % (source.rsplit(".", 1)[-1], image.size[0], image.size[1], len(body) // 1024)))
        except Exception as error:  # noqa: BLE001 - one bad cover must not stop the import
            failed.append((title_id, source, str(error)[:90]))
    return written, failed


# --- Screenshots ------------------------------------------------------------

PAGES_DIRNAME = "pages"
SHOT_LIMIT = 3
SHOT_WIDE = "?w=1920&thumb=false"
SHOT_THUMB = "?w=256&thumb=false"
STEAM_APP = "https://store.steampowered.com/api/appdetails?appids=%s&l=english"
STORE = "https://store.playstation.com/store/api/chihiro/00_09_000/container/%s/%s/19/%s"
PSN_CDN = "https://vulcan.dl.playstation.net/"
PSN_IMAGE = "https://image.api.playstation.com/vulcan/"

# Every game this import added, and where its screenshots come from. Steam covers
# most of them; the five PlayStation classics have no Steam page, so they come
# from the PlayStation Store. The token is the part of the store's own name that
# has to match, so a wrong appid is caught instead of pasted into the catalog.
SHOTS = {
    "PPSA02873": ("steam", 978300, "saintsrowthethird"),        # Saints Row: The Third Remastered
    "PPSA03706": ("steam", 1635590, "myfriendpeppapig"),        # My Friend Peppa Pig
    "PPSA04867": ("steam", 1663640, "thelastoricru"),           # The Last Oricru
    "PPSA05110": ("steam", 1687950, "persona5royal"),           # Persona 5 Royal
    "PPSA16342": ("steam", 2358260, "cricket24"),               # Cricket 24
    "PPSA17456": ("steam", 1669480, "firefightingsimulator"),   # Firefighting Simulator: Ignite
    "PPSA18054": ("steam", 3701350, "starwarszerocompany"),     # Star Wars Zero Company
    "PPSA18471": ("steam", 2316580, "talesofkenzera"),          # Tales of Kenzera: ZAU
    "PPSA19733": ("steam", 1902960, "lostrecords"),             # Lost Records: Bloom & Rage
    "PPSA20946": ("steam", 2827820, "therelic"),                # The Relic: First Guardian
    "PPSA24040": ("steam", 3036720, "mastercollectionvol2"),    # MGS Master Collection Vol.2 bonus
    "PPSA25427": ("steam", 2928600, "hinokamichronicles2"),     # Demon Slayer: Hinokami Chronicles 2
    "PPSA26012": ("steam", 427410, "abioticfactor"),            # Abiotic Factor
    "PPSA26223": ("steam", 2569760, "themound"),                # The Mound: Omen of Cthulhu
    "PPSA27623": ("steam", 361420, "astroneer"),                # ASTRONEER
    "PPSA30839": ("steam", 3634190, "mxgp26"),                  # MXGP 26
    "PPSA34502": ("steam", 202970, "blackopsii"),               # Call of Duty: Black Ops II
    "PPSA34547": ("steam", 3669870, "controlresonant"),         # CONTROL Resonant
    "PPSA35154": ("steam", 521890, "helloneighbor"),            # Hello Neighbor
    "PPSA35889": ("steam", 4356430, "nba2k27"),                 # NBA 2K27
    "PPSA36257": ("steam", 1933000, "lunaabyss"),               # Luna Abyss
    "PPSA09695": ("psn", "US", "en", "UP9000-PPSA09695_00-NPUG803290000000"),   # Daxter
    "PPSA14325": ("psn", "US", "en", "UP9000-PPSA14325_00-NPUG803300000000"),   # Jak and Daxter
    "PPSA14382": ("psn", "IT", "it", "EP1006-PPSA14382_00-0439646099833434"),   # Buzz Lightyear
    "PPSA14431": ("psn", "US", "en", "UP9000-PPSA14431_00-UCUS986330000000"),   # Ratchet & Clank
    "PPSA38272": ("psn", "US", "en", "UP0102-PPSA38272_00-CLASSICONIMUSHA0"),   # Onimusha: Dawn of Dreams
}


def simple(text):
    """A name with nothing left but its letters and digits, for comparing titles."""
    return re.sub(r"[^a-z0-9]+", "", str(text).lower())


def fetch_json(url, attempts=3):
    """Read a JSON document, giving the storefront a second chance after an empty answer.

    Both storefronts answer an empty body when they are asked too quickly, so a
    missing page is only believed after a couple of spaced retries.
    """
    note = ""
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": BROWSER_UA, "Accept": "*/*"})
            with urllib.request.urlopen(request, timeout=45) as response:
                body = response.read()
            if body:
                return json.loads(body.decode("utf-8")), ""
            note = "empty answer"
        except urllib.error.HTTPError as error:
            note = "http %s" % error.code
        except ValueError:
            note = "not json"
        except Exception as error:  # noqa: BLE001 - one unreachable page must not stop the run
            note = type(error).__name__
        time.sleep(2.0 * (attempt + 1))
    return None, note


def steam_shots(appid, token):
    """The first screenshots of a Steam app, in the url/thumb shape the app reads."""
    found, note = fetch_json(STEAM_APP % appid)
    data = ((found or {}).get(str(appid)) or {}).get("data") or {}
    if not data:
        return [], note or "no such app"
    if token not in simple(data.get("name")):
        return [], "app %s is called %r" % (appid, data.get("name"))
    shots = [{"url": shot["path_full"], "thumb": shot["path_thumbnail"]}
             for shot in (data.get("screenshots") or [])[:SHOT_LIMIT] if shot.get("path_full")]
    return shots, "" if shots else "no screenshots on the Steam page"


def psn_shots(title_id, country, language, product_id):
    """The first screenshots of a PlayStation Store product, sized like the catalog's own."""
    if title_id not in product_id:  # the id has to name this very title
        return [], "product id does not name %s" % title_id
    found, note = fetch_json(STORE % (country, language, urllib.parse.quote(product_id)))
    shots = ((found or {}).get("mediaList") or {}).get("screenshots") or []
    result = []
    for shot in shots[:SHOT_LIMIT]:
        url = str(shot.get("url") or "").split("?")[0]
        if not url:
            continue
        if url.startswith(PSN_CDN):  # the store CDN, through the host the app already loads
            url = PSN_IMAGE + url[len(PSN_CDN):]
        result.append({"url": url + SHOT_WIDE, "thumb": url + SHOT_THUMB})
    return result, "" if result else (note or "no screenshots on the store page")


def page_shots(path):
    """The screenshots a page already carries, so a curated page is never overwritten."""
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as handle:
        return json.loads(handle.read()).get("shots") or []


def fetch_shots(data_dir):
    """Write the page of every game this import added that has no screenshots yet."""
    pages_dir = os.path.join(data_dir, PAGES_DIRNAME)
    written, kept, failed = [], [], []
    for title_id, source in sorted(SHOTS.items()):
        path = os.path.join(pages_dir, title_id + ".json")
        try:
            current = page_shots(path)
        except (OSError, ValueError) as error:
            failed.append((title_id, "unreadable page: %s" % error))
            continue
        if current:
            kept.append((title_id, len(current)))
            continue
        if source[0] == "steam":
            shots, note = steam_shots(source[1], source[2])
            origin = "steam %s" % source[1]
        else:
            shots, note = psn_shots(title_id, source[1], source[2], source[3])
            origin = "store %s/%s" % (source[1], source[2])
        if not shots:
            failed.append((title_id, "%s: %s" % (origin, note)))
            continue
        page = collections.OrderedDict([("about", []), ("shots", shots), ("summary", "")])
        body = json.dumps(page, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        with open(path, "wb") as handle:
            handle.write(body)
        written.append((title_id, "%s, %d screenshots" % (origin, len(shots))))
        time.sleep(0.5)
    return written, kept, failed


# --- Reporting --------------------------------------------------------------


def host_name_gaps(data_dir, plan):
    """Provider keys this import introduces that HOST_NAMES in app/state/catalog.js cannot name."""
    path = os.path.join(os.path.dirname(data_dir), "state", "catalog.js")
    named = set()
    if os.path.exists(path):
        block = re.search(r"var HOST_NAMES = \{(.*?)\n\s*\};", read_text(path), re.S)
        if block:
            named = {name.strip() for name in re.findall(r'"?([A-Za-z0-9 ._-]+)"?\s*:', block.group(1))}
    introduced = set()
    for title_id, merged in plan["provider_additions"].items():
        introduced |= set(merged) - set(plan["entries"][title_id]["keys"])
    for page in plan["pages"].values():
        introduced |= set(page["providers"])
    return sorted(key for key in introduced if key not in named)


def print_summary(plan, changed=None):
    info = plan["info"]
    print("input         %s" % info["input"]["path"])
    print("              %d games, %d bytes, sha256 %s" % (info["input"]["games"], info["input"]["bytes"], info["input"]["sha256"]))
    print("links         %d fields, %d decrypted, %d undecryptable" % (info["fields"], info["decrypted"], len(info["undecryptable"])))
    print("              %d already in the catalog, %d dropped as duplicates" % (info["present"], info["duplicate"]))
    print("              %d of the new ones repeat a page the catalog has under another #fragment" % info["near_fragment"])
    print("to import     %d new sources over %d games (%d of them the twin edition of a listed work)"
          % (info["new"], info["titles"], info["editions"]))
    print("              by host: %s" % ", ".join("%s %d" % pair for pair in info["hosts"].most_common()))
    print("              by mirror: %s" % ", ".join("%s %d" % pair for pair in info["owners"].most_common()))
    print("              by field group: %s" % ", ".join("%s %d" % pair for pair in info["groups"].most_common()))
    print("catalog       %d games absent from both blocks, %d entries gain provider keys"
          % (len(plan["absent"]), len(plan["provider_additions"])))
    if plan["absent"]:
        print("              new: %s" % ", ".join("%s %s" % (t, plan["pages"][t]["title"]) for t in plan["absent"]))
    if info["layers"]:
        print("              link lock layers: %s" % ", ".join(sorted(info["layers"])))
    if info["unknown_hosts"]:
        print("unknown hosts %s" % ", ".join("%s %d" % pair for pair in info["unknown_hosts"].most_common()))
    if info["no_title_id"]:
        print("no title id   %s" % ", ".join(info["no_title_id"]))
    for entry in info["undecryptable"]:
        print("undecryptable %s.%s: %s" % (entry["title"], entry["field"], entry["error"]))
    for warning in info["warnings"][:20]:
        print("warning       %s" % warning)
    if len(info["warnings"]) > 20:
        print("warning       ... and %d more" % (len(info["warnings"]) - 20))
    if changed is not None:
        releases, inserted, emptied = changed
        print("written       %d release files, %d catalog lines" % (len(releases), len(inserted)))
        if emptied:
            print("deleted       %s" % ", ".join(emptied))


def check_expectations(plan, ignore):
    info = plan["info"]
    actual = {"fields": info["fields"], "undecryptable": len(info["undecryptable"]),
              "present": info["present"], "duplicate": info["duplicate"],
              "new": info["new"], "absent_games": len(plan["absent"])}
    moved = {key: (EXPECTED[key], actual[key]) for key in STRICT if EXPECTED[key] != actual[key]}
    if not moved:
        print("check         all counts match the 2026-10-15 import (games absent from the catalog: %d)"
              % actual["absent_games"])
        return 0
    for key, (was, now) in moved.items():
        print("check         %s moved: %s -> %s" % (key, was, now))
    if ignore:
        print("check         ignored (--ignore-expect)")
        return 0
    print("check         the upstream file changed; review the difference before importing")
    return 1


def main(argv=None):
    parser = argparse.ArgumentParser(description="Import the Pippo Library sources into Overdrive's catalog.")
    parser.add_argument("--pippo", required=True, help="path to exFAT.json, downloaded outside the repository")
    parser.add_argument("--data", default="app/data", help="the app's data directory (default: app/data)")
    parser.add_argument("--check", action="store_true", help="only re-derive the counts and compare them with EXPECTED")
    parser.add_argument("--dry-run", action="store_true", help="report what would change and write nothing")
    parser.add_argument("--ignore-expect", action="store_true", help="do not fail when the counts moved")
    parser.add_argument("--covers", action="store_true", help="also store the missing games' covers as JPEG")
    parser.add_argument("--covers-dir", help="where --covers writes (default: <repo>/covers)")
    parser.add_argument("--shots", action="store_true",
                        help="also give the games this import added the screenshots of their page")
    parser.add_argument("--report", help="write the run's report as JSON to this path")
    args = parser.parse_args(argv)
    if not os.path.isfile(args.pippo):
        sys.exit("no such input file: %s" % args.pippo)

    plan = build_plan(args)
    print_summary(plan)
    try:
        gaps = host_name_gaps(args.data, plan)
    except (ImportError, OSError, ValueError):
        gaps = []
    if gaps:
        print("host names    no HOST_NAMES entry in app/state/catalog.js for: %s" % ", ".join(gaps))

    if args.check:
        return check_expectations(plan, args.ignore_expect)
    status = check_expectations(plan, args.ignore_expect)
    if status:
        print("              refusing to write; pass --ignore-expect once the difference is reviewed")
        return status

    if args.dry_run:
        print("dry run       nothing written")
        for title_id in plan["absent"][:6]:
            print("              %s" % render_game(plan["pages"][title_id]))
    else:
        print_summary(plan, apply_plan(plan))

    if args.covers:
        root = os.path.dirname(os.path.dirname(os.path.abspath(args.data)))
        covers_dir = args.covers_dir or os.path.join(root, COVERS_DIRNAME)
        written, failed = fetch_covers(plan, covers_dir)
        print("covers        %d written to %s" % (len(written), os.path.abspath(covers_dir)))
        for title_id, detail in written:
            print("              %s %s" % (title_id, detail))
        for title_id, source, error in failed:
            print("cover failed  %s %s: %s" % (title_id, source, error))

    if args.shots:
        if args.dry_run:
            print("shots         dry run: %d games in the table, nothing fetched" % len(SHOTS))
        else:
            written, kept, failed = fetch_shots(args.data)
            print("shots         %d pages written in %s, %d pages left alone"
                  % (len(written), os.path.join(os.path.abspath(args.data), PAGES_DIRNAME), len(kept)))
            for title_id, detail in written:
                print("              %s %s" % (title_id, detail))
            for title_id, count in kept:
                print("              kept %s, it already has %d screenshots" % (title_id, count))
            for title_id, detail in failed:
                print("shot failed   %s %s" % (title_id, detail))

    if args.report:
        info = {key: (dict(value) if isinstance(value, collections.Counter) else value)
                for key, value in plan["info"].items()}
        with open(args.report, "w", encoding="utf-8") as handle:
            json.dump({"info": info, "absent": plan["absent"],
                       "provider_additions": plan["provider_additions"]}, handle, indent=1)
    return status


if __name__ == "__main__":
    sys.exit(main())
