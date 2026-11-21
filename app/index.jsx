// ../pub-game-store/native/index.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { AppRegistry, FileSystem, FocusScope, ReleaseImages, View } from '@ps5-react/core';
import { BrowsePage } from './browse/BrowsePage.jsx';
import { FavoritesScreen } from './browse/FavoritesScreen.jsx';
import { DownloadsScreen } from './downloads/DownloadsScreen.jsx';
import { FilesScreen } from './files/FilesScreen.jsx';
import { GameScreen } from './game/index.jsx';
import { HomebrewGame, HomebrewScreen } from './homebrew/HomebrewScreen.jsx';
import { LocaleProvider, useLocale } from './i18n/index.js';
import { SearchScreen } from './search/index.jsx';
import { NO_FILTERS, getGame, warmCovers } from './state/catalog.js';
import { fetchUpdate } from './state/catalog-update.js';
import { isHomebrewId } from './state/homebrew.js';
import { NavProvider, useIsImmersive, useNavActions, useNavState } from './state/nav.jsx';
import { StoreFreeze, StoreProvider } from './state/store.jsx';
import { Header } from './ui/Header.jsx';
import { Legend } from './ui/Legend.jsx';
import { SettingsScreen } from './ui/SettingsScreen.jsx';
import { Splash } from './ui/Splash.jsx';
import { UpdateDialog } from './ui/UpdateDialog.jsx';
import { useInterfaceHaptics } from './ui/haptics.js';
import { useInterfaceSounds } from './ui/sounds.js';
import { useShowLibrary } from './ui/useSections.js';
import { VERSION } from './version.js';
import { BUILD } from './build.js';
import { games, twins } from './data/catalog.js';

  function Screen({ screen: screen2 }) {
    const { openGame, pop } = useNavActions();
    // "Browse games" on an empty Downloads opens the store front as Discover does, whatever section
    // (Favorites, Top rated) the store was left on.
    const showLibrary = useShowLibrary();
    const openCard = (game) => openGame(game.id, `card:${game.id}`);
    // A homebrew app's page reads its file from the catalog first, and says so when the app is gone.
    if (screen2.name === "game" && isHomebrewId(screen2.id)) return /* @__PURE__ */ (0, jsx)(HomebrewGame, { game: getGame(screen2.id), download: screen2.download, onBack: pop, onOpenGame: openCard });
    if (screen2.name === "game") return /* @__PURE__ */ (0, jsx)(GameScreen, { game: getGame(screen2.id), download: screen2.download, onBack: pop, onOpenGame: openCard });
    if (screen2.name === "downloads") return /* @__PURE__ */ (0, jsx)(DownloadsScreen, { onBack: pop, onBrowse: () => showLibrary(NO_FILTERS, "newest", "spotlight:cta", "discover"), onOpenGame: openGame });
    if (screen2.name === "files") return /* @__PURE__ */ (0, jsx)(FilesScreen, { onBack: pop });
    if (screen2.name === "settings") return /* @__PURE__ */ (0, jsx)(SettingsScreen, { onBack: pop });
    if (screen2.name === "favorites") return /* @__PURE__ */ (0, jsx)(FavoritesScreen, { onBack: pop, onBrowse: () => showLibrary(NO_FILTERS, "newest", "spotlight:cta", "discover") });
    return /* @__PURE__ */ (0, jsx)(SearchScreen, { onBack: pop, onOpenGame: openCard });
  }
  // The store front stays mounted under every other screen; while hidden it lets its images go (the
  // decoded cache keeps them until another screen needs the room), so a game page or the Homebrew page
  // is not left fighting a full cache for its own.
  function BrowseLayer({ shown }) {
    return /* @__PURE__ */ (0, jsx)(View, { style: shown ? { position: "absolute", left: 0, right: 0, top: 96, bottom: 60 } : { position: "absolute", left: 0, right: 0, top: 96, bottom: 60, display: "none" }, children: /* @__PURE__ */ (0, jsx)(ReleaseImages, { when: !shown, children: /* @__PURE__ */ (0, jsx)(StoreFreeze, { frozen: !shown, children: /* @__PURE__ */ (0, jsx)(FocusScope, { focusKey: "page", autoFocus: true, inert: !shown, children: /* @__PURE__ */ (0, jsx)(BrowsePage, {}) }) }) }) });
  }
  // The Homebrew page stays mounted while an app opened from it is on top, hidden like the store front,
  // so Back finds it as it was left: its filter, its scroll and the card focus came from.
  function HomebrewLayer({ shown }) {
    const { pop } = useNavActions();
    return /* @__PURE__ */ (0, jsx)(View, { style: shown ? { position: "absolute", left: 0, right: 0, top: 96, bottom: 60 } : { position: "absolute", left: 0, right: 0, top: 96, bottom: 60, display: "none" }, children: /* @__PURE__ */ (0, jsx)(ReleaseImages, { when: !shown, children: /* @__PURE__ */ (0, jsx)(FocusScope, { focusKey: "homebrew-page", inert: !shown, children: /* @__PURE__ */ (0, jsx)(HomebrewScreen, { onBack: pop }) }) }) });
  }
  var WARM_DELAY_MS = 3e3;
  // The nightly catalog update for the next launch, once the covers' warm-up has had the network.
  var UPDATE_DELAY_MS = 2e4;
  function App() {
    useInterfaceSounds();
    useInterfaceHaptics();
    (0, useEffect)(() => {
      const id = setTimeout(warmCovers, WARM_DELAY_MS);
      const update = setTimeout(fetchUpdate, UPDATE_DELAY_MS);
      return () => {
        clearTimeout(id);
        clearTimeout(update);
      };
    }, []);
    const { stack, top } = useNavState();
    const onBrowse = top.name === "browse";
    const onHomebrew = top.name === "homebrew";
    const keepHomebrew = stack.some((screen2) => screen2.name === "homebrew");
    const key = top.name === "game" ? `game:${top.id}` : top.name;
    const immersive = useIsImmersive();
    const { rtl } = useLocale();
    return (
      // Arabic and Urdu mirror every row and right-align every paragraph from here.
      /* @__PURE__ */ (0, jsxs)(View, { style: [{ width: 1920, height: 1080, backgroundColor: "#000000" }, { direction: rtl ? "rtl" : "ltr" }], children: [
        /* @__PURE__ */ (0, jsxs)(Header, { children: [
          /* @__PURE__ */ (0, jsx)(BrowseLayer, { shown: onBrowse }),
          keepHomebrew ? /* @__PURE__ */ (0, jsx)(HomebrewLayer, { shown: onHomebrew }) : null,
          onBrowse || onHomebrew ? null : (
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
  // Which build wrote this session of app.log: a draft rebuilt with the same version is otherwise
  // indistinguishable from the one before it.
  console.log(`[overdrive] version ${VERSION} build ${BUILD.commit}${BUILD.built ? ` ${BUILD.built}` : ""}`);
  // The same files at another cluster size make an image of another size, so what app.log says about
  // the image is how a console test tells two drafts of one version apart. The free space is the
  // image's own slack, and the app reads its catalog files from this volume.
  try {
    const image = FileSystem.diskUsage(FileSystem.appDir);
    console.log(`[overdrive] image ${FileSystem.appDir}: ${(image.total / 1048576).toFixed(0)} MiB total, ` +
      `${((image.total - image.free) / 1048576).toFixed(0)} MiB in use, ${(image.free / 1048576).toFixed(0)} MiB free`);
  } catch (error) {
    console.log(`[overdrive] image ${FileSystem.appDir}: usage not read: ${error.message}`);
  }
  // What the lists hold after the nightly update, if one was kept: a build whose catalog did not
  // arrive intact otherwise looks like a working one with games missing.
  console.log(`[overdrive] catalog: ${games.length} games, ${twins.length} editions`);
  AppRegistry.registerComponent("overdrive", () => () => /* @__PURE__ */ (0, jsx)(Boot, {}));
