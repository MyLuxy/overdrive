// ../pub-game-store/native/browse/GenreCard.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { memo } from 'react';
import { GENRE_ART } from './genre-art.js';
import { useT } from '../i18n/index.js';
import { genreLabel } from '../state/catalog.js';
import { Cover } from '../ui/Cover.jsx';
import { FocusFrame } from '../ui/FocusRing.jsx';
import { POSTER_WIDTH } from '../ui/posterLayout.js';
import { px } from '../ui/scale.js';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { Image, Text, View, useFocus } from '@ps5-react/core';

  const W = POSTER_WIDTH;
  const H = W;
  const tile = { width: px(W), height: px(H), borderRadius: px(8),
    backgroundColor: "#17171a", overflow: "hidden" };
  const art = { width: px(W), height: px(H), borderRadius: px(8) };
  const caption = { width: px(W), height: px(74), paddingTop: 15 };
  var GenreCard = (0, memo)(function GenreCard2({ genre, count, covers, index, active: active2, onToggle, onReach, nextFocusUp, nextFocusDown, nextFocusLeft, nextFocusRight }) {
    const t2 = useT();
    const { focusedKey } = useFocus();
    const focused = focusedKey === 'genre:' + genre;
    return /* @__PURE__ */ (0, jsxs)(View, {
      focusKey: "genre:" + genre, nextFocusUp, nextFocusDown, nextFocusLeft, nextFocusRight,
      onFocus: () => onReach?.(index),
      onPress: () => onToggle(genre),
      selected: active2,
      style: { width: px(W), position: "relative", transform: focused ? [{ scale: 1.045 }] : [] },
      children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: tile, children: [
          GENRE_ART[genre]
            ? /* @__PURE__ */ (0, jsx)(Image, { source: GENRE_ART[genre], resizeMode: "contain", style: art })
            : covers[0] ? /* @__PURE__ */ (0, jsx)(Cover, { game: covers[0], style: art, label: false }) : null,
          (focused || active2) && /* @__PURE__ */ (0, jsx)(View, { pointerEvents: 'none',
            style: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
              borderRadius: px(8), borderWidth: focused ? 4 : 2,
              borderColor: focused ? '#ffffff' : '#e4b74c' } }),
          active2 && /* @__PURE__ */ (0, jsx)(View, { style: {
            position: "absolute", top: 12, right: 12, backgroundColor: "#f2f2f3",
            width: 29, height: 29, alignItems: "center", justifyContent: "center", borderRadius: 14999
          }, children: /* @__PURE__ */ (0, jsx)(Icon, { name: "check", size: 13, color: colors.canvas }) }),
          focused && /* @__PURE__ */ (0, jsx)(FocusFrame, { round: "lg" })
        ] }),
        /* @__PURE__ */ (0, jsxs)(View, { style: caption, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: {
            fontFamily: "Inter-Regular", fontSize: 23, fontWeight: focused || active2 ? 700 : 400,
            color: focused || active2 ? "#ffffff" : "#f2f2f3e6",
            numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30
          }, children: genreLabel(genre) }),
          /* @__PURE__ */ (0, jsx)(Text, { style: {
            fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94",
            numberOfLines: 1, lineHeight: 30
          }, children: t2("catalog.gameCount", { count }) })
        ] })
      ]
    });
  });

export { GenreCard };
