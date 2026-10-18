// ../pub-game-store/native/search/index.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useRef, useState } from 'react';
import { SPAN_MAX, fitBytes } from '../i18n/fit.js';
import { useLocale, useT } from '../i18n/index.js';
import { Keyboard } from './Keyboard.jsx';
import { CARD_WIDTH3, COLUMNS3, NoResults, Suggestions } from './Suggestions.jsx';
import { rememberSearch } from './history.js';
import { searchGames } from './match.js';
import { useNavActions } from '../state/nav.jsx';
import { useQuery, useStoreActions } from '../state/store.jsx';
import { GameCard, useFavoriteAction } from '../ui/GameCard.jsx';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, ScrollView, Text, View, VirtualList, motion } from '@ps5-react/core';

  var CARD_HEIGHT2 = Math.round(CARD_WIDTH3 * 4 / 3) + 54;
  var SETTLE_MS4 = 150;
  var blink = { duration: 0.5, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" };
  function QueryField({ query }) {
    const t2 = useT();
    const { rtl } = useLocale();
    return /* @__PURE__ */ (0, jsxs)(View, { style: { width: 564, height: 84, flexDirection: "row", alignItems: "center", borderRadius: 14999, borderWidth: 2, borderColor: "#ffffff33", backgroundColor: "#ffffff0d", paddingHorizontal: 30 }, children: [
      /* @__PURE__ */ (0, jsx)(Icon, { name: "search", size: 20, color: colors.subtle }),
      query ? /* @__PURE__ */ (0, jsx)(Text, { style: [rtl ? { marginRight: 18, fontFamily: "Inter-Regular", fontSize: 27, color: "#f2f2f3", lineHeight: 36 } : { marginLeft: 18, fontFamily: "Inter-Regular", fontSize: 27, color: "#f2f2f3", lineHeight: 36 }, { writingDirection: "ltr" }], children: query }) : null,
      /* @__PURE__ */ (0, jsx)(motion.View, { style: [{ width: 2, height: 30, backgroundColor: "#f2f2f3" }, query ? rtl ? { marginRight: 3 } : { marginLeft: 3 } : rtl ? { marginRight: 18 } : { marginLeft: 18 }], initial: { opacity: 1 }, animate: { opacity: 0 }, transition: blink }),
      query ? null : /* @__PURE__ */ (0, jsx)(Text, { style: rtl ? { marginRight: 6, fontFamily: "Inter-Regular", fontSize: 27, color: "#8a8a94", lineHeight: 36 } : { marginLeft: 6, fontFamily: "Inter-Regular", fontSize: 27, color: "#8a8a94", lineHeight: 36 }, children: t2("search.placeholder") })
    ] });
  }
  function useSettled(query) {
    const [settled, setSettled] = (0, useState)(query);
    const typed = Math.abs(query.length - settled.length) === 1;
    (0, useEffect)(() => {
      const id = setTimeout(() => setSettled(query), typed ? SETTLE_MS4 : 0);
      return () => clearTimeout(id);
    }, [query]);
    return typed ? settled : query;
  }
  // The first column of results and suggestions goes back to the keyboard on Left.
  var TO_KEYBOARD = "search-keyboard";
  function Results({ query, onOpenGame }) {
    const t2 = useT();
    const results = searchGames(query);
    if (!results.length) return /* @__PURE__ */ (0, jsx)(NoResults, { query: query.trim() });
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsxs)(Text, { style: { marginBottom: 6, paddingHorizontal: 12, fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 }, children: [
        fitBytes(t2("search.resultsFor", { query: query.trim() }), SPAN_MAX),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontWeight: 400, color: "#8a8a94" }, children: fitBytes(`  ${t2("catalog.gameCount", { count: results.length })}`, SPAN_MAX) })
      ] }),
      /* @__PURE__ */ (0, jsx)(ScrollView, { style: { flex: 1 }, children: /* @__PURE__ */ (0, jsx)(
        VirtualList,
        {
          style: { paddingHorizontal: 12, paddingTop: 18, paddingBottom: 48 },
          data: results,
          numColumns: COLUMNS3,
          itemHeight: CARD_HEIGHT2,
          rowGap: 16,
          columnGap: 16,
          keyExtractor: (game) => game.id,
          renderItem: ({ item: game, index }) => (
            // Right stops at the row's end instead of falling through to the header.
            /* @__PURE__ */ (0, jsx)(
              GameCard,
              {
                game,
                width: CARD_WIDTH3,
                onPress: () => onOpenGame(game),
                rowEnd: index % COLUMNS3 === COLUMNS3 - 1 || index === results.length - 1,
                rowStart: index % COLUMNS3 === 0 ? TO_KEYBOARD : void 0
              }
            )
          )
        }
      ) }, query)
    ] });
  }
  function SearchScreen({ onBack, onOpenGame }) {
    const query = useQuery();
    const settled = useSettled(query);
    const { setQuery } = useStoreActions();
    const favorite = useFavoriteAction();
    const { focusLater } = useNavActions();
    const current = (0, useRef)(query);
    current.current = query;
    const [on] = (0, useState)(() => ({
      submit: () => {
        rememberSearch(current.current);
        focusLater("search-results");
      },
      search: (term) => {
        setQuery(term);
        focusLater("search-results");
      },
      openGame: (game) => {
        rememberSearch(current.current);
        onOpenGame(game);
      }
    }));
    const back2 = () => {
      setQuery("");
      onBack();
      return true;
    };
    const onAction = (action) => {
      if (action === "l2") setQuery("");
      else if (action === "r2") on.submit();
      else
        return favorite(action);
      return true;
    };
    return /* @__PURE__ */ (0, jsx)(FocusScope, { autoFocus: true, onBack: back2, onAction, children: /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, flexDirection: "row", gap: 72, backgroundColor: "#000000", paddingHorizontal: 48, paddingTop: 48 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 36 }, children: [
        /* @__PURE__ */ (0, jsx)(QueryField, { query }),
        /* @__PURE__ */ (0, jsx)(Keyboard, { onChange: setQuery, onSubmit: on.submit, focusKey: TO_KEYBOARD })
      ] }),
      /* @__PURE__ */ (0, jsx)(View, { style: { flex: 1 }, children: /* @__PURE__ */ (0, jsx)(FocusScope, { focusKey: "search-results", children: settled.trim() ? /* @__PURE__ */ (0, jsx)(Results, { query: settled, onOpenGame: on.openGame }) : /* @__PURE__ */ (0, jsx)(Suggestions, { onSearch: on.search, onOpenGame: on.openGame }) }) })
    ] }) });
  }

export { SearchScreen };
