// ../pub-game-store/native/browse/ActiveFilters.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo } from 'react';
import { useT } from '../i18n/index.js';
import { FACETS, facetLabel } from '../state/catalog.js';
import { useNavActions } from '../state/nav.jsx';
import { useQuery, useStoreActions, useStoreState } from '../state/store.jsx';
import { Chip } from '../ui/Chip.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { Text, View, useIsFocused } from '@ps5-react/core';

  function ClearAll() {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, focused ? { color: "#f2f2f3" } : null], children: t2("filters.clearAll") });
  }
  var ActiveFilters = (0, memo)(function ActiveFilters2() {
    const t2 = useT();
    const { filters } = useStoreState();
    const query = useQuery();
    const { setFilters, toggleFilter, setQuery, clearFilters } = useStoreActions();
    const { focusLater } = useNavActions();
    const chips = [
      query && { label: t2("filters.queryChip", { query }), remove: () => setQuery("") },
      filters.wishlist && { label: t2("filters.favorites"), remove: () => setFilters({ ...filters, wishlist: false }) },
      ...FACETS.flatMap(({ key }) => filters[key].map((value) => ({ label: facetLabel(key, value), remove: () => toggleFilter(key, value) })))
    ].filter(Boolean);
    if (!chips.length) return null;
    const remove = (index, action) => {
      const neighbour = chips[index + 1] ?? chips[index - 1];
      action();
      focusLater(neighbour ? `chip:${neighbour.label}` : "catalog:filters");
    };
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      chips.map(
        (chip, index) => /* @__PURE__ */ (0, jsx)(
          Chip,
          {
            focusKey: `chip:${chip.label}`,
            label: chip.label,
            onPress: () => remove(index, chip.remove)
          },
          chip.label
        )
      ),
      chips.length > 1 && /* @__PURE__ */ (0, jsxs)(View, { onPress: () => {
        clearFilters();
        focusLater("catalog:filters");
      }, style: (_state) => [{ height: 60, justifyContent: "center", borderRadius: 14999, paddingHorizontal: 24 }, _state.focused ? { backgroundColor: "#2b2b30" } : null], children: [
        /* @__PURE__ */ (0, jsx)(FocusRing, { round: "full" }),
        /* @__PURE__ */ (0, jsx)(ClearAll, {})
      ] })
    ] });
  });

export { ActiveFilters };
