// Whether a finished torrent seeds while the app is open (the player's choice, on by default). It
// lives in settings.json beside the speed limit, and is handed to the engine at launch and on every
// change; a job already transferring picks it up too, since the engine reads it while it runs.
// Nothing seeds once the app closes.

import { useEffect, useState } from 'react';
import { Torrents } from '@ps5-react/core';
import { loadList, saveList } from './saved.js';

  var SETTINGS = "settings.json";
  var saved = loadList(SETTINGS, "settings").seeding;
  var seeding = saved !== false;
  var listeners = /* @__PURE__ */ new Set();
  function apply() {
    try {
      Torrents.setSeeding(seeding);
    } catch (error) {
      console.log("[seeding] not applied:", error.message);
    }
  }
  function setSeeding(enabled) {
    seeding = enabled === true;
    const { seeding: _old, ...settings } = loadList(SETTINGS, "settings");
    // On is the default, so only the choice to stop is kept.
    saveList(SETTINGS, "settings", seeding ? settings : { ...settings, seeding: false });
    apply();
    for (const listener of listeners) listener(seeding);
  }
  // What the queue hands the engine as each torrent starts.
  function seedingEnabled() {
    return seeding;
  }
  function useSeeding() {
    const [value, setValue] = (0, useState)(seeding);
    (0, useEffect)(() => {
      listeners.add(setValue);
      return () => {
        listeners.delete(setValue);
      };
    }, []);
    return value;
  }
  apply();

export { seedingEnabled, setSeeding, useSeeding };
