// ../pub-game-store/native/ui/Legend.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { memo, useEffect, useState } from 'react';
import { ButtonHints } from './ButtonHints.jsx';
import { View, useFocus } from '@ps5-react/core';
import { useNavState } from '../state/nav.jsx';
import { useStore, useWishlist } from '../state/store.jsx';
import { listedId } from '../state/catalog.js';
import { useFavoriteTarget } from './favoriteFocus.js';

  var HINT = {
    select: { button: "cross", label: "hints.select" },
    back: { button: "circle", label: "hints.back" },
    top: { button: "circle", label: "hints.top" },
    clear: { button: "l2", label: "hints.clear" },
    favorite: { button: "square", label: "hints.favorite" },
    delete: { button: "square", label: "hints.delete" },
    unfavorite: { button: "square", label: "hints.unfavorite" },
    sections: { button: "l1r1", label: "hints.sections" },
    close: { button: "circle", label: "hints.close" }
  };
  var HINTS = {
    browse: [HINT.select, HINT.favorite, HINT.top, HINT.sections],
    game: [HINT.select, HINT.back, HINT.favorite, HINT.sections],
    homebrew: [HINT.select, HINT.back, HINT.favorite, HINT.sections],
    search: [HINT.select, HINT.clear, HINT.back, HINT.sections]
  };
  var SEARCH_BROWSE_HINTS = [HINT.select, HINT.delete, HINT.top, HINT.sections];
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
    const { focusedKey } = useFocus();
    const { top } = useNavState();
    const wishlist = useWishlist();
    const { browsePanel } = useStore();
    const focusedId = useFavoriteTarget(focusedKey) ?? (top.name === 'game' ? top.id : null);
    const isFavorite = focusedId != null && wishlist.includes(listedId(focusedId));
    const fallback = screen2 === 'browse' && browsePanel === 'search' ? SEARCH_BROWSE_HINTS
      : screen2 === 'homebrew' && !focusedKey?.startsWith('card:')
        ? HINTS.homebrew.filter((hint) => hint.button !== 'square') : HINTS[screen2];
    const displayedHints = (hints ?? fallback ?? []).map((hint) =>
      hint.button === 'square' && hint.label === 'hints.favorite' && isFavorite ? HINT.unfavorite : hint);
    (0, useEffect)(() => {
      listeners3.add(setHints);
      setHints(registered2.at(-1)?.hints ?? null);
      return () => listeners3.delete(setHints);
    }, []);
    if (!HINTS[screen2]) return null;
    return /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", left: 0, right: 0, bottom: 0 }, children: /* @__PURE__ */ (0, jsx)(Hints, { hints: displayedHints }) });
  }

export { HINT, Legend, useHints };
