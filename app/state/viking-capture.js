// ../pub-game-store/native/state/viking-capture.js
// reconstructed from the esbuild bundle in eboot.bin

import { sourceKind, webURL } from './download-sources.js';

  var VIKING_PREFIX = "https://vikingfile.com/d/";
  // The file page a LinkVault vault opens; the capture's page mode returns it.
  var VIKING_PAGE_PREFIX = "https://vikingfile.com/f/";
  var VIKING_PREFIXES = [VIKING_PREFIX, "https://vik1ngfile.site/d/"];
  var vikingPath = (url) => {
    const prefix = VIKING_PREFIXES.find((item) => url.startsWith(item));
    return prefix ? url.slice(prefix.length) : "";
  };
  function entity(text) {
    return text.replace(/&(?:amp|quot|apos|lt|gt|#39|#(\d+)|#x([a-f0-9]+));/gi, (all, decimal, hex) => {
      if (decimal || hex) {
        const code = parseInt(decimal || hex, decimal ? 10 : 16);
        return code <= 1114111 ? String.fromCodePoint(code) : all;
      }
      return { "&amp;": "&", "&quot;": '"', "&apos;": "'", "&#39;": "'", "&lt;": "<", "&gt;": ">" }[all.toLowerCase()] ?? all;
    });
  }
  function element(html, id) {
    const pattern = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/\\1\\s*>`, "i");
    return entity(pattern.exec(html)?.[2].replace(/<[^>]*>/g, "").trim() || "");
  }
  var usableFilename = (filename) => Boolean(filename) && encodeURIComponent(filename).replace(/%[a-f0-9]{2}|./gi, "x").length <= 160 && !/[\/\\\x00-\x1f\x7f]/.test(filename) && !filename.includes("..");
  function vikingMetadata(html, expectedBytes) {
    const filename = element(html, "filename");
    if (!usableFilename(filename))
      throw new Error("Vikingfile did not expose a usable filename. Enter the final file link.");
    const size = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB|TiB)$/i.exec(element(html, "size"));
    if (!size && !expectedBytes) throw new Error("Vikingfile did not expose a file size. Enter the final file link.");
    return { filename, expectedBytes: size ? null : expectedBytes || null, displaySize: size ? {
      value: Number(size[1]),
      precision: (size[1].split(".")[1] || "").length,
      unit: size[2].toUpperCase()
    } : null };
  }
  function matchingVikingURL(url, filename) {
    try {
      webURL(url);
      const path = vikingPath(url);
      if (!/^[a-z0-9]{10}\/[^/?#]+$/i.test(path)) return false;
      const name = path.slice(11);
      // A form encoding writes a space as a literal "+" (the capture accepts it the same way); an
      // encoded plus, %2B, stays a plus either way.
      return decodeURIComponent(name) === filename || decodeURIComponent(name.replace(/\+/g, "%20")) === filename;
    } catch {
      return false;
    }
  }
  var CATALOG_SLACK = 2 ** 30;
  function matchingSize(bytes, metadata) {
    if (metadata.expectedBytes) return bytes === metadata.expectedBytes;
    if (!metadata.displaySize) return !metadata.catalogBytes || Math.abs(bytes - metadata.catalogBytes) <= CATALOG_SLACK;
    const { value, precision, unit } = metadata.displaySize;
    const power = { B: 0, KB: 1, KIB: 1, MB: 2, MIB: 2, GB: 3, GIB: 3, TB: 4, TIB: 4 }[unit];
    return (unit.includes("I") ? [1024] : [1e3, 1024]).some((base) => Math.abs(bytes / base ** power - value) <= 0.5 * 10 ** -precision);
  }
  function transferURL(url) {
    const parsed = webURL(url);
    // Vikingfile hands each file to one of its own servers (ar., am., zo. ... .vikingfile.com, seen
    // 2026-10-18): any of its subdomains is its own.
    const own = ["vikingfile.com", "vik1ngfile.site"].some((domain) => parsed.host === domain || parsed.host.endsWith(`.${domain}`));
    if (!url.startsWith("https://") || parsed.origin !== `https://${parsed.host}` || parsed.path.includes("#") || !(own || parsed.host.endsWith(".s3.bhs.io.cloud.ovh.net") || parsed.host.endsWith(".r2.cloudflarestorage.com"))) {
      // The host only, never the path or query: those carry the file's signed token.
      console.log("[browser-capture] download host refused:", parsed.origin);
      throw new Error("Captured file redirected to an unsupported download host.");
    }
    return url;
  }
  async function rangeProbe(http, url, signal) {
    for (let redirects = 0; redirects <= 5; redirects++) {
      const response = await http.request(transferURL(url), {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        signal,
        maxBytes: 8192,
        followRedirects: false
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) return response;
      const location2 = response.headers?.location;
      if (!location2 || redirects === 5) throw new Error("Captured file exceeded its redirect limit.");
      url = location2.startsWith("/") && !location2.startsWith("//") ? webURL(url).origin + location2 : location2;
    }
  }
  async function validateVikingCapture(http, url, metadata, signal) {
    if (!matchingVikingURL(url, metadata.filename)) throw new Error("Captured link does not match the selected file.");
    const response = await rangeProbe(http, url, signal);
    const range = /^bytes 0-0\/(\d+)$/i.exec(response.headers?.["content-range"] || "");
    const bytes = Number(range?.[1]);
    if (!response.ok || response.status !== 206 || Number(response.headers?.["content-length"]) !== 1 || /html|json|xml|text\//i.test(response.headers?.["content-type"] || "") || (await response.text()).length !== 1 || !Number.isSafeInteger(bytes) || bytes <= 0 || !matchingSize(bytes, metadata))
      throw new Error("Captured file failed validation or expired. Reopen the page and retry.");
    const disposition = response.headers?.["content-disposition"];
    if (disposition) {
      const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
      const plain2 = /filename=(?:"([^"]+)"|([^;]+))/i.exec(disposition);
      const filename = encoded ? decodeURIComponent(encoded) : plain2?.[1] || plain2?.[2]?.trim();
      if (filename && filename !== metadata.filename) throw new Error("Captured response names a different file.");
    }
    const etag = response.headers?.etag;
    if (!/^"[^"\x00-\x20\x7f]*"$/.test(etag || "") && !Number.isFinite(Date.parse(response.headers?.["last-modified"] || "")))
      throw new Error("Captured file has no stable identity. Reopen the page and retry.");
    return { url, expectedBytes: bytes };
  }
  async function describeVikingCapture(http, release, signal) {
    const url = release.browserUrl || release.url;
    const page2 = webURL(url);
    if (!["vikingfile.com", "vik1ngfile.site"].includes(page2.host) || !/^\/f\/[a-z0-9]{10}$/i.test(page2.path))
      throw new Error("Unsupported Vikingfile page. Enter the final file link.");
    const response = await http.request(url, { signal, maxBytes: 1024 * 1024 });
    if (!response.ok) throw new Error(`Vikingfile metadata HTTP ${response.status}. Enter the final file link.`);
    return vikingMetadata(await response.text(), release.sizeBytes);
  }
  function vikingLinkPage(release) {
    const url = release.browserUrl || release.url || "";
    return sourceKind(release) === "browser" && /viki/i.test(`${release.label || ""} ${url.includes("#") ? url.slice(url.indexOf("#")) : ""}`);
  }
  function linkPageMetadata(release) {
    return {
      filename: "",
      part: Number(/\bpart\s*(\d+)\b/i.exec(release.label || release.volume || "")?.[1]) || null,
      expectedBytes: null,
      displaySize: null,
      catalogBytes: release.sizeBytes || null
    };
  }
  // A vault's record may stand for one part of a set; the page it opened has to be that part.
  function requirePart(part, filename) {
    if (part && !new RegExp(`part[\\s._-]*0*${part}(?!\\d)`, "i").test(filename))
      throw new Error(`Captured file is not part ${part}. Reopen the page and download that part.`);
  }

export { VIKING_PAGE_PREFIX, VIKING_PREFIX, describeVikingCapture, linkPageMetadata, requirePart, validateVikingCapture, vikingLinkPage };
