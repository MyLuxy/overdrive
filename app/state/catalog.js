// ../pub-game-store/native/state/catalog.js
// reconstructed from the esbuild bundle in eboot.bin

import { features, games, twins } from '../data/catalog.js';
import { formatDate2, formatNumber2, t } from '../i18n/core.js';
import { applyUpdate, loadUpdate } from './catalog-update.js';
import { getHomebrew, homebrewApps, relatedHomebrew } from './homebrew.js';
import { matchesFavoriteKind } from './favorite-kinds.js';
import { createPageCache } from './page-cache.js';
import { pausedFilter } from './paused-hosts.js';
import { createReleaseCache } from './release-cache.js';
import { FileSystem, Image } from '@ps5-react/core';

  var COVER_WIDTH = 440;
  var coverSize = (url) => url.startsWith("https://image.api.playstation.com/") ? url.replace(/([?&]w=)\d+/, `$1${COVER_WIDTH}`) : url;
  // The nightly catalog update the last launch kept (catalog-update.js), applied before anything below
  // reads the lists; its release and page files are read in place of the build's.
  var updated = (() => {
    try {
      const update = loadUpdate();
      return update ? applyUpdate(update, games, twins) : /* @__PURE__ */ new Map();
    } catch (error2) {
      console.log(`[catalog-update] not applied: ${error2.message}`);
      return /* @__PURE__ */ new Map();
    }
  })();
  var dataFileText = (path) => {
    if (!updated.has(path)) return FileSystem.readFile(`/app0/${path}`);
    const text = updated.get(path);
    if (text === null) throw new Error("removed by the catalog update");
    return text;
  };
  var releaseCache = createReleaseCache(dataFileText);
  var pageCache = createPageCache(dataFileText);
  var NO_PAGE = { about: [], shots: [], summary: "" };
  var SYNONYMS = {
    "Role Playing Game (RPG)": "RPG",
    "Role Playing Games": "RPG",
    "Role-playing": "RPG",
    Simulator: "Simulation",
    "Driving/Racing": "Racing",
    Sports: "Sport",
    // Genres of a handful of games each (2026-10-22: 3, 4, 2 and 2), one card under the clearer name.
    "Brain Training": "Educational",
    Quiz: "Educational",
    "Board Game": "Educational"
  };
  var dataFile = (dir2, id) => `data/${dir2}/${encodeURIComponent(id)}.json`;
  var pageOf = (game) => {
    try {
      return pageCache(dataFile("pages", game.id));
    } catch {
      return NO_PAGE;
    }
  };
  var Entry = {
    get releases() {
      try {
        return releaseCache(dataFile("releases", this.id));
      } catch {
        return [];
      }
    },
    get about() {
      return pageOf(this).about;
    },
    get shots() {
      return pageOf(this).shots;
    },
    get shortDescription() {
      return pageOf(this).summary;
    },
    get titleId() {
      return this.id;
    }
  };
  // A game whose every host is paused (paused-hosts.js) leaves the shared lists in place, so no screen
  // shows a game with nothing to download. So does one with no source at all (2026-10-17: 563 games,
  // nearly all PS4, whose only links sit in Archive.org collections now restricted). Either stays when
  // another edition of it can be downloaded, which its Download button then offers (2026-10-21: the
  // PS5 editions the importers add as twins, of PS4 games such as Don't Starve Together, whose only
  // host is MediaFire); an edition with no source is never offered. The data stays: a game that gains
  // a source shows again. The lists are the data module's own arrays, which every screen reads after
  // this module has run.
  var playable = (game) => game.providers?.length > 0 && !game.providers.every(pausedFilter);
  var playableWorks = new Set([...games, ...twins].filter((game) => playable(game) && game.work != null).map((game) => game.work));
  var hidden = (game, listed2) => !playable(game) && (!listed2 || !playableWorks.has(game.work));
  for (const list of [games, twins])
    for (let index = list.length - 1; index >= 0; index--)
      if (hidden(list[index], list === games)) list.splice(index, 1);
  var entries = [...games, ...twins];
  var _a;
  for (const game of entries) {
    Object.setPrototypeOf(game, Entry);
    game.genres = [...new Set(game.genres.flatMap((genre) => genre.split(" / ")).map((genre) => SYNONYMS[genre] ?? genre))];
    (_a = game.art).cover && (_a.cover = coverSize(game.art.cover));
    if (game.art.coverFallbacks) game.art.coverFallbacks = game.art.coverFallbacks.map(coverSize);
  }
  var editionsByWork = /* @__PURE__ */ new Map();
  for (const game of entries) if (game.work) editionsByWork.set(game.work, [...editionsByWork.get(game.work) ?? [], game]);
  var listed = new Set(games);
  for (const game of entries) game.platforms = [...new Set(editionsOf(game).map((edition2) => edition2.platform))].sort();
  // When a game reached Overdrive ("added", which the importers write from 2026-10-21 on): its own date
  // or its newest edition's, so a PS5 edition added to a PS4 game brings the game back among the new.
  var addedOn = new Map(entries.map((game) => [game, editionsOf(game).reduce((last, edition2) => (edition2.added ?? "") > last ? edition2.added : last, "")]));
  var addedAt = (game) => addedOn.get(game) ?? "";
  function editionsOf(game) {
    return [...editionsByWork.get(game.work) ?? [game]].sort((a, b) => b.platform.localeCompare(a.platform) || Number(listed.has(b)) - Number(listed.has(a)) || a.titleId.localeCompare(b.titleId));
  }
  var genres = [...new Set(games.flatMap((game) => game.genres))].sort();
  var byId = new Map(entries.map((game) => [game.id, game]));
  // A homebrew app's page, download and favorite go through the same lookups as a game's.
  var getGame = (id) => byId.get(id) ?? getHomebrew(id);
  function listedId(id) {
    const game = byId.get(id);
    if (!game || listed.has(game)) return id;
    return editionsOf(game).find((edition2) => listed.has(edition2) && edition2.platform === game.platform)?.id ?? id;
  }
  // Downloads art to the disk cache ahead of the screens that show it. The homebrew icons go first: the
  // Homebrew page shows about twenty at once, from a host that answers in about 400 ms. One call: the
  // engine keeps a single warm list, which each call replaces.
  function warmCovers() {
    const icons = homebrewApps().map((app) => app.art.cover).filter(Boolean);
    Image.warm([...icons, ...sortGames(games, "relevance").filter((game) => game.art.cover).map((game) => game.art.cover)]);
  }
  var SORTS = [
    // New releases first: the library's sort menu opens on it.
    { id: "newest", compare: (a, b) => b.releaseDate.localeCompare(a.releaseDate) },
    // Recently added, the "Recently added" row's library: the games added the same day, newest release first.
    { id: "added", compare: (a, b) => addedAt(b).localeCompare(addedAt(a)) || b.releaseDate.localeCompare(a.releaseDate) },
    // Most popular puts the games Archive.org serves first: the app downloads them fastest.
    { id: "relevance", compare: (a, b) => fromArchive(b) - fromArchive(a) || b.recommendations - a.recommendations },
    { id: "rating", compare: (a, b) => (b.metacritic ?? 0) - (a.metacritic ?? 0) },
    { id: "size", compare: (a, b) => (b.sizeGb ?? 0) - (a.sizeGb ?? 0) },
    { id: "title", compare: (a, b) => a.title.localeCompare(b.title) },
    { id: "titleDesc", compare: (a, b) => b.title.localeCompare(a.title) }
  ];
  var sortLabel = (id) => t(`sort.${id}`);
  var sortGames = (list, id) => [...list].sort(SORTS.find((sort) => sort.id === id).compare);
  var fromArchive = (game) => Boolean(game.providers?.includes("archive.org"));
  function showcase(list, count) {
    const first = list.filter(fromArchive);
    return first.length >= count ? first.slice(0, count) : [...first, ...list.filter((game) => !fromArchive(game))].slice(0, count);
  }
  var HOST_NAMES = {
    "overdrive cdn": "Overdrive CDN",
    vikingfile: "VikingFile",
    "archive.org": "Archive.org",
    "1fichier": "1fichier",
    "pippo26442999.github": "Pippo mirror",
    datanodes: "DataNodes",
    mediafire: "MediaFire",
    filekeeper: "FileKeeper",
    datavaults: "DataVaults",
    spectrum: "Spectrum",
    buzzheavier: "Buzzheavier",
    gofile: "Gofile",
    rapidgator: "Rapidgator",
    filecrypt: "Filecrypt",
    fileditchfiles: "FileDitch",
    ranoz: "Ranoz",
    transfer: "Transfer.it",
    akirabox: "AkiraBox",
    "link-vault.org": "LinkVault",
    "rootz.so": "Rootz"
  };
  var MIN_HOST_GAMES = 20;
  var hostCounts = /* @__PURE__ */ new Map();
  for (const game of games) for (const host2 of game.providers ?? []) hostCounts.set(host2, (hostCounts.get(host2) ?? 0) + 1);
  function slug(value) {
    const words = value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    return words.map((word, i) => i ? word[0].toUpperCase() + word.slice(1) : word).join("");
  }
  var CDN_HOST = "overdrive cdn";
  var hosts = [...hostCounts].filter(([host2, count]) => (count >= MIN_HOST_GAMES || host2 === CDN_HOST) && !pausedFilter(host2)).sort((a, b) => (b[0] === CDN_HOST) - (a[0] === CDN_HOST) || b[1] - a[1]).map(([host2]) => ({ value: host2, name: HOST_NAMES[host2] ?? host2 }));
  var onCdn = (game) => Boolean(game.providers?.includes(CDN_HOST));
  var SIZES = [
    { value: "small", label: "filters.size.small", test: (gb) => gb < 10 },
    { value: "medium", label: "filters.size.medium", test: (gb) => gb >= 10 && gb <= 50 },
    { value: "large", label: "filters.size.large", test: (gb) => gb > 50 }
  ];
  var named = (values, namespace) => values.map((value) => ({ value, label: `${namespace}.${slug(value)}`, name: value }));
  var byGames = (values, has) => {
    const counts = new Map(values.map((value) => [value, games.filter((game) => has(game, value)).length]));
    return [...values].sort((a, b) => counts.get(b) - counts.get(a) || a.localeCompare(b));
  };
  var RELEASES = [
    { value: "older", label: "filters.release.older", test: (year) => year < 2020 },
    { value: "current", label: "filters.release.current", test: (year) => year >= 2020 && year <= 2023 },
    { value: "recent", label: "filters.release.recent", test: (year) => year >= 2024 }
  ];
  var FACETS = [
    {
      key: "platform",
      any: true,
      options: [{ value: "ps5", name: "PS5" }, { value: "ps4", name: "PS4" }],
      has: (game, value) => game.platform === value
    },
    // A source the app downloads by itself, with no CAPTCHA page to pass in a browser.
    { key: "access", options: [{ value: "direct", label: "filters.access.direct" }], has: (game) => Boolean(game.direct) },
    {
      key: "genre",
      options: named(byGames(genres, (game, genre) => game.genres.includes(genre)), "genre"),
      has: (game, value) => game.genres.includes(value)
    },
    { key: "feature", options: named(features, "feature"), has: (game, value) => game.features.includes(value) },
    // The VR headset a game plays on (issue #92): "vr", which tools/vr-games.py writes, on the game or
    // on one of its editions, so a PS4 game whose PS5 edition is for PS VR2 is found by either.
    {
      key: "vr",
      any: true,
      options: [{ value: "psvr", name: "PS VR" }, { value: "psvr2", name: "PS VR2" }],
      has: (game, value) => editionsOf(game).some((edition2) => edition2.vr?.includes(value))
    },
    {
      key: "release",
      any: true,
      options: RELEASES,
      has: (game, value) => game.year != null && RELEASES.find((release) => release.value === value).test(game.year)
    },
    {
      key: "size",
      any: true,
      options: SIZES,
      has: (game, value) => game.sizeGb != null && SIZES.find((size) => size.value === value).test(game.sizeGb)
    },
    { key: "provider", any: true, options: hosts, has: (game, value) => game.providers?.includes(value) }
  ];
  var facetTitle = (key) => t(`filters.facet.${key}`);
  function optionLabel(option) {
    if (!option.label) return option.name;
    const text = t(option.label);
    return text === option.label ? option.name : text;
  }
  var facetLabel = (key, value) => {
    const option = FACETS.find((facet) => facet.key === key).options.find((candidate) => candidate.value === value);
    return option ? optionLabel(option) : value;
  };
  var genreLabel = (genre) => optionLabel({ label: `genre.${slug(genre)}`, name: genre });
  var featureLabel = (feature) => optionLabel({ label: `feature.${slug(feature)}`, name: feature });
  var NO_FILTERS = { ...Object.fromEntries(FACETS.map((facet) => [facet.key, []])), wishlist: false };
  var activeCount = (filters) => FACETS.reduce((sum, facet) => sum + filters[facet.key].length, 0);
  var toggleValue = (list, value) => list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  var passes = (game, facet, picked) => !picked.length || (facet.any ? picked.some((value) => facet.has(game, value)) : picked.every((value) => facet.has(game, value)));
  function matching({ filters, query, wishlist, favoriteKind }, skip) {
    const q = query.trim().toLowerCase();
    // Favorites can hold homebrew apps too; every other list is the game catalog's.
    const pool = filters.wishlist ? [...games, ...homebrewApps()] : games;
    const favorites = filters.wishlist ? new Set(wishlist) : null;
    const activeFacets = FACETS.filter((facet) => facet !== skip && filters[facet.key].length);
    return pool.filter((game) =>
      (!favorites || (favorites.has(game.id) && matchesFavoriteKind(game, favoriteKind))) &&
      (!q || `${game.title} ${game.developer} ${game.publisher}`.toLowerCase().includes(q)) &&
      activeFacets.every((facet) => passes(game, facet, filters[facet.key])));
  }
  var filterGames = (state) => matching(state);
  function facetCounts(state, facet) {
    const pool = matching(state, facet.any ? facet : void 0);
    const counts = Object.fromEntries(facet.options.map(({ value }) => [value, 0]));
    for (const game of pool) {
      for (const { value } of facet.options) {
        if (facet.has(game, value)) counts[value]++;
      }
    }
    return counts;

  }
  function facetSummary({ filters, query, wishlist }) {
    const counts = Object.fromEntries(FACETS.map((facet) => [
      facet.key, Object.fromEntries(facet.options.map(({ value }) => [value, 0]))
    ]));
    const q = query.trim().toLowerCase();
    const favorites = filters.wishlist ? new Set(wishlist) : null;
    const pool = favorites ? [...games, ...homebrewApps()] : games;
    let total = 0;
    for (const game of pool) {
      if (q && !`${game.title} ${game.developer} ${game.publisher}`.toLowerCase().includes(q)) continue;
      if (favorites && !favorites.has(game.id)) continue;
      // A failed OR facet can be ignored for its own counts; an AND facet cannot.
      let failed = -1;
      for (let index = 0; index < FACETS.length; index++) {
        const facet = FACETS[index];
        if (passes(game, facet, filters[facet.key])) continue;
        if (failed !== -1) { failed = -2; break; }
        failed = index;
      }
      if (failed === -2) continue;
      if (failed === -1) total++;
      for (let index = 0; index < FACETS.length; index++) {
        const facet = FACETS[index];
        if (failed !== -1 && (failed !== index || !facet.any)) continue;
        const values = counts[facet.key];
        for (const { value } of facet.options)
          if (facet.has(game, value)) values[value]++;
      }
    }
    return { total, counts };
  }
  var summaryOf = (game) => game.about.find((text) => text.length > 80 && text !== text.toUpperCase()) ?? game.shortDescription;
  function relatedGames(game, limit = 6) {
    if (game.homebrew) return relatedHomebrew(game, limit);
    const shared = (other) => other.genres.filter((genre) => game.genres.includes(genre)).length;
    return games.filter((other) => other.id !== game.id && shared(other) > 0).sort((a, b) => shared(b) - shared(a) || b.recommendations - a.recommendations).slice(0, limit);
  }
  var formatDate3 = (iso) => iso ? formatDate2(iso) : "\u2014";
  function formatCount(n) {
    const short = (value) => formatNumber2(value, { maximumFractionDigits: 1 });
    if (n >= 1e6) return t("units.millions", { n: short(n / 1e6) });
    if (n >= 1e3) return t("units.thousands", { n: short(n / 1e3) });
    return formatNumber2(n);
  }

export { CDN_HOST, FACETS, NO_FILTERS, SORTS, activeCount, addedAt, editionsOf, facetCounts, facetLabel, facetSummary, facetTitle, featureLabel, filterGames, formatCount, formatDate3, fromArchive, genreLabel, genres, getGame, listedId, onCdn, optionLabel, relatedGames, showcase, sortGames, sortLabel, summaryOf, toggleValue, warmCovers };
