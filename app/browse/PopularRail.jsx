// ../pub-game-store/native/browse/PopularRail.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { memo, useState } from 'react';
import { GameRail } from './GameRail.jsx';
import { games } from '../data/catalog.js';
import { useT } from '../i18n/index.js';
import { NO_FILTERS } from '../state/catalog.js';
import { FAMOUS, INDIE, picked, shuffle } from './picks.js';
import { useNavActions } from '../state/nav.jsx';
import { useStoreActions } from '../state/store.jsx';
import { GameCard } from '../ui/GameCard.jsx';
import { ART_AHEAD, FIRST_ART } from './GameRail.jsx';
import { RowCard, useRowWindow } from './near.js';

  var WIDTH4 = 152;
  // "You might like" (was the most popular, which only Archive.org's few games could reach): 25
  // games, new on every launch, from the hand-picked famous and indie ones and the rest of the
  // catalog's games that have art and a genre, so the row always has something worth opening.
  var PICKS = 25;
  function selectPicks() {
    const famous = picked(games, FAMOUS).slice(0, 10);
    const indie = picked(games, INDIE).slice(0, 5);
    const chosen = new Set([...famous, ...indie]);
    const others = shuffle(games.filter((game) => !chosen.has(game) && game.art.cover && game.art.hero && game.genres.length)).slice(0, PICKS - chosen.size);
    return shuffle([...famous, ...indie, ...others]);
  }
  var POPULAR = selectPicks();
  var FIRST_POPULAR = `popular:${POPULAR[0].id}`;
  var PopularRail = (0, memo)(function PopularRail2() {
    const t2 = useT();
    const { openGame, focusLater } = useNavActions();
    const { setFilters, setQuery, setSort } = useStoreActions();
    // Covers load only up to a few cards past the furthest one reached.
    const [reach, setReach] = (0, useState)(FIRST_ART);
    // And the ones far from where focus rests let theirs go.
    const row = useRowWindow();
    const seeAll = () => {
      setFilters(NO_FILTERS);
      setQuery("");
      setSort("newest");
      focusLater("catalog:sort");
    };
    return /* @__PURE__ */ (0, jsx)(GameRail, { title: t2("browse.forYou"), onSeeAll: seeAll, seeAllKey: "popular:all", children: POPULAR.map((game, index) => {
      const key = `popular:${game.id}`;
      return /* @__PURE__ */ (0, jsx)(RowCard, { far: row.far(index), children: /* @__PURE__ */ (0, jsx)(
        GameCard,
        {
          game,
          width: WIDTH4,
          detailed: true,
          focusKey: key,
          rowEnd: index === POPULAR.length - 1,
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

export { FIRST_POPULAR, PopularRail };
