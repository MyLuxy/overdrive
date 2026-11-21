// "Recently added": the games the catalog's importers added last (state/catalog.js addedAt), so a
// player sees the library grow. Its title opens the library sorted the same way. Games added before
// 2026-10-21 carry no date and never show here; with none, the row is not shown.

import { jsx } from 'react/jsx-runtime';
import { memo, useState } from 'react';
import { GameRail } from './GameRail.jsx';
import { games } from '../data/catalog.js';
import { useT } from '../i18n/index.js';
import { NO_FILTERS, addedAt, sortGames } from '../state/catalog.js';
import { useNavActions } from '../state/nav.jsx';
import { useStoreActions } from '../state/store.jsx';
import { GameCard } from '../ui/GameCard.jsx';
import { ART_AHEAD, FIRST_ART } from './GameRail.jsx';
import { RowCard, useRowWindow, useSectionShown } from './near.js';

  var WIDTH = 152;
  var COUNT = 25;
  var ADDED = sortGames(games.filter((game) => addedAt(game) && game.art.cover), "added").slice(0, COUNT);
  var AddedRail = (0, memo)(function AddedRail2() {
    const t2 = useT();
    const { openGame, focusLater } = useNavActions();
    const { setFilters, setQuery, setSort } = useStoreActions();
    // Covers load only up to a few cards past the furthest one reached, as in the other rows.
    const [reach, setReach] = (0, useState)(FIRST_ART);
    const row = useRowWindow();
    useSectionShown(ADDED.length > 0);
    if (!ADDED.length) return null;
    const seeAll = () => {
      setFilters(NO_FILTERS);
      setQuery("");
      setSort("added");
      focusLater("catalog:sort");
    };
    return /* @__PURE__ */ (0, jsx)(GameRail, { title: t2("browse.recentlyAdded"), onSeeAll: seeAll, seeAllKey: "added:all", children: ADDED.map((game, index) => {
      const key = `added:${game.id}`;
      return /* @__PURE__ */ (0, jsx)(RowCard, { far: row.far(index), children: /* @__PURE__ */ (0, jsx)(
        GameCard,
        {
          game,
          width: WIDTH,
          detailed: true,
          focusKey: key,
          rowEnd: index === ADDED.length - 1,
          deferArt: index >= reach,
          onFocus: () => {
            setReach((count) => Math.max(count, index + ART_AHEAD));
            row.reached(index);
          },
          onPress: () => openGame(game.id, key)
        }
      ) }, game.id);
    }) });
  });

export { AddedRail };
