// ../pub-game-store/native/search/Suggestions.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { games } from '../data/catalog.js';
import { useT } from '../i18n/index.js';
import { forgetSearch, useSearchHistory } from './history.js';
import { NO_FILTERS, genreLabel } from '../state/catalog.js';
import { useNavActions } from '../state/nav.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { GameCard } from '../ui/GameCard.jsx';
import { Icon } from '../ui/Icon.jsx';
import { HINT, useHints } from '../ui/Legend.jsx';
import { colors } from '../ui/colors.js';
import { useShowLibrary } from '../ui/useSections.js';
import { FocusScope, ScrollView, Text, View, useIsFocused } from '@ps5-react/core';

  var CARD_WIDTH3 = 182;
  var COLUMNS3 = 4;
  var POPULAR2 = [...games].sort((a, b) => b.recommendations - a.recommendations).slice(0, 2 * COLUMNS3);
  var GENRES = Object.entries(games.flatMap((game) => game.genres).reduce((counts, genre) => ({ ...counts, [genre]: (counts[genre] ?? 0) + 1 }), {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([genre]) => genre);
  var RECENT_HINTS = [{ button: "cross", label: "hints.search" }, { button: "square", label: "hints.remove" }, HINT.clear, HINT.back];
  function PillFace2({ label, icon, hints }) {
    const focused = useIsFocused();
    useHints(focused ? hints : null);
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, { round: "full" }),
      /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 18, color: focused ? colors.fg : colors.muted }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 24, color: "#f2f2f3", lineHeight: 36 }, children: label })
    ] });
  }
  function Pill2({ label, icon, hints, onPress, onAction }) {
    return /* @__PURE__ */ (0, jsx)(FocusScope, { onAction, children: /* @__PURE__ */ (0, jsx)(View, { onPress, style: (_state) => [{ height: 72, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14999, backgroundColor: "#17171a", paddingHorizontal: 30 }, _state.focused ? { backgroundColor: "#212125" } : null], children: /* @__PURE__ */ (0, jsx)(PillFace2, { label, icon, hints }) }) });
  }
  var Title3 = ({ children }) => /* @__PURE__ */ (0, jsx)(Text, { style: { marginBottom: 24, fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 }, children });
  function Suggestions({ onSearch, onOpenGame }) {
    const t2 = useT();
    const recent2 = useSearchHistory();
    const { focusLater } = useNavActions();
    return /* @__PURE__ */ (0, jsxs)(ScrollView, { style: { flex: 1, paddingHorizontal: 12 }, children: [
      recent2.length > 0 ? /* @__PURE__ */ (0, jsxs)(View, { style: { marginBottom: 60 }, children: [
        /* @__PURE__ */ (0, jsx)(Title3, { children: t2("search.recent") }),
        /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", flexWrap: "wrap", gap: 18 }, children: recent2.map(
          (term) => /* @__PURE__ */ (0, jsx)(
            Pill2,
            {
              label: term,
              icon: "search",
              hints: RECENT_HINTS,
              onPress: () => onSearch(term),
              onAction: (action) => {
                if (action !== "square") return false;
                forgetSearch(term);
                focusLater("search-results");
                return true;
              }
            },
            term
          )
        ) })
      ] }) : null,
      /* @__PURE__ */ (0, jsx)(Title3, { children: t2("search.popular") }),
      /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", flexWrap: "wrap", gap: 24, paddingBottom: 48 }, children: POPULAR2.map(
        (game, index) => /* @__PURE__ */ (0, jsx)(
          GameCard,
          {
            game,
            width: CARD_WIDTH3,
            onPress: () => onOpenGame(game),
            rowEnd: index % COLUMNS3 === COLUMNS3 - 1,
            rowStart: index % COLUMNS3 === 0 ? "search-keyboard" : void 0
          },
          game.id
        )
      ) })
    ] });
  }
  function NoResults({ query }) {
    const t2 = useT();
    const showLibrary = useShowLibrary();
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, alignItems: "center", justifyContent: "center", gap: 18, paddingBottom: 144 }, children: [
      /* @__PURE__ */ (0, jsx)(Icon, { name: "searchX", size: 32, color: colors.subtle }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { width: 900, fontFamily: "Inter-Regular", fontSize: 27, fontWeight: 600, color: "#f2f2f3", textAlign: "center", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 42 }, children: t2("search.noMatch", { query }) }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 24, color: "#a3a3ab", lineHeight: 36 }, children: t2("search.tryGenre") }),
      /* @__PURE__ */ (0, jsx)(View, { style: { marginTop: 24, width: 960, flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 18 }, children: GENRES.map(
        (genre) => /* @__PURE__ */ (0, jsx)(
          Pill2,
          {
            label: genreLabel(genre),
            icon: "chevronRight",
            onPress: () => showLibrary({ ...NO_FILTERS, genre: [genre] }, "newest")
          },
          genre
        )
      ) })
    ] });
  }

export { CARD_WIDTH3, COLUMNS3, NoResults, Suggestions };
