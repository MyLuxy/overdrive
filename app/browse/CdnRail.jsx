// ../pub-game-store/native/browse/CdnRail.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import cdnCard from '../assets/cdn-card.png';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo } from 'react';
import { GameRail } from './GameRail.jsx';
import { RowCard, useRowWindow, useSectionShown } from './near.js';
import { games } from '../data/catalog.js';
import { useT } from '../i18n/index.js';
import { CDN_HOST, NO_FILTERS, onCdn, sortGames } from '../state/catalog.js';
import { useNavActions } from '../state/nav.jsx';
import { useStoreActions } from '../state/store.jsx';
import { FocusFrame } from '../ui/FocusRing.jsx';
import { DETAILED_CAPTION, GameCard } from '../ui/GameCard.jsx';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { EASE_OUT } from '../ui/ease.js';
import { px } from '../ui/scale.js';
import { Image, Text, View, motion, useIsFocused } from '@ps5-react/core';

  var WIDTH = 152;
  var TILE = { width: px(WIDTH * 2 + 24), height: px(Math.round(WIDTH * 4 / 3)), borderRadius: px(8) };
  var CAPTION2 = { width: px(WIDTH * 2 + 24), height: px(DETAILED_CAPTION) };
  var SERVED = sortGames(games.filter(onCdn), "relevance");
  var lift2 = { type: "tween", duration: 0.3, ease: EASE_OUT };
  function CollectionCard() {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsxs)(motion.View, { style: [{ position: "relative" }, TILE], initial: false, animate: { y: focused ? -6 : 0 }, transition: lift2, children: [
        /* @__PURE__ */ (0, jsx)(Image, { source: cdnCard, resizeMode: "cover", style: TILE }),
        /* @__PURE__ */ (0, jsx)(FocusFrame, { round: "lg" })
      ] }),
      /* @__PURE__ */ (0, jsxs)(View, { style: [{ paddingTop: 15 }, CAPTION2], children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, color: "#8a8a94", lineHeight: 24 }, children: t2("catalog.gameCount", { count: SERVED.length }) }),
        /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ marginTop: 6, fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: "#f2f2f3e6", lineHeight: 30 }, focused ? { color: "#f2f2f3" } : null], children: "Overdrive CDN" }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { marginTop: 9, flexDirection: "row", alignItems: "center", gap: 6 }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ fontFamily: "Inter-Regular", fontSize: 20, color: "#a3a3ab" }, focused ? { color: "#f2f2f3" } : null], children: t2("common.seeAll") }),
          /* @__PURE__ */ (0, jsx)(Icon, { name: "chevronRight", size: 14, color: focused ? colors.fg : colors.muted })
        ] })
      ] })
    ] });
  }
  var CdnRail = (0, memo)(function CdnRail2() {
    const { openGame, focusLater } = useNavActions();
    const { setFilters, setQuery } = useStoreActions();
    const row = useRowWindow();
    useSectionShown(SERVED.length > 0);
    if (!SERVED.length) return null;
    const browse = () => {
      setFilters({ ...NO_FILTERS, provider: [CDN_HOST] });
      setQuery("");
      focusLater("catalog:toggle:filters");
    };
    return /* @__PURE__ */ (0, jsxs)(GameRail, { title: "Overdrive CDN", onSeeAll: browse, seeAllKey: "cdn:all", children: [
      /* @__PURE__ */ (0, jsx)(View, { focusKey: "cdn:card", onPress: browse, children: /* @__PURE__ */ (0, jsx)(CollectionCard, {}) }),
      SERVED.map((game, index) => {
        const key = `cdn:${game.id}`;
        return /* @__PURE__ */ (0, jsx)(RowCard, { far: row.far(index), children: /* @__PURE__ */ (0, jsx)(
          GameCard,
          {
            game,
            width: WIDTH,
            detailed: true,
            focusKey: key,
            rowEnd: index === SERVED.length - 1,
            onFocus: () => row.reached(index),
            onPress: () => openGame(game.id, key)
          }
        ) }, game.id);
      })
    ] });
  });

export { CdnRail };
