// ../pub-game-store/native/search/Keyboard.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo, useCallback, useState } from 'react';
import { focusEnd, focusStart, useLocale, useT } from '../i18n/index.js';
import { edit } from './edit.js';
import { ButtonGlyph } from '../ui/ButtonHints.jsx';
import { Icon } from '../ui/Icon.jsx';
import { HINT, useHints } from '../ui/Legend.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, Text, View, motion, useIsFocused } from '@ps5-react/core';

  var COLUMNS2 = 6;
  var LTR2 = { direction: "ltr" };
  var CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
  var MAX_QUERY = 40;
  var TO_RESULTS = "search-results";
  var TYPE2 = { button: "cross", label: "hints.type" };
  var DELETE = { button: "square", label: "hints.delete" };
  var URL_HINTS = [TYPE2, DELETE, { button: "r2", label: "hints.confirm" }, HINT.back];
  var HINTS4 = [
    TYPE2,
    DELETE,
    { button: "triangle", label: "hints.space" },
    { button: "r2", label: "hints.search" },
    HINT.clear,
    HINT.back
  ];
  function KeyFace({ label, icon, button, url, sidebar }) {
    const focused = useIsFocused();
    useHints(focused && !sidebar ? url ? URL_HINTS : HINTS4 : null);
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      button ? /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", right: 15 }, children: /* @__PURE__ */ (0, jsx)(ButtonGlyph, { button, size: 18 }) }) : null,
      icon ? /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: icon === "clearSearch" ? 28 : 20, color: focused ? colors.accentFg : colors.fg }) : null,
      label ? /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ fontFamily: "Inter-Regular", fontSize: 27, color: "#f2f2f3", lineHeight: 36 }, focused ? { color: "#0d0d0f" } : null], children: label }) : null
    ] });
  }
  var Key = (0, memo)(function Key2({ label, icon, button, wide, value, onKey, toResults, toPrevious, toHeader, toBelow, compact, sidebar }) {
    const { rtl } = useLocale();
    return /* @__PURE__ */ (0, jsx)(motion.View, {
      onPress: () => onKey(value),
      ...focusEnd(rtl, toResults),
      ...focusStart(rtl, toPrevious),
      nextFocusUp: toHeader,
      nextFocusDown: toBelow,
      style: (_state) => [
      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 9, backgroundColor: "#17171a" },
      wide ? { width: sidebar ? 196 : 276 } : { width: sidebar ? 96 : 84 },
      sidebar ? { height: 46 } : compact ? { height: 60 } : { height: 84 },
      _state.focused ? { backgroundColor: "#f2f2f3" } : null
    ], initial: false, animate: { scale: 1 }, transition: { type: "tween", duration: 0.1, ease: [0.4, 0, 0.2, 1] }, whilePress: { scale: 0.95 }, children: /* @__PURE__ */ (0, jsx)(KeyFace, { label, icon, button, url: compact, sidebar }) });
  });
  var Keyboard = (0, memo)(function Keyboard2({ onChange, onSubmit, onTriangle, url = false, focusKey, sidebar = false, resultsFocusKey = TO_RESULTS, belowFocusKey, upFocusKey }) {
    const t2 = useT();
    const { rtl } = useLocale();
    const columns = sidebar ? 5 : COLUMNS2;
    const edge = rtl ? 0 : columns - 1;
    const [upper, setUpper] = (0, useState)(false);
    const characters = url ? [...CHARACTERS, ...":/._-?=&%+#@~".split("")] : CHARACTERS;
    const onKey = (0, useCallback)(
      (value) => value === "case" ? setUpper((value2) => !value2) : value === "done" ? onSubmit() : onChange((query) => edit(query, value, url ? 8192 : MAX_QUERY)),
      [onChange, onSubmit, url]
    );
    const onAction = (action) => {
      if (action === "square") onKey("delete");
      else if (action === "triangle" && !url) {
        if (onTriangle) onTriangle();
        else onKey(" ");
      }
      else
        return false;
      return true;
    };
    const characterKeys = characters.map(
        (character, i) => /* @__PURE__ */ (0, jsx)(
          Key,
          {
            label: url && !upper ? character.toLowerCase() : character,
            value: url && upper ? character : character.toLowerCase(),
            onKey,
            compact: url,
            sidebar,
            toResults: !url && i % columns === edge ? resultsFocusKey : void 0,
            toPrevious: sidebar && i % columns === (rtl ? columns - 1 : 0) ? "nav:current" : void 0,
            toHeader: sidebar && i < columns ? (upFocusKey ?? "nav:current") : void 0,
            toBelow: sidebar && i === characters.length - 1 ? belowFocusKey : void 0
          },
          character
        ));
    return /* @__PURE__ */ (0, jsx)(FocusScope, { wrap: !sidebar, focusKey, onAction, children: /* @__PURE__ */ (0, jsxs)(View, { style: [{ width: sidebar ? 504 : 564, flexDirection: "row", flexWrap: "wrap", gap: sidebar ? 4 : 12 }, LTR2], children: [
      characterKeys,
      /* @__PURE__ */ (0, jsx)(
        Key,
        {
          wide: true,
          compact: url,
          sidebar,
          label: sidebar ? void 0 : url ? upper ? t2("keyboard.lowercase") : t2("keyboard.uppercase") : t2("keyboard.space"),
          icon: sidebar ? "space" : void 0,
          value: url ? "case" : " ",
          button: url || sidebar ? void 0 : "triangle",
          onKey,
          toResults: url || !rtl ? void 0 : resultsFocusKey,
          toBelow: sidebar ? belowFocusKey : void 0
        }
      ),
      /* @__PURE__ */ (0, jsx)(
        Key,
        {
          wide: !sidebar,
          compact: url,
          sidebar,
          label: sidebar ? void 0 : t2("keyboard.delete"),
          icon: sidebar ? "backspaceWide" : "delete",
          button: sidebar ? void 0 : "square",
          value: "delete",
          onKey,
          toBelow: sidebar ? belowFocusKey : void 0,
          toResults: url || rtl ? void 0 : resultsFocusKey
        }
      ),
      /* @__PURE__ */ (0, jsx)(
        Key,
        {
          wide: !sidebar,
          compact: url,
          sidebar,
          label: sidebar ? void 0 : t2("keyboard.clear"),
          icon: sidebar ? "clearSearch" : "x",
          button: url || sidebar ? void 0 : "l2",
          value: "clear",
          onKey,
          toBelow: sidebar ? belowFocusKey : void 0,
          toResults: sidebar ? resultsFocusKey : url || !rtl ? void 0 : resultsFocusKey
        }
      ),
      !sidebar ? /* @__PURE__ */ (0, jsx)(
        Key,
        {
          wide: true,
          compact: url,
          sidebar,
          label: t2("keyboard.done"),
          button: "r2",
          value: "done",
          onKey,
          toResults: url || rtl ? void 0 : resultsFocusKey
        }
      ) : null
    ] }) });
  });

export { Keyboard };
