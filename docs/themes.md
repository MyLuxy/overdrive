# Themes

Overdrive reads your theme from `.json` files on the console and applies it live from
Settings → Appearance → Themes. Only the default palette ships with the app — everything else is
user-made. A theme is three things: a palette of 12 colors, an optional wallpaper, and how much the
wallpaper is dimmed behind the interface. It is not CSS: it recolors the parts of the interface that
go through the app's central `colors` module (`app/ui/colors.js`), and draws a wallpaper behind
everything. Raw colors in a few screens still stay fixed, so keep the dark parts dark.

## Build a theme

1. Open `theme-editor/index.html` in any browser, on any PC. It works offline from the file alone.
2. Tune the twelve palette keys; the preview mirrors the store front, a focused card, buttons and
   the download panel. Contrast badges warn when text stops being readable (WCAG 4.5:1 for normal
   text, 3:1 for large).
3. Set a wallpaper: paste an image URL, or give the name of an image file you will put next to the
   theme's `.json` (for example `wall.jpg`). The **Dim** slider decides how much the palette's
   canvas color covers it — 100% hides the wallpaper, 0% shows it fully behind the interface.
4. Name the theme and press **Export theme**. The file is `<name>.json`.
5. Put the file — and the wallpaper file, if you used one — on the console:

```
/data/overdrive/themes/<name>.json
/data/overdrive/themes/wall.jpg
```

The folder is created on first use; create it yourself if it does not exist yet. On a USB stick the
app's data directory still lives on the console storage, so copy the files with an FTP homebrew or
ShadowMount, depending on your setup. Then open Settings → Appearance → Themes in Overdrive and pick
it from the "From your themes folder" entries.

## File format

```json
{
  "name": "My Theme",
  "colors": {
    "canvas":   "#000000",
    "surface":  "#17171a",
    "surface2": "#212125",
    "surface3": "#2b2b30",
    "line":     "#2a2a2f",
    "fg":       "#f2f2f3",
    "muted":    "#a3a3ab",
    "subtle":   "#8a8a94",
    "accentFg": "#0d0d0f",
    "ok":       "#a7f3d0",
    "warn":     "#fde68a",
    "info":     "#a5f3fc"
  },
  "background": "",
  "backgroundDim": 0.28
}
```

- `name` is optional; the file name is used when it is missing.
- Hex values accept `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`.
- A `colors` key you omit falls back to the default palette for that color, so a theme may override
  as few as one color.
- `background` is an `http(s)` image URL, or a bare file name (`.png`, `.jpg`, `.jpeg`, `.webp`,
  `.gif`, no slashes) for an image inside `/data/overdrive/themes/`. Omit it for no wallpaper.
- `backgroundDim` is 0–1 (default 0.28 when a wallpaper is set). Higher = dimmer wallpaper.
- Anything else in the file (author, version, notes) is ignored.

## Glass, and what each color does

Alpha colors (`#rrggbbaa`) are what make the "glass" look: give `surface` and `surface2` semi-
transparent values and let the wallpaper show through cards instead of only behind them, for example
`"surface": "#17171a99", "surface2": "#21212580"`. Keep the base readable — the wallpaper plus
`canvas` at `backgroundDim` is what shows through, so raise the dim or lower the alpha together.

| Key        | Used for |
|------------|----------|
| `canvas`   | The screen behind everything, and the wallpaper's dim layer |
| `surface`  | Cards, tiles, dialogs, the settings side panel |
| `surface2` | Focused rows, pressed tiles |
| `surface3` | Bars, wells, deep chip backgrounds |
| `line`     | Dialog and card borders |
| `fg`       | Main text, the focus ring, progress fill, the primary button background |
| `muted`    | Secondary labels and hints |
| `subtle`   | Tertiary text, section headers |
| `accentFg` | Text drawn on `fg` and the status chips |
| `ok`       | Success chips |
| `warn`     | Attention chips |
| `info`     | Neutral info chips |

## What a theme can and cannot change

| Can be themed | Cannot (yet) |
|---------------|--------------|
| The 12 palette colors, anywhere the app draws through `colors` | Colors hardcoded per screen (a few gradients and overlays) |
| A wallpaper behind the whole interface, with dimming | Layout, sizes, spacing, fonts (glyphs are baked in at build time) |
| Translucency, via alpha in any color | Per-page or per-game recolors, animation speeds |
| Whether the wallpaper file lives on the console or is served by URL | Sounds and haptics |

## Guidelines

- `canvas`, `surface` and `surface2` must stay dark (roughly under `#303038` luminance) unless the
  wallpaper partially covers them; parts of the app still draw fixed light-on-dark text, and a
  light theme cannot be read there yet.
- Keep `fg` readable on `surface`, `muted` readable on `surface`, and `accentFg` readable on `fg`,
  `ok` and `warn` — the editor checks all of these.
- `fg` doubles as the focus ring and the primary button background; a near-white or very light
  accent value keeps that system intact.
- Wallpapers: an image at least 1920×1080 reads best behind the interface; a busy picture wants a
  higher dim (0.4–0.6), a dark minimal one works at 0.1–0.3.

## Sharing

A theme is one `.json` file plus, optionally, its image files. Share the `.json` (and the images)
as a set and have the recipient drop everything into `/data/overdrive/themes/`; keep image names
unique (`mytheme-wall.jpg`, not `wall.jpg`) so themes cannot shadow each other's files.
