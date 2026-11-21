// ../pub-game-store/native/ui/Shine.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { px } from './scale.js';
import { View, motion, useIsFocused } from '@ps5-react/core';

  var CYCLE_MS = 5e3;
  var SETTLE_MS3 = 300;
  var sweep2 = { type: "tween", duration: 1.6, ease: [0.4, 0, 0.3, 1] };
  var band3 = { backgroundGradient: {
    type: "linear",
    angle: 115,
    stops: [
      { color: "#ffffff00", offset: 0.3 },
      { color: "#ffffff11", offset: 0.5 },
      { color: "#ffffff00", offset: 0.7 }
    ]
  } };
  function Shine({ width, round = "lg" }) {
    const focused = useIsFocused();
    const [pass, setPass] = (0, useState)(0);
    (0, useEffect)(() => {
      if (!focused) return void 0;
      let interval;
      const settle3 = setTimeout(() => {
        setPass(1);
        interval = setInterval(() => setPass((n) => n + 1), CYCLE_MS);
      }, SETTLE_MS3);
      return () => {
        clearTimeout(settle3);
        clearInterval(interval);
        setPass(0);
      };
    }, [focused]);
    if (!focused || pass === 0) return null;
    return /* @__PURE__ */ (0, jsx)(View, { style: round === "xl" ? { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden", borderRadius: 18 } : { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden", borderRadius: 12 }, children: /* @__PURE__ */ (0, jsx)(
      motion.View,
      {
        style: [{ position: "absolute", top: 0, bottom: 0, left: 0 }, [{ width: px(width) }, band3]],
        initial: { x: -0.7 * width },
        animate: { x: 0.7 * width },
        transition: sweep2
      },
      pass
    ) });
  }

export { Shine };
