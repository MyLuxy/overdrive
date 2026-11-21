// ../pub-game-store/native/game/useFreeSpace.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useRef, useState } from 'react';
import { freeBytes } from '../state/downloads.js';

  var EVERY_MS = 3e3;
  function useFreeSpace(roots, status, watching) {
    const [free, setFree] = (0, useState)(() => roots.map(freeBytes));
    const mounted = (0, useRef)(false);
    (0, useEffect)(() => {
      const read = () => setFree((previous) => {
        const next = roots.map(freeBytes);
        return next.every((value, i) => value === previous[i]) ? previous : next;
      });
      if (!mounted.current) mounted.current = true;
      else read();
      if (!watching) return void 0;
      const id = setInterval(read, EVERY_MS);
      return () => clearInterval(id);
    }, [status, watching]);
    return free;
  }

export { useFreeSpace };
