// ../pub-game-store/native/ui/ButtonHints.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { Path, Svg, Text, View } from '@ps5-react/core';
import { useT } from '../i18n/index.js';
import { colors } from './colors.js';
import { px } from './scale.js';

  var FACES = {
    cross: ["M7 7 17 17", "M17 7 7 17"],
    circle: ["M18 12a6 6 0 1 1-12 0a6 6 0 1 1 12 0"],
    triangle: ["M12 6 18.5 17H5.5Z"],
    square: ["M6.5 6.5h11v11h-11Z"]
  };
  var CAPS = { l1: ["L1"], r1: ["R1"], l2: ["L2"], r2: ["R2"], l1r1: ["L1", "R1"], l2r2: ["L2", "R2"] };
  function Face({ name, size }) {
    return /* @__PURE__ */ (0, jsxs)(Svg, { width: px(size), height: px(size), viewBox: "0 0 24 24", children: [
      /* @__PURE__ */ (0, jsx)(Path, { d: "M23 12a11 11 0 1 1-22 0a11 11 0 1 1 22 0", fill: colors.surface2 }),
      FACES[name].map(
        (d) => /* @__PURE__ */ (0, jsx)(Path, { d, fill: "none", stroke: colors.fg, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }, d)
      )
    ] });
  }
  function Cap({ label, size }) {
    return /* @__PURE__ */ (0, jsx)(View, { style: [{ alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#212125", paddingHorizontal: 9 }, { height: px(size) }], children: /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, fontWeight: 600, color: "#f2f2f3" }, children: label }) });
  }
  function ButtonGlyph({ button, size = 20 }) {
    if (FACES[button]) return /* @__PURE__ */ (0, jsx)(Face, { name: button, size });
    return /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", gap: 6 }, children: CAPS[button].map((cap) => /* @__PURE__ */ (0, jsx)(Cap, { label: cap, size }, cap)) });
  }
  function ButtonHints({ hints }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsx)(View, { style: { height: 60, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 30, paddingHorizontal: 48 }, children: hints.map(
      ({ button, label }) => /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 9 }, children: [
        /* @__PURE__ */ (0, jsx)(ButtonGlyph, { button, size: 16 }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: t2(label) })
      ] }, button)
    ) });
  }

export { ButtonGlyph, ButtonHints };
