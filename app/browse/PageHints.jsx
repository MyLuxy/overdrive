import { useFocus } from '@ps5-react/core';
import { useNavState } from '../state/nav.jsx';
import { useStore } from '../state/store.jsx';
import { HINT, useHints } from '../ui/Legend.jsx';

const CLEAR_FILTERS = { button: 'triangle', label: 'filters.clearAllFilters' };
const GAME_HINTS = [HINT.select, HINT.favorite, HINT.top, HINT.sections];
const LIBRARY_GAME_HINTS = [HINT.select, CLEAR_FILTERS, HINT.favorite, HINT.top, HINT.sections];
const LIBRARY_TOOL_HINTS = [HINT.select, CLEAR_FILTERS, HINT.top, HINT.sections];
const SEARCH_HINTS = [HINT.select, CLEAR_FILTERS, HINT.delete, HINT.top, HINT.sections];

function hintsFor(key, searching = false) {
  if (key.startsWith('card:')) return LIBRARY_GAME_HINTS;
  if (/^(catalog|chip):/.test(key)) return searching ? SEARCH_HINTS : LIBRARY_TOOL_HINTS;
  if (key.startsWith('genre:') || key === 'cdn:card' || key === 'cdn:all')
    return [HINT.select, HINT.top, HINT.sections];
  if (/^(spotlight|popular|cdn|continue|recent|chart):/.test(key)) return GAME_HINTS;
  return null;
}

function PageHints() {
  const { focusedKey } = useFocus();
  const shown = useNavState().top.name === 'browse';
  const searching = useStore().browsePanel === 'search';
  useHints(shown ? hintsFor(focusedKey ?? '', searching) : null);
  return null;
}

export { PageHints };
