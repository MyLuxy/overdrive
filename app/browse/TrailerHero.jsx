import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { games } from '../data/catalog.js';
import { trailersFor } from '../state/trailers.js';
import { LATIN_IN_RTL, useLocale, useT } from '../i18n/index.js';
import { useNavActions } from '../state/nav.jsx';
import { FAMOUS, picked } from './picks.js';
import { FIRST_POPULAR } from './PopularRail.jsx';
import { Button2 } from '../ui/Button.jsx';
import { GameLogo } from '../ui/GameLogo.jsx';
import { colors } from '../ui/colors.js';
import { Text, Video, View } from '@ps5-react/core';

var MAX_LOOKUPS = 400;
var VIDEO_W = 1280;
var VIDEO_H = 520;
var LOGO = [320, 112, 48 * 256];

function pickHero() {
  for (const game of picked(games, FAMOUS)) {
    const trailers = trailersFor(game.id);
    if (trailers.length) return { game, trailer: trailers[0] };
  }
  const start = Math.floor(Date.now() / 86400000) % games.length;
  for (let at = 0; at < Math.min(MAX_LOOKUPS, games.length); at++) {
    const game = games[(start + at) % games.length];
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
        (0, jsx)(Video, { source: { uri: trailer.url }, muted: true, loop: true, resizeMode: "cover", style: { width: "100%", height: "100%" } })
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
