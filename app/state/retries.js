// How many times a download asks a server again by itself when it answers busy (HTTP 429 or a 5xx)
// before leaving it failed for the player to Retry. Kept in settings.json beside the speed limit,
// and read by the queue on each failure, so a change applies to downloads already running.
// Three tries is the default: the queue waits 30 s, then a minute, then two, so the app recovers
// from a host's short outage without the player touching anything. "always" keeps asking for as
// long as the app is open, the wait held at five minutes after the first few tries.

import { useEffect, useState } from 'react';
import { loadList, saveList } from './saved.js';

  var RETRIES = [0, 1, 3, 5, 10, "always"];
  var DEFAULT = 3;
  var SETTINGS = "settings.json";
  var saved = loadList(SETTINGS, "settings").retries;
  var retries = RETRIES.includes(saved) ? saved : DEFAULT;
  var listeners = /* @__PURE__ */ new Set();
  function setRetries(count) {
    if (!RETRIES.includes(count)) return;
    retries = count;
    const { retries: _old, ...settings } = loadList(SETTINGS, "settings");
    saveList(SETTINGS, "settings", { ...settings, retries: count });
    for (const listener of listeners) listener(count);
  }
  // What the queue asks on each busy failure: the tries it has, or "always" for no limit.
  function autoRetries() {
    return retries;
  }
  function useRetries() {
    const [value, setValue] = (0, useState)(retries);
    (0, useEffect)(() => {
      listeners.add(setValue);
      return () => {
        listeners.delete(setValue);
      };
    }, []);
    return value;
  }

export { RETRIES, autoRetries, setRetries, useRetries };
