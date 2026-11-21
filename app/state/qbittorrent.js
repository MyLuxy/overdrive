// qBittorrent on the home network (issue #89): the user's own client fetches the torrent, and the
// WebUI hands the finished file over HTTP, so the console downloads it like any other link.
//
//   GET  /api/v2/app/webapiVersion                         the WebUI's version
//   POST /api/v2/torrents/add          urls=<magnet>        adds the torrent
//   GET  /api/v2/torrents/info?hashes=                      progress of the torrent
//   GET  /api/v2/torrents/files?hash=                       the torrent's files
//   GET  /api/v2/torrents/downloadFile?hash=&file=          the file itself (WebAPI 2.16.0 and up)
//
// Everything is behind the WebUI's password: HTTP Basic, which the WebUI accepts from 2.15.0, the
// same versions that have downloadFile.

import { magnetInfo } from './link-download.js';

  var NEEDED = [2, 16, 0];
  var WAIT_MS = 30 * 60e3;
  var FIRST_MS = 2e3;
  var THEN_MS = 5e3;
  var BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  // Base64 of a "user:password", in UTF-8; QuickJS has no btoa to rely on.
  function base64(text) {
    const bytes = [];
    const value = String(text);
    for (let i = 0; i < value.length; i++) {
      let code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
        code = 0x10000 + ((code - 0xd800) << 10) + (value.charCodeAt(++i) - 0xdc00);
      }
      if (code < 0x80) bytes.push(code);
      else if (code < 0x800) bytes.push(0xc0 | code >> 6, 0x80 | code & 63);
      else if (code < 0x10000) bytes.push(0xe0 | code >> 12, 0x80 | code >> 6 & 63, 0x80 | code & 63);
      else bytes.push(0xf0 | code >> 18, 0x80 | code >> 12 & 63, 0x80 | code >> 6 & 63, 0x80 | code & 63);
    }
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const chunk = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      out += BASE64[chunk >> 18 & 63] + BASE64[chunk >> 12 & 63];
      out += i + 1 < bytes.length ? BASE64[chunk >> 6 & 63] : "=";
      out += i + 2 < bytes.length ? BASE64[chunk & 63] : "=";
    }
    return out;
  }

  function version(parts) {
    return parts.map((part, index) => Number(part) * Math.pow(1000, 2 - index)).reduce((sum, part) => sum + part, 0);
  }

  // The file to download: the largest one that is complete, so a release's own .nfo, a sample or a
  // second episode is passed over.
  function pickFile(files) {
    if (!Array.isArray(files)) return null;
    let best = null;
    for (const file of files) {
      if (!file || typeof file.name !== "string" || !file.name) continue;
      if (Number(file.progress ?? 1) < 1) continue;
      const size = Number(file.size) || 0;
      if (!best || size > (Number(best.size) || 0)) best = file;
    }
    return best;
  }

  function baseName(value) {
    const text = String(value ?? "");
    return text.slice(text.lastIndexOf("/") + 1) || text;
  }

  function createQBittorrent({ http, address, username = "", password = "", wait = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms)), now = Date.now, timeoutMs = WAIT_MS }) {
    if (!address) throw new Error("qBittorrent is not set up.");
    const base = String(address).replace(/\/+$/, "");
    const headers = username || password
      ? { Authorization: `Basic ${base64(`${username}:${password}`)}`, Referer: base }
      : { Referer: base };

    async function request(path, { method = "GET", form, signal, binary = false } = {}) {
      const response = await http.request(base + path, {
        method,
        signal,
        maxBytes: binary ? 1024 : 4 * 1024 * 1024,
        headers: { ...headers, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
        ...(form ? { body: form } : {})
      });
      if (response.status === 401 || response.status === 403)
        throw new Error("qBittorrent refused the login. Check its user and password in the download settings.");
      if (response.status === 404 && path.startsWith("/api/v2/torrents/downloadFile"))
        throw new Error("This qBittorrent cannot hand files over. Update it to a version with WebAPI 2.16.0 or newer.");
      if (!response.ok && response.status !== 200) throw new Error(`qBittorrent answered HTTP ${response.status}.`);
      return response;
    }

    async function webapi() {
      const text = await (await request("/api/v2/app/webapiVersion")).text();
      const parts = String(text).trim().split(".").map((part) => Number(/^\d+/.exec(part)?.[0] ?? 0));
      if (!parts.length || version(parts) < version(NEEDED))
        throw new Error(`qBittorrent's WebUI is version ${String(text).trim() || "unknown"}; handing files over needs ${NEEDED.join(".")} or newer. Update qBittorrent.`);
      return String(text).trim();
    }

    // Adds a magnet (or a link to a .torrent) and returns the hash to watch. A magnet names its own
    // hash; the client's newest torrent is the one just added when the link was a .torrent file.
    async function add(value, { signal } = {}) {
      const text = String(value ?? "").trim();
      const magnet = magnetInfo(text);
      if (!magnet && !/^https?:\/\//i.test(text)) throw new Error("Paste a magnet link, or a link to a .torrent file.");
      const answer = String(await (await request("/api/v2/torrents/add", { method: "POST", form: `urls=${encodeURIComponent(text)}`, signal })).text()).trim();
      if (/fail/i.test(answer)) throw new Error("qBittorrent refused the torrent.");
      if (magnet && magnet.hash.length === 40) return magnet.hash;
      await wait(1e3);
      const list = await (await request("/api/v2/torrents/info?sort=added_on&reverse=true&limit=1", { signal })).json();
      const newest = Array.isArray(list) ? list[0] : null;
      if (!newest?.hash) throw new Error("qBittorrent added it but does not list it.");
      return String(newest.hash).toLowerCase();
    }

    async function status(hash, { signal } = {}) {
      const list = await (await request(`/api/v2/torrents/info?hashes=${hash}`, { signal })).json();
      const item = Array.isArray(list) ? list.find((entry) => String(entry.hash).toLowerCase() === hash) ?? list[0] : null;
      if (!item) throw new Error("qBittorrent does not list the torrent any more.");
      return item;
    }

    // Waits for the torrent to finish, reporting progress as a fraction of its size.
    async function downloaded(hash, { onProgress, signal } = {}) {
      const end = now() + timeoutMs;
      let pause = FIRST_MS;
      for (;;) {
        const item = await status(hash, { signal });
        const state = String(item.state ?? "");
        if (/^(error|missingFiles|unknown)$/i.test(state)) throw new Error(`qBittorrent stopped on it (${state}).`);
        const progress = Number(item.progress) || 0;
        if (progress >= 1) return item;
        if (onProgress) onProgress({ progress, state });
        if (signal?.aborted) throw new Error("Cancelled.");
        if (now() >= end) throw new Error("qBittorrent is still downloading it. Add it again later: the client keeps working on it.");
        await wait(pause);
        pause = THEN_MS;
      }
    }

    /** Adds the torrent, waits for it, and resolves to the file's own WebUI link. */
    async function prepare(input, { onProgress, signal } = {}) {
      const version2 = await webapi();
      console.log(`[qbittorrent] WebAPI ${version2}; adding the torrent`);
      const hash = await add(input, { signal });
      await downloaded(hash, { onProgress, signal });
      const files = await (await request(`/api/v2/torrents/files?hash=${hash}`, { signal })).json();
      const file = pickFile(files);
      if (!file) throw new Error("qBittorrent has no finished file to download.");
      const url = `${base}/api/v2/torrents/downloadFile?hash=${hash}&file=${encodeURIComponent(file.name)}`;
      console.log(`[qbittorrent] ${hash}: ${baseName(file.name)} ready`);
      return { url, filename: baseName(file.name), sizeBytes: Number(file.size) || 0, headers };
    }

    return { add, prepare, status, webapi };
  }

export { base64, createQBittorrent, pickFile };
