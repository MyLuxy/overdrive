// ../pub-game-store/native/search/history.js
// reconstructed from the esbuild bundle in eboot.bin

import { savedList } from '../state/saved.js';

  var LIMIT2 = 8;
  var searches = savedList("searches.json", "recent searches");
  var same2 = (a, b) => a.toLowerCase() === b.toLowerCase();
  function rememberSearch(query) {
    const term = query.trim();
    const terms = searches.get();
    if (term.length < 2 || same2(terms[0] ?? "", term)) return;
    searches.set([term, ...terms.filter((other) => !same2(other, term))].slice(0, LIMIT2));
  }
  var forgetSearch = (term) => searches.set(searches.get().filter((other) => other !== term));
  var useSearchHistory = searches.useList;

export { forgetSearch, rememberSearch, useSearchHistory };
