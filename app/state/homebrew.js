// The Homebrew section: native PS5 apps and games from the community catalog behind prosperostore.net
// (github.com/darkxex/ps5-homebrew-catalog). The game catalog ships inside the app; this one is read
// at run time from the catalog's store API (docs/api.md there), so a new app or release shows without
// a new Overdrive. The list, index.json, is kept on disk for the next launch; an app's own file, with
// its download and SHA-256, is read when its page opens. Every file comes from its developer's GitHub
// release, and the queue checks its bytes against that SHA-256 before anything is installed.
// The catalog also signs its manifest (Ed25519), but Http hands JavaScript text and the signature is
// 64 raw bytes, so HTTPS vouches for the lists here.
//
// An app becomes an entry shaped like a catalog game, so its page, card, download and install are the
// game's own; its id is "hb-" and the catalog's id, apart from any game's title id.

import { useEffect, useState } from 'react';
import { t } from '../i18n/core.js';
import { isRecord, readJSON } from './read-json.js';
import { FileSystem, Http } from '@ps5-react/core';

  var API = "https://prosperostore.net/api/v1";
  var DIR = `${FileSystem.dataDir}/overdrive`;
  var CACHE = `${DIR}/homebrew.json`;
  var PREFIX = "hb-";
  var MAX_BYTES = 4 * 1024 * 1024;
  // What the queue installs: a zip of the app folder (every listing since the catalog made it the only
  // format), or an image ShadowMount+ mounts as it is.
  var INSTALLABLE = /* @__PURE__ */ new Set(["zip", "ffpfsc", "ffpfs", "ffpkg", "exfat"]);
  // The catalog's categories under the names the genre labels translate (genre.<slug> in the locales).
  var CATEGORIES = {
    "console-ports": "Console Ports",
    emulators: "Emulators",
    video: "Video",
    "pc-ports": "PC Ports",
    utilities: "Utilities",
    streaming: "Streaming",
    music: "Music",
    tools: "Tools",
    ai: "AI",
    "homebrew-games": "Homebrew Games"
  };
  var KINDS = ["app", "game", "tool"];
  var TITLE_ID = /^[A-Z]{4}\d{5}$/;
  var APP_ID = /^[A-Za-z0-9_-]{1,80}$/;
  var SHA256 = /^[0-9a-f]{64}$/i;
  var text = (value, max) => typeof value === "string" && value.length <= max ? value : "";
  var https = (value) => typeof value === "string" && value.length <= 2048 && /^https:\/\/[a-z0-9.-]+\//i.test(value) && !/[\s\\]/.test(value) ? value : null;
  var bytes = (value) => Number.isSafeInteger(value) && value > 0 ? value : null;
  var safe = (value) => String(value).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60);
  function categoryName(category) {
    if (CATEGORIES[category]) return CATEGORIES[category];
    return text(category, 40).split(/[-_ ]+/).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join(" ");
  }
  var details = /* @__PURE__ */ new Map();
  var Entry = {
    get releases() {
      const app = details.get(this.id);
      if (!app || !this.hasDownloads) return [];
      const version = safe(app.version || "release");
      return [{
        id: `homebrew-${version}`,
        provider: "GitHub",
        label: "",
        version: app.version || void 0,
        url: app.artifact_url,
        format: app.format,
        filename: `${this.titleId}-${version}.${app.format}`,
        sizeBytes: app.size || this.homebrew.size || null,
        sha256: app.sha256.toLowerCase(),
        source: "homebrew"
      }];
    },
    get about() {
      const app = details.get(this.id);
      if (!app) return [];
      const notes = (app.release_notes || "").split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean);
      // An upper-case line is a heading to About.
      const heading = t("homebrew.releaseNotes", { version: app.version || "" }).toUpperCase();
      return [app.description, ...notes.length ? [heading, ...notes] : []].filter(Boolean);
    },
    get shots() {
      return [];
    },
    get shortDescription() {
      return details.get(this.id)?.description ?? "";
    }
  };
  function toEntry(item) {
    if (!isRecord(item) || item.status !== "available" || !APP_ID.test(item.id ?? "") || !TITLE_ID.test(item.titleid ?? "")) return null;
    const title = text(item.name, 200).trim();
    if (!title) return null;
    const format = text(item.format, 12).toLowerCase();
    const released = text(item.released, 40) || text(item.updated, 40);
    const size = bytes(item.size);
    const entry2 = {
      id: `${PREFIX}${item.id}`,
      titleId: item.titleid,
      title,
      platform: "ps5",
      platforms: ["ps5"],
      providers: ["github"],
      direct: true,
      developer: text(item.author, 120),
      publisher: text(item.author, 120),
      releaseDate: released,
      year: /^\d{4}/.test(released) ? Number(released.slice(0, 4)) : null,
      genres: item.category ? [categoryName(item.category)] : [],
      features: [],
      recommendations: 0,
      metacritic: null,
      sizeGb: size ? size / 1e9 : null,
      art: { cover: https(item.icon_small), square: true },
      hasDownloads: INSTALLABLE.has(format),
      homebrew: {
        apiId: item.id,
        kind: KINDS.includes(item.kind) ? item.kind : "app",
        category: text(item.category, 40),
        version: text(item.version, 60),
        contentVersion: text(item.content_version, 20),
        format,
        size,
        sandbox: ["stays", "leaves", "unclear"].includes(item.sandbox) ? item.sandbox : null
      }
    };
    return Object.setPrototypeOf(entry2, Entry);
  }
  // Newest release first: what changed lately is what a visitor has not seen yet.
  var byRelease = (a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.title.localeCompare(b.title);
  var apps = [];
  var byId = /* @__PURE__ */ new Map();
  var status = "idle";
  var listeners = /* @__PURE__ */ new Set();
  var notify = () => listeners.forEach((listener) => listener());
  function adopt(index) {
    const seen = /* @__PURE__ */ new Set();
    const list = (Array.isArray(index?.apps) ? index.apps : []).map(toEntry).filter((entry2) => entry2 && !seen.has(entry2.id) && seen.add(entry2.id));
    apps = list.sort(byRelease);
    byId = new Map(apps.map((entry2) => [entry2.id, entry2]));
    for (const id of details.keys()) if (!byId.has(id)) details.delete(id);
    return apps.length;
  }
  // The last list read, so the section shows at once on the next launch, offline too.
  var cached = readJSON(FileSystem, CACHE, null, isRecord, (message) => console.log(`[homebrew] cache: ${message}`));
  if (cached) adopt(cached);
  if (apps.length) status = "ready";
  var request = null;
  async function fetchJSON(path) {
    const response = await Http.request(`${API}/${path}`, { headers: { Accept: "application/json", "User-Agent": "Overdrive" }, maxBytes: MAX_BYTES });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }
  // Reads the list once a launch, or again after a failure when asked; a second call while one is
  // running waits for it.
  function refresh(force = false) {
    if (request) return request;
    if (status === "fresh" && !force) return Promise.resolve();
    if (!apps.length) {
      status = "loading";
      notify();
    }
    request = fetchJSON("index.json").then((index) => {
      if (!adopt(index)) throw new Error("the catalog listed no app");
      status = "fresh";
      try {
        FileSystem.mkdir(DIR, { recursive: true });
        FileSystem.writeFile(`${CACHE}.tmp`, JSON.stringify({ apps: index.apps }));
        FileSystem.rename(`${CACHE}.tmp`, CACHE);
      } catch (error2) {
        console.log(`[homebrew] list not kept: ${error2.message}`);
      }
      console.log(`[homebrew] ${apps.length} apps listed`);
    }).catch((error2) => {
      console.log(`[homebrew] list not read: ${error2.message}`);
      status = apps.length ? "ready" : "failed";
    }).finally(() => {
      request = null;
      notify();
    });
    return request;
  }
  var loading = /* @__PURE__ */ new Map();
  // An app's own file: its description, release notes, download and SHA-256. Checked against the list
  // (same title id, an installable format, a GitHub release file), else the page offers no download.
  function loadDetails(entry2) {
    if (details.has(entry2.id)) return Promise.resolve(entry2);
    if (loading.has(entry2.id)) return loading.get(entry2.id);
    const pending = fetchJSON(`apps/${encodeURIComponent(entry2.homebrew.apiId)}.json`).then((app) => {
      const artifact = https(app?.artifact_url);
      if (!isRecord(app) || app.titleid !== entry2.titleId || app.status !== "available") throw new Error("the app's file does not match the list");
      if (!artifact || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//i.test(artifact) || !SHA256.test(app.sha256 ?? "")) throw new Error("the app's download is not a pinned GitHub release file");
      const format = text(app.format, 12).toLowerCase();
      details.set(entry2.id, {
        description: text(app.description, 4e3).trim(),
        release_notes: text(app.release_notes, 8e3),
        version: text(app.version, 60),
        artifact_url: artifact,
        sha256: app.sha256,
        format: INSTALLABLE.has(format) ? format : entry2.homebrew.format,
        size: bytes(app.size),
        license: text(app.license, 60),
        source_repo: https(app.source_repo)
      });
      entry2.hasDownloads = INSTALLABLE.has(format);
      return entry2;
    }).finally(() => loading.delete(entry2.id));
    loading.set(entry2.id, pending);
    return pending;
  }
  var detailsOf = (entry2) => details.get(entry2.id) ?? null;
  var isHomebrewId = (id) => typeof id === "string" && id.startsWith(PREFIX);
  var getHomebrew = (id) => byId.get(id);
  var homebrewApps = () => apps;
  // Other homebrew only, never a catalog game: the same category first, then the same kind.
  function relatedHomebrew(entry2, limit = 6) {
    const score = (other) => (other.homebrew.category === entry2.homebrew.category ? 2 : 0) + (other.homebrew.kind === entry2.homebrew.kind ? 1 : 0);
    return apps.filter((other) => other.id !== entry2.id).map((other, index) => ({ other, index, score: score(other) })).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(({ other }) => other);
  }
  function useHomebrew() {
    const [, setVersion] = (0, useState)(0);
    (0, useEffect)(() => {
      const listener = () => setVersion((count) => count + 1);
      listeners.add(listener);
      void refresh();
      return () => listeners.delete(listener);
    }, []);
    return { apps, status };
  }

export { KINDS, detailsOf, getHomebrew, homebrewApps, isHomebrewId, loadDetails, refresh, relatedHomebrew, useHomebrew };
