// ../pub-game-store/native/browse/PageHints.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { useNavState } from '../state/nav.jsx';
import { HINT, useHints } from '../ui/Legend.jsx';
import { useFocus } from '@ps5-react/core';

  var CATALOG = [HINT.select, { button: "triangle", label: "hints.filters" }, HINT.favorite, HINT.top, HINT.sections];
  var CARDS = [HINT.select, HINT.favorite, HINT.top, HINT.sections];
  function hintsFor(key) {
    if (/^(card|catalog|chip):/.test(key)) return CATALOG;
    if (/^(popular|recent|continue):/.test(key) && !key.endsWith(":all")) return CARDS;
    return null;
  }
  function PageHints() {
    const { focusedKey: focusedKey2 } = useFocus();
    const shown = useNavState().top.name === "browse";
    useHints(shown ? hintsFor(focusedKey2 ?? "") : null);
    return null;
  }

export { PageHints };
