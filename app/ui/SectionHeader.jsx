// ../pub-game-store/native/ui/SectionHeader.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useT } from '../i18n/index.js';
import { FocusRing } from './FocusRing.jsx';
import { Icon } from './Icon.jsx';
import { colors } from './colors.js';
import { Text, View, useIsFocused } from '@ps5-react/core';

  function SeeAll() {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, focused ? { color: "#f2f2f3" } : null], children: t2("common.seeAll") }),
      /* @__PURE__ */ (0, jsx)(Icon, { name: "chevronRight", color: focused ? colors.fg : colors.muted })
    ] });
  }
  function SectionHeader({ title, onSeeAll, focusKey, nextFocusUp }) {
    return /* @__PURE__ */ (0, jsxs)(View, { style: { marginBottom: 24, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 }, children: title }),
      onSeeAll && /* @__PURE__ */ (0, jsx)(View, { onPress: onSeeAll, focusKey, nextFocusUp, style: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 6 }, children: /* @__PURE__ */ (0, jsx)(SeeAll, {}) })
    ] });
  }

export { SectionHeader };
