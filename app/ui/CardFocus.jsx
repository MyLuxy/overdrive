// ../pub-game-store/native/ui/CardFocus.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { ShineBorder } from './FocusRing.jsx';
import { formatSize } from '../state/size.js';
import { px } from './scale.js';
import { AnimatePresence, Text, View, motion } from '@ps5-react/core';

  var SIZE = 2.6;
  var band2 = { backgroundGradient: {
    type: "linear",
    angle: 330,
    stops: [
      { color: "#ffffff00", offset: 0.6 },
      { color: "#ffffff38", offset: 0.7 },
      { color: "#ffffff00", offset: 1 }
    ]
  } };
  var cross = { type: "tween", duration: 0.75, ease: [0.25, 0.1, 0.25, 1] };
  var SETTLE_MS = 300;
  var fade2 = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { type: "tween", duration: 0.3, ease: [0, 0, 0.2, 1] }
  };
  function Glare({ width, height }) {
    const [settled, setSettled] = (0, useState)(false);
    (0, useEffect)(() => {
      const settle3 = setTimeout(() => setSettled(true), SETTLE_MS);
      return () => clearTimeout(settle3);
    }, []);
    if (!settled) return null;
    const travel = SIZE - 1;
    return /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden", borderRadius: 12 }, children: /* @__PURE__ */ (0, jsx)(
      motion.View,
      {
        style: [{ position: "absolute", left: 0, top: 0 }, [{ width: px(width * SIZE), height: px(height * SIZE) }, band2]],
        initial: { x: travel * width, y: travel * height },
        animate: { x: -travel * width, y: -travel * height },
        transition: cross
      }
    ) });
  }
  function CardFocus({ focused, width, height, platforms, sizeGb }) {
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      focused && /* @__PURE__ */ (0, jsx)(Glare, { width, height }),
      /* @__PURE__ */ (0, jsx)(AnimatePresence, { children: sizeGb != null && /* @__PURE__ */ (0, jsx)(motion.View, {
        ...fade2,
        style: { position: "absolute", bottom: 12, right: 12, height: px(18), paddingHorizontal: px(7),
          borderRadius: px(2.5), backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
        children: /* @__PURE__ */ (0, jsx)(Text, {
          style: { fontFamily: "Inter-Regular", fontSize: 16, fontWeight: 700, color: "#000000" },
          children: formatSize(sizeGb)
        })
      }, "size") }),
      /* @__PURE__ */ (0, jsx)(AnimatePresence, { children: focused && /* @__PURE__ */ (0, jsx)(ShineBorder, { radius: 8 }, "shine") })
    ] });
  }

export { CardFocus };
