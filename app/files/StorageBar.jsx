// ../pub-game-store/native/files/StorageBar.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { KINDS } from './scan.js';
import { useT } from '../i18n/index.js';
import { formatBytes } from '../state/size.js';
import { EASE_OUT } from '../ui/ease.js';
import { px } from '../ui/scale.js';
import { Text, View, motion } from '@ps5-react/core';

  var SHADE = { packages: "#d9d9de", images: "#a3a3ab", archives: "#76767f", extracted: "#5a5a62", other: "#46464d" };
  var OTHER_DATA = "#2b2b30";
  var lift3 = { type: "tween", duration: 0.18, ease: EASE_OUT };
  function Swatch({ color, label, size }) {
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 12 }, children: [
      /* @__PURE__ */ (0, jsx)(View, { style: [{ height: 12, width: 12, borderRadius: 14999 }, { backgroundColor: color }] }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, color: "#a3a3ab" }, children: label }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, color: "#8a8a94" }, children: size })
    ] });
  }
  function StorageBar({ usage, sums, focus: focus2, width }) {
    const t2 = useT();
    if (!usage?.total) return null;
    const share = (bytes) => Math.round(bytes / usage.total * width);
    const kinds = KINDS.filter((kind) => sums[kind.key].size > 0);
    const others = Math.max(0, usage.total - usage.free - sums.all.size);
    return /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 18 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: [{ height: 12, flexDirection: "row", overflow: "hidden", borderRadius: 14999, backgroundColor: "#17171a" }, { width: px(width) }], children: [
        kinds.map(
          (kind) => /* @__PURE__ */ (0, jsx)(
            motion.View,
            {
              initial: false,
              transition: lift3,
              animate: { opacity: !focus2 || focus2 === kind.key ? 1 : 0.55 },
              style: [{ height: 12 }, { width: px(Math.max(3, share(sums[kind.key].size))), backgroundColor: focus2 === kind.key ? "#ffffff" : SHADE[kind.key] }]
            },
            kind.key
          )
        ),
        /* @__PURE__ */ (0, jsx)(View, { style: [{ height: 12 }, { width: px(share(others)), backgroundColor: OTHER_DATA }] })
      ] }),
      /* @__PURE__ */ (0, jsxs)(View, { style: [{ flexDirection: "row", flexWrap: "wrap", columnGap: 30, rowGap: 6 }, { width: px(width) }], children: [
        kinds.map((kind) => /* @__PURE__ */ (0, jsx)(
          Swatch,
          {
            color: focus2 === kind.key ? "#ffffff" : SHADE[kind.key],
            label: t2(`files.kind.${kind.key}`),
            size: formatBytes(sums[kind.key].size)
          },
          kind.key
        )),
        /* @__PURE__ */ (0, jsx)(Swatch, { color: OTHER_DATA, label: t2("files.otherData"), size: formatBytes(others) })
      ] })
    ] });
  }

export { StorageBar };
