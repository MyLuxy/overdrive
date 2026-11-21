// ../pub-game-store/native/downloads/useDownloadAlerts.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useRef } from 'react';
import { alertsBetween } from './alerts.js';
import { downloadQueue } from '../state/downloads.js';

  function useDownloadAlerts(onAlert) {
    const current = (0, useRef)(onAlert);
    current.current = onAlert;
    (0, useEffect)(() => {
      let previous = null;
      try {
        return downloadQueue().subscribe((jobs) => {
          if (previous) for (const alert of alertsBetween(previous, jobs)) current.current(alert);
          previous = jobs;
        });
      } catch {
        return void 0;
      }
    }, []);
  }

export { useDownloadAlerts };
