// ../pub-game-store/native/ui/Skeleton.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { View, motion } from '@ps5-react/core';

  var BLOCK = { backgroundColor: "#212125", borderRadius: 9 };
  var pulse = {
    initial: { opacity: 1 },
    animate: { opacity: 0.5 },
    transition: { type: "tween", duration: 0.9, ease: "easeInOut", repeat: Infinity, repeatType: "reverse" }
  };
  function Skeleton({ style, pulse: pulsing = false }) {
    if (!pulsing) return /* @__PURE__ */ (0, jsx)(View, { style: [BLOCK, style] });
    return /* @__PURE__ */ (0, jsx)(motion.View, { ...pulse, style: [BLOCK, style] });
  }

export { Skeleton };
