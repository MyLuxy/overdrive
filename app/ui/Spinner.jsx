// A loading spinner: a faint ring with a bright quarter that turns, slowly enough to stay a small
// repaint (its box is far under the engine's transform buffer).

import { jsx, jsxs } from 'react/jsx-runtime';
import { colors } from './colors.js';
import { px } from './scale.js';
import { Path, Svg, motion } from '@ps5-react/core';

  var TURN = { rotate: 360 };
  var START = { rotate: 0 };
  var SPIN = { type: "tween", duration: 1.1, ease: "linear", repeat: Infinity };
  function Spinner({ size = 40 }) {
    return /* @__PURE__ */ (0, jsx)(motion.View, { initial: START, animate: TURN, transition: SPIN, style: { width: px(size), height: px(size) }, children: /* @__PURE__ */ (0, jsxs)(Svg, { width: px(size), height: px(size), viewBox: "0 0 24 24", children: [
      /* @__PURE__ */ (0, jsx)(Path, { d: "M22 12a10 10 0 1 1-20 0a10 10 0 1 1 20 0", fill: "none", stroke: "#2a2a2f", strokeWidth: 2.5 }),
      /* @__PURE__ */ (0, jsx)(Path, { d: "M12 2a10 10 0 0 1 10 10", fill: "none", stroke: colors.fg, strokeWidth: 2.5, strokeLinecap: "round" })
    ] }) });
  }

export { Spinner };
