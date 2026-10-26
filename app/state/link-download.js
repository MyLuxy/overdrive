// A download that starts from something the user pasted (issue #107), not from the catalog: a direct
// file, a host page the app already resolves, a magnet, or a ".torrent" link. The link becomes a game
// and a release the queue accepts as any other, so it queues, pauses, resumes, installs and deletes
// like a catalog download; a torrent goes to the app's own engine (queue.executeTorrent).
//
// A pasted file names no game: the release carries `link`, the queue keeps it out of the game
// checks that would reject a file it does not know (a text file, a video), and the row shows the
// file's name as its title.

import { webURL } from './download-sources.js';

  // The formats download-formats.js routes by name, in its own order (an image, then a package,
  // then an archive), so the format this module derives is the one that accepts the file's name.
  var IMAGES2 = ["ffpkg", "exfat", "ffpfs", "ffpfsc"];
  var ARCHIVES2 = ["zip", "rar", "7z", "tar", "tar.gz", "tgz", "tar.bz2", "tar.xz", "tar.zst"];
  var NAMED2 = [...IMAGES2, "pkg", "fpkg", ...ARCHIVES2];
  var MAX_NAME = 200;
  var FALLBACK = "download";

  function decode2(value) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  // A file name taken from a link: no separators, no control characters, and never so long that the
  // destination path does not fit. The extension stays, since it is what the format is read from.
  function fileName(value) {
    let name = String(value ?? "").replace(/[\\/\x00-\x1f]/g, "_").trim();
    if (!name || name === "." || name === "..") return "";
    if (name.length > MAX_NAME) {
      const extension = /(\.[a-z0-9]{1,8})$/i.exec(name)?.[1] ?? "";
      name = name.slice(0, MAX_NAME - extension.length) + extension;
    }
    return name;
  }

  // The format the file name declares: "pkg" for an .fpkg (download-formats.js treats them alike),
  // otherwise the extension, and "binary" for a name it does not know.
  function formatOf(name) {
    const lower = String(name ?? "").toLowerCase();
    const found = NAMED2.find((extension) => lower.endsWith(`.${extension}`));
    if (!found) return "binary";
    return found === "fpkg" ? "pkg" : found;
  }

  function query2(value) {
    const text = String(value);
    const start = text.indexOf("?");
    if (start < 0) return {};
    const params = {};
    for (const pair of text.slice(start + 1).split("&")) {
      const at = pair.indexOf("=");
      if (at <= 0) continue;
      const key = decode2(pair.slice(0, at));
      if (!(key in params)) params[key] = decode2(pair.slice(at + 1));
    }
    return params;
  }

  // The name a URL gives its file: its last path segment when that names a format, else a
  // `file=`/`filename=`/`name=` in the query (a gateway's own link), else the segment as it is.
  function fileNameOf(value) {
    const text = String(value);
    const path = text.split(/[?#]/)[0];
    const direct = fileName(decode2(path.slice(path.lastIndexOf("/") + 1)));
    if (direct && formatOf(direct) !== "binary") return direct;
    const params = query2(text);
    for (const key of ["file", "filename", "name"]) {
      const candidate = fileName(params[key]);
      if (candidate && formatOf(candidate) !== "binary") return candidate;
    }
    return direct;
  }

  // A BitTorrent infohash as 40 hex digits: a v2 magnet or a base32 v1 one is converted, so the
  // magnet's identity reads the same whichever form the user pasted.
  var BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  function base32Hex(text) {
    if (!/^[a-z2-7]{32}$/i.test(text)) return "";
    let bits = "";
    for (const character of text.toUpperCase()) {
      const value = BASE32.indexOf(character);
      if (value < 0) return "";
      bits += value.toString(2).padStart(5, "0");
    }
    let hex = "";
    for (let i = 0; i + 4 <= bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    return hex;
  }

  // A magnet link's own parts: the link as pasted, its infohash when it names one, and its name.
  // A v1 infohash is 40 hex digits or the 32 base32 ones that transliterate to them; a longer or
  // shorter `xt` names no torrent the engine could fetch, so it leaves `hash` empty.
  function magnetInfo(value) {
    const text = String(value ?? "").trim();
    if (!/^magnet:\?/i.test(text)) return null;
    const params = query2(text);
    const urn = /^urn:btih:(?:([0-9a-f]{40})|([a-z2-7]{32}))$/i.exec(params.xt || "")?.slice(1).find(Boolean) ?? "";
    const hash = urn.length === 32 ? base32Hex(urn) : urn.toLowerCase();
    return { magnet: text, hash, name: fileName(params.dn) };
  }

  // What the user pasted, checked: a magnet link, or an http(s) URL the queue can fetch.
  function linkInput(value) {
    const text = String(value ?? "").trim();
    if (!text) throw new Error("Enter a link or a magnet.");
    const magnet = magnetInfo(text);
    if (magnet) {
      if (!magnet.hash) throw new Error("That is not a magnet link.");
      return { kind: "magnet", value: text, hash: magnet.hash, name: magnet.name };
    }
    webURL(text);
    return { kind: "link", value: text, name: fileNameOf(text) };
  }

  // A short stable id from the link, so pasting the same link twice finds the same job instead of
  // downloading the file a second time under another name.
  function linkId(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  var LINK_GAME = "link";
  function linkGame(title) {
    return { id: LINK_GAME, title: title || FALLBACK, art: {}, releases: [] };
  }

  // The release the queue downloads: its name, its link, the format its name declares, and the
  // headers a service needs for it (a qBittorrent's own download link is behind its password).
  function linkRelease({ url, filename, headers, sizeBytes, title } = {}) {
    const address = webURL(url).url;
    const name = fileName(filename) || fileNameOf(address) || FALLBACK;
    return {
      id: `link-${linkId(address)}`,
      filename: name,
      url: address,
      format: formatOf(name),
      sizeBytes: Number.isSafeInteger(sizeBytes) && sizeBytes > 0 ? sizeBytes : 0,
      title: title || name,
      link: true,
      ...headers && Object.keys(headers).length ? { headers } : {}
    };
  }

  /** Queues a pasted link (or a file a service prepared) on the drive the user chose. */
  function addLink(queue, { url, filename, headers, sizeBytes, title, root } = {}) {
    const release = linkRelease({ url, filename, headers, sizeBytes, title });
    return queue.enqueue(linkGame(title || release.title), release, root);
  }

  // The ".torrent" file's own name, without the extension: it is the sidecar suffix the queue writes
  // beside the destination, so the destination cannot carry it too.
  var TORRENT_FILE = /\.torrent(?:[?#]|$)/i;
  function torrentName(value) {
    return (fileNameOf(value) || "").replace(/\.torrent$/i, "");
  }

  // A torrent the app's own engine fetches. A magnet is named by its `dn` and fetched from its
  // trackers; a ".torrent" link is named by its file and fetched by the queue first. Neither names
  // the file inside it, so the destination is a stem: the headers route it once it is complete.
  function torrentRelease({ magnet, url, filename, title } = {}) {
    const link = String(magnet ?? "").trim();
    const address = link || webURL(url).url;
    const info = link ? magnetInfo(link) : null;
    if (link && !(info && info.hash)) throw new Error("That is not a magnet link.");
    if (!link && !TORRENT_FILE.test(address)) throw new Error("Enter a magnet or a .torrent link.");
    const name = fileName(filename) || (info ? info.name : torrentName(address)) || FALLBACK;
    return {
      id: `link-${linkId(address)}`,
      filename: name,
      url: address,
      format: formatOf(name),
      sizeBytes: 0,
      title: title || name,
      link: true,
      ...info ? { magnet: link } : { torrentUrl: address }
    };
  }

  /** Queues a pasted magnet or ".torrent" link on the drive the user chose. */
  function addTorrent(queue, { magnet, url, filename, title, root } = {}) {
    const release = torrentRelease({ magnet, url, filename, title });
    return queue.enqueue(linkGame(title || release.title), release, root);
  }

export { TORRENT_FILE, addLink, addTorrent, base32Hex, fileName, fileNameOf, formatOf, linkGame, linkId, linkInput, linkRelease, magnetInfo, torrentRelease };
