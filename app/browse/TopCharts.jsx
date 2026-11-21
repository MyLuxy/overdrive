// ../pub-game-store/native/browse/TopCharts.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { games } from '../data/catalog.js';
import { prefetchWhenSettled } from '../game/art.js';
import { latin, useLocale, useT } from '../i18n/index.js';
import { NO_FILTERS, formatCount, formatDate3, sortGames, sortLabel } from '../state/catalog.js';
import { shuffle } from './picks.js';
import { useNavActions } from '../state/nav.jsx';
import { useShowLibrary } from '../ui/useSections.js';
import { Cover } from '../ui/Cover.jsx';
import { FocusFrame } from '../ui/FocusRing.jsx';
import { SectionHeader } from '../ui/SectionHeader.jsx';
import { lightGame, unlight } from '../ui/lightBar.js';
import { Text, View } from '@ps5-react/core';

  // Each chart ranks the whole catalog, with no preference for Archive.org's games: the most reviewed
  // and the best rated are five drawn on every launch from the fifteen at the top, then ranked, so
  // the lists vary but stay the best; only the games that have that number take part. New releases
  // are the five newest.
  var TOP = 15;
  var RANK = {
    relevance: { has: (game) => game.recommendations > 0, compare: (a, b) => b.recommendations - a.recommendations },
    rating: { has: (game) => game.metacritic != null, compare: (a, b) => b.metacritic - a.metacritic }
  };
  function chartOf(id) {
    if (!RANK[id]) return sortGames(games, id).slice(0, 5);
    const { has, compare } = RANK[id];
    const top = games.filter(has).sort(compare).slice(0, TOP);
    return shuffle(top).slice(0, 5).sort(compare);
  }
  var CHARTS = ["relevance", "newest", "rating"].map((id) => ({ id, games: chartOf(id) }));
  var DETAIL = {
    relevance: (t2, game) => t2("browse.reviews", { count: formatCount(game.recommendations) }),
    newest: (t2, game) => formatDate3(game.releaseDate)
  };
  var thumb = { width: 66, height: 87, borderRadius: 9 };
  function Detail({ chart, game }) {
    const t2 = useT();
    if (chart !== "rating") return /* @__PURE__ */ (0, jsx)(Text, { style: { marginTop: 6, fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab" }, children: DETAIL[chart](t2, game) });
    return /* @__PURE__ */ (0, jsxs)(View, { style: { marginTop: 6, flexDirection: "row", alignItems: "center", gap: 9 }, children: [
      /* @__PURE__ */ (0, jsx)(View, { style: { borderRadius: 3, backgroundColor: "#f2f2f3", paddingHorizontal: 9 }, children: /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, fontWeight: 700, color: "#000000", lineHeight: 30 }, children: String(game.metacritic ?? "\u2014") }) }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab" }, children: "Metacritic" })
    ] });
  }
  function Row3({ rank, game, chart }) {
    const { rtl } = useLocale();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusFrame, {}),
      /* @__PURE__ */ (0, jsx)(Text, { style: { width: 18, fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: String(rank) }),
      /* @__PURE__ */ (0, jsx)(Cover, { game, style: thumb, label: false }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { width: 444, fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30 }, children: latin(rtl, game.title) }),
        /* @__PURE__ */ (0, jsx)(Detail, { chart, game })
      ] })
    ] });
  }
  function TopCharts() {
    useT();
    const { openGame } = useNavActions();
    const show = useShowLibrary();
    // "See all" opens Browse with the selected chart sorting, including Top rated.
    const seeAll = (id) => show(NO_FILTERS, id, "catalog:sort", "browse");
    return /* @__PURE__ */ (0, jsx)(View, { scrollAnchor: true, style: { marginBottom: -18, marginTop: -12, flexDirection: "row", gap: 48 }, children: CHARTS.map(
      (chart) => /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1 }, children: [
        /* @__PURE__ */ (0, jsx)(SectionHeader, { title: sortLabel(chart.id), onSeeAll: () => seeAll(chart.id) }),
        chart.games.map((game, index) => {
          const key = `chart:${chart.id}:${game.id}`;
          return /* @__PURE__ */ (0, jsx)(
            View,
            {
              focusKey: key,
              onPress: () => openGame(game.id, key),
              onFocus: () => {
                prefetchWhenSettled(game);
                lightGame(key, game);
              },
              onBlur: () => unlight(key),
              style: (_state) => [{ position: "relative", marginHorizontal: -12, flexDirection: "row", alignItems: "center", gap: 21, borderRadius: 12, padding: 12 }, _state.focused ? { backgroundColor: "#17171a" } : null],
              children: /* @__PURE__ */ (0, jsx)(Row3, { rank: index + 1, game, chart: chart.id })
            },
            game.id
          );
        })
      ] }, chart.id)
    ) });
  }

export { TopCharts };
