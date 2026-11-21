// ../pub-game-store/native/browse/SortSelect.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo, useState } from 'react';
import { SPAN_MAX, fitBytes } from '../i18n/fit.js';
import { useLocale, useT } from '../i18n/index.js';
import { SORTS, sortLabel } from '../state/catalog.js';
import { useStoreActions, useStoreState } from '../state/store.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { Icon } from '../ui/Icon.jsx';
import { Menu, MenuItem } from '../ui/Menu.jsx';
import { colors } from '../ui/colors.js';
import { Text, View, motion, useIsFocused } from '@ps5-react/core';

  function Trigger({ sort, open }) {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, { round: "full" }),
      /* @__PURE__ */ (0, jsxs)(Text, { focused, style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, focused ? { color: "#f2f2f3d9" } : null], children: [
        fitBytes(t2("sort.label"), SPAN_MAX),
        /* @__PURE__ */ (0, jsx)(Text, { style: { color: "#f2f2f3" }, children: fitBytes(`  ${sortLabel(sort)}`, SPAN_MAX) })
      ] }),
      /* @__PURE__ */ (0, jsx)(
        motion.View,
        {
          initial: false,
          animate: { rotate: open ? 180 : 0 },
          transition: { type: "tween", duration: 0.2, ease: "easeOut" },
          children: /* @__PURE__ */ (0, jsx)(Icon, { name: "chevronDown", color: focused ? colors.fg : colors.muted })
        }
      )
    ] });
  }
  var SortSelect = (0, memo)(function SortSelect2() {
    const { rtl } = useLocale();
    const { sort } = useStoreState();
    const { setSort } = useStoreActions();
    const [open, setOpen] = (0, useState)(false);
    return /* @__PURE__ */ (0, jsxs)(View, { style: { position: "relative", zIndex: 10 }, children: [
      /* @__PURE__ */ (0, jsx)(View, { focusKey: "catalog:sort", selected: open, onPress: () => setOpen((value) => !value), style: (_state) => [
        { height: 60, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14999, backgroundColor: "#17171a" },
        rtl ? { paddingRight: 24, paddingLeft: 18 } : { paddingLeft: 24, paddingRight: 18 },
        open ? { backgroundColor: "#2b2b30" } : null,
        _state.focused ? { backgroundColor: "#2b2b30" } : null
      ], children: /* @__PURE__ */ (0, jsx)(Trigger, { sort, open }) }),
      /* @__PURE__ */ (0, jsx)(Menu, { open, onClose: () => setOpen(false), align: "left", rows: SORTS.length, children: SORTS.map(
        (option) => /* @__PURE__ */ (0, jsx)(
          MenuItem,
          {
            label: sortLabel(option.id),
            checked: sort === option.id,
            onSelect: () => setSort(option.id)
          },
          option.id
        )
      ) })
    ] });
  });

export { SortSelect };
