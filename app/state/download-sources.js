// ../pub-game-store/native/state/download-sources.js
// reconstructed from the esbuild bundle in eboot.bin
// MODIFIED: archiveRefusal, so an Archive.org 401/403 is a dead link, not a browser check.


  function webURL(value) {
    if (typeof value !== "string" || value.length > 8192 || /[\s\\\x00-\x1f]/.test(value)) throw new Error("Invalid HTTP URL.");
    const match = /^(https?):\/\/([a-z0-9.-]+)(:\d{1,5})?([/?#].*)?$/i.exec(value);
    if (!match || !match[2] || match[2].startsWith(".")) throw new Error("Invalid HTTP URL.");
    return { url: value, host: match[2].toLowerCase(), origin: `${match[1].toLowerCase()}://${match[2]}${match[3] || ""}`, path: match[4] || "/" };
  }
  var hosts2 = {
    mediafire: ["mediafire.com"],
    buzzheavier: ["buzzheavier.com"],
    vikingfile: ["vikingfile.com", "vik1ngfile.site"],
    datanodes: ["datanodes.to"],
    filekeeper: ["filekeeper.net"]
  };
  var isHost = (host2, domain) => host2 === domain || host2.endsWith(`.${domain}`);
  // Archive.org answers 401 for a restricted item and 403 for one taken down. Neither is a
  // check a browser can pass: a login there gives the app no access, it only stays in the
  // console's browser. The status, when it is that refusal, else null.
  function archiveRefusal(release, message) {
    try {
      if (!isHost(webURL(release.browserUrl || release.url).host, "archive.org")) return null;
    } catch {
      return null;
    }
    return /\bHTTP (401|403)\b/.exec(message)?.[1] ?? null;
  }
  function sourceKind(release) {
    if (release.manifestUrl) return "manifest";
    const value = release.browserUrl || release.url;
    if (!value) return "unavailable";
    const { host: host2, path } = webURL(value);
    const provider = Object.keys(hosts2).find((name) => hosts2[name].some((domain) => isHost(host2, domain)));
    if (provider === "mediafire" && host2.startsWith("download")) return "direct";
    if (provider === "vikingfile" && /^\/d\//.test(path) && !release.browserUrl) return "direct";
    if (provider) return provider;
    if (host2 === "archive.org" && path.startsWith("/download/") || host2 === "github.com" && path.includes("/releases/download/") || /\.(?:ffpfsc|ffpfs|ffpkg|exfat|pkg|zip|rar|7z)(?:[?#]|$)/i.test(path)) return "direct";
    if (release.requiresBrowser || release.source?.startsWith("pegasus")) return "browser";
    return "direct";
  }
  var decode = (value) => value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  function absolute(value, base) {
    value = decode(value);
    if (value.startsWith("//")) value = `${webURL(base).origin.split(":")[0]}:${value}`;
    else if (value.startsWith("/")) value = webURL(base).origin + value;
    else if (!/^https?:/i.test(value)) value = base.split(/[?#]/)[0].replace(/[^/]*$/, "") + value;
    webURL(value);
    if (base.startsWith("https:") && !value.startsWith("https:")) throw new Error("Provider attempted an insecure redirect.");
    return value;
  }
  function attribute(tag, key) {
    return new RegExp(`(?:^|\\s)${key}\\s*=\\s*["']([^"']*)["']`, "i").exec(tag)?.[1];
  }
  function anchor(html, id) {
    const tag = (html.match(/<a\b[^>]*>/gi) || []).find((value) => attribute(value, "id") === id);
    return tag && attribute(tag, "href");
  }
  var BrowserRequired = class extends Error {
    constructor(url, message = "Browser verification required. Open the source, then enter its final file URL.") {
      super(message);
      this.name = "BrowserRequired";
      this.url = webURL(url).url;
    }
  };
  var htmlResponse = (response) => /(?:text\/html|application\/xhtml)/i.test(response.headers?.["content-type"] || "");
  // A wait the queue's cancel ends early: FileKeeper's countdown.
  var pause = (ms, signal) => new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  var FILEKEEPER_COUNTDOWN_MS = 5e3;
  function createSourceResolver({ http }) {
    async function request(url, options = {}) {
      webURL(url);
      const response = await http.request(url, { maxBytes: 1024 * 1024, ...options });
      if (response.status === 404 || response.status === 410) throw new Error(`Source unavailable: HTTP ${response.status}. Choose another source.`);
      if ([401, 403, 429].includes(response.status)) throw new BrowserRequired(url);
      if (!response.ok && !(response.status >= 300 && response.status < 400)) throw new Error(`Provider HTTP ${response.status}.`);
      return response;
    }
    async function direct(url, signal, headers) {
      webURL(url);
      const response = await request(url, { method: "HEAD", signal, headers });
      if (htmlResponse(response)) throw new BrowserRequired(url);
      if (response.status >= 300) throw new BrowserRequired(url, "The final file redirects with custom headers. Choose another source.");
      return { url: webURL(response.url || url).url, headers, rejectHtml: true };
    }
    // FileKeeper's page has no human check: a five-second countdown, then its Free Download button
    // posts op=download2 with the file's code, and the answer redirects to the file on Datanodes'
    // dlproxy.uk gateway. The page itself keeps the file in a cookie the engine never hands to the
    // app, so the app posts the same form to the file's own address, /<code>, which needs none,
    // after waiting the countdown out.
    async function fileKeeper(url, signal) {
      const code = /^\/([a-z0-9]{12})(?:[/?]|$)/i.exec(webURL(url).path)?.[1];
      if (!code) throw new BrowserRequired(url);
      console.log("[sources] filekeeper", code, "- waiting its countdown, then posting its form");
      await pause(FILEKEEPER_COUNTDOWN_MS, signal);
      if (signal?.aborted) throw new Error("Cancelled.");
      const next = await request(url, {
        signal,
        method: "POST",
        followRedirects: false,
        headers: { "Content-Type": "application/x-www-form-urlencoded", Referer: url },
        body: `op=download2&id=${code}&rand=&referer=&method_free=&down_direct=1`
      });
      const location2 = next.headers?.location;
      console.log("[sources] filekeeper answered HTTP", next.status, location2 ? `with ${webURL(absolute(location2, url)).host}` : "without a file");
      if (!location2) throw new Error("Source unavailable: FileKeeper gave no file. Choose another source.");
      // The catalog's FileKeeper sizes are rounded (1 GiB for a 1.6 GB file), and the engine holds a
      // download to its expected size exactly: the file's own length, from the same HEAD, replaces it.
      const file = absolute(location2, url);
      const head = await request(file, { method: "HEAD", signal });
      if (htmlResponse(head) || head.status >= 300) throw new BrowserRequired(url);
      const bytes = Number(head.headers?.["content-length"]);
      return { url: webURL(head.url || file).url, rejectHtml: true, ...Number.isSafeInteger(bytes) && bytes > 0 ? { expectedBytes: bytes } : {} };
    }
    async function resolve2(release, { signal, directURL } = {}) {
      if (directURL) return direct(directURL, signal);
      const url = release.browserUrl || release.url;
      const kind = sourceKind(release);
      if (kind === "unavailable") throw new Error("Source unavailable: no download URL.");
      // A pasted link may be behind the password of the service it came from (a qBittorrent WebUI):
      // the release then carries the headers to send with it.
      if (kind === "direct") return { url: webURL(url).url, rejectHtml: true, headers: release.headers };
      if (kind === "manifest") throw new Error("Split manifests must be resolved by the queue.");
      // Buzzheavier's pages sit behind a Cloudflare check only a browser passes (403 to the app,
      // 2026-10-17): its file link is captured from the console's browser, as Datanodes' is.
      if (kind === "browser" || kind === "datanodes" || kind === "buzzheavier") throw new BrowserRequired(url);
      if (kind === "filekeeper") return fileKeeper(url, signal);
      const response = await request(url, { signal });
      const base = response.url || url;
      if (response.headers?.["content-disposition"]?.includes("attachment")) return direct(base, signal);
      const html = await response.text();
      let candidate;
      if (kind === "mediafire") candidate = anchor(html, "downloadButton");
      if (kind === "vikingfile") candidate = anchor(html, "download-link");
      if (!candidate) throw new BrowserRequired(url);
      return direct(absolute(candidate, base), signal);
    }
    return { resolve: resolve2 };
  }
  function cancellation() {
    const listeners4 = /* @__PURE__ */ new Set();
    const signal = { aborted: false, addEventListener: (_, fn) => listeners4.add(fn), removeEventListener: (_, fn) => listeners4.delete(fn) };
    return { signal, cancel() {
      signal.aborted = true;
      for (const fn of listeners4) fn();
      listeners4.clear();
    } };
  }

export { archiveRefusal, BrowserRequired, cancellation, createSourceResolver, sourceKind, webURL };
