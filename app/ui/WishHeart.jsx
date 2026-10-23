// ../pub-game-store/native/ui/WishHeart.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx, jsxs } from 'react/jsx-runtime';
import { Icon } from './Icon.jsx';
import { colors } from './colors.js';
import { View, motion, transitions } from '@ps5-react/core';

  function WishHeart({ active: active2, color = colors.fg }) {
    return /* @__PURE__ */ (0, jsxs)(View, { style: { position: "relative", width: 24, height: 24, alignItems: "center", justifyContent: "center" }, children: [
      active2 && /* @__PURE__ */ (0, jsx)(
        motion.View,
        {
          style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 14999, borderWidth: 2, borderColor: "#f2f2f3" },
          initial: { scale: 0.4, opacity: 0.7 },
          animate: { scale: 2.4, opacity: 0 },
          transition: { type: "tween", duration: 0.55, ease: "easeOut" }
        },
        "burst"
      ),
      /* @__PURE__ */ (0, jsx)(
        motion.View,
        {
          initial: active2 ? { scale: 1.45 } : false,
          animate: { scale: 1 },
          transition: transitions.pop,
          children: /* @__PURE__ */ (0, jsx)(Icon, { name: "star", color, fill: active2 ? color : "none" })
        },
        String(active2)
      )
    ] });
  }

export { WishHeart };
