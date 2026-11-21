// ../pub-game-store/native/browse/useSlides.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useRef, useState } from 'react';

  var SLIDE_MS = 7e3;
  function useSlides(count, enabled) {
    const [active2, setActive] = (0, useState)(0);
    const [left, setLeft] = (0, useState)(SLIDE_MS);
    const [paused, setPaused] = (0, useState)(false);
    const startedAt = (0, useRef)(0);
    const running = (0, useRef)(false);
    const held = (0, useRef)(false);
    const ranFor = (0, useRef)(0);
    const current = (0, useRef)(active2);
    current.current = active2;
    (0, useEffect)(() => {
      if (paused || !enabled) return void 0;
      startedAt.current = Date.now();
      running.current = true;
      const id = setTimeout(() => {
        setActive((index) => (index + 1) % count);
        setLeft(SLIDE_MS);
      }, left);
      return () => {
        running.current = false;
        ranFor.current = Date.now() - startedAt.current;
        clearTimeout(id);
      };
    }, [active2, left, paused, enabled]);
    (0, useEffect)(() => {
      if (!enabled && !held.current) setLeft((ms) => Math.max(0, ms - ranFor.current));
    }, [enabled]);
    const [select] = (0, useState)(() => (index) => {
      if (index === current.current) return;
      startedAt.current = Date.now();
      setActive(index);
      setLeft(SLIDE_MS);
    });
    const [hold] = (0, useState)(() => (on) => {
      if (held.current === on) return;
      held.current = on;
      if (on && running.current) {
        const elapsed = Date.now() - startedAt.current;
        setLeft((ms) => Math.max(0, ms - elapsed));
      }
      setPaused(on);
    });
    return { active: active2, left, paused: paused || !enabled, select, hold };
  }

export { SLIDE_MS, useSlides };
