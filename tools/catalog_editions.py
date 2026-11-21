"""What the catalog importers share about editions: telling one game from another, and writing the
other platform's edition of a game the catalog has.

The catalog has two blocks (app/state/catalog.js): "games" is the library the app lists, "twins"
holds the other editions of a work. Entries of one work share a "work" number, and the app shows
them as one game with its editions, so the PS5 edition of a PS4 game is a twin, never a second game.
"""
import datetime
import html
import json
import re

# Words that name an edition, not a game: "Persona 5 Royal Ultimate Edition" is "Persona 5 Royal".
EDITION = re.compile(r"\b(?:ultimate|deluxe|complete|definitive|standard|digital|premium|gold|special|collector'?s?|"
                     r"enhanced|director'?s cut|game of the year|goty|anniversary|launch|legendary|remastered|"
                     r"console|cross-gen|bundle|edition|ps4|ps5|and)\b", re.I)
ID = re.compile(r'^\s*\{ "id": "([^"]+)"')
WORK = re.compile(r'"work": (\d+)')


def today():
    """The day a new entry is added, in UTC: its "added", which the app's "Recently added" row sorts by."""
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


def edition_key(title):
    """A title without its edition's words, numerals or punctuation: one game's editions share it."""
    title = html.unescape(title).lower().replace("&", " ")
    title = re.sub(r"[™®©:'’.,!?\-–/|()\[\]+]", " ", title)
    title = EDITION.sub(" ", title)
    title = re.sub(r"\biii\b", "3", re.sub(r"\bii\b", "2", title))
    return re.sub(r"[^a-z0-9]", "", title)


def block_bounds(lines, name):
    start = next(i for i, line in enumerate(lines) if re.match(r"^\s*var %s = \[$" % name, line))
    end = next(i for i in range(start + 1, len(lines)) if re.match(r"^\s*\];$", lines[i]))
    return start, end


def insert(lines, name, new_lines):
    """New entries at the end of a block, as the importers add theirs."""
    if not new_lines:
        return
    _, end = block_bounds(lines, name)
    if re.match(r"^\s*\{ ", lines[end - 1]) and not lines[end - 1].rstrip().endswith(","):
        lines[end - 1] = lines[end - 1].rstrip() + ","
    lines[end:end] = new_lines


def work_of(lines, game_id):
    """The work number of a catalog entry, giving it the next free one when it has none."""
    index = next(i for i, line in enumerate(lines) if (ID.match(line) or [None, None])[1] == game_id)
    found = WORK.search(lines[index])
    if found:
        return int(found.group(1))
    number = max([int(m.group(1)) for line in lines for m in [WORK.search(line)] if m] or [0]) + 1
    line = lines[index]
    # After "art", before "region" and "source", as the catalog's own lines have it.
    keys = [line.find(key) for key in ('"region":', '"source":') if key in line]
    if keys:
        lines[index] = line[:min(keys)] + '"work": %d, ' % number + line[min(keys):]
    else:
        at = line.rstrip().rstrip(",").rstrip().rfind("}")
        lines[index] = line[:at].rstrip() + ', "work": %d ' % number + line[at:]
    return number


def with_work(fields, work):
    """A new entry's fields with its work number after "art"."""
    if work is None:
        return fields
    at = next(i for i, (key, _) in enumerate(fields) if key == "art") + 1
    return fields[:at] + [("work", work)] + fields[at:]


def render(value):
    if isinstance(value, dict):
        return "{ " + ", ".join("%s: %s" % (json.dumps(k), render(v)) for k, v in value.items()) + " }"
    return json.dumps(value, ensure_ascii=True)


def render_line(fields):
    return "    { " + ", ".join("%s: %s" % (json.dumps(key), render(value)) for key, value in fields) + " },"
