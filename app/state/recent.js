// ../pub-game-store/native/state/recent.js
// reconstructed from the esbuild bundle in eboot.bin

import { savedList } from './saved.js';

  var LIMIT = 12;
  var recent = savedList("recent.json", "recently viewed");
  function recordVisit(id) {
    const ids = recent.get();
    if (ids[0] !== id) recent.set([id, ...ids.filter((other) => other !== id)].slice(0, LIMIT));
  }
  var useRecent = recent.useList;

export { recordVisit, useRecent };
