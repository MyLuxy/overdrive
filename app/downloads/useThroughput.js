// ../pub-game-store/native/downloads/useThroughput.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useState } from 'react';
import { createThroughput } from './rates.js';
import { subscribe2 } from './useQueue.js';

  var SAMPLES = 60;
  var EMPTY = { network: [], disk: [] };
  function useThroughput(id) {
    const [history, setHistory] = (0, useState)(EMPTY);
    (0, useEffect)(() => {
      const measure = createThroughput();
      return subscribe2((jobs) => {
        const job2 = jobs.find((item) => item.id === id);
        const sample = job2 && measure(job2, Date.now());
        if (!sample) return;
        setHistory((previous) => ({
          network: [...previous.network, sample.network].slice(-SAMPLES),
          disk: [...previous.disk, sample.disk].slice(-SAMPLES)
        }));
      });
    }, [id]);
    return history;
  }

export { SAMPLES, useThroughput };
