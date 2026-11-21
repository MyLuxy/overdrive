// ../pub-game-store/native/game/OptionsSheet.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';
import { FocusRing } from '../ui/FocusRing.jsx';
import { Icon } from '../ui/Icon.jsx';
import { SideSheet } from '../ui/SideSheet.jsx';
import { colors } from '../ui/colors.js';
import { Text, View, useIsFocused } from '@ps5-react/core';

  function OptionFace({ icon, label, detail: detail2 }) {
    const focused = useIsFocused();
    const ink2 = focused ? colors.fg : colors.muted;
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 18, color: ink2 }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 3 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: "#f2f2f3" }, children: label }),
        /* @__PURE__ */ (0, jsx)(Text, { style: [{ width: 600, fontFamily: "Inter-Regular", fontSize: 21, numberOfLines: 2, ellipsizeMode: "tail", lineHeight: 30 }, { color: ink2 }], children: detail2 })
      ] })
    ] });
  }
  var ARM_MS3 = 3e3;
  function Option({ item, autoFocus, onClose }) {
    const [armed, setArmed] = (0, useState)(false);
    (0, useEffect)(() => {
      if (!armed) return void 0;
      const timer = setTimeout(() => setArmed(false), ARM_MS3);
      return () => clearTimeout(timer);
    }, [armed]);
    const press3 = () => {
      if (item.armed && !armed) {
        setArmed(true);
        return;
      }
      if (!item.next) onClose();
      item.onSelect();
    };
    const face = armed ? { ...item, ...item.armed } : item;
    return /* @__PURE__ */ (0, jsx)(View, { autoFocus, onPress: press3, onBlur: () => setArmed(false), style: (_state) => [{ position: "relative", flexDirection: "row", alignItems: "center", gap: 18, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 18 }, _state.focused ? { backgroundColor: "#212125" } : null], children: /* @__PURE__ */ (0, jsx)(OptionFace, { icon: face.icon, label: face.label, detail: face.detail }) });
  }
  function OptionsSheet({ title, items, onClose }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsx)(SideSheet, { title: t2("download.optionsTitle"), subtitle: title, onClose, children: /* @__PURE__ */ (0, jsx)(View, { style: { gap: 6, padding: 9 }, children: items.map((item, index) => /* @__PURE__ */ (0, jsx)(Option, { item, autoFocus: index === 0, onClose }, item.label)) }) });
  }

export { OptionsSheet };
