import { useEffect, useState } from 'react';
import { loadList, saveList } from './saved.js';
import { Downloads } from '@ps5-react/core';

  // A cap on what game downloads take from the connection (issue #15), in MB/s as the app shows
  // speeds (formatSpeed's MB is 1024 ** 2 bytes); 0 is no cap. Kept in settings.json beside the vibration, and
  // handed to the download engine at launch and on every change, running downloads included.
  // App updates are enqueued unlimited and never wait on it.
  // 50, 2 and 1 MB/s went (2026-10-17): few connections reach 50 with these hosts, and 1 or 2 take a day
  // over a big game. A saved one of them becomes the nearest value left.
  var LIMITS = [0, 25, 10, 5];
  var SETTINGS = "settings.json";
  var saved = loadList(SETTINGS, "settings").speedLimit;
  var nearest = (limit) => LIMITS.filter(Boolean).reduce((best, value) => Math.abs(value - limit) < Math.abs(best - limit) ? value : best);
  var speedLimit = LIMITS.includes(saved) ? saved : typeof saved === "number" && saved > 0 ? nearest(saved) : 0;
  var listeners = /* @__PURE__ */ new Set();
  function apply() {
    try {
      Downloads.setRateLimit(speedLimit * 1024 ** 2);
    } catch (error) {
      console.log("[speed-limit] not applied:", error.message);
    }
  }
  function setSpeedLimit(limit) {
    if (!LIMITS.includes(limit)) return;
    speedLimit = limit;
    const { speedLimit: _old, ...settings } = loadList(SETTINGS, "settings");
    saveList(SETTINGS, "settings", limit ? { ...settings, speedLimit: limit } : settings);
    apply();
    for (const listener of listeners) listener(limit);
  }
  // The next value one step up (faster, then unlimited) or down (slower), stopping at the ends.
  function stepSpeedLimit(direction) {
    const index = LIMITS.indexOf(speedLimit);
    setSpeedLimit(LIMITS[Math.min(LIMITS.length - 1, Math.max(0, index + direction))]);
  }
  function useSpeedLimit() {
    const [limit, setLimit] = (0, useState)(speedLimit);
    (0, useEffect)(() => {
      listeners.add(setLimit);
      return () => {
        listeners.delete(setLimit);
      };
    }, []);
    return limit;
  }
  apply();

export { LIMITS, setSpeedLimit, stepSpeedLimit, useSpeedLimit };
