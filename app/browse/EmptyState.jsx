// ../pub-game-store/native/browse/EmptyState.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useT } from '../i18n/index.js';
import { Button2 } from '../ui/Button.jsx';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { Text, View } from '@ps5-react/core';

  function copy(t2, query, onlyWishlist) {
    if (query) return { title: t2("catalog.empty.queryTitle", { query }), hint: t2("catalog.empty.queryHint") };
    if (onlyWishlist) return { title: t2("catalog.empty.wishlistTitle"), hint: t2("catalog.empty.wishlistHint") };
    return { title: t2("catalog.empty.filtersTitle"), hint: t2("catalog.empty.filtersHint") };
  }
  function EmptyState({ query, onlyWishlist, onClear }) {
    const t2 = useT();
    const { title, hint } = copy(t2, query, onlyWishlist);
    return /* @__PURE__ */ (0, jsxs)(View, { style: { marginTop: 36, alignItems: "center", paddingHorizontal: 36, paddingVertical: 120 }, children: [
      /* @__PURE__ */ (0, jsx)(Icon, { name: onlyWishlist ? "heart" : "searchX", size: 32, color: colors.subtle }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { marginTop: 24, fontFamily: "Inter-Regular", fontSize: 27, fontWeight: 600, color: "#f2f2f3", lineHeight: 42 }, children: title }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { marginTop: 6, width: 720, textAlign: "center", fontFamily: "Inter-Regular", fontSize: 24, color: "#a3a3ab", lineHeight: 36 }, children: hint }),
      /* @__PURE__ */ (0, jsx)(View, { style: { marginTop: 36 }, children: /* @__PURE__ */ (0, jsx)(Button2, { variant: "outline", label: t2("catalog.empty.browseAll"), focusKey: "catalog:empty", onPress: onClear }) })
    ] });
  }

export { EmptyState };
