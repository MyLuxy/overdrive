# International text

Text is drawn by Embedded React's software renderer. Glyphs come from two
places:

- **Baked fonts.** An imported TTF/OTF is rasterized at build time, at the
  sizes the app uses, into bitmap glyphs compiled into the executable. This is
  the fast path, and the only one for text the baked font fully covers.
- **Runtime fonts.** Characters the baked font lacks, and scripts that need
  shaping (Devanagari, Bengali, Arabic), are drawn from subset Noto fonts the
  app packages with `textFonts`: HarfBuzz shapes them, SheenBidi orders
  right-to-left runs, and glyphs are rasterized on demand
  (`native/shared/text_shaper.cpp`). A string goes to this path only when it
  contains such a character or is laid out right to left; its baked characters
  keep their baked glyphs, so Latin text and digits inside a Japanese or Arabic
  sentence still use the app's font.

`apps/text-lab` shows a sample in each of the thirteen most spoken languages
(Latin, Cyrillic, CJK, Devanagari, Bengali, Arabic and Urdu), CJK wrapping and
truncation, and a right-to-left box (`npm run dev -- --app text-lab`).

## Baked glyph sets

A baked font covers printable ASCII plus the codepoints its `assets.config.js`
entry names. Text known at build time is checked by the font baker, which warns
about missing glyphs. Text that arrives at runtime (catalog titles, user names)
cannot be checked, so pick a named set that covers the languages you show:

| `glyphs` | Adds |
| --- | --- |
| `'common'` | Typographic quotes, dashes, bullets, currency and math signs |
| `'latin-ext'` | `common`, Latin-1 Supplement, Latin Extended-A, Ș Ț ẞ, `„ ‚ ‹ ›`, `€ ₹ ₺ ₽ №` |
| `'cyrillic'` | `common`, U+0400–U+045F, Ґ ґ, № |
| `'european'` | `latin-ext`, `cyrillic` and modern Greek (tonos, final sigma) |

`'latin-ext'` covers Spanish, French, German, Portuguese, Indonesian and the
other Latin-alphabet European languages; Vietnamese is not included.
`'european'` adds about 470 glyphs to each baked size (about 65 KB at 24 px with
the default 4 bits per pixel).

```js
export default {
  fonts: {'Inter-Regular': {glyphs: 'european', extraGlyphs: '…'}},
};
```

A codepoint the baked font lacks draws as `?`, unless a runtime font has it.

## Runtime fonts

List the scripts an app shows in `app.json`:

```json
"textFonts": ["chinese", "chinese-traditional", "japanese", "devanagari", "bengali", "arabic"]
```

| Script | Languages | Font (subset) | Characters | Package |
| --- | --- | --- | --- | --- |
| `chinese` | Chinese (Simplified) | Noto Sans SC | GB 2312: 6,763 hanzi, CJK punctuation, full-width forms | 1.6 MB |
| `chinese-traditional` | Chinese (Traditional) | Noto Sans TC | Big5 level 1: 5,401 hanzi and its symbols, CJK punctuation, full-width forms | about 1.4 MB (not measured) |
| `japanese` | Japanese | Noto Sans JP | JIS X 0208: kana, 6,355 kanji (levels 1 and 2), punctuation | 1.7 MB |
| `devanagari` | Hindi, Marathi, Nepali | Noto Sans Devanagari | Devanagari, Devanagari Extended, Vedic Extensions | 0.16 MB |
| `bengali` | Bengali, Assamese | Noto Sans Bengali | Bengali | 0.09 MB |
| `arabic` | Arabic, Urdu, Persian | Noto Sans Arabic | Arabic, Supplement, Extended-A, presentation forms | 0.11 MB |

The five scripts other than `chinese-traditional` add 3.7 MB to the package. Urdu is drawn in Noto Sans Arabic's Naskh
style, not Nastaliq.

The build pins each font in `dependencies.lock.json`, subsets it with HarfBuzz
(`tools/font_subset.cpp`, cached in `.deps/fonts/subset/`) and packages it in
`fonts/` with its OFL notice in `notices/Noto-fonts-LICENSE.txt`. The desktop
preview reads the same files from `.build/<app>/generated/fonts/`. Han
characters outside one font fall back to the other when both are listed, so a
Japanese UI that lists both also draws kanji beyond JIS X 0208.

Kana always uses the Japanese font. Han characters use the simplified Chinese
forms, then traditional, then Japanese; the traditional forms come first when the
language is traditional Chinese (`zh-Hant`, or `zh` with region TW, HK or MO), and
the Japanese ones when it is Japanese: the shaper starts with the
system language (`DeviceInfo.get().language`) and `Fonts.setLanguage(tag)`
overrides it (see [Native API](NATIVE-API.md)).

### Memory

Nothing is loaded until a string needs a runtime font. Then the font file is
read whole and kept (the package sizes above). Rasterized glyphs live in one
least-recently-used cache capped at 4 MiB, about 7,000 CJK glyphs at 24 px; the
128 most recent shaped strings are kept as well (about 1 KB each for a label).
An app showing every script therefore holds at most about 8 MB for text (3.7 MB
of fonts, 4 MiB of glyphs, up to 0.2 MB of layouts), from the title heap, never
the JavaScript heap. HarfBuzz and SheenBidi add about 0.8 MB of code to the
executable.

### Line breaking

Runtime text breaks where the bitmap path does (newlines, spaces, inside a
word only when nothing else fits) and also between any two CJK characters,
following the basic kinsoku rules: closing punctuation (`。、，」』）`), small
kana, `ー` and iteration marks never start a line, and opening brackets
(`「『（`) never end one. Devanagari, Bengali, Arabic and Urdu break only at
spaces (and after a zero-width space, U+200B). A word wider than its line
breaks between grapheme clusters: a letter keeps its marks and a conjunct
(consonant, virama, consonant) stays whole. `numberOfLines` truncates with `…`
(from the baked font, or `...` when it lacks one), after whole clusters.
`tools/test_text.py` checks these layouts with text-lab's fonts.

### Shaping

Devanagari and Bengali conjuncts, reordered vowel signs and reph, and Arabic
joining forms and ligatures (lam-alef) come from the fonts' OpenType tables
through HarfBuzz's shapers. Their marks reach further below the baseline than
Latin, so a string containing them gets a taller line box: about 14% for
Devanagari and Bengali and 28% for Arabic over Inter's (CJK keeps Inter's). Joined scripts take no `letterSpacing`, and faux
bold does not widen them, so their joins stay intact. Each node's text is
limited to 255 bytes (`ER_TEXT_MAX`): about 85 CJK or Devanagari characters.
Each styled segment of a nested `Text` is limited to 63 bytes
(`ER_SPAN_TEXT_MAX`, about 21 such characters), at most four segments. Longer
text is cut at the last whole character, never inside a UTF-8 sequence or
between a letter and its marks or conjunct.

## Right-to-left text

Text containing Arabic or Hebrew letters is ordered by the Unicode
bidirectional algorithm (SheenBidi), one paragraph per line feed: numbers and
Latin names inside Arabic stay left to right (`PS5 تحميل 24.2 GB`), brackets
are mirrored, and lines break in logical order before each line is reordered.

| Style | On | Values | Effect |
| --- | --- | --- | --- |
| `direction` | any node, inherited | `'inherit'` (default), `'ltr'`, `'rtl'` | A right-to-left row lays its children out from the right edge and a column starts its cross axis at the right, as in Yoga. Text below it is right to left. |
| `writingDirection` | `Text` | `'auto'` (default), `'ltr'`, `'rtl'` | The paragraph's base direction; `'auto'` takes the inherited `direction`, else the first strong character. |
| `textAlign` | `Text` | `'auto'`/`'start'` (default), `'end'`, `'left'`, `'right'`, `'center'` | `start` and `end` follow the paragraph direction; `left` and `right` do not. |

An Arabic or Urdu interface sets `direction: 'rtl'` once on its root view. A
truncated right-to-left line keeps its start at the right and puts `…` at its
left end. The `text-start` and `text-end` utilities follow the direction.

Limits: a horizontal `ScrollView` keeps left-to-right order (reverse its data
for right-to-left); margins, padding and `left`/`right` insets stay physical
(there are no `marginStart`/`paddingEnd` styles); focus moves by laid-out
position, so the D-pad follows the mirrored layout.
