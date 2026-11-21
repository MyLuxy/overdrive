// ../pub-game-store/native/browse/Catalog.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActiveFilters } from './ActiveFilters.jsx';
import { EmptyState } from './EmptyState.jsx';
import { SortSelect } from './SortSelect.jsx';
import { SPAN_MAX, fitBytes } from '../i18n/fit.js';
import { useLocale, useT } from '../i18n/index.js';
import { activeCount, filterGames, sortGames } from '../state/catalog.js';
import { useNavActions } from '../state/nav.jsx';
import { useStore } from '../state/store.jsx';
import { ButtonGlyph } from '../ui/ButtonHints.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { DETAILED_CAPTION, GameCard } from '../ui/GameCard.jsx';
import { px } from '../ui/scale.js';
import { FocusScope, Image, Text, View, VirtualList, useIsFocused } from '@ps5-react/core';

  var STAGGER = 0.03;
  var COLUMNS = 6;
  var BATCH = COLUMNS * 8;
  var CARD_WIDTH = 182;
  var CARD_HEIGHT = 243 + DETAILED_CAPTION;
  var FIRST = COLUMNS * 3;
  var STEP = 3;
  var AHEAD = [2, 5];
  var SETTLE_MS2 = 200;
  var fetched = /* @__PURE__ */ new Set();
  var settle2 = null;
  var coverBox = { width: px(CARD_WIDTH), height: px(Math.round(CARD_WIDTH * 4 / 3)), resizeMode: "cover" };
  function prefetchBelow(games2, index) {
    clearTimeout(settle2);
    settle2 = setTimeout(() => prefetchRows(games2, index), SETTLE_MS2);
  }
  function prefetchRows(games2, index) {
    const row = Math.floor(index / COLUMNS);
    for (const game of games2.slice((row + AHEAD[0]) * COLUMNS, (row + AHEAD[1]) * COLUMNS)) {
      if (!game.art.cover || fetched.has(game.id)) continue;
      fetched.add(game.id);
      Image.prefetch(game.art.cover, coverBox).catch(() => fetched.delete(game.id));
    }
  }
  var sameGrid = (a, b) => a.signature === b.signature && a.enter === b.enter && a.games.length === b.games.length && a.games.every((game, i) => game === b.games[i]);
  var Grid = (0, memo)(function Grid2({ games: games2, enter: enter3 }) {
    const { openGame } = useNavActions();
    const [limit, setLimit] = (0, useState)(BATCH);
    const [filled, setFilled] = (0, useState)(STEP);
    const entering = (0, useRef)(enter3);
    (0, useEffect)(() => {
      if (filled >= FIRST) {
        entering.current = false;
        return void 0;
      }
      const id = setTimeout(() => setFilled((count) => count + STEP), 0);
      return () => clearTimeout(id);
    }, [filled]);
    const all = (0, useRef)(games2);
    all.current = games2;
    const renderItem = (0, useCallback)(
      ({ item: game, index }) => /* @__PURE__ */ (0, jsx)(
        GameCard,
        {
          game,
          width: CARD_WIDTH,
          detailed: true,
          rowEnd: index % COLUMNS === COLUMNS - 1 || index === all.current.length - 1,
          rowStart: index % COLUMNS === 0,
          enterDelay: entering.current ? index * STAGGER : void 0,
          onFocus: () => prefetchBelow(all.current, index),
          onPress: () => openGame(game.id, `card:${game.id}`)
        }
      ),
      [openGame]
    );
    return /* @__PURE__ */ (0, jsx)(
      VirtualList,
      {
        style: { marginTop: 36 },
        data: games2.slice(0, filled < FIRST ? filled : limit),
        numColumns: COLUMNS,
        itemHeight: CARD_HEIGHT,
        rowGap: 40,
        columnGap: 24,
        initialNumRows: 3,
        keyExtractor: (game) => game.id,
        onEndReached: () => setLimit((count) => count + BATCH),
        renderItem
      }
    );
  }, sameGrid);
  function FiltersLabel({ count }) {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3d9", lineHeight: 30 }, focused ? { color: "#f2f2f3" } : null], children: t2("filters.title") }),
      count > 0 && /* @__PURE__ */ (0, jsx)(View, { style: { height: 30, minWidth: 30, alignItems: "center", justifyContent: "center", borderRadius: 14999, backgroundColor: "#f2f2f3", paddingHorizontal: 9 }, children: /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 18, fontWeight: 600, color: "#000000", lineHeight: 24 }, children: String(count) }) }),
      /* @__PURE__ */ (0, jsx)(ButtonGlyph, { button: "triangle", size: 18 })
    ] });
  }
  function Catalog({ onOpenFilters }) {
    const t2 = useT();
    const { rtl } = useLocale();
    const store = useStore();
    const { filters, query } = store;
    const results = (0, useMemo)(
      () => sortGames(filterGames(store), store.sort),
      [filters, query, store.wishlist, store.sort]
    );
    const settled = (0, useRef)(false);
    (0, useEffect)(() => {
      settled.current = true;
    }, []);
    const signature = JSON.stringify([filters, query, store.sort]);
    const title = query ? t2("catalog.resultsFor", { query }) : filters.wishlist ? t2("catalog.favorites") : t2("catalog.library");
    const filtersCount = activeCount(filters) - Number(filters.wishlist);
    const onAction = (action) => {
      if (action !== "triangle" && action !== "options") return false;
      onOpenFilters();
      return true;
    };
    return /* @__PURE__ */ (0, jsx)(FocusScope, { restoreFocus: false, onAction, children: /* @__PURE__ */ (0, jsxs)(View, { scrollAnchor: true, children: [
      /* @__PURE__ */ (0, jsxs)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 }, children: [
        fitBytes(title, SPAN_MAX),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontWeight: 400, color: "#8a8a94" }, children: fitBytes(`  ${t2("catalog.gameCount", { count: results.length })}`, SPAN_MAX) })
      ] }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { zIndex: 10, marginTop: 24, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 }, children: [
        /* @__PURE__ */ (0, jsx)(View, { focusKey: "catalog:filters", onPress: onOpenFilters, style: (_state) => [
          { height: 60, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14999, backgroundColor: "#17171a" },
          rtl ? { paddingRight: 24, paddingLeft: 18 } : { paddingLeft: 24, paddingRight: 18 },
          _state.focused ? { backgroundColor: "#2b2b30" } : null
        ], children: /* @__PURE__ */ (0, jsx)(FiltersLabel, { count: filtersCount }) }),
        /* @__PURE__ */ (0, jsx)(SortSelect, {}),
        /* @__PURE__ */ (0, jsx)(ActiveFilters, {})
      ] }),
      results.length > 0 ? /* @__PURE__ */ (0, jsx)(Grid, { games: results, signature, enter: settled.current }, signature) : /* @__PURE__ */ (0, jsx)(
        EmptyState,
        {
          query,
          onlyWishlist: filters.wishlist && activeCount(filters) === 1,
          onClear: store.clearFilters
        }
      )
    ] }) });
  }

export { Catalog };
