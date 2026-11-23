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

## Hero section on the Browse page

When at least one game has trailers, the Browse page shows, right under the spotlight: a video
window on one side (autoplaying, muted, repeating) and the current game's title, the trailer's name
and a *View game* button on the other. Up to six games rotate through the window, one every 30
seconds, with a small position counter by the heading. The line-up opens with the most cinematic
blockbusters (`EPIC` in `app/browse/TrailerHero.jsx`: God of War Ragnarök, Elden Ring, Spider-Man 2,
Cyberpunk 2077, Ghost of Yotei, Ghost of Tsushima, PRAGMATA, Black Myth: Wukong, Crimson Desert,
Marvel's Wolverine), continues with the hand-picked famous games (`FAMOUS` in `app/browse/picks.js`)
and then fills with the rest of the catalog in its own order. To lead the rotation differently,
reorder or edit those two lists. With no trailer anywhere the section simply does not render.

## Filling the bundled file: tools/fetch-trailers.py

A helper asks two sources, in this order per game, and bundles what it finds. It is
**experimental**: both answer without authentication today, but they are undocumented and may
change or leave games out; run it without `--write` first to see what it would do.

1. The **PlayStation Store**: the old chihiro title container is gone, so the tool resolves a game
   through the store's GraphQL API instead -- search, product, concept, then the concept's media,
   which carries direct mp4 previews (with their names). Anonymous, no keys. The persisted-query
   hashes live in `PRODUCT_HASH`/`MEDIA_HASH` in the tool; if Sony ever rejects them (HTTP 400/403),
   copy the fresh hash from browser devtools on any store page.
2. **Steam** -- the public `appdetails` endpoint (`filters=movies`), the same place Hydra Launcher
   takes its details from. Steam retired direct mp4s in late 2026 and serves HLS/DASH only; the
   tool takes the HLS playlist (`hls_h264`), which the engine's FFmpeg build can demux -- this one
   is untested on the console, so PS Store mp4s always come first. Steam is keyed by appid; the
   tool reads each game's `*/steam/apps/<appid>/*` art URL from the catalog, so games with Steam
   art are covered even when the PlayStation Store has nothing.

```
python -P tools/fetch-trailers.py [--limit N] [--chunk N] [--region US] [--language en]
                                  [--jobs N] [--refresh] [--write]
```

`--jobs N` asks N games in parallel (4\u20138 covers the whole 4,000-game catalog in about an hour;
sources are anonymous and gentle at that pace, but if a store starts replying 429, lower it).

- `--limit N` — only the first N catalog games (a cheap way to try it).
- `--chunk N` — progress line every N games.
- `--jobs N` — N games in parallel, roughly N times faster than one by one.
- `--refresh` — ask the sources again for games that already have a trailer (default: skip them,
  so reruns only fill the holes).
- `--write` — save the merged result to `app/data/trailers.js`; without it the tool only prints.
- Entries already in the file are never touched; the sources only fill the gaps.

## In the player

- Pause/Play and Restart are on the bottom bar; ⭘ (circle) or back closes.
- Direct mp4 URLs play best. A link the engine cannot decode shows a "This trailer did not play"
  message instead of crashing the app.
