// ../pub-game-store/native/index.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { AppRegistry, FocusScope, View } from '@ps5-react/core';
import { BrowsePage } from './browse/BrowsePage.jsx';
import { DownloadsScreen } from './downloads/DownloadsScreen.jsx';
import { FilesScreen } from './files/FilesScreen.jsx';
import { GameScreen } from './game/index.jsx';
import { LocaleProvider, useLocale } from './i18n/index.js';
import { SearchScreen } from './search/index.jsx';
import { getGame, warmCovers } from './state/catalog.js';
import { NavProvider, useIsImmersive, useNavActions, useNavState } from './state/nav.jsx';
import { StoreFreeze, StoreProvider } from './state/store.jsx';
import { Header } from './ui/Header.jsx';
import { Legend } from './ui/Legend.jsx';
import { Splash } from './ui/Splash.jsx';
import { UpdateDialog } from './ui/UpdateDialog.jsx';
import { useInterfaceHaptics } from './ui/haptics.js';
import { useInterfaceSounds } from './ui/sounds.js';
import { VERSION } from './version.js';

  function Screen({ screen: screen2 }) {
    const { openGame, pop } = useNavActions();
    const openCard = (game) => openGame(game.id, `card:${game.id}`);
    if (screen2.name === "game") return /* @__PURE__ */ (0, jsx)(GameScreen, { game: getGame(screen2.id), download: screen2.download, onBack: pop, onOpenGame: openCard });
    if (screen2.name === "downloads") return /* @__PURE__ */ (0, jsx)(DownloadsScreen, { onBack: pop, onOpenGame: openGame });
    if (screen2.name === "files") return /* @__PURE__ */ (0, jsx)(FilesScreen, { onBack: pop });
    return /* @__PURE__ */ (0, jsx)(SearchScreen, { onBack: pop, onOpenGame: openCard });
  }
  function BrowseLayer({ shown }) {
    return /* @__PURE__ */ (0, jsx)(View, { style: shown ? { position: "absolute", left: 0, right: 0, top: 96, bottom: 60 } : { position: "absolute", left: 0, right: 0, top: 96, bottom: 60, display: "none" }, children: /* @__PURE__ */ (0, jsx)(StoreFreeze, { frozen: !shown, children: /* @__PURE__ */ (0, jsx)(FocusScope, { focusKey: "page", autoFocus: true, inert: !shown, children: /* @__PURE__ */ (0, jsx)(BrowsePage, {}) }) }) });
  }
  var WARM_DELAY_MS = 3e3;
  function App() {
    useInterfaceSounds();
    useInterfaceHaptics();
    (0, useEffect)(() => {
      const id = setTimeout(warmCovers, WARM_DELAY_MS);
      return () => clearTimeout(id);
    }, []);
    const { top } = useNavState();
    const onBrowse = top.name === "browse";
    const key = top.name === "game" ? `game:${top.id}` : top.name;
    const immersive = useIsImmersive();
    const { rtl } = useLocale();
    return (
      // Arabic and Urdu mirror every row and right-align every paragraph from here.
      /* @__PURE__ */ (0, jsxs)(View, { style: [{ width: 1920, height: 1080, backgroundColor: "#000000" }, { direction: rtl ? "rtl" : "ltr" }], children: [
        /* @__PURE__ */ (0, jsxs)(Header, { children: [
          /* @__PURE__ */ (0, jsx)(BrowseLayer, { shown: onBrowse }),
          onBrowse ? null : (
            // No background of its own: the root's canvas shows through, so a screen change does not
            // fill the whole screen twice. `screen` lets the header's Down return to where it was left.
            /* @__PURE__ */ (0, jsx)(View, { style: immersive ? { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 } : top.name === "downloads" || top.name === "files" ? { position: "absolute", left: 0, right: 0, top: 96, bottom: 0 } : { position: "absolute", left: 0, right: 0, top: 96, bottom: 60 }, children: /* @__PURE__ */ (0, jsx)(FocusScope, { focusKey: "screen", children: /* @__PURE__ */ (0, jsx)(Screen, { screen: top }) }) }, key)
          ),
          immersive ? null : /* @__PURE__ */ (0, jsx)(Legend, { screen: top.name }),
          /* @__PURE__ */ (0, jsx)(UpdateDialog, {})
        ] })
      ] })
    );
  }
  // The intro owns the screen until it ends: the store is mounted by its `onDone`, so no
  // page, cover or catalog work happens underneath the needle.
  function Boot() {
    const [booted, setBooted] = (0, useState)(false);
    // The intro reports itself (about 2.5s); this only covers an animation callback that never
    // arrives, where a black screen forever is worse than a store without the needle.
    (0, useEffect)(() => {
      const id = setTimeout(() => setBooted(true), 5e3);
      return () => clearTimeout(id);
    }, []);
    return /* @__PURE__ */ (0, jsx)(View, { style: { width: 1920, height: 1080, backgroundColor: "#000000" }, children: booted
      ? /* @__PURE__ */ (0, jsx)(LocaleProvider, { children: /* @__PURE__ */ (0, jsx)(StoreProvider, { children: /* @__PURE__ */ (0, jsx)(NavProvider, { children: /* @__PURE__ */ (0, jsx)(App, {}) }) }) })
      : /* @__PURE__ */ (0, jsx)(Splash, { onDone: () => setBooted(true) }) });
  }
  // Which build wrote this session of app.log.
  console.log(`[overdrive] version ${VERSION}`);
  AppRegistry.registerComponent("overdrive", () => () => /* @__PURE__ */ (0, jsx)(Boot, {}));
