// The Homebrew page (the header's Homebrew item): every app the community catalog lists, newest release
// first, by kind or category. And an app's own page, which first reads the app's file from the catalog
// (its download and description) and is then a game's page.

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useCallback, useEffect, useRef, useState } from 'react';
import { GameScreen } from '../game/index.jsx';
import { SPAN_MAX, fitBytes } from '../i18n/fit.js';
import { useLocale, useT } from '../i18n/index.js';
import { detailsOf, loadDetails, refresh, useHomebrew } from '../state/homebrew.js';
import { useNavActions } from '../state/nav.jsx';
import { Button2 } from '../ui/Button.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { DETAILS_HEIGHT, GameCard, useFavoriteAction } from '../ui/GameCard.jsx';
import { POSTER_WIDTH, POSTER_ROW_GAP } from '../ui/posterLayout.js';
import { logical, px } from '../ui/scale.js';
import { Spinner } from '../ui/Spinner.jsx';
import { FocusScope, ScrollView, Text, View, VirtualList, useIsFocused } from '@ps5-react/core';

  var COLUMNS = 7;
  var CARD_WIDTH = POSTER_WIDTH;
  var CARD_HEIGHT = px(Math.round(CARD_WIDTH * 4 / 3)) + DETAILS_HEIGHT;
  var TITLE = { fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", lineHeight: 42, letterSpacing: -0.75 };
  var NOTE = { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 };
  var SOURCE = "prosperostore.net";
  // The chips: the catalog's kinds, and emulators, a category of apps people look for on their own.
  var FILTERS = [
    { id: "all", label: "homebrew.kind.all", test: () => true },
    { id: "app", label: "homebrew.kind.app", test: (app) => app.homebrew.kind === "app" },
    { id: "game", label: "homebrew.kind.game", test: (app) => app.homebrew.kind === "game" },
    { id: "emulators", label: "genre.emulators", test: (app) => app.homebrew.category === "emulators" },
    { id: "tool", label: "homebrew.kind.tool", test: (app) => app.homebrew.kind === "tool" }
  ];
  // An app's file is read once focus has rested on its card this long, so its page usually opens at once.
  var PREFETCH_MS = 250;
  var prefetching = null;
  function prefetch(app) {
    clearTimeout(prefetching);
    prefetching = setTimeout(() => void loadDetails(app).catch(() => {}), PREFETCH_MS);
  }
  function ChipLabel({ label, count, current }) {
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: current ? "#0d0d0f" : "#f2f2f3d9", lineHeight: 30 }, focused && !current ? { color: "#f2f2f3" } : null], children: label }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: current ? "#0d0d0f99" : "#8a8a94", lineHeight: 30 }, children: String(count) })
    ] });
  }
  function Chip({ id, label, count, current, onPress }) {
    return /* @__PURE__ */ (0, jsx)(View, { focusKey: `homebrew-kind:${id}`, onPress, style: (state) => [
      { height: 60, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14999, paddingHorizontal: 24, backgroundColor: current ? "#f2f2f3" : "#17171a" },
      state.focused && !current ? { backgroundColor: "#2b2b30" } : null
    ], children: /* @__PURE__ */ (0, jsx)(ChipLabel, { label, count, current }) });
  }
  function Grid({ apps }) {
    const { openGame } = useNavActions();
    const renderItem = (0, useCallback)(
      ({ item: app, index }) => /* @__PURE__ */ (0, jsx)(View, {
        scrollAnchor: index >= COLUMNS,
        style: { width: px(CARD_WIDTH), height: CARD_HEIGHT },
        children: /* @__PURE__ */ (0, jsx)(
        GameCard,
        {
          game: app,
          width: CARD_WIDTH,
          detailed: true,
          rowEnd: index % COLUMNS === COLUMNS - 1 || index === apps.length - 1,
          rowStart: index % COLUMNS === 0,
          nextFocusUp: index >= COLUMNS
            ? 'card:' + apps[index - COLUMNS].id : 'homebrew-kind:' + chosenFilter,
          nextFocusRight: index % COLUMNS === COLUMNS - 1 && index + 1 < apps.length
            ? 'card:' + apps[index + 1].id : void 0,
          nextFocusLeft: index % COLUMNS === 0
            ? (index > 0 ? 'card:' + apps[index - 1].id : void 0) : void 0,
          nextFocusDown: index + COLUMNS < apps.length
            ? 'card:' + apps[index + COLUMNS].id : void 0,
          enterDelay: void 0,
          onFocus: () => prefetch(app),
          onPress: () => openGame(app.id, `card:${app.id}`)
        })
      }),
      [apps, openGame]
    );
    return /* @__PURE__ */ (0, jsx)(VirtualList, { style: { marginTop: 36 }, data: apps, numColumns: COLUMNS, itemHeight: logical(CARD_HEIGHT), rowGap: POSTER_ROW_GAP, columnGap: 12, initialNumRows: 3, keyExtractor: (app) => app.id, renderItem });
  }
  // Waiting for the list, or why there is none, with a way to ask again.
  function Status({ failed }) {
    const t2 = useT();
    if (!failed) return /* @__PURE__ */ (0, jsx)(View, { style: { marginTop: 120, alignItems: "center" }, children: /* @__PURE__ */ (0, jsx)(Spinner, {}) });
    return /* @__PURE__ */ (0, jsxs)(View, { style: { marginTop: 96, alignItems: "center", gap: 30 }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: [NOTE, { width: 900, textAlign: "center" }], children: t2("homebrew.failed") }),
      /* @__PURE__ */ (0, jsx)(Button2, { label: t2("homebrew.retry"), focusKey: "homebrew:retry", autoFocus: true, onPress: () => void refresh(true) })
    ] });
  }
  // The filter chosen; the page stays mounted under an app's page (index.jsx), so it is only for a later
  // visit from the header.
  var chosenFilter = "all";
  function HomebrewScreen({ onBack }) {
    const t2 = useT();
    const { rtl } = useLocale();
    const { apps, status } = useHomebrew();
    const [filter, setFilter] = (0, useState)(chosenFilter);
    const choose = (next) => {
      chosenFilter = next;
      setFilter(next);
    };
    // On a first launch the list can arrive after the page opened, with nothing focused yet.
    const { focusLater } = useNavActions();
    const listed = apps.length > 0;
    const listedAtOpen = (0, useRef)(listed);
    (0, useEffect)(() => {
      if (listed && !listedAtOpen.current) focusLater(`homebrew-kind:${chosenFilter}`);
    }, [listed]);
    const counts = Object.fromEntries(FILTERS.map(({ id, test }) => [id, apps.filter(test).length]));
    const chips = FILTERS.filter(({ id }) => id === "all" || counts[id] > 0);
    const active = chips.find(({ id }) => id === filter) ?? FILTERS[0];
    const shown = apps.filter(active.test);
    const onAction = useFavoriteAction();
    const back2 = () => {
      onBack();
      return true;
    };
    // Not a trap: Up from the chips reaches the header, as on Downloads and Files.
    return /* @__PURE__ */ (0, jsx)(FocusScope, { autoFocus: true, onBack: back2, onAction, children: /* @__PURE__ */ (0, jsxs)(ScrollView, { style: { flex: 1, paddingHorizontal: 48, paddingTop: 48, paddingBottom: 96 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { scrollAnchor: true, children: [
        /* @__PURE__ */ (0, jsxs)(Text, { style: TITLE, children: [
          fitBytes(t2("nav.homebrew"), SPAN_MAX),
          apps.length ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontWeight: 400, color: "#8a8a94" }, children: fitBytes(`  ${t2("homebrew.count", { count: apps.length })}`, SPAN_MAX) }) : null
        ] }),
        /* @__PURE__ */ (0, jsx)(Text, { style: [NOTE, { marginTop: 12, width: 1400, textAlign: rtl ? "right" : "left" }], children: t2("homebrew.about", { source: SOURCE }) }),
        apps.length ? /* @__PURE__ */ (0, jsx)(FocusScope, { row: true, children: /* @__PURE__ */ (0, jsx)(View, { style: { marginTop: 36, flexDirection: "row", flexWrap: "wrap", gap: 12 }, children: chips.map(
          ({ id, label }) => /* @__PURE__ */ (0, jsx)(Chip, { id, label: t2(label), count: counts[id], current: active.id === id, onPress: () => choose(id) }, id)
        ) }) }) : null
      ] }),
      apps.length ? /* @__PURE__ */ (0, jsx)(Grid, { apps: shown }, active.id) : /* @__PURE__ */ (0, jsx)(Status, { failed: status === "failed" })
    ] }) });
  }
  // An app's page: its file is read first, so the page opens with its download ready. While it is read
  // the screen shows a spinner alone; a failure says so, with Retry and Back.
  function HomebrewGame({ game, ...props }) {
    const t2 = useT();
    const [state, setState] = (0, useState)(() => !game ? "failed" : detailsOf(game) ? "ready" : "loading");
    const [attempt, setAttempt] = (0, useState)(0);
    (0, useEffect)(() => {
      if (!game || state === "ready") return void 0;
      let live = true;
      setState("loading");
      loadDetails(game).then(() => live && setState("ready"), (error2) => {
        console.log(`[homebrew] ${game.id} not read: ${error2.message}`);
        if (live) setState("failed");
      });
      return () => {
        live = false;
      };
    }, [game?.id, attempt]);
    if (state === "ready") return /* @__PURE__ */ (0, jsx)(GameScreen, { game, ...props });
    const back2 = () => {
      props.onBack();
      return true;
    };
    if (state === "loading") {
      return /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, autoFocus: true, onBack: back2, children: /* @__PURE__ */ (0, jsx)(View, { style: { flex: 1, alignItems: "center", justifyContent: "center" }, children: /* @__PURE__ */ (0, jsx)(Spinner, {}) }) });
    }
    return /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, autoFocus: true, onBack: back2, children: /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, alignItems: "center", justifyContent: "center", gap: 30 }, children: [
      game ? /* @__PURE__ */ (0, jsx)(Text, { style: TITLE, children: game.title }) : null,
      /* @__PURE__ */ (0, jsx)(Text, { style: [NOTE, { width: 900, textAlign: "center" }], children: t2("homebrew.appFailed") }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 15 }, children: [
        game ? /* @__PURE__ */ (0, jsx)(Button2, { label: t2("homebrew.retry"), focusKey: "homebrew-app:retry", onPress: () => setAttempt((count) => count + 1) }) : null,
        /* @__PURE__ */ (0, jsx)(Button2, { variant: "outline", label: t2("hints.back"), focusKey: "homebrew-app:back", onPress: props.onBack })
      ] })
    ] }) });
  }

export { HomebrewGame, HomebrewScreen };
