// ../pub-game-store/native/game/ShotViewer.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { THUMB, VIEW } from './art.js';
import { useT } from '../i18n/index.js';
import { useImmersive } from '../state/nav.jsx';
import { ButtonHints } from '../ui/ButtonHints.jsx';
import { FocusFrame } from '../ui/FocusRing.jsx';
import { FocusScope, Image, Text, View, useFocus } from '@ps5-react/core';

  var HINTS5 = [{ button: "l1r1", label: "hints.previousNext" }, { button: "circle", label: "hints.close" }];
  var stripKey = (i) => `shot-view:${i}`;
  function ShotViewer({ shots, start, onClose }) {
    const t2 = useT();
    const [index, setIndex] = (0, useState)(start);
    const { focus: focus2 } = useFocus();
    const step = (delta) => focus2(stripKey((index + delta + shots.length) % shots.length));
    useImmersive(true);
    (0, useEffect)(() => {
      for (const delta of [-1, 1]) Image.prefetch(shots[(index + delta + shots.length) % shots.length].url, VIEW).catch(() => {
      });
    }, [index]);
    const onAction = (action) => {
      if (action === "l1") step(-1);
      else if (action === "r1") step(1);
      else
        return false;
      return true;
    };
    return /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, autoFocus: true, onBack: () => {
      onClose(index);
      return true;
    }, onAction, children: /* @__PURE__ */ (0, jsxs)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "#000000" }, children: [
      /* @__PURE__ */ (0, jsx)(Image, { source: { uri: shots[index].url }, style: VIEW, resizeMode: "contain" }),
      /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", left: 0, right: 0, bottom: 0, height: 288, backgroundGradient: { type: "linear", to: "top", stops: [{ color: "#000000", offset: 0 }, { color: "#00000000", offset: 1 }] } } }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { position: "absolute", left: 0, right: 0, bottom: 0 }, children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: { marginRight: 18, width: 96, textAlign: "end", fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", lineHeight: 30 }, children: t2("game.shotPosition", { index: index + 1, total: shots.length }) }),
          shots.map(
            (shot, i) => /* @__PURE__ */ (0, jsxs)(
              View,
              {
                focusKey: stripKey(i),
                autoFocus: i === start,
                onFocus: () => setIndex(i),
                onPress: () => onClose(i),
                style: { position: "relative", width: 192, height: 108 },
                children: [
                  /* @__PURE__ */ (0, jsx)(Image, { source: { uri: shot.thumb }, style: [{ borderRadius: 9, backgroundColor: "#212125" }, THUMB], resizeMode: "cover" }),
                  /* @__PURE__ */ (0, jsx)(FocusFrame, {})
                ]
              },
              shot.url
            )
          )
        ] }),
        /* @__PURE__ */ (0, jsx)(View, { style: { marginTop: 24 }, children: /* @__PURE__ */ (0, jsx)(ButtonHints, { hints: HINTS5 }) })
      ] })
    ] }) });
  }

export { ShotViewer };
