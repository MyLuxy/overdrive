// ../pub-game-store/native/browse/RecentRow.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { memo, useRef } from 'react';
import { GameRail } from './GameRail.jsx';
import { RowCard, useRowWindow, useSectionShown } from './near.js';
import { useT } from '../i18n/index.js';
import { getGame, listedId } from '../state/catalog.js';
import { useNavActions, useNavState } from '../state/nav.jsx';
import { useRecent } from '../state/recent.js';
import { GameCard } from '../ui/GameCard.jsx';

  function RecentRow() {
    return /* @__PURE__ */ (0, jsx)(Recent, { shown: useNavState().top.name === "browse" });
  }
  var Recent = (0, memo)(function Recent2({ shown }) {
    const t2 = useT();
    const recent2 = useRecent();
    const kept = (0, useRef)(recent2);
    if (shown) kept.current = recent2;
    const { openGame } = useNavActions();
    const row = useRowWindow();
    const games2 = [...new Set(kept.current.map(listedId))].map(getGame).filter(Boolean);
    useSectionShown(games2.length > 0);
    if (!games2.length) return null;
    return /* @__PURE__ */ (0, jsx)(GameRail, { title: t2("browse.recentlyViewed"), children: games2.map((game, index) => {
      const key = `recent:${game.id}`;
      return /* @__PURE__ */ (0, jsx)(RowCard, { far: row.far(index), children: /* @__PURE__ */ (0, jsx)(
        GameCard,
        {
          game,
          width: 162,
          detailed: true,
          focusKey: key,
          rowEnd: index === games2.length - 1,
          onFocus: () => row.reached(index),
          onPress: () => openGame(game.id, key)
        }
      ) }, game.id);
    }) });
  });

export { RecentRow };
