// ../pub-game-store/native/ui/Header.jsx
// reconstructed from the esbuild bundle in eboot.bin
// MODIFIED: the settings button shows a gear.

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useRef } from 'react';
import { focusEnd, useLocale, useT } from '../i18n/index.js';

import { useIsImmersive, useNavActions, useNavState } from '../state/nav.jsx';
import { DownloadToast } from './DownloadToast.jsx';
import { DownloadsBadge } from './DownloadsBadge.jsx';
import { FocusRing } from './FocusRing.jsx';
import { Logo } from './Logo.jsx';
import { NavItem } from './NavItem.jsx';
import { NavPill, useNavLayouts } from './NavPill.jsx';
import { useSections } from './useSections.js';
import { VERSION } from '../version.js';
import { FocusScope, Text, View } from '@ps5-react/core';

  var BADGE = /* @__PURE__ */ (0, jsx)(DownloadsBadge, {});
  function Header({ children }) {
    const t2 = useT();
    const { rtl } = useLocale();
    const { shown, on, step, keyOf } = useSections();
    const nav = useNavActions();
    const { top } = useNavState();

    const immersive = useIsImmersive();
    const [layouts, track] = useNavLayouts();
    const down = top.name === "browse" ? "page" : top.name === "homebrew" ? "homebrew-page" : "screen";
    const toastAction = (0, useRef)(null);
    const onAction = (action) => {
      if (action === "r2" && toastAction.current) {
        toastAction.current();
        return true;
      }
      if (action !== "l1" && action !== "r1") return false;
      // Right-to-left the sections run leftward, so L1 is the one that moves on (issue #30).
      const forward = action === (rtl ? "l1" : "r1");
      step(forward);
      return true;
    };
    const onBack = () => {
      if (!nav.pop()) nav.focusLater("spotlight:cta");
      return true;
    };
    return /* @__PURE__ */ (0, jsxs)(FocusScope, { onAction, onBack, children: [
      children,
      /* @__PURE__ */ (0, jsx)(DownloadToast, { actionRef: toastAction }),
      /* @__PURE__ */ (0, jsx)(View, { style: immersive ? { position: "absolute", left: 0, right: 0, top: 0, zIndex: 40, display: "none" } : { position: "absolute", left: 0, right: 0, top: 0, zIndex: 40 }, children: /* @__PURE__ */ (0, jsx)(FocusScope, { focusKey: "header", inert: immersive, children: /* @__PURE__ */ (0, jsxs)(View, { onLayout: track("header"), style: { height: 96, flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "#000000", paddingHorizontal: 48 }, children: [
        /* @__PURE__ */ (0, jsx)(NavPill, { section: shown, layouts }),
        /* Original left-side text navigation, now with icons alongside the labels. */
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 0 }, children: [
          /* @__PURE__ */ (0, jsxs)(View, {
            focusKey: "nav:home",
            onPress: on.discover,
            nextFocusDown: down,
            style: { marginLeft: 0, flexDirection: "row", alignItems: "center", borderRadius: 6, paddingLeft: 0, paddingRight: 24 },
            children: [
              /* @__PURE__ */ (0, jsx)(FocusRing, {}),
              /* @__PURE__ */ (0, jsxs)(View, { style: { position: "relative" }, children: [
                /* @__PURE__ */ (0, jsx)(Logo, { enlarged: true }),
                /* @__PURE__ */ (0, jsx)(Text, {
                  style: { position: "absolute", left: 66, top: 39, fontFamily: "Inter-Regular", fontSize: 16, lineHeight: 18, color: "#8a8a94" },
                  children: "v" + VERSION
                })
              ] })
            ]
          }),
          /* @__PURE__ */ (0, jsx)(NavItem, {
            focusKey: keyOf("discover"),
            icon: "compass",
            label: t2("nav.discover"),
            current: shown === "discover",
            onPress: on.discover,
            onLayout: track("discover"),
            nextFocusDown: down
          }),
          /* @__PURE__ */ (0, jsx)(NavItem, {
            focusKey: keyOf("browse"),
            icon: "controller",
            label: t2("nav.browse"),
            current: shown === "browse",
            onPress: on.browse,
            onLayout: track("browse"),
            nextFocusDown: down
          }),
          /* @__PURE__ */ (0, jsx)(NavItem, {
            focusKey: keyOf("homebrew"),
            icon: "homebrew",
            label: t2("nav.homebrew"),
            current: shown === "homebrew",
            onPress: on.homebrew,
            onLayout: track("homebrew"),
            nextFocusDown: down
          }),
          /* @__PURE__ */ (0, jsx)(NavItem, {
            focusKey: keyOf("search"),
            icon: "search",
            label: t2("nav.search"),
            current: shown === "search",
            onPress: on.search,
            onLayout: track("search"),
            nextFocusDown: down
          }),
        ] }),
        /* Keep the four fixed-width utility icons on the right; they never grow captions. */
        /* @__PURE__ */ (0, jsx)(View, { style: { width: 232, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }, children:
          /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 12 }, children: [

            /* @__PURE__ */ (0, jsx)(
              NavItem,
              {
                focusKey: keyOf("favorites"),
                icon: "star",
                compact: true,
                current: shown === "favorites",
                onPress: on.favorites,
                onLayout: track("favorites"),
                nextFocusDown: down,
                ...focusEnd(rtl, keyOf("downloads"))
              }
            ),
            /* @__PURE__ */ (0, jsx)(
              NavItem,
              {
                focusKey: keyOf("downloads"),
                icon: "download",
                compact: true,
                current: shown === "downloads",
                onPress: on.downloads,
                onLayout: track("downloads"),
                nextFocusDown: down,
                children: BADGE
              }
            ),
            /* @__PURE__ */ (0, jsx)(
              NavItem,
              {
                focusKey: keyOf("files"),
                icon: "folder",
                compact: true,
                current: shown === "files",
                onPress: on.files,
                onLayout: track("files"),
                nextFocusDown: down
              }
            ),
            /* @__PURE__ */ (0, jsx)(
              NavItem,
              {
                focusKey: keyOf("settings"),
                icon: "settings",
                compact: true,
                current: shown === "settings",
                onPress: on.settings,
                onLayout: track("settings"),
                nextFocusDown: down,
                ...focusEnd(rtl, keyOf("settings"))
              }
            )
          ] })
        })
      ] }) }) })
    ] });
  }

export { Header };
