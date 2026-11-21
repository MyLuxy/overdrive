// ../pub-game-store/native/ui/useSections.js
// reconstructed from the esbuild bundle in eboot.bin

import { useRef, useState } from 'react';
import { NO_FILTERS } from '../state/catalog.js';
import { useNavActions, useNavState } from '../state/nav.jsx';
import { useQueryActive, useStoreActions, useStoreState } from '../state/store.jsx';

  var KEYS2 = {
    discover: "nav:discover",
    browse: "nav:browse",
    homebrew: "nav:homebrew",
    search: "nav:search",
    favorites: "nav:favorites",
    downloads: "nav:downloads",
    files: "nav:files",
    settings: "nav:settings"
  };
  var TABS = ["discover", "browse", "homebrew", "search", "favorites", "downloads", "files", "settings"];
  // Sections that are their own screen rather than a view of the library.
  var SCREENS = ["homebrew", "search", "favorites", "downloads", "files", "settings"];
  // The tab tracks the navigation entry that opened the library until its filters or sort change.
  var pinned = { section: "discover", filters: NO_FILTERS, sort: "newest" };
  function useShowLibrary() {
    const store = useStoreActions();
    const nav = useNavActions();
    const [show] = (0, useState)(() => (filters, sort, target = "catalog:sort", section = "browse") => {
      pinned = { section, filters, sort };
      store.setFilters(filters);
      store.setQuery("");
      store.setSort(sort);
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
    const store = { ...useStoreState(), ...useStoreActions() };
    const queryActive = useQueryActive();
    const nav = useNavActions();
    const { top } = useNavState();
    const show = useShowLibrary();
    const underneath = SCREENS.includes(top.name) ? top.name : sectionOf(store, queryActive);
    const section = top.name === "game" ? null : underneath;
    const topName = (0, useRef)(top.name);
    topName.current = top.name;
    const [on] = (0, useState)(() => ({
      show,
      search: () => topName.current !== "search" && nav.push({ name: "search" }, "nav:search"),
      discover: () => show(NO_FILTERS, "newest", "spotlight:cta", "discover"),
      browse: () => show(NO_FILTERS, "newest", void 0, "browse"),
      homebrew: () => topName.current !== "homebrew" && nav.push({ name: "homebrew" }, "nav:homebrew"),
      favorites: () => topName.current !== "favorites" && nav.push({ name: "favorites" }, "nav:favorites"),
      settings: () => topName.current !== "settings" && nav.push({ name: "settings" }, "nav:settings"),
      downloads: () => topName.current !== "downloads" && nav.push({ name: "downloads" }, "nav:downloads"),
      files: () => topName.current !== "files" && nav.push({ name: "files" }, "nav:files")
    }));
    const step = (forward) => {
      const current = underneath;
      const next = TABS[TABS.indexOf(current) + (forward ? 1 : -1)];
      if (!next) return;
      if (next === "downloads" || next === "files" || next === "homebrew") {
        store.setQuery("");
        nav.home();
      }
      on[next]();
    };
    return {
      section,
      filters: store.filters,
      on,
      step,
      // The page's top elements go up to `nav:current`, the current section's item, like a PS5 tab
      // row; the scope's own memory would be stale after L1/R1 or a closed menu.
      keyOf: (name) => name === section ? "nav:current" : KEYS2[name],
      shown: section
    };
  }

export { useSections, useShowLibrary };
