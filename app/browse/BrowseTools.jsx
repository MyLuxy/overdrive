import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useRef } from 'react';
import { Facet } from './FilterDrawer.jsx';
import { Keyboard } from '../search/Keyboard.jsx';
import { rememberSearch, useSearchHistory } from '../search/history.js';
import { FACETS, SORTS, activeCount, filterGames, sortGames, sortLabel } from '../state/catalog.js';
import { useNavActions } from '../state/nav.jsx';
import { FAVORITE_KINDS } from '../state/favorite-kinds.js';
import { useStore } from '../state/store.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { FocusScope, Text, View, ScrollView, useFocus, useIsFocused } from '@ps5-react/core';
import { useT } from '../i18n/index.js';

const labelStyle = { fontFamily: 'Inter-Regular', fontSize: 22, lineHeight: 32 };
const muted = '#a3a3ab';
const white = '#f2f2f3';
const SEARCH_BAR_WIDTH = 496;
const SEARCH_PANEL_WIDTH = 504;
const RECENT_GAP = 6;
const RECENT_WIDTH = (SEARCH_BAR_WIDTH - RECENT_GAP) / 2;

function SortOption({ option, index, current, onPress }) {
  const focused = useIsFocused();
  const selected = current === option.id;
  return /* @__PURE__ */ (0, jsxs)(View, {
    focusKey: 'catalog:sort:' + option.id,
    nextFocusUp: index < 2 ? 'catalog:toggle:filters' : void 0,
    onPress,
    style: {
      position: 'relative', width: 224, height: 42, paddingHorizontal: 14,
      borderRadius: 9, flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: selected ? '#f2f2f3' : focused ? '#2b2b30' : '#17171a'
    },
    children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, {
        style: { ...labelStyle, fontSize: 20, color: selected ? '#000000' : white },
        children: sortLabel(option.id)
      }),
      selected && /* @__PURE__ */ (0, jsx)(Text, {
        style: { ...labelStyle, marginLeft: 'auto', color: '#000000' },
        children: '✓'
      })
    ]
  });
}

function FavoriteKindChip({ option, selected, onPress }) {
  const t = useT();
  const focused = useIsFocused();
  return /* @__PURE__ */ (0, jsxs)(View, {
    focusKey: 'catalog:favorite-kind:' + option.id,
    nextFocusUp: 'catalog:sort:' + SORTS[SORTS.length - 1].id,
    onPress,
    style: { position: 'relative', borderRadius: 8, height: 34,
      paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center',
      backgroundColor: selected ? white : focused ? '#35353b' : '#17171a' },
    children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, {
        style: { fontFamily: 'Inter-Regular', fontSize: 18,
          color: selected ? '#0d0d0f' : white },
        children: t(option.label)
      })
    ]
  });
}
function FilterControls({ store, height }) {
  const t = useT();
  const { setSort, resetBrowse } = store;
  const total = activeCount(store.filters);
  return /* @__PURE__ */ (0, jsxs)(ScrollView, {
    style: { height, paddingRight: 12, paddingBottom: 16 },
    children: [
      /* @__PURE__ */ (0, jsx)(Text, {
        style: { marginTop: 12, marginBottom: 8, fontFamily: 'Inter-Regular',
          fontSize: 21, color: muted, fontWeight: 600, letterSpacing: 1.3 },
        children: t('sort.label').toUpperCase()
      }),
      /* @__PURE__ */ (0, jsx)(View, {
        // Account for FocusRing overflow when sizing sort controls.
        style: { width: 488, flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8, paddingTop: 9, paddingBottom: 12, gap: 14, marginBottom: 12 },
        children: SORTS.map((option, index) =>
          /* @__PURE__ */ (0, jsx)(SortOption, {
            option, index, current: store.sort, onPress: () => setSort(option.id)
          }, option.id))
      }),
      store.filters.wishlist ? /* @__PURE__ */ (0, jsxs)(View, {
        style: { marginTop: 12, marginBottom: 12, gap: 8 },
        children: [
          /* @__PURE__ */ (0, jsx)(Text, {
            style: { fontFamily: 'Inter-Regular', fontSize: 21,
              color: muted, fontWeight: 600, letterSpacing: 1.3 },
            children: t('nav.homebrew').toUpperCase()
          }),
          /* @__PURE__ */ (0, jsx)(View, {
            style: { width: SEARCH_PANEL_WIDTH, flexDirection: 'row',
              flexWrap: 'wrap', gap: 6 },
            children: FAVORITE_KINDS.map((option) =>
              /* @__PURE__ */ (0, jsx)(FavoriteKindChip, {
                option, selected: store.favoriteKind === option.id,
                onPress: () => store.setFavoriteKind(option.id)
              }, option.id))
          })
        ]
      }) : null,
      /* @__PURE__ */ (0, jsx)(View, {
        style: { marginTop: 12 },
        children: FACETS.map((facet) =>
          /* @__PURE__ */ (0, jsx)(Facet, {
            facet, store, autoFocus: false, compact: true
          }, facet.key))
      }),
      (total > 0 || store.sort !== 'newest' || Boolean(store.query)) && /* @__PURE__ */ (0, jsx)(View, {
        focusKey: 'catalog:clear-filters',
        onPress: resetBrowse,
        style: { marginTop: 14, padding: 12, backgroundColor: '#25252a', borderRadius: 10 },
        children: /* @__PURE__ */ (0, jsx)(Text, {
          style: { ...labelStyle, color: white },
          children: t('filters.clearAll')
        })
      })
    ]
  });
}

function RecentSearch({ term, index, onSearch, resultsFocusKey }) {
  const focused = useIsFocused();
  return /* @__PURE__ */ (0, jsxs)(View, {
    focusKey: 'catalog:history:' + index,
    nextFocusRight: resultsFocusKey !== 'catalog:keyboard' ? resultsFocusKey : void 0,
    onPress: () => onSearch(term),
    style: { width: RECENT_WIDTH, height: 34, position: 'relative', paddingHorizontal: 12,
      borderRadius: 9, backgroundColor: focused ? '#f2f2f3' : '#17171a',
      justifyContent: 'center' },
    children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, {
        style: { fontFamily: 'Inter-Regular', fontSize: 19,
          color: focused ? '#0d0d0f' : white, numberOfLines: 1, ellipsizeMode: 'tail' },
        children: term
      })
    ]
  });
}

function SearchControls({ store, resultsFocusKey, height }) {
  const t = useT();
  const { setQuery, resetBrowse } = store;
  const { focusLater } = useNavActions();
  const { focusedKey } = useFocus();
  const query = store.query;
  const searches = useSearchHistory().slice(0, 6);
  const currentQuery = useRef(query);
  currentQuery.current = query;
  useEffect(() => () => rememberSearch(currentQuery.current), []);
  useEffect(() => {
    if (focusedKey?.startsWith('card:') && query.trim().length > 3) rememberSearch(query);
  }, [focusedKey, query]);
  const onSearch = (term) => {
    // A query can change before React commits the new result grid; use the current focus target.
    let target = resultsFocusKey;
    if (term !== query) {
      const [first] = sortGames(filterGames({ ...store, query: term }), store.sort);
      target = first ? 'card:' + first.id : 'catalog:keyboard';
    }
    setQuery(term);
    rememberSearch(term);
    if (target !== 'catalog:keyboard') focusLater(target);
  };
  const belowFocusKey = searches.length ? 'catalog:history:0' : void 0;
  return /* @__PURE__ */ (0, jsxs)(View, {
    style: { height, width: SEARCH_PANEL_WIDTH },
    children: [/* @__PURE__ */ (0, jsxs)(View, {
      style: { marginTop: 10, gap: 6, width: SEARCH_PANEL_WIDTH },
      children: [
      /* @__PURE__ */ (0, jsx)(View, {
        style: { width: SEARCH_BAR_WIDTH, height: 44, justifyContent: 'center', paddingHorizontal: 18,
          borderRadius: 10, backgroundColor: '#19191c', borderWidth: 1, borderColor: '#38383d' },
        children: /* @__PURE__ */ (0, jsx)(Text, {
          style: { fontFamily: 'Inter-Regular', fontSize: 24, color: query ? white : muted,
            numberOfLines: 1, ellipsizeMode: 'tail' },
          children: query || t('search.placeholder')
        })
      }),
      /* @__PURE__ */ (0, jsx)(Keyboard, {
        focusKey: 'catalog:keyboard',
        onChange: setQuery,
        onSubmit: () => rememberSearch(query),
        onTriangle: resetBrowse,
        sidebar: true,
        resultsFocusKey: resultsFocusKey !== 'catalog:keyboard' ? resultsFocusKey : 'nav:current',
        belowFocusKey,
        upFocusKey: 'catalog:toggle:filters'
      }),
      /* @__PURE__ */ (0, jsxs)(View, {
        style: { marginTop: 4, gap: 4 },
        children: [
          /* @__PURE__ */ (0, jsx)(Text, {
            style: { ...labelStyle, fontSize: 18, lineHeight: 24, color: muted },
            children: t('search.recent')
          }),
          /* @__PURE__ */ (0, jsx)(View, {
            style: { flexDirection: 'row', flexWrap: 'wrap', gap: RECENT_GAP, width: SEARCH_PANEL_WIDTH },
            children: searches.map((term, index) =>
              /* @__PURE__ */ (0, jsx)(RecentSearch, {
                term, index, onSearch, resultsFocusKey
              }, term))
          })
        ]
      })
      ]
    })]
  });
}

export function BrowseTools({ section, height, resultsFocusKey }) {
  const store = useStore();
  return /* @__PURE__ */ (0, jsx)(FocusScope, {
    children: /* @__PURE__ */ (0, jsx)(View, {
      style: { width: 522, height, paddingRight: 6 },
      children: section === 'filters'
        ? /* @__PURE__ */ (0, jsx)(FilterControls, { store, height })
        : /* @__PURE__ */ (0, jsx)(SearchControls, { store, resultsFocusKey, height })
    })
  });
}
