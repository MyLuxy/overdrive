# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Runtime fonts for the scripts an app lists in app.json "textFonts" (docs/TEXT.md).

Each script gets one pinned Noto font, subset at build time to the characters it is used for, so
the package carries the common set of a script rather than the whole font. The runtime shaper
(native/shared/text_shaper.cpp) loads a file the first time text needs it.
"""
import hashlib
import shutil
import tarfile

from common import DEPS, LOCK, ROOT, digest, fetch, run

ASCII = set(range(0x20, 0x7F))
# Punctuation, CJK symbols and full-width forms shared by Chinese and Japanese text.
CJK_COMMON = ASCII | set(range(0x2000, 0x2070)) | set(range(0x3000, 0x3040)) | set(range(0xFF00, 0xFFF0))
KANA = set(range(0x3040, 0x3100)) | set(range(0x31F0, 0x3200))
SHAPING = {0x00A0, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x2010, 0x2013, 0x2014, 0x25CC}


def span(first, last):
    return set(range(first, last + 1))


def euc_rows(codec, first, last):
    """Every character of a two-byte EUC character set's rows first..last (inclusive, 1-based)."""
    found = set()
    for row in range(0xA0 + first, 0xA0 + last + 1):
        for cell in range(0xA1, 0xFF):
            try:
                found.update(map(ord, bytes((row, cell)).decode(codec)))
            except UnicodeDecodeError:
                pass
    return found


def big5_level1():
    """Big5's symbol rows (0xA1-0xA3) and its 5,401 common hanzi (level 1, lead bytes 0xA4-0xC6)."""
    found = set()
    for lead in range(0xA1, 0xC7):
        for trail in [*range(0x40, 0x7F), *range(0xA1, 0xFF)]:
            try:
                found.update(map(ord, bytes((lead, trail)).decode("big5")))
            except UnicodeDecodeError:
                pass
    return found


SCRIPTS = {
    # GB 2312: the 6,763 hanzi of simplified Chinese plus its punctuation.
    "chinese": ("NotoSansSC-Regular.otf", lambda: euc_rows("gb2312", 1, 87) | CJK_COMMON),
    # Big5 level 1: the 5,401 common hanzi of traditional Chinese (Taiwan, Hong Kong) and its symbols.
    "chinese-traditional": ("NotoSansTC-Regular.otf", lambda: big5_level1() | CJK_COMMON),
    # JIS X 0208: kana and the 6,355 kanji of levels 1 and 2. Han characters outside it fall back
    # to the Chinese font when the app also lists "chinese".
    "japanese": ("NotoSansJP-Regular.otf", lambda: euc_rows("euc_jp", 1, 84) | KANA | CJK_COMMON),
    # Whole blocks, with the joiners and the dotted circle HarfBuzz draws under a stray mark.
    "devanagari": ("NotoSansDevanagari-Regular.ttf",
                   lambda: ASCII | span(0x0900, 0x097F) | span(0xA8E0, 0xA8FF) | span(0x1CD0, 0x1CFF) | SHAPING),
    "bengali": ("NotoSansBengali-Regular.ttf", lambda: ASCII | span(0x0980, 0x09FF) | {0x0964, 0x0965} | SHAPING),
    # Arabic and Urdu letters, presentation forms and Arabic-Indic digits.
    "arabic": ("NotoSansArabic-Regular.ttf", lambda: ASCII | span(0x0600, 0x06FF) | span(0x0750, 0x077F) |
               span(0x08A0, 0x08FF) | span(0xFB50, 0xFDFF) | span(0xFE70, 0xFEFF) | SHAPING),
}


def harfbuzz():
    """Source directory of the pinned HarfBuzz release (MIT)."""
    pinned = LOCK["harfbuzz"]
    source = DEPS / f"harfbuzz-{pinned['version']}"
    if not (source / "src/harfbuzz.cc").exists():
        archive = fetch(pinned["url"], DEPS / f"harfbuzz-{pinned['version']}.tar.xz", pinned["sha256"])
        with tarfile.open(archive) as package:
            package.extractall(DEPS, filter="data")
    return source


def sheenbidi():
    """Source directory of the pinned SheenBidi release (Apache-2.0), the Unicode bidi algorithm."""
    pinned = LOCK["sheenBidi"]
    source = DEPS / f"SheenBidi-{pinned['version']}"
    if not (source / "Source/SheenBidi.c").exists():
        archive = fetch(pinned["url"], DEPS / f"SheenBidi-{pinned['version']}.tar.gz", pinned["sha256"])
        with tarfile.open(archive) as package:
            package.extractall(DEPS, filter="data")
    return source


def subset_tool():
    tool_source = ROOT / "tools/font_subset.cpp"
    tool = ROOT / ".build/host" / f"font-subset-{LOCK['harfbuzz']['version']}-{digest(tool_source)[:12]}"
    if not tool.exists():
        src = harfbuzz() / "src"
        run(["clang++", "-std=c++17", "-O2", "-fno-exceptions", "-fno-rtti", "-I", src, tool_source,
             src / "harfbuzz-subset.cc", "-o", tool], log=ROOT / ".build/host/font-subset.log")
    return tool


def text_fonts(config, directory):
    """Writes the app's subset fonts to `directory` (and nothing else); returns their paths."""
    scripts = config.get("textFonts", [])
    directory.mkdir(parents=True, exist_ok=True)
    wanted = {SCRIPTS[script][0]: script for script in scripts}
    for stale in directory.iterdir():
        if stale.name not in wanted: stale.unlink()
    for name, script in wanted.items():
        pinned = LOCK["notoFonts"][name]
        original = fetch(pinned["url"], DEPS / "fonts" / name, pinned["sha256"])
        codepoints = "\n".join(f"{c:X}" for c in sorted(SCRIPTS[script][1]())) + "\n"
        tool = subset_tool()
        key = hashlib.sha256(f"{pinned['sha256']}{tool.name}{codepoints}".encode()).hexdigest()[:16]
        cached = DEPS / "fonts/subset" / f"{key}-{name}"
        if not cached.exists():
            cached.parent.mkdir(parents=True, exist_ok=True)
            listing = cached.with_suffix(".codepoints")
            listing.write_text(codepoints)
            partial = cached.with_name(cached.name + ".partial")
            run([tool, original, partial, listing])
            partial.replace(cached)
            listing.unlink()
        target = directory / name
        if not target.exists() or digest(target) != digest(cached):
            shutil.copy2(cached, target)
    return sorted(directory / name for name in wanted)
