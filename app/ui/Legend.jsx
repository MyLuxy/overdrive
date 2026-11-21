// ../pub-game-store/native/ui/Legend.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { memo, useEffect, useState } from 'react';
import { ButtonHints } from './ButtonHints.jsx';
import { View } from '@ps5-react/core';

  var HINT = {
    select: { button: "cross", label: "hints.select" },
    back: { button: "circle", label: "hints.back" },
    top: { button: "circle", label: "hints.top" },
    clear: { button: "l2", label: "hints.clear" },
    favorite: { button: "square", label: "hints.favorite" },
    sections: { button: "l1r1", label: "hints.sections" },
    close: { button: "circle", label: "hints.close" }
  };
  var HINTS = {
    browse: [HINT.select, HINT.top, HINT.sections],
    game: [HINT.select, HINT.back, HINT.favorite, HINT.sections],
    homebrew: [HINT.select, HINT.back, HINT.favorite, HINT.sections],
    favorites: [HINT.select, HINT.back, HINT.favorite, HINT.sections],
    settings: [HINT.select, HINT.back, HINT.sections],
    search: [HINT.select, HINT.favorite, HINT.clear, HINT.back, HINT.sections]
  };
  var registered2 = [];
  var listeners3 = /* @__PURE__ */ new Set();
  var notify = () => listeners3.forEach((listener) => listener(registered2.at(-1)?.hints ?? null));
  function useHints(hints) {
    (0, useEffect)(() => {
      if (!hints) return void 0;
      const entry2 = { hints };
      registered2.push(entry2);
      notify();
      return () => {
        registered2.splice(registered2.indexOf(entry2), 1);
        notify();
      };
    }, [hints]);
  }
  var Hints = (0, memo)(ButtonHints);
  function Legend({ screen: screen2 }) {
    const [hints, setHints] = (0, useState)(() => registered2.at(-1)?.hints ?? null);
    (0, useEffect)(() => {
      listeners3.add(setHints);
      setHints(registered2.at(-1)?.hints ?? null);
      return () => listeners3.delete(setHints);
    }, []);
    if (!HINTS[screen2]) return null;
    return /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", left: 0, right: 0, bottom: 0 }, children: /* @__PURE__ */ (0, jsx)(Hints, { hints: hints ?? HINTS[screen2] }) });
  }

export { HINT, Legend, useHints };
