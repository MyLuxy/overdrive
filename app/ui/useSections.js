// ../pub-game-store/native/ui/useSections.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useRef, useState } from 'react';
import { useFocus } from '@ps5-react/core';
import { activateBrowseSection, headerSectionForFocus } from '../browse/near.js';
import { NO_FILTERS, filterGames, sortGames } from '../state/catalog.js';

import { useNavActions, useNavState } from '../state/nav.jsx';
import { useQuery, useQueryActive, useStoreActions, useStoreState } from '../state/store.jsx';

  var KEYS2 = {
    search: "nav:search",
    discover: "nav:discover",
    browse: "nav:browse",
    homebrew: "nav:homebrew",
    favorites: "nav:favorites",
    downloads: "nav:downloads",
    files: "nav:files",
    settings: "nav:settings"
  };
  var TABS = ["discover", "browse", "homebrew", "search", "favorites", "downloads", "files", "settings"];
  const snapshotView = ({ filters, sort, query, browsePanel }) =>
    ({ filters, sort, query, browsePanel });
  const libraryFocusTarget = ({ browsePanel, sort }) =>
    browsePanel === 'search' ? 'catalog:keyboard'
      : browsePanel === 'filters' ? 'catalog:sort:' + sort : 'catalog:toggle:filters';

  // The tab tracks the navigation entry that opened the library until its filters or sort change.
  var pinned = { section: "discover", filters: NO_FILTERS, sort: "newest" };
  var libraryListeners = new Set();
  var openFullLibrary = () => {};
  function browseFullLibrary(options) { openFullLibrary(options); }
  function useShowLibrary() {
    const store = useStoreActions();
    const nav = useNavActions();
    const [show] = (0, useState)(() => (filters, sort, target = "catalog:toggle:filters", section = "browse", panel = null) => {

      pinned = { section, filters, sort };
      store.setFilters(filters);
      store.setQuery("");
      store.setSort(sort);
      store.setBrowsePanel(panel);
      for (const listener of libraryListeners) listener(section, { filters, sort, browsePanel: panel });
      nav.home(target);
    });
    return show;
  }
  function sectionOf({ filters, sort }, query) {
    if (!query && filters === pinned.filters && sort === pinned.sort) return pinned.section;
    if (filters.wishlist) return "favorites";
    // The full library stays under Browse regardless of how it is sorted or filtered.
    return "browse";
  }
  function useSections() {
    const query = useQuery();
    const store = { ...useStoreState(), ...useStoreActions(), query };
    // Read the current panel through a ref to avoid stale tab handlers.
    const storeRef = (0, useRef)(store);
    storeRef.current = store;
    const views = (0, useRef)({ library: { filters: NO_FILTERS, sort: 'newest', query: '', browsePanel: null }, favorites: null });
    const queryActive = useQueryActive();
    const nav = useNavActions();
    const { top } = useNavState();
    const show = useShowLibrary();
    const { focusedKey } = useFocus();
    const [pageRegion, setPageRegion] = (0, useState)(null);
    const [selectedTab, setSelectedTab] = (0, useState)(null);
    const selectedTabRef = (0, useRef)(null);
    const stepTab = (0, useRef)(null);
    const pendingRegion = (0, useRef)(null);
    const focusedRegionRef = (0, useRef)(null);
    focusedRegionRef.current = top.name === "browse" ? headerSectionForFocus(focusedKey) : top.name;
    const [selectTab] = (0, useState)(() => (tab, nextStore) => {
      // Shoulder inputs can arrive before React commits the previous tab transition.
      const leavingFavoritesForSearch = tab === 'search'
        && storeRef.current.filters.wishlist && nextStore?.filters?.wishlist === false;
      if (nextStore) storeRef.current = { ...storeRef.current, ...nextStore };
      stepTab.current = tab;
      const region = tab === "discover" ? "discover"
        : tab === "browse" || tab === "search" || tab === "favorites" ? "browse" : tab;
      // Suppress stale region updates during bounded focus retries.
      pendingRegion.current = region === focusedRegionRef.current && !leavingFavoritesForSearch ? null
        : { region, target: leavingFavoritesForSearch ? 'catalog:keyboard' : null,
            expires: Date.now() + 1600 };
      if (region === "browse" || region === "discover") {
        selectedTabRef.current = tab;
        setSelectedTab(tab);
        setPageRegion(region);
      }
    });
    (0, useEffect)(() => {
      libraryListeners.add(selectTab);
      return () => libraryListeners.delete(selectTab);
    }, []);
    (0, useEffect)(() => {
      const focusedRegion = headerSectionForFocus(focusedKey);
      const region = top.name === "browse" ? focusedRegion : top.name;
      const pending = pendingRegion.current;
      if (pending && Date.now() < pending.expires &&
          (pending.region !== region || (pending.target && !String(focusedKey ?? '').startsWith(pending.target)))) return;
      pendingRegion.current = null;
      if (selectedTabRef.current === "favorites" && !storeRef.current.filters.wishlist) {
        selectedTabRef.current = "browse";
        setSelectedTab("browse");
      }
      if (top.name !== "browse") {
        if (TABS.includes(top.name)) stepTab.current = top.name;
        return;
      }
      if (focusedRegion) {
        setPageRegion(focusedRegion);
        const previous = selectedTabRef.current;
        const next = focusedRegion === "discover" ? "discover"
          : previous === "browse" || previous === "search" || previous === "favorites" ? previous
          : storeRef.current.filters.wishlist ? "favorites" : "browse";
        selectedTabRef.current = next;
        setSelectedTab(next);
        stepTab.current = next;
      } else {
        stepTab.current = selectedTabRef.current;

      }
    }, [focusedKey, top.name, store.filters.wishlist]);
    const underneath = ["downloads", "files", "homebrew", "settings"].includes(top.name)
      ? top.name : sectionOf(store, queryActive);
    const section = top.name === "game" ? null : underneath;
    const inferred = top.name === "browse" && store.browsePanel === "search" && pageRegion === "browse"
      ? "search"
      : top.name === "browse" && (section === "discover" || section === "browse") && pageRegion
        ? pageRegion : section;
    const shown = top.name === "browse" && selectedTab ? selectedTab : inferred;
    // Restore separate Library state when leaving Favorites via Browse or Search.
    const restoreLibrary = () => {
      const current = storeRef.current;
      if (!current.filters.wishlist) return current;
      views.current.favorites = snapshotView(current);
      const library = views.current.library;
      store.setFilters(library.filters);
      store.setSort(library.sort);
      store.setQuery(library.query);
      store.setBrowsePanel(library.browsePanel);
      return library;
    };
    const [on] = (0, useState)(() => ({
      show,
      search: () => {
        const library = restoreLibrary();
        selectTab('search', { ...library, browsePanel: 'search' });
        activateBrowseSection();
        store.setBrowsePanel('search');
        nav.home('catalog:keyboard');
      },
      discover: () => {
        const library = restoreLibrary();
        selectTab('discover', library);
        nav.home('spotlight:cta');
      },
      browse: (options) => {
        const library = restoreLibrary();
        selectTab('browse', library);
        activateBrowseSection();
        const first = options?.focusFirstGame
          ? sortGames(filterGames({ ...library, wishlist: [] }), library.sort)[0] : null;
        nav.home(first ? 'card:' + first.id : libraryFocusTarget(library));
      },
      homebrew: () => {
        selectTab("homebrew");
        nav.openTab("homebrew", "nav:homebrew");
      },
      favorites: () => {
        const current = storeRef.current;
        if (!current.filters.wishlist) views.current.library = snapshotView(current);
        const previous = views.current.favorites;
        const favorite = previous ?? { filters: { ...NO_FILTERS, wishlist: true }, sort: 'newest', query: '', browsePanel: null };
        const filters = { ...favorite.filters, wishlist: true };
        selectTab('favorites', { ...favorite, filters });
        activateBrowseSection();
        store.setFilters(filters);
        store.setSort(favorite.sort);
        store.setQuery(favorite.query);
        store.setBrowsePanel(favorite.browsePanel);
        nav.home(libraryFocusTarget(favorite));
      },
      downloads: () => {
        selectTab("downloads");
        nav.openTab("downloads", "nav:downloads");
      },
      files: () => {
        selectTab("files");
        nav.openTab("files", "nav:files");
      },
      settings: () => {
        selectTab("settings");
        nav.openTab("settings", "nav:settings");
      }
    }));
    (0, useEffect)(() => {
      openFullLibrary = on.browse;
      return () => { if (openFullLibrary === on.browse) openFullLibrary = () => {}; };
    }, [on]);
    const step = (forward) => {
      const current = stepTab.current ?? shown;
      const next = TABS[TABS.indexOf(current) + (forward ? 1 : -1)];
      if (!next) return false;
      stepTab.current = next;
      on[next]();
      return true;
    };
    return {
      section: shown,
      filters: store.filters,
      on,
      step,
      // The page's top elements go up to `nav:current`, the current section's item, like a PS5 tab
      // row; the scope's own memory would be stale after L1/R1 or a closed menu.
      keyOf: (name) => name === shown ? "nav:current" : KEYS2[name],
      shown

    };
  }

export { browseFullLibrary, useSections, useShowLibrary };
