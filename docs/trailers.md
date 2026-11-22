# Trailers

The game pages can play trailers: a **Trailer** button appears next to *Add to favorites* when
Overdrive knows videos for the game, and the player is a full-screen view with pause, restart and a
back hint. Video playback needs the `video` feature in `app/app.json`, which adds roughly 11 MB to
the build.

## Where trailers come from

Two places, merged per game, deduplicated by URL, at most 8 per game:

1. **Bundled** with the app: `app/data/trailers.js`, an object keyed by the catalog's game id:

   ```js
   var trailers = {
     "CUSA09267": [
       { "url": "https://…/trailer.mp4", "title": "Launch Trailer" }
     ]
   };

   export { trailers };
   ```

2. **Yours**, on the console: one `.json` file per game in

   ```
   /data/overdrive/trailers/<game id>.json
   ```

   either a plain array or `{"trailers": [...]}`, with the same entries:

   ```json
   [
     { "url": "https://…/trailer.mp4", "title": "Gameplay" },
     "https://…/other-trailer.mp4"
   ]
   ```

   A plain string entry works when there is no title. Your entries come after the bundled ones;
   a URL the file already has is not added twice. Anything that is not an `http(s)` URL is dropped.

There is no way to point the button at a video for a game Overdrive lists under an id you do not
know yet: the key in both places is the exact catalog id (`CUSA09267`, `PPSA03753`).

## Filling the bundled file: tools/fetch-trailers.py

A helper asks the same PlayStation Store API `tools/enrich-catalog.py` uses and bundles what it
finds. It is **experimental**: the store answers this API without authentication today, but it is
undocumented and may change or leave games out; run it without `--write` first to see what it would
do.

```
python -P tools/fetch-trailers.py [--limit N] [--chunk N] [--region US] [--language en] [--write]
```

- `--limit N` — only the first N catalog games (a cheap way to try it).
- `--chunk N` — progress line every N games.
- `--write` — save the merged result to `app/data/trailers.js`; without it the tool only prints.
- Entries already in the file are never touched; the store only fills the gaps.

## In the player

- Pause/Play and Restart are on the bottom bar; ⭘ (circle) or back closes.
- Direct mp4 URLs play best. A link the engine cannot decode shows a "This trailer did not play"
  message instead of crashing the app.
