// ../pub-game-store/native/browse/GameRail.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { FocusRing } from '../ui/FocusRing.jsx';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, ScrollView, Text, View, useIsFocused } from '@ps5-react/core';

  function TitleLink({ title }) {
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 }, children: title }),
      /* @__PURE__ */ (0, jsx)(Icon, { name: "chevronRight", size: 16, color: focused ? colors.fg : colors.muted })
    ] });
  }
  // A row scope: Left and Right stop at the rail's first and last card. Without one, a press past
  // the end looked for the nearest element across the whole page and could land at its top.
  var Arrow = ({ name }) => /* @__PURE__ */ (0, jsx)(View, { style: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 14999, backgroundColor: "#17171a" }, children: /* @__PURE__ */ (0, jsx)(Icon, { name, size: 16, color: colors.muted, fixed: true }) });
  var LTR = { direction: "ltr" };
  // A long row loads the art of its first cards (about a screen and a half of them) and, as focus moves
  // along it, of the cards up to ART_AHEAD past the furthest one reached: every image in use stays in the
  // decoded cache, and forty covers per row pushed the rest of the app's images out of it.
  var FIRST_ART = 10;
  var ART_AHEAD = 8;
  function GameRail({ title, onSeeAll, seeAllKey, children }) {
    return /* @__PURE__ */ (0, jsxs)(View, { scrollAnchor: true, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { marginBottom: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, children: [
        onSeeAll ? /* @__PURE__ */ (0, jsx)(View, { onPress: onSeeAll, focusKey: seeAllKey, style: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 9 }, children: /* @__PURE__ */ (0, jsx)(TitleLink, { title }) }) : /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 }, children: title }),
        /* @__PURE__ */ (0, jsxs)(View, { style: [{ flexDirection: "row", gap: 12 }, LTR], children: [
          /* @__PURE__ */ (0, jsx)(Arrow, { name: "chevronLeft" }),
          /* @__PURE__ */ (0, jsx)(Arrow, { name: "chevronRight" })
        ] })
      ] }),
      /* @__PURE__ */ (0, jsx)(View, { style: { marginHorizontal: -12, marginVertical: -24 }, children: /* @__PURE__ */ (0, jsx)(FocusScope, { row: true, children: /* @__PURE__ */ (0, jsx)(ScrollView, { style: [{ flexDirection: "row", gap: 36, paddingHorizontal: 12, paddingVertical: 24 }, LTR], children }) }) })
    ] });
  }

export { ART_AHEAD, FIRST_ART, GameRail };
