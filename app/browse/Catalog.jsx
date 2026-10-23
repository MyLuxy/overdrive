// ../pub-game-store/native/browse/Catalog.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from './EmptyState.jsx';
import { BrowseTools } from './BrowseTools.jsx';
import { ButtonGlyph } from '../ui/ButtonHints.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { rememberSearch } from '../search/history.js';
import { SPAN_MAX, fitBytes } from '../i18n/fit.js';
import { useT } from '../i18n/index.js';
import { activeCount, filterGames, sortGames } from '../state/catalog.js';
import { useHomebrew } from '../state/homebrew.js';
import { useNavActions } from '../state/nav.jsx';
import { useStore } from '../state/store.jsx';
import { browseFullLibrary } from '../ui/useSections.js';
import { DETAILS_HEIGHT, GameCard } from '../ui/GameCard.jsx';
import { POSTER_WIDTH, POSTER_ROW_GAP } from '../ui/posterLayout.js';
import { logical, px } from '../ui/scale.js';
import { FocusScope, Image, ReleaseImages, ScrollView, Text, View, VirtualList, useIsFocused } from '@ps5-react/core';

  var TOP_COLUMNS = 5;
  var FULL_COLUMNS = 7;
  var PANEL_HEIGHT = px(530);
  var BATCH = FULL_COLUMNS * 8;
  var CARD_WIDTH = POSTER_WIDTH;
  var GRID_WIDTH = FULL_COLUMNS * px(CARD_WIDTH) + (FULL_COLUMNS - 1) * px(12);
  var COVER_HEIGHT = px(Math.round(CARD_WIDTH * 4 / 3));
  var CARD_HEIGHT = COVER_HEIGHT + DETAILS_HEIGHT;
  var FIRST = FULL_COLUMNS * 3;
  var STEP = FULL_COLUMNS;
  var AHEAD = [2, 5];
  var SETTLE_MS2 = 200;
  var fetched = /* @__PURE__ */ new Set();
  var coverBox = { width: px(CARD_WIDTH), height: px(Math.round(CARD_WIDTH * 4 / 3)), resizeMode: "cover" };
  function prefetchBelow(games2, index, panel, timer) {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => prefetchRows(games2, index, panel), SETTLE_MS2);
  }
  function prefetchRows(games2, index, panel) {
    const columns = panel ? TOP_COLUMNS : FULL_COLUMNS;
    const row = Math.floor(index / columns);
    const start = (row + AHEAD[0]) * columns;
    const end = (row + AHEAD[1]) * columns;
    for (const game of games2.slice(start, end)) {
      if (!game.art.cover || fetched.has(game.id)) continue;
      fetched.add(game.id);
      Image.prefetch(game.art.cover, coverBox).catch(() => fetched.delete(game.id));
    }
  }
  // Use reference equality for unchanged grids; fall back to element comparison when needed.
  var sameGrid = (a, b) => a.signature === b.signature &&
    a.interactive === b.interactive &&
    a.columns === b.columns &&
    a.searchQuery === b.searchQuery &&
    (a.games === b.games || (a.games.length === b.games.length &&
      a.games.every((game, i) => game === b.games[i])));
  var Grid = (0, memo)(function Grid2({ games: games2, columns = FULL_COLUMNS, searchQuery, interactive = true }) {
    const { openGame } = useNavActions();
    const [limit, setLimit] = (0, useState)(BATCH);
    const [filled, setFilled] = (0, useState)(STEP);
    const prefetchTimer = (0, useRef)(null);
    // Cancel prefetch from stale results when switching grids.
    (0, useEffect)(() => () => clearTimeout(prefetchTimer.current), [games2, columns, interactive]);
    (0, useEffect)(() => {
      if (filled >= FIRST) return void 0;
      const id = setTimeout(() => setFilled((count) => count + STEP), 0);
      return () => clearTimeout(id);
    }, [filled]);
    const all = (0, useRef)(games2);
    all.current = games2;
    const panelLeftFocus = columns === TOP_COLUMNS
      ? (searchQuery !== null ? 'catalog:keyboard' : 'catalog:sort:newest')
      : null;
    // Keep separate grid instances so hidden focus nodes cannot shadow visible cards.
    const cardKey = (game) => (interactive ? 'card:' : 'cached:' + columns + ':') + game.id;
    const renderItem = (0, useCallback)(
      ({ item: game, index }) => /* @__PURE__ */ (0, jsx)(View, {
        scrollAnchor: index >= columns,
        style: { width: px(CARD_WIDTH), height: CARD_HEIGHT },
        children: /* @__PURE__ */ (0, jsx)(GameCard, {
          game,
          focusKey: cardKey(game),
          width: CARD_WIDTH,
          detailed: true,
          rowEnd: index % columns === columns - 1 || index === all.current.length - 1,
          rowStart: index % columns === 0 ? (panelLeftFocus || true) : void 0,
          nextFocusUp: index >= columns
            ? cardKey(all.current[index - columns])
            : (index === columns - 1 ? 'catalog:toggle:search' : 'catalog:toggle:filters'),
          nextFocusRight: index % columns === columns - 1 && index + 1 < all.current.length
            ? cardKey(all.current[index + 1]) : void 0,
          nextFocusLeft: index % columns === 0
            ? (panelLeftFocus ?? (index > 0 ? cardKey(all.current[index - 1]) : void 0))
            : void 0,
          // Keep vertical focus inside the grid rather than falling into the side panel.
          nextFocusDown: index + columns < all.current.length
            ? cardKey(all.current[index + columns]) : void 0,
          // Preserve mounted cards and stagger state when switching tool panels.
          enterDelay: void 0,
          onFocus: () => {
            if (!interactive) return;
            if (searchQuery?.trim().length > 3) rememberSearch(searchQuery);
            prefetchBelow(all.current, index, columns === TOP_COLUMNS, prefetchTimer);
          },
          onPress: () => openGame(game.id, `card:${game.id}`)
        })
      }),
      [openGame, columns, searchQuery, panelLeftFocus, interactive]
    );
    return /* @__PURE__ */ (0, jsx)(
      VirtualList,
      {
        style: { paddingTop: px(10) },
        data: games2.slice(0, filled < FIRST ? filled : limit),
        numColumns: columns,
        itemHeight: logical(CARD_HEIGHT),
        rowGap: POSTER_ROW_GAP,
        columnGap: 12,
        initialNumRows: 3,
        keyExtractor: (game) => game.id,
        onEndReached: () => setLimit((count) => count + BATCH),
        renderItem
      }
    );
  }, sameGrid);
  function PanelButton({ mode, label, shortcut, active, onPress, firstGameKey, upFocusKey }) {
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(View, {
      focusKey: 'catalog:toggle:' + mode,
      nextFocusUp: upFocusKey,
      nextFocusDown: firstGameKey,
      onPress,
      style: { position: 'relative', height: 44, paddingHorizontal: 14,
        flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 9,
        backgroundColor: active ? '#29292d' : focused ? '#202024' : '#151518',
        borderWidth: active ? 1 : 0, borderColor: '#686872' },
      children: [
        /* @__PURE__ */ (0, jsx)(FocusRing, {}),
        /* @__PURE__ */ (0, jsx)(ButtonGlyph, { button: shortcut, size: 18 }),
        /* @__PURE__ */ (0, jsx)(Text, {
          style: { fontFamily: 'Inter-Regular', fontSize: 19,
            color: active || focused ? '#f2f2f3' : '#a3a3ab' },
          children: label
        })
      ]
    });
  }
  function Catalog() {
    const t2 = useT();
    const store = useStore();
    const { browsePanel: panel, filters, query } = store;
    const { apps: homebrewApps } = useHomebrew();
    const { focusLater } = useNavActions();
    // Wishlist changes only invalidate results when filtering favorites.
    const wishlist = filters.wishlist ? store.wishlist : null;
    const results = (0, useMemo)(
      () => sortGames(filterGames(store), store.sort),
      [filters, query, wishlist, store.sort, store.favoriteKind, homebrewApps]
    );
    const signature = JSON.stringify([filters, query, store.sort, store.favoriteKind, homebrewApps.length]);
    // Keep both layouts mounted; the inactive layout releases its image pins.
    const cachedGrids = (0, useRef)({ wide: null, narrow: null }).current;
    const narrow = Boolean(panel);
    cachedGrids[narrow ? 'narrow' : 'wide'] = {
      games: results, signature, searchQuery: panel === 'search' ? query : null
    };
    const title = filters.wishlist ? t2("catalog.favorites") : t2("catalog.library");
    const activeFilters = activeCount(filters);
    // Leave Favorites scope before opening the full Library.
    const emptyState = /* @__PURE__ */ (0, jsx)(EmptyState, {
      query,
      onlyWishlist: filters.wishlist && activeFilters === 0,
      onClear: filters.wishlist ? () => browseFullLibrary({ focusFirstGame: true }) : store.resetBrowse
    });
    const togglePanel = (target) => {
      const next = panel === target ? null : target;
      store.setBrowsePanel(next);
      if (next) focusLater(next === "filters"
        ? ("catalog:sort:newest")
        : "catalog:keyboard");
      else if (results.length) focusLater('card:' + results[0].id);
    };
    const onAction = (action) => {
      if (action === "triangle") {
        store.resetBrowse();
        return true;
      }
      if (action === "l2" || action === "r2" || action === "options") {
        togglePanel(action === "l2" || action === "options" ? "filters" : "search");
        return true;
      }
      return false;
    };
    return /* @__PURE__ */ (0, jsx)(FocusScope, {
      restoreFocus: false, onAction,
      children: /* @__PURE__ */ (0, jsxs)(View, {
        scrollAnchor: true,
        children: [
          /* @__PURE__ */ (0, jsxs)(View, {
            style: { width: GRID_WIDTH, minHeight: 94, flexDirection: 'row',
              alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
            children: [
              /* @__PURE__ */ (0, jsxs)(View, {
                style: { flexDirection: 'column', alignItems: 'flex-start', gap: 0 },
                children: [
                  /* @__PURE__ */ (0, jsx)(Text, {
                    style: { fontFamily: "Inter-Regular", fontSize: 36, fontWeight: 700,
                      color: "#f2f2f3", lineHeight: 50, letterSpacing: -0.75 },
                    children: fitBytes(title, SPAN_MAX)
                  }),
                  /* @__PURE__ */ (0, jsx)(Text, {
                    style: { fontFamily: "Inter-Regular", fontSize: 24,
                      color: "#8a8a94", lineHeight: 32 },
                    children: fitBytes(t2("catalog.gameCount", { count: results.length }), SPAN_MAX)
                  })
                ]
              }),
              /* @__PURE__ */ (0, jsxs)(View, {
                style: { flexDirection: 'column', alignItems: 'flex-end', gap: 5 },
                children: [
                  /* @__PURE__ */ (0, jsxs)(View, {
                    style: { flexDirection: 'row', alignItems: 'center', gap: 18, marginTop: 44 },
                    children: [
                      /* @__PURE__ */ (0, jsx)(PanelButton, {
                        mode: 'filters', shortcut: 'l2',
                        upFocusKey: filters.wishlist ? 'nav:current' : void 0,
                        firstGameKey: results.length ? 'card:' + results[0].id : void 0,
                        label: t2('filters.title') + (activeFilters ? ' (' + activeFilters + ')' : ''),
                        active: panel === 'filters', onPress: () => togglePanel('filters')
                      }),
                      /* @__PURE__ */ (0, jsx)(PanelButton, {
                        mode: 'search', shortcut: 'r2', label: t2('nav.search'),
                        upFocusKey: filters.wishlist ? 'nav:current' : void 0,
                        active: panel === 'search', onPress: () => togglePanel('search')
                      })
                    ]
                  }),

                ]
              })
            ]
          }),
          /* Each poster layout remains mounted. The inactive one is collapsed,
           * inert to navigation and allowed to release its decoded image memory. */
          /* @__PURE__ */ (0, jsxs)(View, {
            style: { flexDirection: narrow ? 'row' : 'column',
              height: narrow ? PANEL_HEIGHT : void 0, flexShrink: 0, position: 'relative' },
            children: [
              /* @__PURE__ */ (0, jsxs)(View, {
                style: { display: narrow ? 'flex' : 'none', height: PANEL_HEIGHT,
                  flexDirection: 'row', flexShrink: 0 },
                children: [
                  narrow ? /* @__PURE__ */ (0, jsx)(BrowseTools, {
                    section: panel, height: PANEL_HEIGHT,
                    resultsFocusKey: results.length ? 'card:' + results[0].id : 'catalog:keyboard'
                  }) : null,
                  /* @__PURE__ */ (0, jsx)(ScrollView, {
                    style: { flex: 1, height: PANEL_HEIGHT },
                    children: /* @__PURE__ */ (0, jsx)(FocusScope, { inert: !narrow, children:
                      /* @__PURE__ */ (0, jsx)(ReleaseImages, { when: !narrow, children:
                        narrow && !results.length ? null
                          : cachedGrids.narrow ? /* @__PURE__ */ (0, jsx)(Grid, {
                              ...cachedGrids.narrow, columns: TOP_COLUMNS,
                              interactive: narrow
                            }) : null
                      })
                    })
                  })
                ]
              }),
              /* @__PURE__ */ (0, jsx)(View, {
                style: { display: narrow ? 'none' : 'flex' },
                children: /* @__PURE__ */ (0, jsx)(FocusScope, { inert: narrow, children:
                  /* @__PURE__ */ (0, jsx)(ReleaseImages, { when: narrow, children:
                    !narrow && !results.length ? null
                      : cachedGrids.wide ? /* @__PURE__ */ (0, jsx)(Grid, {
                          ...cachedGrids.wide, columns: FULL_COLUMNS,
                          interactive: !narrow
                        }) : null
                  })
                })
              }),
              !results.length ? /* @__PURE__ */ (0, jsx)(View, {
                style: { position: 'absolute', top: 0, left: 0, width: GRID_WIDTH },
                children: emptyState
              }) : null
            ]
          })
        ]
      })
    });
  }

export { Catalog };
