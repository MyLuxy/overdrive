# Themes

Overdrive reads your palette from small `.json` files, applies it live from Settings → Themes, and
ships six built-in presets (Default, Midnight, Ember, Forest, Sakura, Graphite). A theme is a
palette, not CSS: it recolors the parts of the interface that go through the app's central
`colors` module (`app/ui/colors.js`). Raw colors in a few screens still stay fixed, so keep the
dark parts dark.

## Build a theme

1. Open `theme-editor/index.html` in any browser, on any PC. It works offline from the file alone.
2. Tune the twelve palette keys; the preview mirrors the store front, a focused card, buttons and
   the download panel. Contrast badges warn when text stops being readable (WCAG 4.5:1 for normal
   text, 3:1 for large).
3. Name the theme and press **Export theme**. The file is `<name>.json`.
4. Put the file on the console:

```
/data/overdrive/themes/<name>.json
```

The folder is created on first use; create it yourself if it does not exist yet. On a USB stick the
app's data directory still lives on the console storage, so copy the file with an FTP homebrew or
ShadowMount, depending on your setup. Then open Settings → Themes in Overdrive and pick it from the
"From your themes folder" entries.

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
  }
}
```

- `name` is optional; the file name is used when it is missing.
- Hex values accept `#rgb`, `#rgba`, `#rrggbb` and `#rrggbbaa`.
- A key you omit falls back to the base palette for that color, so a theme may override as few as
  one color.
- Anything else in the file (author, version, notes) is ignored.

## What each color does

| Key        | Used for |
|------------|----------|
| `canvas`   | The screen behind everything |
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

## Guidelines

- `canvas`, `surface` and `surface2` must stay dark (roughly under `#303038` luminance); parts of
  the app still draw fixed light-on-dark text, and a light theme cannot be read there yet.
- Keep `fg` readable on `surface`, `muted` readable on `surface`, and `accentFg` readable on `fg`,
  `ok` and `warn` — the editor checks all of these.
- `fg` doubles as the focus ring and the primary button background; a near-white or very light
  accent value keeps that system intact.
