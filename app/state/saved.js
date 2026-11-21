// ../pub-game-store/native/state/saved.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useState } from 'react';
import { SAVED_FILES, isRecord, isStringList, readJSON } from './read-json.js';
import { FileSystem } from '@ps5-react/core';

  var dir = `${FileSystem.dataDir}/overdrive`;
  function loadList(name, what) {
    const valid = SAVED_FILES[name] ?? isStringList;
    return readJSON(
      FileSystem,
      `${dir}/${name}`,
      valid === isRecord ? {} : [],
      valid,
      (message) => console.log(`overdrive: ${what}: ${message}`)
    );
  }
  var SYNCED = /* @__PURE__ */ new Set(["settings.json", "wishlist.json"]);
  function saveList(name, what, list) {
    try {
      FileSystem.mkdir(dir, { recursive: true });
      FileSystem.writeFile(`${dir}/${name}.tmp`, JSON.stringify(list), { sync: SYNCED.has(name) });
      FileSystem.rename(`${dir}/${name}.tmp`, `${dir}/${name}`);
    } catch (error2) {
      console.log(`overdrive: ${what} not saved: ${error2.message}`);
    }
  }
  function savedList(name, what) {
    let list = loadList(name, what);
    const listeners4 = /* @__PURE__ */ new Set();
    return {
      get: () => list,
      set: (next) => {
        list = next;
        saveList(name, what, list);
        for (const listener of listeners4) listener(list);
      },
      useList: () => {
        const [value, setValue] = (0, useState)(list);
        (0, useEffect)(() => {
          listeners4.add(setValue);
          setValue(list);
          return () => {
            listeners4.delete(setValue);
          };
        }, []);
        return value;
      }
    };
  }

export { loadList, saveList, savedList };
