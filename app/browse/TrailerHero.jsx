import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { games } from '../data/catalog.js';
import { trailers as bundled } from '../data/trailers.js';
import { TRAILERS_DIR, trailersFor } from '../state/trailers.js';
import { LATIN_IN_RTL, useLocale, useT } from '../i18n/index.js';
import { useNavActions } from '../state/nav.jsx';
import { FAMOUS, picked } from './picks.js';
import { FIRST_POPULAR } from './PopularRail.jsx';
import { Button2 } from '../ui/Button.jsx';
import { GameLogo } from '../ui/GameLogo.jsx';
import { colors } from '../ui/colors.js';
import { FileSystem, Text, Video, View } from '@ps5-react/core';

var VIDEO_W = 1280;
var VIDEO_H = 520;
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

function pickHero() {
  const known = new Set(Object.keys(bundled).filter((id) => Array.isArray(bundled[id]) && bundled[id].length > 0));
  for (const id of userTrailerIds()) known.add(id);
  if (!known.size) return null;
  const seen = new Set();
  for (const game of [...picked(games, FAMOUS), ...games]) {
    if (seen.has(game.id) || !known.has(game.id)) continue;
    seen.add(game.id);
    const trailers = trailersFor(game.id);
    if (trailers.length) return { game, trailer: trailers[0] };
  }
  return null;
}

var hero = pickHero();
var hasTrailerHero = hero != null;

function TrailerHero() {
  const t2 = useT();
  const { rtl } = useLocale();
  const { openGame } = useNavActions();
  if (!hero) return null;
  const { game, trailer } = hero;
  return (0, jsxs)(View, { style: { gap: 24 }, children: [
    (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, letterSpacing: 2, color: colors.subtle, textTransform: "uppercase" }, children: t2("game.trailer") }),
    (0, jsxs)(View, { style: { flexDirection: "row", gap: 24, alignItems: "center" }, children: [
      (0, jsx)(View, { style: { width: VIDEO_W, height: VIDEO_H, borderRadius: 18, overflow: "hidden", backgroundColor: "#000000" }, children:
        (0, jsx)(Video, { source: { uri: trailer.url }, muted: true, repeat: true, resizeMode: "cover", style: { width: "100%", height: "100%" } })
      }),
      (0, jsxs)(View, { style: { flex: 1, gap: 18, alignItems: "flex-start" }, children: [
        (0, jsx)(GameLogo, { game, width: LOGO[0], height: LOGO[1], area: LOGO[2] }),
        trailer.title ? (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, rtl ? LATIN_IN_RTL : void 0], children: trailer.title }) : null,
        (0, jsx)(Button2, { variant: "primary", size: "lg", label: t2("browse.viewGame"), halo: false, focusKey: "trailhero:cta", nextFocusUp: "nav:current", nextFocusDown: FIRST_POPULAR, onPress: () => openGame(game.id, "trailhero:cta") })
      ] })
    ] })
  ] });
}

export { TrailerHero, hasTrailerHero };
