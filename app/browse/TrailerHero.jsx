import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { games } from '../data/catalog.js';
import { summaryOf } from '../state/catalog.js';
import { trailers as bundled } from '../data/trailers.js';
import { TRAILERS_DIR, trailersFor } from '../state/trailers.js';
import { ratingFor } from '../state/ratings.js';
import { LATIN_IN_RTL, useLocale, useT } from '../i18n/index.js';
import { useNavActions } from '../state/nav.jsx';
import { FAMOUS, picked } from './picks.js';
import { FIRST_POPULAR } from './PopularRail.jsx';
import { Button2 } from '../ui/Button.jsx';
import { GameLogo } from '../ui/GameLogo.jsx';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { FileSystem, Text, Video, View } from '@ps5-react/core';

var EPIC = ["PPSA08330", "PPSA04609", "PPSA03016", "PPSA04029", "PPSA26344", "PPSA02225", "PPSA02530", "PPSA23226", "PPSA25286", "PPSA03671"];
var ROTATE_MS = 30000;
var MAX_SLIDES = 6;
var LOGO = [320, 112, 48 * 256];

function userTrailerIds() {
  try {
    return FileSystem.readDir(TRAILERS_DIR)
      .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5));
  } catch {
    return [];
  }
}

function pickPlaylist() {
  const known = new Set(Object.keys(bundled).filter((id) => Array.isArray(bundled[id]) && bundled[id].length > 0));
  for (const id of userTrailerIds()) known.add(id);
  if (!known.size) return null;
  const byId = new Map(games.map((game) => [game.id, game]));
  const order = [];
  for (const id of EPIC) {
    const game = byId.get(id);
    if (game && known.has(id)) order.push(game);
  }
  for (const game of picked(games, FAMOUS)) if (known.has(game.id) && !order.includes(game)) order.push(game);
  for (const game of games) if (known.has(game.id) && !order.includes(game)) order.push(game);
  const playlist = [];
  for (const game of order) {
    if (playlist.length >= MAX_SLIDES) break;
    const trailers = trailersFor(game.id);
    if (trailers.length) playlist.push({ game, trailer: trailers[0] });
  }
  return playlist.length ? playlist : null;
}

var playlist = pickPlaylist();
var hasTrailerHero = playlist != null;

function TrailerHero() {
  const t2 = useT();
  const { rtl } = useLocale();
  const { openGame } = useNavActions();
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!playlist || playlist.length < 2) return void 0;
    const id = setInterval(() => setActive((value) => value + 1), ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  if (!playlist) return null;
  const { game, trailer } = playlist[active % playlist.length];
  const rating = ratingFor(game.id);
  return (0, jsxs)(View, { style: { flexDirection: "row", height: 640, borderRadius: 18, overflow: "hidden", backgroundColor: colors.canvas }, children: [
    (0, jsx)(View, { style: { width: "50%", backgroundColor: "#000000" }, children:
      (0, jsx)(Video, { key: trailer.url, source: { uri: trailer.url }, muted: true, repeat: true, resizeMode: "cover", style: { width: "100%", height: "100%" } })
    }),
    (0, jsxs)(View, { style: { flex: 1, justifyContent: "center", gap: 22, padding: 60 }, children: [
      (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 14 }, children: [
        (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, letterSpacing: 2, color: colors.subtle, textTransform: "uppercase" }, children: t2("game.trailer") }),
        playlist.length > 1 ? (0, jsx)(Text, { style: { fontFamily: "JetBrainsMono-Regular", fontSize: 19, color: colors.subtle }, children: `${(active % playlist.length) + 1} / ${playlist.length}` }) : null
      ] }),
      (0, jsx)(GameLogo, { game, width: LOGO[0], height: LOGO[1], area: LOGO[2] }),
      rating ? (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 12 }, children: [
        (0, jsx)(View, { style: { flexDirection: "row", alignItems: "center", gap: 4 }, children: [0, 1, 2, 3, 4].map((index) => (0, jsx)(Icon, { name: "star", size: 24, color: index < Math.round(rating.average) ? "#f5c518" : colors.muted, fill: index < Math.round(rating.average) ? "#f5c518" : "none" }, index)) }),
        (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 26, fontWeight: 700, color: colors.fg, lineHeight: 34 }, children: `${Math.round(rating.average * 10) / 10}/5` }),
        (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, children: t2("game.ratingCount", { count: String(rating.count) }) })
      ] }) : null,
      (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 23, color: "#f2f2f3d9", numberOfLines: 6, ellipsizeMode: "tail", lineHeight: 37 }, rtl ? LATIN_IN_RTL : void 0], children: summaryOf(game) }),
      (0, jsx)(Button2, { variant: "primary", size: "lg", label: t2("browse.viewGame"), halo: false, focusKey: "spotlight:cta", nextFocusUp: "nav:current", nextFocusDown: FIRST_POPULAR, onPress: () => openGame(game.id, "spotlight:cta") })
    ] })
  ] });
}

export { TrailerHero, hasTrailerHero };
