// Real-Debrid (issue #20): the second debrid service beside TorBox. A magnet becomes a torrent
// Real-Debrid fetches on its servers, a host link is unrestricted straight away; either way the
// answer is a direct link the normal queue downloads. Real-Debrid keeps what it fetched, so the same
// torrent added again is instant.
//
// The token is the user's own, saved on the console (download-services.js); nothing is sent
// anywhere else. The REST API answers HTTP errors with { error, error_code }, so both are logged:
// a user's app.log names the call, the code and Real-Debrid's own message.
//
// A token from the phone login (device-login.js) lasts hours: `renew` gets a new one before it runs
// out, and once more if Real-Debrid refuses the old one; a token typed by hand comes with no `renew`.
//
// Written from https://api.real-debrid.com/ (2026-10-24), not against a live account: the flows
// below follow the documented fields, and any difference shows up in the log lines as the call's
// own status and error code.

import { linkInput } from './link-download.js';

  var API = "https://api.real-debrid.com/rest/1.0";
  // A cached torrent is ready in seconds; one Real-Debrid has to fetch waits this long at most,
  // then the user can add it again later (Real-Debrid keeps fetching it in the meantime).
  var WAIT_MS = 30 * 60e3;
  var FIRST_MS = 2e3;
  var THEN_MS = 5e3;

  var FAILED = /^(magnet_error|error|virus|dead)$/;
  var DONE = "downloaded";

  function message(json, status) {
    const error = String(json?.error ?? "").trim();
    const code = Number(json?.error_code) || 0;
    if (status === 401 || code === 8 || /bad_token/i.test(error))
      return "Real-Debrid rejected the token. Enter it again in the download settings.";
    if (code === 9 || code === 14 || /permission_denied|account_locked/i.test(error))
      return "Real-Debrid refused the account: it is locked or not premium.";
    if (code === 24 || /unavailable_file|file_unavailable/i.test(error))
      return "Real-Debrid has that file unavailable.";
    if (code === 25 || /service_unavailable/i.test(error))
      return "Real-Debrid is unavailable right now. Try again later.";
    if (code === 34 || /too_many_requests/i.test(error) || status === 429)
      return "Real-Debrid is rate limiting the token. Try again in a minute.";
    return error ? `Real-Debrid: ${error}${code ? ` (code ${code})` : ""}.` : `Real-Debrid answered HTTP ${status}.`;
  }

  function baseName(value) {
    const text = String(value ?? "");
    const cut = text.slice(text.lastIndexOf("/") + 1);
    return cut || text;
  }

  // The file to download: the largest one, so a release's own .nfo or sample is passed over.
  function pickFile(files) {
    if (!Array.isArray(files)) return null;
    let best = null;
    for (const file of files) {
      if (!file || !Number.isSafeInteger(file.id)) continue;
      const size = Number(file.bytes) || 0;
      if (!best || size > (Number(best.bytes) || 0)) best = file;
    }
    return best;
  }

  function createRealDebrid({ http, key, renew = null, expiresAt = 0, wait = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms)), now = Date.now, timeoutMs = WAIT_MS }) {
    if (!key) throw new Error("Real-Debrid is not set up.");
    let renewed = null;
    // One renewal at a time, shared by the calls that wait for it.
    const fresh = async (signal) => {
      renewed ?? (renewed = renew({ signal }).then((token) => {
        key = token.realdebrid;
        expiresAt = Number(token.realdebridExpires) || 0;
        return token;
      }).finally(() => {
        renewed = null;
      }));
      return renewed;
    };

    async function call(path, { method = "GET", form, signal, again = true } = {}) {
      // A minute early, so no call goes out with a token about to lapse.
      if (renew && expiresAt && now() > expiresAt - 60e3) await fresh(signal);
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
        json = text ? JSON.parse(text) : null;
      } catch {
      }
      if (response.status === 204) return null;
      if (response.status === 401 && renew && again) {
        console.log(`[realdebrid] ${path}: HTTP 401, renewing the token`);
        await fresh(signal);
        return call(path, { method, form, signal, again: false });
      }
      if (response.status >= 400) {
        // The one line that makes a user's log enough: which call, what it answered, and the reason.
        console.log(`[realdebrid] ${path}: HTTP ${response.status} ${text.slice(0, 300)}`);
        throw new Error(message(json, response.status));
      }
      return json;
    }

    async function status(id, { signal } = {}) {
      return call(`/torrents/info/${encodeURIComponent(id)}`, { signal });
    }

    // Adds the magnet; Real-Debrid answers the torrent's id, which the rest is asked for by.
    async function addMagnet(magnet, { signal } = {}) {
      const data = await call("/torrents/addMagnet", { method: "POST", form: `magnet=${encodeURIComponent(magnet)}`, signal });
      const id = data && data.id != null ? String(data.id) : "";
      if (!id) throw new Error("Real-Debrid took the magnet but named no torrent.");
      console.log(`[realdebrid] magnet added: torrent ${id}`);
      return id;
    }

    // Tells Real-Debrid which files the torrent's download should keep: only the one that is wanted,
    // so its link list holds one entry instead of the release's samples and subtitles.
    async function selectFiles(id, files, { signal } = {}) {
      await call(`/torrents/selectFiles/${encodeURIComponent(id)}`, { method: "POST", form: `files=${encodeURIComponent(files)}`, signal });
      console.log(`[realdebrid] torrent ${id}: selected files ${files}`);
    }

    // Waits until Real-Debrid has the torrent, selecting its largest file on the way, and reports
    // each state change once: a log that shows a torrent stuck in magnet_conversion says why.
    async function fetched(id, { onProgress, signal } = {}) {
      const end = now() + timeoutMs;
      let pause = FIRST_MS;
      let last = "";
      let selected = false;
      const select = async (files) => {
        const file = pickFile(files);
        if (!file) throw new Error("Real-Debrid lists no file to download.");
        await selectFiles(id, String(file.id), { signal });
        selected = true;
      };
      for (;;) {
        const item = await status(id, { signal });
        if (!item) throw new Error("Real-Debrid does not list the torrent any more.");
        const state = String(item.status ?? "");
        const progress = Math.max(0, Math.min(1, Number(item.progress) / 100 || 0));
        if (state !== last) {
          console.log(`[realdebrid] torrent ${id}: ${state || "no status"} (${Math.round(progress * 100)}%)`);
          last = state;
        }
        if (onProgress) onProgress({ progress, state });
        if (FAILED.test(state)) throw new Error(`Real-Debrid could not fetch it (${state}).`);
        if (state === "waiting_files_selection") {
          if (selected) throw new Error("Real-Debrid did not start the download after its files were selected.");
          await select(item.files);
        }
        if (state === DONE) {
          if (Array.isArray(item.links) && item.links.length) return item;
          // Finished, but nothing was selected yet: pick the file and wait for its link.
          if (selected) throw new Error("Real-Debrid finished the torrent but gave no download link.");
          await select(item.files);
        }
        if (signal?.aborted) throw new Error("Cancelled.");
        if (now() >= end)
          throw new Error("Real-Debrid is still fetching it. Add it again later: Real-Debrid keeps working on it.");
        await wait(pause);
        pause = THEN_MS;
      }
    }

    // The direct link for one hoster link, valid for a few hours: Real-Debrid turns its own
    // https://real-debrid.com/d/… into one on a download node.
    async function unrestrict(link, { signal } = {}) {
      const data = await call("/unrestrict/link", { method: "POST", form: `link=${encodeURIComponent(link)}`, signal });
      const url = String(data?.download ?? "");
      if (!/^https?:\/\//.test(url)) throw new Error("Real-Debrid gave no download link for the file.");
      const filename = baseName(data.filename);
      console.log(`[realdebrid] unrestrict ${data.host ?? "-"}: ${filename} (${Number(data.filesize) || 0} bytes)`);
      return { url, filename, sizeBytes: Number(data.filesize) || 0 };
    }

    /** Hands the input to Real-Debrid and waits for the file; resolves to what addLink() needs. */
    async function prepare(input, { onProgress, signal } = {}) {
      const parsed = linkInput(input);
      if (parsed.kind !== "magnet") return unrestrict(parsed.value, { signal });
      const id = await addMagnet(parsed.value, { signal });
      const item = await fetched(id, { onProgress, signal });
      const link = item.links[0];
      const file = pickFile(item.files);
      const prepared = await unrestrict(link, { signal });
      // A torrent's own name is the file's when the link leaves it out.
      if (file) prepared.filename = prepared.filename || baseName(file.path);
      console.log(`[realdebrid] torrent ${id}: ${prepared.filename} ready`);
      return prepared;
    }

    return { addMagnet, status, prepare, unrestrict };
  }

export { baseName, createRealDebrid, pickFile };
