// ../pub-game-store/native/ui/Toast.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useLocale } from '../i18n/index.js';
import { ButtonGlyph } from './ButtonHints.jsx';
import { Cover } from './Cover.jsx';
import { Icon } from './Icon.jsx';
import { colors } from './colors.js';
import { EASE_OUT } from './ease.js';
import { px } from './scale.js';
import { Text, View, motion } from '@ps5-react/core';

  var WIDTH7 = 400;
  var THUMB3 = { width: px(56), height: px(75), borderRadius: px(6) };
  var enter2 = { duration: 0.45, ease: EASE_OUT };
  var leave = { opacity: 0, x: 24, transition: { duration: 0.25, ease: "easeIn" } };
  var leaveRtl = { ...leave, x: -24 };
  function Toast({ game, icon, status, title, action, detail: detail2, failed = false, duration, inPage = false }) {
    const { rtl } = useLocale();
    const side2 = rtl ? "left-8" : "right-8";
    return /* @__PURE__ */ (0, jsx)(
      motion.View,
      {
        style: [{ position: "absolute", zIndex: 50, width: 600 }, rtl ? { left: 48 } : { right: 48 }, inPage ? { top: 18 } : { top: 114 }],
        initial: { opacity: 0, x: rtl ? -40 : 40 },
        animate: { opacity: 1, x: 0 },
        transition: enter2,
        exit: rtl ? leaveRtl : leave,
        children: /* @__PURE__ */ (0, jsxs)(View, { style: [
          { flexDirection: "row", alignItems: "center", gap: 24, overflow: "hidden", borderRadius: 18, borderWidth: 2, backgroundColor: "#17171a", padding: 18 },
          rtl ? { paddingLeft: 30 } : { paddingRight: 30 },
          failed ? { borderColor: "#f2f2f399" } : { borderColor: "#2a2a2f" }
        ], children: [
          game ? /* @__PURE__ */ (0, jsx)(Cover, { game, label: false, style: THUMB3 }) : null,
          /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 6 }, children: [
            /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 9 }, children: [
              /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 16, color: failed ? colors.fg : colors.muted }),
              /* @__PURE__ */ (0, jsx)(Text, { style: failed ? { fontFamily: "Inter-Regular", fontSize: 21, fontWeight: 600, color: "#f2f2f3", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30 } : { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30 }, children: status })
            ] }),
            /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 26, fontWeight: 600, color: "#f2f2f3", numberOfLines: 2, ellipsizeMode: "tail", lineHeight: 36 }, children: title }),
            action ? /* @__PURE__ */ (0, jsxs)(View, { style: { marginTop: 3, flexDirection: "row", alignItems: "center", gap: 9 }, children: [
              /* @__PURE__ */ (0, jsx)(ButtonGlyph, { button: action.button }),
              /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3d9", lineHeight: 30 }, children: action.label })
            ] }) : detail2 ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: detail2 }) : null
          ] }),
          duration ? /* @__PURE__ */ (0, jsx)(
            motion.View,
            {
              style: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, backgroundColor: "#f2f2f380" },
              initial: { x: 0 },
              animate: { x: rtl ? WIDTH7 : -WIDTH7 },
              transition: { duration: duration / 1e3, ease: "linear" }
            }
          ) : null
        ] })
      }
    );
  }

export { Toast };
