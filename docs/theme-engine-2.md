# Theme Engine 2.0 (draft)

Status: the data layer lives in `app/state/themes.js` and `app/state/theme-lightbar.js`; the
wiring checklist below tracks what still consumes it. Stage 4 (fonts) and stage 5 (effects) are
not started. Nothing here breaks a v1 theme: every new value is optional and falls back to a
default that reproduces today's look.

## Goals and non-goals

- Goal: close the gap with PC launchers (Hydra Themes) as far as a non-CSS, software-rendered
  engine allows — a theme becomes a pack: palette + wallpaper + layout knobs + sounds + lightbar.
- Non-goal: CSS. Overdrive on PS5 is React in QuickJS over a custom software renderer; there is
  nothing to run CSS against. Freedom comes from the schema, not from code execution.
- Non-goal: heavy per-frame effects (live blur). The renderer is CPU-only at 1080p.

## Stage 1 — extended palette (engine done, wiring pending)

Three new optional `colors` keys, next to the twelve in [themes.md](themes.md):

| Key | Default | What it is for |
|----------|------------|----------------|
| `accent` | `#f2f2f3` | Primary button fill and the progress bar; `fg` doubles as this today |
| `focus` | `#f2f2f3` | The focus ring, independent from text color |
| `overlay` | `#000000` | The dim layer behind dialogs, sheets and toasts |

`EXTRA_COLOR_DEFAULTS` holds the fallbacks; `themeExtraColors()` returns the merged view. Until a
screen is wired, the key is simply unused, so old themes render identically.

## Stage 2 — layout overrides (engine done, wiring pending)

```json
{
  "overrides": {
    "cardRadius": 24,
    "buttonRadius": 20,
    "chipRadius": 12,
    "glowSize": 10,
    "glowColor": "#01cdfe"
  }
}
```

Clamps: `cardRadius`/`buttonRadius` 0–48, `chipRadius` 0–999, `glowSize` 0–40, `glowColor` a valid
hex or empty (empty = use the focus color). Defaults in `DEFAULT_OVERRIDES` reproduce the current
chrome. Consumers: `GameCard`, `Button`, `Chip`, `FocusRing` — each swaps its hardcoded radius for
`themeOverrides().<key>` as it is wired.

## Stage 3 — sounds and the lightbar (engine done, lightbar wiring point ready)

```json
{
  "sounds": { "focus": "blip.wav", "confirm": "https://example.com/confirm.wav" },
  "lightbar": { "mode": "fixed", "color": "#b967ff" }
}
```

- Sounds: six slots (`focus`, `confirm`, `back`, `error`, `notify`, `page`). A value is a bare
  `.wav` filename inside `/data/overdrive/themes/` or an `http(s)` URL; traversal and other
  extensions are rejected. `themeSounds()` returns only the set slots.
- Open question before sounds go live: the generated `app/ui/sounds.js` plays bundled assets
  through `Sound.play`; whether `@ps5-react/core` can play an arbitrary file from the data
  directory (or a URL) needs a check against `ps5-react/docs/NATIVE-API.md`. Until then the data
  is parsed, validated and stored, but the player still uses the bundled sounds.
- Lightbar: `cover` (today's behavior — the focused cover's average color), `fixed` (the theme's
  color, always) or `off` (neutral/reset). `app/state/theme-lightbar.js` provides
  `useThemeLightBar()` (call once in `App` in `app/index.jsx`) and `lightBarColorForCover()`
  for the generated `lightBar.js` to consult.

## Stage 4 — fonts (spike, not started)

Glyphs are baked in at build time (see "What a theme can and cannot change" in [themes.md](themes.md)),
so theme fonts need a native-renderer change: load a TTF from the theme directory at boot and
re-render text through it. This is the one stage that lives in the native host; treat it as its own
spike before promising anything.

## Stage 5 — effects (design, not started)

Alpha in any palette color already works (`#rrggbbaa`), so "glass" surfaces are free. Live blur is
out; the affordable approximation is a pre-blurred wallpaper: the editor (or the theme author)
ships a blurred variant and the renderer just draws it behind translucent surfaces.

## Wiring checklist

- [ ] `GameCard.jsx` — `cardRadius` from `themeOverrides()`
- [ ] `Button.jsx` — `buttonRadius`
- [ ] `Chip.jsx` — `chipRadius`
- [ ] `FocusRing.jsx` — `focus` color and `glowSize`/`glowColor`
- [ ] Dialogs/sheets/toasts — `overlay` color
- [ ] Progress bars and the primary button — `accent`
- [ ] `app/index.jsx` — `useThemeLightBar()`
- [ ] `lightBar.js` (generated) — `lightBarColorForCover()`
- [ ] `sounds.js` (generated) — theme sounds, once the Sound API question is answered
- [ ] Settings preview panel — `accent`/`focus`/`overlay` rows and locale strings (`themes.color.*`)
- [ ] `site/editor.html` — knobs for every stage, contrast checks kept

## Tests

`app/state/themes-v2.test.mjs` covers the v2 validators and the default-theme guarantee that the
base palette and the v1 behavior stay untouched.
