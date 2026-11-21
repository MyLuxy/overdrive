// ../pub-game-store/native/ui/FocusRing.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect } from 'react';
import { Animated, Easing, View, motion, useAnimatedValue, useIsFocused } from '@ps5-react/core';
import { px } from './scale.js';

  var SHINE_MS2 = 6e3;
  var shine = {
    type: "radial",
    width: px(1.5),
    size: 3,
    stops: [
      { color: "#ffffff00", offset: 0.25 },
      { color: "#ffffffc7", offset: 0.5 },
      { color: "#ffffff00", offset: 0.75 }
    ]
  };
  var fade = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { type: "tween", duration: 0.3, ease: [0, 0, 0.2, 1] }
  };
  var breathe = {
    initial: { opacity: 0.4 },
    animate: { opacity: 1 },
    transition: { type: "tween", duration: 2.8, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }
  };
  function ShineBorder({ radius }) {
    const angle = useAnimatedValue(0);
    (0, useEffect)(() => {
      const run = Animated.loop(Animated.timing(angle, { toValue: 360, duration: SHINE_MS2, easing: Easing.linear }));
      run.start();
      return () => run.stop();
    }, []);
    return /* @__PURE__ */ (0, jsx)(motion.View, { ...fade, pointerEvents: "none", style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, children: /* @__PURE__ */ (0, jsx)(Animated.View, { style: [{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, { borderRadius: px(radius), borderGradient: shine, borderGradientAngle: angle }] }) });
  }
  function Glow({ radius }) {
    const ring2 = (offset, color) => ({
      position: "absolute",
      left: -px(offset),
      top: -px(offset),
      right: -px(offset),
      bottom: -px(offset),
      borderRadius: px(radius + offset),
      borderWidth: px(3),
      borderColor: color
    });
    return /* @__PURE__ */ (0, jsxs)(motion.View, { ...breathe, style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, children: [
      /* @__PURE__ */ (0, jsx)(View, { style: ring2(3, "#ffffff59") }),
      /* @__PURE__ */ (0, jsx)(View, { style: ring2(6, "#ffffff21") })
    ] });
  }
  var RING_RADIUS = { full: 999, lg: 12, md: 10 };
  function FocusRing({ round = "md", halo = false, radius }) {
    const focused = useIsFocused();
    if (!focused) return null;
    if (halo) return /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, children: /* @__PURE__ */ (0, jsx)(Glow, { radius: radius ?? RING_RADIUS[round] }) });
    return /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: -7, right: -7, bottom: -7, left: -7 }, children: /* @__PURE__ */ (0, jsx)(ShineBorder, { radius: RING_RADIUS[round] }) });
  }
  function FocusFrame({ round = "lg" }) {
    const focused = useIsFocused();
    if (!focused) return null;
    return /* @__PURE__ */ (0, jsx)(ShineBorder, { radius: round === "2xl" ? 16 : round === "xl" ? 12 : 8 });
  }

export { FocusFrame, FocusRing, ShineBorder };
