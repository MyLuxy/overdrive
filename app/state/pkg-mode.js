import { useEffect, useState } from 'react';
import { loadList, saveList } from './saved.js';

  // Where a PKG downloads: in the background through the PS5's own Downloads, where it keeps going
  // once Overdrive is closed and the console is free for anything else, or in Overdrive as before,
  // with its pause, resume and install at the end. "ask" puts the question before each download; a
  // choice remembered there, or made in Settings, answers it from then on. Kept in settings.json.
  var MODES = ["ask", "overdrive", "console"];
  var SETTINGS = "settings.json";
  var saved = loadList(SETTINGS, "settings").pkgMode;
  var mode = MODES.includes(saved) ? saved : "ask";
  var listeners = /* @__PURE__ */ new Set();

  function pkgMode() {
    return mode;
  }

  function setPkgMode(next) {
    if (!MODES.includes(next) || next === mode) return;
    mode = next;
    const { pkgMode: _old, ...settings } = loadList(SETTINGS, "settings");
    saveList(SETTINGS, "settings", next === "ask" ? settings : { ...settings, pkgMode: next });
    for (const listener of listeners) listener(next);
  }

  function usePkgMode() {
    const [value, setValue] = (0, useState)(mode);
    (0, useEffect)(() => {
      listeners.add(setValue);
      setValue(mode);
      return () => {
        listeners.delete(setValue);
      };
    }, []);
    return value;
  }

export { MODES, pkgMode, setPkgMode, usePkgMode };
