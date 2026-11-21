// ../pub-game-store/native/game/useShadowMount.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useState } from 'react';
import { shadowMountUp } from '../state/downloads.js';

  function useShadowMount(needed) {
    const [up, setUp] = (0, useState)(true);
    (0, useEffect)(() => {
      if (!needed) return void 0;
      let live = true;
      void shadowMountUp().then((value) => {
        if (live) setUp(value);
      });
      return () => {
        live = false;
      };
    }, [needed]);
    return up;
  }

export { useShadowMount };
