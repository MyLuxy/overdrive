// Premiumize (issue #20): the third debrid service, after TorBox and Real-Debrid. premiumize.me
// hands a magnet or a host link to its own servers and answers with direct links; a cached one is
// ready at once, anything else is a transfer that is polled until it finishes.
//
// The API key is the user's own, saved on the console (download-services.js); nothing is sent
// anywhere else. Every answer carries { status, message }; both are logged, so a user's app.log
// says which call answered what.
//
// Written from https://www.premiumize.me/api (2026-10-24), not against a live account: the flows
// follow the documented fields, and any difference shows up in the log lines as the call's own
// status and message.

import { linkInput } from './link-download.js';

  var API = "https://www.premiumize.me/api";
  // A cached file is ready at once; one Premiumize has to fetch waits this long at most, then the
  // user can add it again later (Premiumize keeps fetching it in the meantime).
  var WAIT_MS = 30 * 60e3;
  var FIRST_MS = 2e3;
  var THEN_MS = 5e3;

  function message(json, status) {
    const text = String(json?.message ?? "").trim().replace(/\.$/, "");
    if (status === 401 || status === 403 || /authentication failed|invalid api|api key/i.test(text))
      return "Premiumize rejected the API key. Enter it again in the download settings.";
    if (/rate ?limit|too many requests/i.test(text))
      return "Premiumize is rate limiting the key. Try again in a minute.";
    return text ? `Premiumize: ${text}.` : `Premiumize answered HTTP ${status}.`;
  }

  function baseName(value) {
    const text = String(value ?? "");
    const cut = text.slice(Math.max(text.lastIndexOf("/"), text.lastIndexOf("\\")) + 1);
    return cut || text;
  }

  // The file to download: the largest one, so a release's own .nfo or sample is passed over. A
  // container answer may list bare links instead of { path, size, link }.
  function pickContent(content) {
    if (!Array.isArray(content)) return null;
    let best = null;
    for (const entry of content) {
      const link = typeof entry === "string" ? entry : entry?.link;
      if (typeof link !== "string" || !/^https?:\/\//.test(link)) continue;
      const sizeBytes = Number(typeof entry === "string" ? 0 : entry.size) || 0;
      const path = typeof entry === "string" ? link : entry.path;
      if (!best || sizeBytes > best.sizeBytes) best = { url: link, filename: baseName(path), sizeBytes };
    }
    return best;
  }

  function createPremiumize({ http, key, wait = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms)), now = Date.now, timeoutMs = WAIT_MS }) {
    if (!key) throw new Error("Premiumize is not set up.");

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
        json = text ? JSON.parse(text) : null;
      } catch {
      }
      if (response.status >= 400) {
        // The one line that makes a user's log enough: which call, what it answered, and the reason.
        console.log(`[premiumize] ${path}: HTTP ${response.status} ${text.slice(0, 300)}`);
        throw new Error(message(json, response.status));
      }
      if (!json || typeof json !== "object") throw new Error(`Premiumize answered HTTP ${response.status}.`);
      return json;
    }

    // The direct links for a source Premiumize already holds. Anything it does not hold yet answers
    // status "error" (or no content), which is why the caller has a transfer to fall back on.
    async function direct(src, { signal } = {}) {
      const data = await call("/transfer/directdl", { method: "POST", form: `src=${encodeURIComponent(src)}`, signal });
      const pick = String(data.status) === "success" ? pickContent(data.content) : null;
      if (pick) {
        console.log(`[premiumize] directdl: ${pick.filename} (${pick.sizeBytes} bytes)`);
        return { item: pick };
      }
      const reason = String(data.message ?? (String(data.status) === "success" ? "no file in the answer" : data.status ?? "no reason"));
      console.log(`[premiumize] directdl: not ready (${reason})`);
      return { reason };
    }

    // Adds the source as a transfer for Premiumize to fetch; a container answer already holds links.
    async function create(src, { signal } = {}) {
      const data = await call("/transfer/create", { method: "POST", form: `src=${encodeURIComponent(src)}`, signal });
      if (String(data.status) !== "success") throw new Error(message(data, 200));
      if (data.type === "container") {
        const pick = pickContent(data.content);
        if (pick) return { item: pick };
      }
      const id = data.id != null ? String(data.id) : "";
      if (!id) throw new Error("Premiumize took the link but named no transfer.");
      console.log(`[premiumize] transfer ${id} added`);
      return { id };
    }

    // Waits until the transfer is fetched, reporting progress as a fraction and logging each state
    // change once: a transfer stuck in "queued" in a user's log says exactly that.
    async function fetched(id, { onProgress, signal } = {}) {
      const end = now() + timeoutMs;
      let pause = FIRST_MS;
      let last = "";
      for (;;) {
        const data = await call("/transfer/list", { signal });
        const list = Array.isArray(data.transfers) ? data.transfers : [];
        const item = list.find((entry) => entry && String(entry.id) === id);
        if (!item) {
          console.log(`[premiumize] transfer ${id} is no longer listed; asking for its links`);
          return null;
        }
        const state = String(item.status ?? "");
        if (state !== last) {
          console.log(`[premiumize] transfer ${id}: ${state || "no status"}${item.message ? ` (${item.message})` : ""}`);
          last = state;
        }
        if (onProgress) onProgress({ progress: Math.max(0, Math.min(1, Number(item.progress) || 0)), state });
        if (state === "finished") return item;
        if (state === "error") throw new Error(`Premiumize could not fetch it${item.message ? ` (${item.message})` : ""}.`);
        if (signal?.aborted) throw new Error("Cancelled.");
        if (now() >= end)
          throw new Error("Premiumize is still fetching it. Add it again later: Premiumize keeps working on it.");
        await wait(pause);
        pause = THEN_MS;
      }
    }

    /** Hands the input to Premiumize and waits for the file; resolves to what addLink() needs. */
    async function prepare(input, { onProgress, signal } = {}) {
      const parsed = linkInput(input);
      const src = parsed.value;
      const quick = await direct(src, { signal });
      if (quick.item) return quick.item;
      const created = await create(src, { signal });
      if (created.item) return created.item;
      await fetched(created.id, { onProgress, signal });
      const ready = await direct(src, { signal });
      if (ready.item) return ready.item;
      throw new Error(`Premiumize gave no download link (${quick.reason}).`);
    }

    return { create, direct, fetched, prepare };
  }

export { baseName, createPremiumize, pickContent };
