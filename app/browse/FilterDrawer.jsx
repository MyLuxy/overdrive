// ../pub-game-store/native/browse/FilterDrawer.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo, useMemo, useRef, useState } from 'react';
import { formatNumber2 } from '../i18n/core.js';
import { useT } from '../i18n/index.js';
import { FACETS, activeCount, facetCounts, facetSummary, facetTitle, optionLabel } from '../state/catalog.js';
import { useNavActions } from '../state/nav.jsx';
import { useStore } from '../state/store.jsx';
import { Button2 } from '../ui/Button.jsx';
import { CdnAura, CdnSpark } from '../ui/CdnAura.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { useHints } from '../ui/Legend.jsx';
import { PlatformBadge } from '../ui/PlatformBadge.jsx';
import { SheetPanel } from '../ui/SideSheet.jsx';
import { EASE_OUT } from '../ui/ease.js';
import { AnimatePresence, FocusScope, ScrollView, Text, View, useIsFocused } from '@ps5-react/core';

  var WIDTH3 = 480;
  var slide = { type: "tween", duration: 0.24, ease: EASE_OUT };
  var TILE_LIMIT = 3;
  var PILL_LIMIT = 12;
  function TileFace({ facet, value, label, count, active: active2 }) {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      facet === "platform" ? /* @__PURE__ */ (0, jsx)(PlatformBadge, { platforms: [value] }) : /* @__PURE__ */ (0, jsx)(Text, { style: active2 ? { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: "#000000" } : { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: "#f2f2f3" }, children: label }),
      /* @__PURE__ */ (0, jsx)(Text, { style: active2 ? { fontFamily: "Inter-Regular", fontSize: 21, color: "#000000b3", lineHeight: 30 } : count === 0 ? { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a9499", lineHeight: 30 } : focused ? { fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", lineHeight: 30 } : { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: t2("catalog.gameCount", { count }) })
    ] });
  }
  var reachable2 = ({ count, active: active2 }) => count > 0 || active2;
  function Tile({ focusKey, autoFocus, compact = false, ...props }) {
    const { active: active2, onPress } = props;
    return /* @__PURE__ */ (0, jsx)(View, { focusKey, autoFocus, focusable: true, onPress, style: (_state) => active2 ? { height: compact ? 80 : 108, flex: 1, justifyContent: "center", gap: compact ? 4 : 9, borderRadius: 12, backgroundColor: "#f2f2f3", paddingHorizontal: compact ? 14 : 24 } : [{ height: compact ? 80 : 108, flex: 1, justifyContent: "center", gap: compact ? 4 : 9, borderRadius: 12, borderWidth: 2, borderColor: "#2a2a2f", paddingHorizontal: compact ? 14 : 24 }, _state.focused ? { backgroundColor: "#212125" } : null], children: /* @__PURE__ */ (0, jsx)(TileFace, { ...props }) });
  }
  function PillFace({ label, count, active: active2 }) {
    const focused = useIsFocused();
    const empty = count === 0 && !active2;
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, { round: "full" }),
      /* @__PURE__ */ (0, jsx)(Text, { style: active2 ? { fontFamily: "Inter-Regular", fontSize: 21, fontWeight: 600, color: "#000000", lineHeight: 30 } : empty ? { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a9499", lineHeight: 30 } : focused ? { fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", lineHeight: 30 } : { fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3d9", lineHeight: 30 }, children: label }),
      /* @__PURE__ */ (0, jsx)(Text, { style: active2 ? { fontFamily: "Inter-Regular", fontSize: 20, color: "#00000099" } : { fontFamily: "Inter-Regular", fontSize: 20, color: "#8a8a94" }, children: formatNumber2(count) })
    ] });
  }
  function Pill({ label, count, active: active2, onPress, focusKey, autoFocus, value, compact = false }) {
    const cdn = value === "overdrive cdn" && !active2;
    return /* @__PURE__ */ (0, jsxs)(View, { focusKey, autoFocus, focusable: true, onPress, style: (_state2) => active2 ? { height: compact ? 46 : 60, flexDirection: "row", alignItems: "center", gap: compact ? 8 : 12, borderRadius: 14999, backgroundColor: "#f2f2f3", paddingHorizontal: compact ? 14 : 24 } : cdn ? { position: "relative", height: compact ? 46 : 60, flexDirection: "row", alignItems: "center", gap: compact ? 8 : 12, borderRadius: 14999, backgroundColor: "#17171a", paddingHorizontal: compact ? 14 : 24 } : [{ height: compact ? 46 : 60, flexDirection: "row", alignItems: "center", gap: compact ? 8 : 12, borderRadius: 14999, backgroundColor: "#17171a", paddingHorizontal: compact ? 14 : 24 }, _state2.focused ? { backgroundColor: "#2b2b30" } : null], children: [
      cdn ? /* @__PURE__ */ (0, jsx)(CdnAura, { radius: 20, width: 170 }) : null,
      cdn ? /* @__PURE__ */ (0, jsx)(CdnSpark, { size: 14 }) : null,
      /* @__PURE__ */ (0, jsx)(PillFace, { label, count, active: active2 })
    ] });
  }
  function More({ count, onPress, compact = false }) {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(View, { focusable: true, onPress, style: (_state3) => [{ height: compact ? 46 : 60, flexDirection: "row", alignItems: "center", borderRadius: 14999, borderWidth: 2, borderColor: "#2a2a2f", paddingHorizontal: compact ? 14 : 24 }, _state3.focused ? { backgroundColor: "#2b2b30" } : null], children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, { round: "full" }),
      /* @__PURE__ */ (0, jsx)(Text, { style: focused ? { fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", lineHeight: 30 } : { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: t2("filters.more", { count }) })
    ] });
  }
  function ClearFacet({ onPress }) {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(View, { onPress, style: { borderRadius: 6, paddingHorizontal: 6 }, children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, { style: focused ? { fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", lineHeight: 30 } : { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: t2("filters.clearFacet") })
    ] });
  }
  function Facet({ facet, store, autoFocus, compact = false }) {
    const t2 = useT();
    const [expanded, setExpanded] = (0, useState)(false);
    const { focusLater } = useNavActions();
    // Facet counts depend on filters and query, not sort or panel state.
    const wishlist = store.filters.wishlist ? store.wishlist : null;
    const counts = (0, useMemo)(() => facetCounts(store, facet),
      [facet, store.filters, store.query, wishlist, store.favoriteKind]);

    const picked = store.filters[facet.key];
    const options = facet.options;
    const tiles = options.length <= TILE_LIMIT;
    const visibleLimit = compact && facet.key === 'genre' ? 8 : PILL_LIMIT;
    const folded = !tiles && !expanded && options.length > visibleLimit;
    const shown = folded ? options.filter((option, index) => index < visibleLimit || picked.includes(option.value)) : options;
    return /* @__PURE__ */ (0, jsxs)(View, { scrollAnchor: compact && facet.key === 'access', style: { gap: compact ? 10 : 18, paddingVertical: compact ? 15 : 30 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { height: compact ? 28 : 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, fontWeight: 600, color: "#a3a3ab", letterSpacing: 1.6 }, children: facetTitle(facet.key).toUpperCase() }),

      ] }),
      /* @__PURE__ */ (0, jsxs)(View, { style: tiles ? compact
        ? { flexDirection: "row", width: 462, marginLeft: 8, gap: 8 }
        : { flexDirection: "row", gap: 18 }
        : { flexDirection: "row", flexWrap: "wrap", gap: compact ? 7 : 12 }, children: [
        shown.map((option, index) => {
          const { value } = option;
          const props = {
            facet: facet.key,
            value,
            label: optionLabel(option),
            count: counts[value],
            active: picked.includes(value),
            onPress: () => store.toggleFilter(facet.key, value),
            focusKey: index === 0 ? `filters:${facet.key}` : `filters:${facet.key}:${value}`,
            autoFocus: index === 0 && autoFocus
          };
          return tiles ? /* @__PURE__ */ (0, jsx)(Tile, { ...props, compact }, value) : /* @__PURE__ */ (0, jsx)(Pill, { value, ...props, compact }, value);
        }),
        folded && /* @__PURE__ */ (0, jsx)(More, { compact, count: facet.options.length - shown.length, onPress: () => {
          setExpanded(true);
          focusLater(`filters:${facet.key}:${facet.options[visibleLimit].value}`);
        } })
      ] })
    ] });
  }
  var HINTS3 = [{ button: "cross", label: "hints.toggle" }, { button: "circle", label: "hints.close" }];
  function Panel({ onClose }) {
    useHints(HINTS3);
    const t2 = useT();
    const store = useStore();
    const { filters, clearFilters } = store;
    const { focusLater } = useNavActions();
    const count = activeCount(filters);
    const { total, counts } = facetSummary(store);
    const opened = (0, useRef)(JSON.stringify(filters));
    const close = () => {
      if (JSON.stringify(filters) !== opened.current) focusLater("catalog:filters");
      onClose();
      return true;
    };
    return (
      // A modal: the shoulder buttons would switch the header's section under it, so every action stops here.
      /* @__PURE__ */ (0, jsxs)(FocusScope, { trap: true, onBack: close, onAction: (action) => action !== "triangle" && action !== "options" || close(), children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { height: 96, flexDirection: "row", alignItems: "center", gap: 18 }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 }, children: t2("filters.title") }),
          count > 0 && /* @__PURE__ */ (0, jsx)(View, { style: { height: 36, minWidth: 36, alignItems: "center", justifyContent: "center", borderRadius: 14999, backgroundColor: "#f2f2f3", paddingHorizontal: 12 }, children: /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, fontWeight: 600, color: "#000000" }, children: String(count) }) }),
          /* @__PURE__ */ (0, jsx)(View, { style: { flex: 1 } }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: t2("catalog.gameCount", { count: total }) })
        ] }),
        /* @__PURE__ */ (0, jsxs)(ScrollView, { style: { marginHorizontal: -24, flex: 1, paddingHorizontal: 24 }, children: [
          FACETS.map((facet, index) => /* @__PURE__ */ (0, jsx)(Facet, { facet, store, counts: counts[facet.key], autoFocus: index === 0 }, facet.key)),
          /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 18, paddingBottom: 36, paddingTop: 30 }, children: [
            count > 0 && /* @__PURE__ */ (0, jsx)(Button2, { variant: "secondary", size: "lg", label: t2("filters.clearAll"), onPress: () => {
              clearFilters();
              focusLater(`filters:${FACETS[0].key}`);
            } }),
            /* @__PURE__ */ (0, jsx)(Button2, { variant: "primary", size: "lg", style: { flex: 1 }, label: t2("filters.show", { count: total }), onPress: close })
          ] })
        ] })
      ] })
    );
  }
  var FilterDrawer = (0, memo)(function FilterDrawer2({ open, onClose, onClosed }) {
    return /* @__PURE__ */ (0, jsx)(AnimatePresence, { onExitComplete: onClosed, children: open && /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 30 }, children: /* @__PURE__ */ (0, jsx)(
      SheetPanel,
      {
        style: { width: 720, paddingHorizontal: 36 },
        initial: { x: WIDTH3 },
        animate: { x: 0 },
        exit: { x: WIDTH3, transition: { ...slide, duration: 0.16 } },
        transition: slide,
        children: /* @__PURE__ */ (0, jsx)(Panel, { onClose })
      }
    ) }, "drawer") });
  });

export { Facet, FilterDrawer };
