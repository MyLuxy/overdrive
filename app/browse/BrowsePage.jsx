// ../pub-game-store/native/browse/BrowsePage.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import '../assets/JetBrainsMono-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo, useState } from 'react';
import { AddedRail } from './AddedRail.jsx';
import { Catalog } from './Catalog.jsx';
import { CdnRail } from './CdnRail.jsx';
import { ContinueRow } from './ContinueRow.jsx';
import { FilterDrawer } from './FilterDrawer.jsx';
import { GenreRail } from './GenreRail.jsx';
import { PageHints } from './PageHints.jsx';
import { FocusedSection, NearSection } from './near.js';
import { PopularRail } from './PopularRail.jsx';
import { RecentRow } from './RecentRow.jsx';
import { Spotlight } from './Spotlight.jsx';
import { TopCharts } from './TopCharts.jsx';
import { useT } from '../i18n/index.js';
import { StoreFreeze } from '../state/store.jsx';
import { useFolderInstall } from '../state/update.js';
import { useFavoriteAction } from '../ui/GameCard.jsx';
import { Icon } from '../ui/Icon.jsx';
import { Logo } from '../ui/Logo.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, ScrollView, Text, View } from '@ps5-react/core';

  function Footer() {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsxs)(View, { style: { marginHorizontal: -48, marginTop: 120, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 2, borderColor: "#2a2a2f", paddingHorizontal: 48, paddingVertical: 48 }, children: [
      /* @__PURE__ */ (0, jsx)(Logo, { color: colors.muted }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: t2("browse.footer") })
    ] });
  }
  var MIGRATE_GUIDE = "gitlab.com/myluxy/overdrive";
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
  var Sections = (0, memo)(function Sections2({ onOpenFilters }) {
    const onAction = useFavoriteAction();
    return /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, onAction, children: /* @__PURE__ */ (0, jsxs)(ScrollView, { style: { flex: 1, gap: 60, paddingHorizontal: 48 }, children: [
      /* @__PURE__ */ (0, jsx)(FocusedSection, {}),
      // Each section keeps its images in use only while focus is in it or the next one (near.js).
      /* @__PURE__ */ (0, jsx)(NearSection, { index: 0, children: /* @__PURE__ */ (0, jsxs)(View, { scrollAnchor: true, style: { gap: 24, paddingTop: 36 }, children: [
        /* @__PURE__ */ (0, jsx)(FolderInstallNotice, {}),
        /* @__PURE__ */ (0, jsx)(Spotlight, {})
      ] }) }),
      /* @__PURE__ */ (0, jsx)(NearSection, { index: 1, children: /* @__PURE__ */ (0, jsx)(PopularRail, {}) }),
      /* @__PURE__ */ (0, jsx)(NearSection, { index: 2, children: /* @__PURE__ */ (0, jsx)(AddedRail, {}) }),
      /* @__PURE__ */ (0, jsx)(NearSection, { index: 3, children: /* @__PURE__ */ (0, jsx)(CdnRail, {}) }),
      /* @__PURE__ */ (0, jsx)(NearSection, { index: 4, children: /* @__PURE__ */ (0, jsx)(ContinueRow, {}) }),
      /* @__PURE__ */ (0, jsx)(NearSection, { index: 5, children: /* @__PURE__ */ (0, jsx)(RecentRow, {}) }),
      /* @__PURE__ */ (0, jsx)(NearSection, { index: 6, children: /* @__PURE__ */ (0, jsx)(TopCharts, {}) }),
      /* @__PURE__ */ (0, jsx)(NearSection, { index: 7, children: /* @__PURE__ */ (0, jsx)(GenreRail, {}) }),
      /* @__PURE__ */ (0, jsx)(NearSection, { index: 8, children: /* @__PURE__ */ (0, jsx)(Catalog, { onOpenFilters }) }),
      /* @__PURE__ */ (0, jsx)(Footer, {})
    ] }) });
  });
  var BrowsePage = (0, memo)(function BrowsePage2() {
    const [open, setOpen] = (0, useState)(false);
    const [frozen, setFrozen] = (0, useState)(false);
    const [drawer] = (0, useState)(() => ({
      open: () => {
        setOpen(true);
        setFrozen(true);
      },
      close: () => setOpen(false),
      closed: () => setFrozen(false)
    }));
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(StoreFreeze, { frozen, children: /* @__PURE__ */ (0, jsx)(Sections, { onOpenFilters: drawer.open }) }),
      /* @__PURE__ */ (0, jsx)(FilterDrawer, { open, onClose: drawer.close, onClosed: drawer.closed }),
      /* @__PURE__ */ (0, jsx)(PageHints, {})
    ] });
  });

export { BrowsePage };
