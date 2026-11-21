import { useEffect, useState } from 'react';
import { loadList, saveList } from './saved.js';

  // The drive downloads are saved to, kept between sessions (issue #103): with three drives plugged
  // in the player had to pick the right one on every game. It lives in settings.json beside the
  // speed limit. Null is no choice: DownloadButton's own pick, the first drive with room for the
  // release. Settings and the game page's "Save to" row both write it, so the drive picked last is
  // the one proposed next time.
  var SETTINGS = "settings.json";
  var ROOT = /^\/(?:data|mnt\/(?:usb|ext)\d+)$/;
  var saved = loadList(SETTINGS, "settings").downloadRoot;
  var current = typeof saved === "string" && ROOT.test(saved) ? saved : null;
  var downloadRoot = () => current;
  var listeners = /* @__PURE__ */ new Set();
  function setDownloadRoot(root) {
    const next = typeof root === "string" && ROOT.test(root) ? root : null;
    if (next === current) return;
    current = next;
    const { downloadRoot: _old, ...settings } = loadList(SETTINGS, "settings");
    saveList(SETTINGS, "settings", next ? { ...settings, downloadRoot: next } : settings);
    for (const listener of listeners) listener(next);
  }
  function useDownloadRoot() {
    const [root, setRoot] = (0, useState)(current);
    (0, useEffect)(() => {
      listeners.add(setRoot);
      setRoot(current);
      return () => {
        listeners.delete(setRoot);
      };
    }, []);
    return root;
  }
  // The drive to preselect: the remembered one when it is mounted and has room for this release,
  // else the first drive that has (a disconnected or full drive must not preselect itself).
  function storageIndex(roots, remembered, fits) {
    const index = remembered ? roots.indexOf(remembered) : -1;
    return index >= 0 && fits(roots[index]) ? index : Math.max(0, roots.findIndex(fits));
  }

export { downloadRoot, setDownloadRoot, storageIndex, useDownloadRoot };
