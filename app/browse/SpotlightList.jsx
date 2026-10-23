// ../pub-game-store/native/browse/SpotlightList.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { memo, useMemo } from 'react';
import { SLIDE_MS } from './useSlides.js';
import { focusEnd, focusStart, latin, useLocale } from '../i18n/index.js';
import { Cover } from '../ui/Cover.jsx';
import { WishBadge } from '../ui/GameCard.jsx';
import { setFavoriteTarget } from '../ui/favoriteFocus.js';
import { FocusFrame } from '../ui/FocusRing.jsx';
import { Shine } from '../ui/Shine.jsx';
import { lightGame, unlight } from '../ui/lightBar.js';
import { Text, View, motion, useIsFocused, useFocus } from '@ps5-react/core';

  var TRACK = 215;
  var cover2 = { height: "100%", aspectRatio: 0.75, borderRadius: 9 };
  function Progress({ left, paused }) {
    const { rtl } = useLocale();
    const sign = rtl ? -1 : 1;
    const x = -TRACK * left / SLIDE_MS * sign;
    return /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", left: 15, right: 15, bottom: 9, height: 3, overflow: "hidden", borderRadius: 14999, backgroundColor: "#ffffff1a" }, children: /* @__PURE__ */ (0, jsx)(
      motion.View,
      {
        style: { position: "absolute", top: 0, bottom: 0, left: 0, width: 332, backgroundColor: "#f2f2f3" },
        initial: { x: -TRACK * sign },
        animate: { x: paused ? x : 0 },
        transition: paused ? { type: "tween", duration: 0 } : { type: "tween", duration: left / 1e3, ease: "linear" }
      }
    ) });
  }
  function Title2({ title, active: active2 }) {
    const focused = useIsFocused();
    const { rtl } = useLocale();
    return /* @__PURE__ */ (0, jsx)(Text, { selected: active2 || focused, style: [{ width: 183, fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", numberOfLines: 2, ellipsizeMode: "tail", lineHeight: 30 }, active2 || focused ? { color: "#f2f2f3" } : null], children: latin(rtl, title) });
  }
  var Item = (0, memo)(function Item2({ game, index, active: active2, progress, select, hold }) {
    const { rtl } = useLocale();
    const { focusedKey } = useFocus();
    const focused = focusedKey === `spotlight:${index}`;
    return /* @__PURE__ */ (0, jsxs)(
      View,
      {
        focusKey: `spotlight:${index}`,
        selected: active2,
        nextFocusUp: index === 0 ? "nav:current" : void 0,
        ...focusStart(rtl, "spotlight:wish"),
        ...focusEnd(rtl, `spotlight:${index}`),
        onFocus: () => {
          select(index);
          hold(true);
          setFavoriteTarget('spotlight:' + index, game.id);
          lightGame(`spotlight:${index}`, game);
        },
        onBlur: () => {
          hold(false);
          unlight(`spotlight:${index}`);
        },
        onPress: () => select(index),
        style: [{ position: "relative", flex: 1, flexDirection: "row", alignItems: "center", gap: 21, borderRadius: 18, padding: 15 }, active2 ? { backgroundColor: "#17171a" } : null],
        children: [
          /* @__PURE__ */ (0, jsx)(Shine, { width: 260, round: "xl" }),
          /* @__PURE__ */ (0, jsx)(FocusFrame, { round: "xl" }),
          /* @__PURE__ */ (0, jsx)(Cover, { game, style: cover2, label: false }),
          /* @__PURE__ */ (0, jsx)(Title2, { title: game.title, active: active2 }),
          /* @__PURE__ */ (0, jsx)(WishBadge, { id: game.id, focused, compact: true, placement: 'row-end' }),
          progress && /* @__PURE__ */ (0, jsx)(Progress, { left: progress.left, paused: progress.paused })
        ]
      }
    );
  });
  function SpotlightList({ games: games2, slides }) {
    const { active: active2, left, paused, select, hold } = slides;
    const progress = (0, useMemo)(() => ({ left, paused }), [left, paused]);
    return /* @__PURE__ */ (0, jsx)(View, { style: { width: 355.8, gap: 6 }, children: games2.map(
      (game, index) => /* @__PURE__ */ (0, jsx)(
        Item,
        {
          game,
          index,
          active: index === active2,
          progress: index === active2 ? progress : null,
          select,
          hold
        },
        game.id
      )
    ) });
  }

export { SpotlightList };
