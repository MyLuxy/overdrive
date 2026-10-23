// ../pub-game-store/native/ui/NavItem.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo } from 'react';
import { FocusRing } from './FocusRing.jsx';
import { Icon } from './Icon.jsx';
import { colors } from './colors.js';
import { Text, View, motion, useIsFocused } from '@ps5-react/core';

  function NavContent({ label, icon, iconFill, trailing, current, focusLabel, suppressActiveLabel, iconAfterLabel }) {
    const focused = useIsFocused();
    const showLabel = Boolean(focusLabel && (focused || (current && !suppressActiveLabel)));
    const color = current || focused ? colors.fg : "#f2f2f3a6";
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, { round: "full" }),
      icon && !iconAfterLabel && /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 18, color, fill: iconFill ? color : "none" }),
      label && (!focusLabel || !showLabel) && /* @__PURE__ */ (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 23 }, { color }], children: label }),
      showLabel && /* @__PURE__ */ (0, jsx)(motion.View, {
        initial: { opacity: 0, x: -14 },
        animate: { opacity: 1, x: 0 },
        transition: { type: "tween", duration: 0.22, ease: [0.16, 1, 0.3, 1] },
        style: { justifyContent: "center" },
        children: /* @__PURE__ */ (0, jsx)(Text, {
          style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.fg, numberOfLines: 1 },
          children: focusLabel
        })
      }, "focus-label"),
      icon && iconAfterLabel && /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 18, color, fill: iconFill ? color : "none" }),
      trailing && /* @__PURE__ */ (0, jsx)(Icon, { name: trailing, size: 14, color })
    ] });
  }
  var NavItem = (0, memo)(function NavItemView({ label, icon, iconFill, trailing, focusLabel, iconAfterLabel = false, suppressActiveLabel = false, compact = false, current = false, children, ...rest2 }) {
    return /* @__PURE__ */ (0, jsxs)(View, { ...rest2, style: { position: "relative", height: 60, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 14999, paddingHorizontal: compact ? 14 : 24 }, children: [
      /* @__PURE__ */ (0, jsx)(NavContent, { label, icon, iconFill, trailing, current, focusLabel, suppressActiveLabel, iconAfterLabel }),
      children
    ] });
  });

export { NavItem };
