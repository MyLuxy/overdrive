// ../pub-game-store/native/ui/Menu.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { createContext, useContext } from 'react';
import { useLocale } from '../i18n/index.js';
import { Icon } from './Icon.jsx';
import { colors } from './colors.js';
import { EASE_OUT } from './ease.js';
import { canScale } from './scale.js';
import { AnimatePresence, FocusScope, ScrollView, Text, View, motion, useIsFocused } from '@ps5-react/core';

  var CloseContext = (0, createContext)(null);
  var MAX_HEIGHT = 512;
  function Menu({ open, onClose, align = "left", rows, children }) {
    const { rtl } = useLocale();
    const left = align === "left" !== rtl;
    const pop = canScale(240, Math.min(rows * 36 + 8, MAX_HEIGHT)) ? 0.98 : 1;
    const close = () => {
      onClose();
      return true;
    };
    return /* @__PURE__ */ (0, jsx)(AnimatePresence, { children: open && /* @__PURE__ */ (0, jsx)(
      motion.View,
      {
        style: left ? { position: "absolute", left: 0, top: "100%", zIndex: 50, marginTop: 9, width: 360, borderRadius: 12, borderWidth: 2, borderColor: "#2a2a2f", backgroundColor: "#17171a", padding: 6, transformOrigin: [0, 0] } : { position: "absolute", right: 0, top: "100%", zIndex: 50, marginTop: 9, width: 360, borderRadius: 12, borderWidth: 2, borderColor: "#2a2a2f", backgroundColor: "#17171a", padding: 6, transformOrigin: [1, 0] },
        initial: { opacity: 0, y: -6, scale: pop },
        animate: { opacity: 1, y: 0, scale: 1 },
        exit: { opacity: 0, y: -4, transition: { type: "tween", duration: 0.1, ease: "easeIn" } },
        transition: { type: "tween", duration: 0.18, ease: EASE_OUT },
        children: /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, onBack: close, children: /* @__PURE__ */ (0, jsx)(ScrollView, { style: { maxHeight: 768 }, children: /* @__PURE__ */ (0, jsx)(CloseContext.Provider, { value: onClose, children }) }) })
      },
      "menu"
    ) });
  }
  function ItemContent({ label, checked }) {
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(Text, { focused, selected: checked, style: [{ flex: 1, fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30 }, checked ? { color: "#f2f2f3" } : null, focused ? { color: "#f2f2f3" } : null], children: label }),
      checked && /* @__PURE__ */ (0, jsx)(Icon, { name: "check", color: colors.fg })
    ] });
  }
  function MenuItem({ label, checked = false, autoFocus = false, onSelect }) {
    const close = (0, useContext)(CloseContext);
    return /* @__PURE__ */ (0, jsx)(View, { autoFocus: checked || autoFocus, onPress: () => {
      onSelect();
      close();
    }, style: (_state) => [{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 36, borderRadius: 9, paddingHorizontal: 18, paddingVertical: 12 }, _state.focused ? { backgroundColor: "#2b2b30" } : null], children: /* @__PURE__ */ (0, jsx)(ItemContent, { label, checked }) });
  }
  var MenuDivider = () => /* @__PURE__ */ (0, jsx)(View, { style: { marginVertical: 6, height: 2, backgroundColor: "#2a2a2f" } });

export { Menu, MenuDivider, MenuItem };
