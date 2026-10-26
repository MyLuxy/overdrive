// ../pub-game-store/native/search/Keyboard.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo, useCallback, useState } from 'react';
import { focusEnd, useLocale, useT } from '../i18n/index.js';
import { edit } from './edit.js';
import { ButtonGlyph } from '../ui/ButtonHints.jsx';
import { Icon } from '../ui/Icon.jsx';
import { HINT, useHints } from '../ui/Legend.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, Text, View, motion, useIsFocused } from '@ps5-react/core';

  var COLUMNS2 = 6;
  var LTR2 = { direction: "ltr" };
  var CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
  // What the letters miss, for an address or a key: the URL keyboard had no "! ( ) [ ] { } ; , < > '"
  // and the like, so a link or magnet carrying one could not be typed at all. A second page,
  // since 32 more keys on the first would not fit the dialog.
  var SYMBOLS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~".split("");
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
  function KeyFace({ label, icon, button, url }) {
    const focused = useIsFocused();
    useHints(focused ? url ? URL_HINTS : HINTS4 : null);
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      button ? /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", right: 15 }, children: /* @__PURE__ */ (0, jsx)(ButtonGlyph, { button, size: 18 }) }) : null,
      icon ? /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 20, color: focused ? colors.accentFg : colors.fg }) : null,
      label ? /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ fontFamily: "Inter-Regular", fontSize: 27, color: "#f2f2f3", lineHeight: 36 }, focused ? { color: "#0d0d0f" } : null], children: label }) : null
    ] });
  }
  var Key = (0, memo)(function Key2({ label, icon, button, wide, value, onKey, toResults, compact }) {
    const { rtl } = useLocale();
    return /* @__PURE__ */ (0, jsx)(motion.View, { onPress: () => onKey(value), ...focusEnd(rtl, toResults), style: (_state) => [
      { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, borderRadius: 9, backgroundColor: "#17171a" },
      wide ? { width: 276 } : { width: 84 },
      compact ? { height: 60 } : { height: 84 },
      _state.focused ? { backgroundColor: "#f2f2f3" } : null
    ], initial: false, animate: { scale: 1 }, transition: { type: "tween", duration: 0.1, ease: [0.4, 0, 0.2, 1] }, whilePress: { scale: 0.95 }, children: /* @__PURE__ */ (0, jsx)(KeyFace, { label, icon, button, url: compact }) });
  });
  var Keyboard = (0, memo)(function Keyboard2({ onChange, onSubmit, url = false, focusKey }) {
    const t2 = useT();
    const { rtl } = useLocale();
    const edge = rtl ? 0 : COLUMNS2 - 1;
    const [upper, setUpper] = (0, useState)(false);
    const [symbols, setSymbols] = (0, useState)(false);
    const characters = symbols ? SYMBOLS : url ? [...CHARACTERS, ...":/._-?=&%+#@~".split("")] : CHARACTERS;
    const onKey = (0, useCallback)(
      (value) => value === "case" ? setUpper((value2) => !value2) : value === "page" ? setSymbols((shown) => !shown) : value === "done" ? onSubmit() : onChange((query) => edit(query, value, url ? 8192 : MAX_QUERY)),
      [onChange, onSubmit, url]
    );
    const onAction = (action) => {
      if (action === "square") onKey("delete");
      else if (action === "triangle" && (!url || symbols)) onKey(" ");
      else
        return false;
      return true;
    };
    // The URL dialog's own Confirm and Cancel sit to the right of the keys: wrapping at the last
    // column would keep focus here, so that dialog's keyboard lets the move leave.
    return /* @__PURE__ */ (0, jsx)(FocusScope, { wrap: !url, focusKey, onAction, children: /* @__PURE__ */ (0, jsxs)(View, { style: [{ width: 564, flexDirection: "row", flexWrap: "wrap", gap: 12 }, LTR2], children: [
      characters.map(
        (character, i) => /* @__PURE__ */ (0, jsx)(
          Key,
          {
            label: url && !upper ? character.toLowerCase() : character,
            value: url && upper ? character : character.toLowerCase(),
            onKey,
            compact: url,
            toResults: !url && i % COLUMNS2 === edge ? TO_RESULTS : void 0
          },
          character
        )
      ),
      // The URL keyboard's second page: the toggle stays mounted across the two pages, so the focus
      // stays on it (press again to go back). Search needs no punctuation, and the key moved the
      // rows there, so it has none.
      url ? /* @__PURE__ */ (0, jsx)(
        Key,
        {
          compact: url,
          // The label names what sits behind it, the characters a URL or a password asks for: "&123"
          // once promised the digits the first page already has. On "ABC" the letters come back.
          label: symbols ? "ABC" : "()@?~",
          value: "page",
          onKey
        },
        "page"
      ) : null,
      /* @__PURE__ */ (0, jsx)(
        Key,
        {
          wide: true,
          compact: url,
          // On the symbols page the wide key is the space, which a URL keyboard otherwise has nowhere.
          label: !url || symbols ? t2("keyboard.space") : upper ? t2("keyboard.lowercase") : t2("keyboard.uppercase"),
          value: !url || symbols ? " " : "case",
          button: !url || symbols ? "triangle" : void 0,
          onKey,
          toResults: url || !rtl ? void 0 : TO_RESULTS
        }
      ),
      /* @__PURE__ */ (0, jsx)(
        Key,
        {
          wide: true,
          compact: url,
          label: t2("keyboard.delete"),
          icon: "delete",
          button: "square",
          value: "delete",
          onKey,
          toResults: url || rtl ? void 0 : TO_RESULTS
        }
      ),
      /* @__PURE__ */ (0, jsx)(
        Key,
        {
          wide: true,
          compact: url,
          label: t2("keyboard.clear"),
          icon: "x",
          button: url ? void 0 : "l2",
          value: "clear",
          onKey,
          toResults: url || !rtl ? void 0 : TO_RESULTS
        }
      ),
      /* @__PURE__ */ (0, jsx)(
        Key,
        {
          wide: true,
          compact: url,
          label: t2("keyboard.done"),
          button: "r2",
          value: "done",
          onKey,
          toResults: url || rtl ? void 0 : TO_RESULTS
        }
      )
    ] }) });
  });

export { Keyboard };
