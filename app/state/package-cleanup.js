import { useEffect, useState } from 'react';
import { loadList, saveList } from './saved.js';

  // A PKG deleted once the console has installed it: a 30 GB game no longer takes 60 GB until the file
  // is deleted by hand (testers, issues #24 and #50). On unless turned off in settings; kept in
  // settings.json beside the speed limit as keepPackages, only while it is off.
  var SETTINGS = "settings.json";
  var keep = loadList(SETTINGS, "settings").keepPackages === true;
  var listeners = /* @__PURE__ */ new Set();
  var deletesPackages = () => !keep;
  function setDeletePackages(on) {
    keep = !on;
    const { keepPackages: _old, ...settings } = loadList(SETTINGS, "settings");
    saveList(SETTINGS, "settings", keep ? { ...settings, keepPackages: true } : settings);
    for (const listener of listeners) listener(!keep);
  }
  function useDeletePackages() {
    const [on, setOn] = (0, useState)(!keep);
    (0, useEffect)(() => {
      listeners.add(setOn);
      return () => {
        listeners.delete(setOn);
      };
    }, []);
    return on;
  }

export { deletesPackages, setDeletePackages, useDeletePackages };
