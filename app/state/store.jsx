// ../pub-game-store/native/state/store.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { createContext, useContext, useMemo, useRef, useState } from 'react';
import { NO_FILTERS, listedId, toggleValue } from './catalog.js';
import { loadList, saveList } from './saved.js';

  var StateContext = (0, createContext)(null);
  var WishlistContext = (0, createContext)([]);
  var QueryContext = (0, createContext)("");
  var QueryActiveContext = (0, createContext)(false);
  var ActionsContext = (0, createContext)(null);
  function StoreProvider({ children }) {
    const [wishlist, setWishlist] = (0, useState)(() => [...new Set(loadList("wishlist.json", "wishlist").map(listedId))]);
    const [filters, setFilters] = (0, useState)(NO_FILTERS);
    // The library opens on the newest games (2026-10-17); "Most popular" stays a choice.
    const [sort, setSort] = (0, useState)("newest");
    const [query, setQuery] = (0, useState)("");
    const [actions] = (0, useState)(() => ({
      setFilters,
      setSort,
      setQuery,
      toggleWish: (id) => setWishlist((list) => {
        const next = toggleValue(list, listedId(id));
        saveList("wishlist.json", "wishlist", next);
        return next;
      }),
      toggleFilter: (key, value) => setFilters((current) => ({ ...current, [key]: toggleValue(current[key], value) })),
      clearFilters: () => {
        setFilters(NO_FILTERS);
        setQuery("");
      }
    }));
    const state = (0, useMemo)(() => ({ filters, sort }), [filters, sort]);
    return /* @__PURE__ */ (0, jsx)(ActionsContext.Provider, { value: actions, children: /* @__PURE__ */ (0, jsx)(StateContext.Provider, { value: state, children: /* @__PURE__ */ (0, jsx)(WishlistContext.Provider, { value: wishlist, children: /* @__PURE__ */ (0, jsx)(QueryActiveContext.Provider, { value: query !== "", children: /* @__PURE__ */ (0, jsx)(QueryContext.Provider, { value: query, children }) }) }) }) });
  }
  function StoreFreeze({ frozen, children }) {
    const live = { state: (0, useContext)(StateContext), wishlist: (0, useContext)(WishlistContext), query: (0, useContext)(QueryContext) };
    const kept = (0, useRef)(live);
    if (!frozen) kept.current = live;
    return /* @__PURE__ */ (0, jsx)(StateContext.Provider, { value: kept.current.state, children: /* @__PURE__ */ (0, jsx)(WishlistContext.Provider, { value: kept.current.wishlist, children: /* @__PURE__ */ (0, jsx)(QueryContext.Provider, { value: kept.current.query, children }) }) });
  }
  var useStoreActions = () => (0, useContext)(ActionsContext);
  var useStoreState = () => (0, useContext)(StateContext);
  var useWishlist = () => (0, useContext)(WishlistContext);
  var useQuery = () => (0, useContext)(QueryContext);
  var useQueryActive = () => (0, useContext)(QueryActiveContext);
  function useStore() {
    const state = (0, useContext)(StateContext);
    const wishlist = (0, useContext)(WishlistContext);
    const query = (0, useContext)(QueryContext);
    const actions = (0, useContext)(ActionsContext);
    return (0, useMemo)(() => ({ ...state, wishlist, query, ...actions }), [state, wishlist, query, actions]);
  }

export { StoreFreeze, StoreProvider, useQuery, useQueryActive, useStore, useStoreActions, useStoreState, useWishlist };
