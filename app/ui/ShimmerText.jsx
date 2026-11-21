// ../pub-game-store/native/ui/ShimmerText.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx, jsxs } from 'react/jsx-runtime';
import { useState } from 'react';
import { colors } from './colors.js';
import { logical, px } from './scale.js';
import { Text, View, motion } from '@ps5-react/core';

  var BAND = 100;
  var SWEEP_S = 2;
  var PAUSE_S = 1.6;
  var DIM = "a6";
  function ShimmerText({ textStyle, background = colors.canvas, children }) {
    const [width, setWidth] = (0, useState)(0);
    const veil = `${background}${DIM}`;
    const pause = (width + BAND) / SWEEP_S * PAUSE_S;
    const side2 = width + BAND + pause;
    return /* @__PURE__ */ (0, jsxs)(View, { style: { position: "relative", alignSelf: "flex-start", overflow: "hidden" }, children: [
      /* @__PURE__ */ (0, jsx)(
        Text,
        {
          style: [textStyle, { color: colors.fg }],
          numberOfLines: 1,
          onLayout: (event) => setWidth(Math.ceil(logical(event.layout.width))),
          children
        }
      ),
      width ? /* @__PURE__ */ (0, jsxs)(
        motion.View,
        {
          style: { position: "absolute", top: 0, bottom: 0, left: 0, flexDirection: "row" },
          initial: { x: -side2 - BAND - pause },
          animate: { x: width - side2 },
          transition: { type: "tween", duration: SWEEP_S + PAUSE_S, ease: "linear", repeat: Infinity },
          children: [
            /* @__PURE__ */ (0, jsx)(View, { style: { width: px(side2), backgroundColor: veil } }),
            /* @__PURE__ */ (0, jsx)(View, { style: { width: px(BAND), backgroundGradient: { type: "linear", angle: 90, stops: [
              { color: veil, offset: 0 },
              { color: `${background}00`, offset: 0.5 },
              { color: veil, offset: 1 }
            ] } } }),
            /* @__PURE__ */ (0, jsx)(View, { style: { width: px(side2), backgroundColor: veil } })
          ]
        },
        width
      ) : null
    ] });
  }

export { ShimmerText };
