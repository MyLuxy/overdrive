// TorBox (issue #20): a magnet or a link another host refuses is handed to TorBox's API, which
// fetches it on its own servers and then gives a direct link to the file, which the normal queue
// downloads. TorBox keeps what it fetched, so pasting the same magnet again is instant.
//
// The API key is the user's own, saved on the console (download-services.js); nothing is sent
// anywhere else. Every call answers { success, error, detail, data }; only data is returned.

import { linkInput } from './link-download.js';

  var API = "https://api.torbox.app";
  var TORRENTS = "/v1/api/torrents";
  var WEB = "/v1/api/webdl";
  // A cached file is ready in a second or two; one TorBox has to fetch waits this long at most,
  // then the user can add it again later (TorBox keeps fetching it in the meantime).
  var WAIT_MS = 30 * 60e3;
  var FIRST_MS = 2e3;
  var THEN_MS = 5e3;

  var FAILED = /^(error|failed|missingfiles|uploaderror|downloaderror)$/i;

  // The plan, not the key: TorBox answers this with HTTP 403, the same code as a refused key.
  function planRestricted(json) {
    const text = `${json?.error || ""} ${json?.detail || ""}`;
    return /PLAN_RESTRICTED|not available on your plan/i.test(text);
  }

  function message(json, status) {
    const detail = json && typeof json.detail === "string" ? json.detail.trim() : "";
    const error = json && typeof json.error === "string" ? json.error : "";
    if (/BAD_TOKEN|AUTH_ERROR|BAD_API_KEY|INVALID_TOKEN/i.test(error + detail))
      return "TorBox rejected the API key. Enter it again in the download settings.";
    // A free plan gets 403 PLAN_RESTRICTED_FEATURE from webdl (found on the console, 2026-10-27):
    // the key is good, so asking for it again would send the player in a circle.
    if (planRestricted(json))
      return "TorBox's web downloads need a paid plan. Upgrade the account or use another source.";
    if (/TOO_MANY|RATE_LIMIT/i.test(error + detail)) return "TorBox is rate limiting the key. Try again in a minute.";
    return detail || (error ? `TorBox: ${error}.` : `TorBox answered HTTP ${status}.`);
  }

  // The torrent or web download an answer names, whatever the endpoint calls it.
  function createdId(kind, data) {
    const item = Array.isArray(data) ? data[0] : data;
    if (!item || typeof item !== "object") return null;
    const id = kind === "torrent" ? item.torrent_id ?? item.id : item.web_id ?? item.webdownload_id ?? item.id;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  function listItem(kind, data) {
    const item = Array.isArray(data) ? data.find((entry) => entry && (entry.id ?? entry.torrent_id ?? entry.web_id)) ?? data[0] : data;
    return item && typeof item === "object" ? item : null;
  }

  // Whether the item is fetched and ready: TorBox's own flag, its state, or full progress.
  function ready(item) {
    if (!item) return false;
    if (item.download_finished === true || item.download_present === true) return true;
    if (typeof item.download_state === "string" && /^(cached|completed|uploading)$/i.test(item.download_state)) return true;
    return Number(item.progress) >= 1 && Number(item.size) > 0;
  }

  function failed(item) {
    if (!item) return "";
    const state = String(item.download_state ?? "");
    if (!FAILED.test(state)) return "";
    return `TorBox could not fetch it (${state.toLowerCase()}).`;
  }

  // The file to download: the largest one, so a release's own .nfo or sample is passed over.
  function pickFile(files) {
    if (!Array.isArray(files)) return null;
    let best = null;
    for (const file of files) {
      if (!file || !Number.isSafeInteger(file.id)) continue;
      const size = Number(file.size) || 0;
      if (!best || size > (Number(best.size) || 0)) best = file;
    }
    return best;
  }

  function baseName(value) {
    const text = String(value ?? "");
    const cut = text.slice(text.lastIndexOf("/") + 1);
    return cut || text;
  }

  function createTorbox({ http, key, wait = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms)), now = Date.now, timeoutMs = WAIT_MS }) {
    if (!key) throw new Error("TorBox is not set up.");

    async function call(path, { method = "GET", form, signal } = {}) {
      const response = await http.request(API + path, {
        method,
        signal,
        maxBytes: 1024 * 1024,
        headers: {
          Authorization: `Bearer ${key}`,
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
        },
        ...(form ? { body: form } : {})
      });
      const text = await response.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
      }
      // The reason a link is refused is in the body, and nowhere else: a torrent or a web download
      // that fails says only "Conversion failed" to the user (catalog-torbox.js). Log the endpoint
      // without its query (requestdl carries the key there) and the body without the key in it.
      if (!response.ok || json?.success === false)
        console.log(`[torbox] ${path.split("?")[0]}: HTTP ${response.status} ${String(text).split(key).join("***").slice(0, 300)}`);
      // Whatever the body says, these two are the key — unless the plan is the one refusing it.
      if (response.status === 401 || response.status === 403)
        throw new Error(planRestricted(json) ? message(json, response.status)
          : "TorBox rejected the API key. Enter it again in the download settings.");
      if (!json || typeof json !== "object") throw new Error(`TorBox answered HTTP ${response.status}.`);
      if (!json.success) throw new Error(message(json, response.status));
      return json.data;
    }

    // Adds the link or magnet: a magnet is a torrent, anything else a web download. Both answer
    // with the item's id, which the status and the download link are asked for by.
    async function create(input, { signal } = {}) {
      const parsed = linkInput(input);
      if (parsed.kind === "magnet") {
        const data = await call(`${TORRENTS}/createtorrent`, { method: "POST", form: `magnet=${encodeURIComponent(parsed.value)}`, signal });
        const id = createdId("torrent", data);
        if (!id) throw new Error("TorBox took the magnet but named no torrent.");
        return { kind: "torrent", id };
      }
      const data = await call(`${WEB}/createwebdownload`, { method: "POST", form: `link=${encodeURIComponent(parsed.value)}`, signal });
      const id = createdId("web", data);
      if (!id) throw new Error("TorBox took the link but named no download.");
      return { kind: "web", id };
    }

    async function status({ kind, id }, { signal } = {}) {
      const data = await call(`${kind === "torrent" ? TORRENTS : WEB}/mylist?id=${id}`, { signal });
      return listItem(kind, data);
    }

    // Waits until TorBox has the file, reporting progress as a fraction of the item's size.
    async function fetched(created, { onProgress, signal } = {}) {
      const end = now() + timeoutMs;
      let pause = FIRST_MS;
      for (;;) {
        const item = await status(created, { signal });
        if (!item) throw new Error("TorBox does not list the download any more.");
        const failure = failed(item);
        if (failure) throw new Error(failure);
        if (ready(item) && pickFile(item.files)) return item;
        if (onProgress) onProgress({ progress: Number(item.progress) || 0, state: String(item.download_state ?? "") });
        if (signal?.aborted) throw new Error("Cancelled.");
        if (now() >= end)
          throw new Error("TorBox is still fetching it. Add it again later: TorBox keeps working on it.");
        await wait(pause);
        pause = THEN_MS;
      }
    }

    // The direct link to one file, valid for a few hours and carrying the key.
    async function link({ kind, id }, file, { signal } = {}) {
      const query3 = kind === "torrent" ? `torrent_id=${id}` : `web_id=${id}`;
      const data = await call(`${kind === "torrent" ? TORRENTS : WEB}/requestdl?token=${encodeURIComponent(key)}&${query3}&file_id=${file.id}`, { signal });
      if (typeof data !== "string" || !/^https?:\/\//.test(data)) throw new Error("TorBox gave no download link for the file.");
      return data;
    }

    /** Hands the input to TorBox and waits for the file; resolves to what addLink() needs. */
    async function prepare(input, { onProgress, signal } = {}) {
      const created = await create(input, { signal });
      console.log(`[torbox] added ${created.kind} ${created.id}; waiting for the file`);
      const item = await fetched(created, { onProgress, signal });
      const file = pickFile(item.files);
      const url = await link(created, file, { signal });
      const filename = baseName(file.short_name || file.name);
      console.log(`[torbox] ${created.kind} ${created.id}: ${filename} ready`);
      return { url, filename, sizeBytes: Number(file.size) || 0 };
    }

    return { create, status, prepare };
  }

export { baseName, createTorbox, createdId, pickFile, ready };
