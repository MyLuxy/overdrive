// Which images the store front keeps in use. An image in use is never evicted from the decoded cache,
// and the store front mounts every section and every card of its rows, so it held over a hundred images
// at once: the cache stayed full and, with the Homebrew page's many small icons, the engine's image
// registry ran out ("the engine image registry is full") and new covers never drew.
//
// Down the page, the section focus is in and the one above and below keep theirs; the rest let them go
// (ReleaseImages: an image released stays cached until the room is needed, and one on screen at that
// moment stays). A section with nothing to show (no recent games, no download to continue) is not
// counted, so the one past it is still the next. Along a row, the cards near the one focus last rested
// on keep theirs.

import { jsx } from 'react/jsx-runtime';
import { createContext, useContext, useEffect, useState } from 'react';
import { ReleaseImages, useFocus } from '@ps5-react/core';

  // The sections in page order, by the prefix of their elements' focus keys.
  var SECTIONS = { spotlight: 0, popular: 1, added: 2, cdn: 3, continue: 4, recent: 5, chart: 6, genre: 7, card: 8, catalog: 8, chip: 8 };
  var NEAR = 1;
  var current = 0;
  var listeners = /* @__PURE__ */ new Set();
  var empty = /* @__PURE__ */ new Set();
  var notify = () => {
    for (const listener of listeners) listener(current);
  };
  // Where a section sits among the ones shown.
  var rank = (index) => index - [...empty].filter((other) => other < index).length;
  var SectionIndex = (0, createContext)(-1);
  // Rendered once by the page: follows focus and tells the sections, which re-render only when they turn
  // near or far. Focus elsewhere (the header, another screen) leaves the last section as it was.
  function FocusedSection() {
    const { focusedKey } = useFocus();
    (0, useEffect)(() => {
      const index = SECTIONS[String(focusedKey ?? "").split(":")[0]];
      if (index === void 0 || index === current) return;
      current = index;
      notify();
    }, [focusedKey]);
    return null;
  }
  function NearSection({ index, children }) {
    const far = (focused) => Math.abs(rank(index) - rank(focused)) > NEAR;
    const [released, setReleased] = (0, useState)(() => far(current));
    (0, useEffect)(() => {
      const listener = (focused) => setReleased(far(focused));
      listeners.add(listener);
      listener(current);
      return () => {
        listeners.delete(listener);
      };
    }, [index]);
    return /* @__PURE__ */ (0, jsx)(SectionIndex.Provider, { value: index, children: /* @__PURE__ */ (0, jsx)(ReleaseImages, { when: released, children }) });
  }
  // Called by a section that can have nothing to show, before it returns null.
  function useSectionShown(shown) {
    const index = (0, useContext)(SectionIndex);
    (0, useEffect)(() => {
      if (index < 0 || shown === !empty.has(index)) return;
      if (shown) empty.delete(index);
      else empty.add(index);
      notify();
    }, [index, shown]);
  }
  // Cards further than this from the one focus last rested on let their images go; a screen shows six
  // or seven. The centre moves in steps of four, so a row re-renders every few cards, not on every one.
  var ROW_WINDOW = 8;
  var STEP = 4;
  // `reached` keeps its identity across renders, so a memoized card given it does not re-render.
  function useRowWindow() {
    const [center, setCenter] = (0, useState)(0);
    const [reached] = (0, useState)(() => (index) => setCenter(Math.floor(index / STEP) * STEP));
    return { far: (index) => Math.abs(index - center) > ROW_WINDOW, reached };
  }
  function RowCard({ far, children }) {
    return /* @__PURE__ */ (0, jsx)(ReleaseImages, { when: far, children });
  }

export { FocusedSection, NearSection, RowCard, useRowWindow, useSectionShown };
