// ../pub-game-store/native/ui/PlatformBadge.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { G, Path, Svg, View } from '@ps5-react/core';
import { CAP2, WORDS } from './psLogotype.js';
import { px } from './scale.js';

  var H = 18;
  var W = 44;
  var SLANT = 5;
  var GAP = 2;
  var R = 2.5;
  var TYPE = 6.5;
  var STYLE = {
    ps5: { fill: "#ffffff", ink: "#000000", edge: "none" },
    ps4: { fill: "#000000b3", ink: "#ffffff", edge: "#ffffff" }
  };
  function segment(i, count) {
    const left = i === 0 ? null : i * W + GAP / 2, right = i === count - 1 ? null : (i + 1) * W - GAP / 2;
    const top = right == null ? `L${count * W - R} 0A${R} ${R} 0 0 1 ${count * W} ${R}L${count * W} ${H - R}A${R} ${R} 0 0 1 ${count * W - R} ${H}` : `L${right + SLANT / 2} 0L${right - SLANT / 2} ${H}`;
    const start = left == null ? `M0 ${R}A${R} ${R} 0 0 1 ${R} 0` : `M${left + SLANT / 2} 0`;
    const end = left == null ? `L${R} ${H}A${R} ${R} 0 0 1 0 ${H - R}Z` : `L${left - SLANT / 2} ${H}Z`;
    return start + top + end;
  }
  // `scale` draws the same badge larger, as the download choice's mark of the PS5.
  function PlatformBadge({ platforms, style, scale = 1 }) {
    const order = [...platforms].sort().reverse();
    const width = order.length * W;
    return /* @__PURE__ */ (0, jsx)(View, { style, children: /* @__PURE__ */ (0, jsx)(Svg, { width: px(width * scale), height: px(H * scale), viewBox: `0 0 ${width} ${H}`, children: order.map((platform, i) => {
      const { fill: fill2, ink: ink2, edge } = STYLE[platform];
      const word = WORDS[platform], scale = TYPE / CAP2;
      const x = i * W + (W - (word.right - word.left) * scale) / 2 - word.left * scale;
      return [
        /* @__PURE__ */ (0, jsx)(Path, { d: segment(i, order.length), fill: fill2, stroke: edge, strokeWidth: 1 }, `${platform}-box`),
        /* @__PURE__ */ (0, jsx)(G, { translateX: x, translateY: (H - TYPE) / 2, scale, children: /* @__PURE__ */ (0, jsx)(Path, { d: word.d, fill: ink2 }) }, `${platform}-text`)
      ];
    }) }) });
  }

export { PlatformBadge };
