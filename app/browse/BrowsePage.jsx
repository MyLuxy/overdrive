// ../pub-game-store/native/browse/BrowsePage.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import '../assets/JetBrainsMono-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo } from 'react';

import { Catalog } from './Catalog.jsx';
import { CdnRail } from './CdnRail.jsx';
import { ContinueRow } from './ContinueRow.jsx';
import { GenreRail } from './GenreRail.jsx';
import { PageHints } from './PageHints.jsx';
import { FocusedSection, NearSection, headerSectionForFocus } from './near.js';
import { PopularRail } from './PopularRail.jsx';
import { RecentRow } from './RecentRow.jsx';
import { Spotlight } from './Spotlight.jsx';
import { TopCharts } from './TopCharts.jsx';
import { useT } from '../i18n/index.js';
import { edit } from '../search/edit.js';
import { useFolderInstall } from '../state/update.js';
import { useFavoriteAction } from '../ui/GameCard.jsx';
import { useStore } from '../state/store.jsx';
import { useNavActions } from '../state/nav.jsx';
import { Icon } from '../ui/Icon.jsx';
import { Logo } from '../ui/Logo.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, ReleaseImages, ScrollView, Text, View, useFocus } from '@ps5-react/core';

  function Footer() {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsxs)(View, { style: { marginHorizontal: -48, marginTop: 120, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 2, borderColor: "#2a2a2f", paddingHorizontal: 48, paddingVertical: 48 }, children: [
      /* @__PURE__ */ (0, jsx)(Logo, { color: colors.muted }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: t2("browse.footer") })
    ] });
  }
  var MIGRATE_GUIDE = "github.com/MyLuxy/overdrive";
  function FolderInstallNotice() {
    const t2 = useT();
    if (!useFolderInstall()) return null;
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 18, borderRadius: 18, borderWidth: 2, borderColor: "#2a2a2f", backgroundColor: "#17171a", paddingHorizontal: 30, paddingVertical: 18 }, children: [
      /* @__PURE__ */ (0, jsx)(Icon, { name: "alert", size: 18, color: colors.muted }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 3 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: t2("browse.folderInstall") }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "JetBrainsMono-Regular", fontSize: 21, color: "#f2f2f3", lineHeight: 30 }, children: MIGRATE_GUIDE })
      ] })
    ] });
  }
  // Keep Discover mounted across tab switches; hide it from focus and release off-screen images.
  var DiscoverContent = (0, memo)(function DiscoverContent2({ hidden }) {
    // Handle Square here because nested Discover focus scopes may not reach the outer page handler.
    const favorite = useFavoriteAction();
    const onAction = (action) => !hidden && action === 'square' && favorite(action);
    return /* @__PURE__ */ (0, jsx)(FocusScope, { inert: hidden, onAction, children:
      /* @__PURE__ */ (0, jsx)(ReleaseImages, { when: hidden, children:
        /* @__PURE__ */ (0, jsxs)(View, {
          style: { display: hidden ? 'none' : 'flex', gap: 60 },
          children: [
            /* @__PURE__ */ (0, jsx)(NearSection, { index: 0, children:
              /* @__PURE__ */ (0, jsxs)(View, { scrollAnchor: true, style: { gap: 24, paddingTop: 36 }, children: [
                /* @__PURE__ */ (0, jsx)(FolderInstallNotice, {}),
                /* @__PURE__ */ (0, jsx)(Spotlight, {})
              ] })
            }),
            /* @__PURE__ */ (0, jsx)(NearSection, { index: 1, children: /* @__PURE__ */ (0, jsx)(PopularRail, {}) }),
            /* @__PURE__ */ (0, jsx)(NearSection, { index: 2, children: /* @__PURE__ */ (0, jsx)(CdnRail, {}) }),
            /* @__PURE__ */ (0, jsx)(NearSection, { index: 3, children: /* @__PURE__ */ (0, jsx)(ContinueRow, {}) }),
            /* @__PURE__ */ (0, jsx)(NearSection, { index: 4, children: /* @__PURE__ */ (0, jsx)(RecentRow, {}) }),
            /* @__PURE__ */ (0, jsx)(NearSection, { index: 5, children: /* @__PURE__ */ (0, jsx)(TopCharts, {}) }),
            /* @__PURE__ */ (0, jsx)(NearSection, { index: 6, children: /* @__PURE__ */ (0, jsx)(GenreRail, {}) })
          ]
        })
      })
    });
  });

  var Sections = (0, memo)(function Sections2() {
    const favorite = useFavoriteAction();
    const store = useStore();
    const { focusLater } = useNavActions();
    const { focusedKey } = useFocus();
    const inLibrary = headerSectionForFocus(focusedKey) === 'browse';
    const onAction = (action) => {
      if ((action === 'l2' || action === 'r2') && inLibrary) {
        const target = action === 'l2' ? 'filters' : 'search';
        const next = store.browsePanel === target ? null : target;
        store.setBrowsePanel(next);
        if (next) focusLater(next === 'filters' ? ('catalog:sort:newest') : 'catalog:keyboard');
        return true;
      }
      if (action === 'square' && inLibrary && store.browsePanel === 'search' && !focusedKey?.startsWith('card:')) {
        store.setQuery((query) => edit(query, 'delete'));
        return true;
      }
      if (action === 'square') return favorite(action);
      return false;
    };
    // Remount the scroll container on Favorites transitions to avoid restoring an invalid offset.
    const favoritesOnly = store.filters.wishlist;
    return /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, onAction, children:
      /* @__PURE__ */ (0, jsxs)(ScrollView, {
        style: {
          flex: 1, gap: favoritesOnly ? 0 : 28, paddingHorizontal: 48,
          paddingTop: favoritesOnly ? 36 : 0
        },
        children: [
          /* @__PURE__ */ (0, jsx)(FocusedSection, {}),
          /* @__PURE__ */ (0, jsx)(DiscoverContent, { hidden: favoritesOnly }),
          /* @__PURE__ */ (0, jsx)(NearSection, { index: 7, keepImages: !favoritesOnly && store.browsePanel === 'search', children: /* @__PURE__ */ (0, jsx)(Catalog, {}) }),
          !favoritesOnly ? /* @__PURE__ */ (0, jsx)(Footer, {}) : null
        ]
      }, favoritesOnly ? 'favorites-scroll' : 'library-scroll')
    });


  });
  var BrowsePage = (0, memo)(function BrowsePage2() {
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(Sections, {}),
      /* @__PURE__ */ (0, jsx)(PageHints, {})
    ] });
  });

export { BrowsePage };
