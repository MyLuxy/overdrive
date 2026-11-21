// The catalog's nightly update (.github/workflows/catalog.yml): the games Pegasus and SuperPSX added or
// changed since this version's release, which tools/catalog-update.py publishes as catalog-update.json
// on the repository's "catalog" branch. It is read once a launch, in the background, and kept on disk;
// the next launch applies it before any list is made (state/catalog.js), so no list changes under the
// player. An update for another version, or one that fails a check, is never applied: the last good
// one stays, and without one the catalog is the build's own. A release folds the updates into its
// own catalog, and the next nightly update starts again from it.

import { VERSION } from '../version.js';
import { isRecord, readJSON } from './read-json.js';
import { FileSystem, Http } from '@ps5-react/core';

  var URL2 = "https://raw.githubusercontent.com/MyLuxy/overdrive/catalog/catalog-update.json";
  var DIR = `${FileSystem.dataDir}/overdrive`;
  var FILE = `${DIR}/catalog-update.json`;
  var TAG = `${DIR}/catalog-update.etag`;
  // The most network.request reads (native network_api.cpp: more is refused before any request);
  // tools/catalog-update.py publishes nothing bigger.
  var MAX_BYTES = 4 * 1024 * 1024;
  var ID = /^[A-Z]{4}\d{5}$/;
  var log = (message) => console.log(`[catalog-update] ${message}`);
  var isText = (value, max = 4096) => typeof value === "string" && value.length <= max;
  var isTextList = (value) => Array.isArray(value) && value.length <= 64 && value.every((item) => isText(item, 200));
  var optional = (value, test) => value === void 0 || test(value);
  var isNumber = (value) => typeof value === "number" && Number.isFinite(value);
  // A game with no art of its own has none or null (20 such in the build's catalog).
  var isArt = (value) => value === null || isText(value);
  // What the screens read from a catalog entry, with the types they read it as: a sort compares
  // releaseDate as text and recommendations as a number, the filters walk genres and features.
  function validGame(line) {
    return isRecord(line) && ID.test(line.id ?? "") && isText(line.title, 300) && line.title.length > 0 &&
      (line.platform === "ps4" || line.platform === "ps5") && isTextList(line.providers) && isTextList(line.genres) &&
      isTextList(line.features) && isText(line.releaseDate, 10) && isText(line.developer, 300) && isText(line.publisher, 300) &&
      isNumber(line.recommendations) && isRecord(line.art) && optional(line.art.cover, isArt) && optional(line.art.hero, isArt) &&
      optional(line.art.tint, (tint) => /^#[0-9a-f]{6}$/i.test(tint)) && optional(line.year, isNumber) &&
      optional(line.sizeGb, (size) => size === null || isNumber(size)) && optional(line.work, Number.isSafeInteger) &&
      optional(line.vr, isTextList) && optional(line.added, (added) => isText(added, 10)) && optional(line.updated, (updated) => isText(updated, 10)) && optional(line.direct, (direct) => typeof direct === "boolean");
  }
  var validRelease = (record) => isRecord(record) && isText(record.id, 200) && isText(record.filename, 220) && isText(record.format, 20);
  var validPage = (page) => isRecord(page) && Array.isArray(page.about) && Array.isArray(page.shots);
  function valid(update) {
    if (!isRecord(update) || update.format !== 1 || !isText(update.version, 20) || !Array.isArray(update.games) || !Array.isArray(update.removed)) return false;
    if (!update.games.every((game) => isRecord(game) && (game.block === "games" || game.block === "twins") && validGame(game.line))) return false;
    if (!update.removed.every((id) => ID.test(id))) return false;
    for (const [field, check] of [["releases", (rows) => Array.isArray(rows) && rows.every(validRelease)], ["pages", validPage]]) {
      if (!isRecord(update[field])) return false;
      for (const [id, value] of Object.entries(update[field])) if (!ID.test(id) || value !== null && !check(value)) return false;
    }
    return true;
  }
  // The update kept by the last launch, for this version only.
  function loadUpdate() {
    const update = readJSON(FileSystem, FILE, null, valid, log);
    if (!update) return null;
    if (update.version !== VERSION) {
      log(`kept update is for ${update.version}, this is ${VERSION}: not applied`);
      return null;
    }
    return update;
  }
  // Into the data module's own arrays, before state/catalog.js makes anything of them: an entry the
  // update names replaces the build's (in whichever block it is now), a removed one goes. Returns the
  // release and page files the update replaces, by their data path; null for a file it removed.
  function applyUpdate(update, games, twins) {
    const named = new Set([...update.games.map((game) => game.line.id), ...update.removed]);
    for (const list of [games, twins])
      for (let index = list.length - 1; index >= 0; index--) if (named.has(list[index].id)) list.splice(index, 1);
    for (const game of update.games) (game.block === "twins" ? twins : games).push(game.line);
    const files = /* @__PURE__ */ new Map();
    for (const [folder, field] of [["releases", "releases"], ["pages", "pages"]])
      for (const [id, value] of Object.entries(update[field])) files.set(`data/${folder}/${encodeURIComponent(id)}.json`, value === null ? null : JSON.stringify(value));
    const added = update.games.filter((game) => game.line.added).length;
    log(`applied the update of ${update.generated}: ${update.games.length} entries (${added} dated), ${update.removed.length} removed, ${files.size} files`);
    return files;
  }
  // Once a launch, after the start: the update for the next one. Unchanged (the same ETag) it is not
  // read again; one that fails a check is not kept, nor one for another version.
  async function fetchUpdate() {
    try {
      const etag = FileSystem.exists(FILE) && FileSystem.exists(TAG) ? FileSystem.readFile(TAG).trim() : "";
      const response = await Http.request(URL2, { headers: { Accept: "application/json", "User-Agent": "Overdrive", ...etag ? { "If-None-Match": etag } : {} }, maxBytes: MAX_BYTES });
      if (response.status === 304) {
        log("no change since the kept update");
        return;
      }
      if (response.status === 404) {
        log("no update published");
        return;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.text();
      const update = JSON.parse(body);
      if (!valid(update)) throw new Error("it failed its checks");
      if (update.version !== VERSION) {
        log(`the published update is for ${update.version}, this is ${VERSION}: not kept`);
        return;
      }
      FileSystem.mkdir(DIR, { recursive: true });
      FileSystem.writeFile(`${FILE}.tmp`, body);
      FileSystem.rename(`${FILE}.tmp`, FILE);
      if (response.headers.etag) FileSystem.writeFile(TAG, response.headers.etag);
      log(`kept the update of ${update.generated} (${update.games.length} entries) for the next launch`);
    } catch (error2) {
      log(`not read: ${error2.message}`);
    }
  }

export { applyUpdate, fetchUpdate, loadUpdate, valid };
