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
import { Icon } from '../ui/Icon.jsx';
import { Shine } from '../ui/Shine.jsx';
import { colors } from '../ui/colors.js';
import { EASE_OUT } from '../ui/ease.js';
import { Image, Text, View, motion, useIsFocused } from '@ps5-react/core';

  var spread = { type: "tween", duration: 0.3, ease: EASE_OUT };
  var cover = { width: 126, height: 168, borderRadius: 12 };
  var side = { width: 113, height: 151, borderRadius: 12 };
  var front = { position: "absolute", left: 87, top: 24, zIndex: 10 };
  var OPEN = [-12.6, 12.6];
  // The sprite is drawn at the size it was baked at, centred in the space the covers take.
  var art = { position: "absolute", left: 78, top: 36, width: 144, height: 144 };
  function Fan({ covers }) {
    const focused = useIsFocused();
    return covers.slice(1).map(
      (game, index) => /* @__PURE__ */ (0, jsx)(
        motion.View,
        {
          style: index === 0 ? { position: "absolute", left: 18, top: 32 } : { position: "absolute", left: 169, top: 32 },
          initial: false,
          animate: { x: focused ? OPEN[index] : 0 },
          transition: spread,
          children: /* @__PURE__ */ (0, jsx)(Cover, { game, style: side, label: false })
        },
        game.id
      )
    );
  }
  var GenreCard = (0, memo)(function GenreCard2({ genre, count, covers, index, active: active2, onToggle, onReach }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsxs)(
      motion.View,
      {
        focusKey: `genre:${genre}`,
        onFocus: () => onReach?.(index),
        onPress: () => onToggle(genre),
        selected: active2,
        whileFocus: { y: -6 },
        transition: spread,
        style: (_state) => [{ width: 300, borderRadius: 18, backgroundColor: "#17171a", paddingHorizontal: 24, paddingBottom: 24, paddingTop: 216 }, active2 ? { backgroundColor: "#212125" } : null, _state.focused ? { backgroundColor: "#212125" } : null],
        children: [
          GENRE_ART[genre] ? /* @__PURE__ */ (0, jsx)(Image, { source: GENRE_ART[genre], resizeMode: "contain", style: art }) : /* @__PURE__ */ (0, jsx)(Fan, { covers }),
          !GENRE_ART[genre] && covers[0] && /* @__PURE__ */ (0, jsx)(Cover, { game: covers[0], style: [cover, front], label: false }),
          active2 && /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", right: 18, top: 18, zIndex: 20, width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 14999, backgroundColor: "#f2f2f3" }, children: /* @__PURE__ */ (0, jsx)(Icon, { name: "check", size: 14, strokeWidth: 3, color: colors.canvas }) }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 24, color: "#f2f2f3", lineHeight: 36 }, children: genreLabel(genre) }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: t2("catalog.gameCount", { count }) }),
          /* @__PURE__ */ (0, jsx)(Shine, { width: 200, round: "xl" }),
          /* @__PURE__ */ (0, jsx)(FocusFrame, { round: "xl" })
        ]
      }
    );
  });

export { GenreCard };
