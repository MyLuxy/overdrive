// The favorites page (the header's Favorites item): the games and Homebrew apps kept with Triangle,
// newest first, by kind.

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SPAN_MAX, fitBytes } from '../i18n/fit.js';
import { useT } from '../i18n/index.js';
import { FAVORITE_KINDS, matchesFavoriteKind } from '../state/favorite-kinds.js';
import { NO_FILTERS, filterGames, sortGames } from '../state/catalog.js';
import { useNavActions } from '../state/nav.jsx';
import { useStore } from '../state/store.jsx';
import { EmptyState } from './EmptyState.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { DETAILED_CAPTION, GameCard, useFavoriteAction } from '../ui/GameCard.jsx';
import { FocusScope, ScrollView, Text, View, VirtualList, useIsFocused } from '@ps5-react/core';

  var COLUMNS = 6;
  var CARD_WIDTH = 182;
  var CARD_HEIGHT = 243 + DETAILED_CAPTION;
  var TITLE = { fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 };
  // The filter chosen; the page stays mounted under a game's page (index.jsx), so it survives a visit.
  var chosenKind = "all";
  function ChipLabel({ label, count, current }) {
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: current ? "#0d0d0f" : "#f2f2f3d9", lineHeight: 30 }, focused && !current ? { color: "#f2f2f3" } : null], children: label }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: current ? "#0d0d0f99" : "#8a8a94", lineHeight: 30 }, children: String(count) })
    ] });
  }
  function Chip({ id, label, count, current, onPress }) {
    return /* @__PURE__ */ (0, jsx)(View, { focusKey: `favorites-kind:${id}`, onPress, style: (state) => [
      { height: 60, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14999, paddingHorizontal: 24, backgroundColor: current ? "#f2f2f3" : "#17171a" },
      state.focused && !current ? { backgroundColor: "#2b2b30" } : null
    ], children: /* @__PURE__ */ (0, jsx)(ChipLabel, { label, count, current }) });
  }
  function Grid({ games: games2 }) {
    const { openGame } = useNavActions();
    const renderItem = (0, useCallback)(
      ({ item: game, index }) => /* @__PURE__ */ (0, jsx)(
        GameCard,
        {
          game,
          width: CARD_WIDTH,
          detailed: true,
          rowEnd: index % COLUMNS === COLUMNS - 1 || index === games2.length - 1,
          rowStart: index % COLUMNS === 0,
          onPress: () => openGame(game.id, `favorite:${game.id}`)
        }
      ),
      [games2, openGame]
    );
    return /* @__PURE__ */ (0, jsx)(VirtualList, { style: { marginTop: 36 }, data: games2, numColumns: COLUMNS, itemHeight: CARD_HEIGHT, rowGap: 40, columnGap: 24, initialNumRows: 3, keyExtractor: (game) => game.id, renderItem });
  }
  function FavoritesScreen({ onBack, onBrowse }) {
    const t2 = useT();
    const store = useStore();
    const [kind, setKind] = (0, useState)(chosenKind);
    const choose = (next) => {
      chosenKind = next;
      setKind(next);
    };
    const saved = (0, useMemo)(
      () => sortGames(filterGames({ filters: { ...NO_FILTERS, wishlist: true }, query: "", wishlist: store.wishlist }), "newest"),
      [store.wishlist]
    );
    const counts = (0, useMemo)(
      () => Object.fromEntries(FAVORITE_KINDS.map(({ id }) => [id, saved.filter((game) => matchesFavoriteKind(game, id)).length])),
      [saved]
    );
    const chips = FAVORITE_KINDS.filter(({ id }) => id === "all" || counts[id] > 0);
    const shown = kind === "all" ? saved : saved.filter((game) => matchesFavoriteKind(game, kind));
    // Removing the last favorite leaves the empty state; its button takes the focus.
    const { focusLater } = useNavActions();
    const listed = saved.length > 0;
    const listedBefore = (0, useRef)(listed);
    (0, useEffect)(() => {
      if (listedBefore.current && !listed) focusLater("catalog:empty");
      listedBefore.current = listed;
    }, [listed]);
    const onAction = useFavoriteAction();
    const back2 = () => {
      onBack();
      return true;
    };
    // Not a trap: Up from the chips reaches the header, as on Homebrew, Downloads and Files.
    return /* @__PURE__ */ (0, jsx)(FocusScope, { autoFocus: true, onBack: back2, onAction, children: /* @__PURE__ */ (0, jsxs)(ScrollView, { style: { flex: 1, paddingHorizontal: 48, paddingTop: 48, paddingBottom: 96 }, children: [
      /* @__PURE__ */ (0, jsx)(View, { scrollAnchor: true, children: /* @__PURE__ */ (0, jsxs)(Text, { style: TITLE, children: [
        fitBytes(t2("catalog.favorites"), SPAN_MAX),
        saved.length ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontWeight: 400, color: "#8a8a94" }, children: fitBytes(`  ${t2("catalog.gameCount", { count: saved.length })}`, SPAN_MAX) }) : null
      ] }) }),
      saved.length ? /* @__PURE__ */ (0, jsx)(FocusScope, { row: true, children: /* @__PURE__ */ (0, jsx)(View, { style: { marginTop: 36, flexDirection: "row", flexWrap: "wrap", gap: 12 }, children: chips.map(
        ({ id, label }) => /* @__PURE__ */ (0, jsx)(Chip, { id, label: t2(label), count: counts[id], current: kind === id, onPress: () => choose(id) }, id)
      ) }) }) : null,
      saved.length ? /* @__PURE__ */ (0, jsx)(Grid, { games: shown }, kind) : /* @__PURE__ */ (0, jsx)(EmptyState, { onlyWishlist: true, onClear: onBrowse })
    ] }) });
  }

export { FavoritesScreen };
