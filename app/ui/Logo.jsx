// ../pub-game-store/native/ui/Logo.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { Path, Svg, Text, View } from '@ps5-react/core';
import { colors } from './colors.js';
import { px } from './scale.js';

  function Logo({ color = colors.fg, enlarged = false }) {
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: enlarged ? 14 : 12 }, children: [
      /* @__PURE__ */ (0, jsxs)(Svg, { width: px(enlarged ? 34 : 28), height: px(enlarged ? 34 : 28), viewBox: "0 0 32 32", children: [
        /* @__PURE__ */ (0, jsx)(Path, { d: "M26.34 12.24A11 11 0 1 1 19.76 5.66", fill: "none", stroke: color, strokeWidth: 4.5 }),
        /* @__PURE__ */ (0, jsx)(Path, { d: "M28.4 3.6 17.6 18.1a2.9 2.9 0 1 1-3.7-3.7Z", fill: color })
      ] }),
      /* @__PURE__ */ (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: enlarged ? 34 : 29, fontWeight: 600, letterSpacing: -0.85 }, { color }], children: "overdrive" })
    ] });
  }

export { Logo };
