// Browser hosts are paused, except Vikingfile, while each one is tested on the console on its own
// (2026-10-16): a source that needs the console's browser is left out of every game when the
// game's sources load, its host out of Browse's host filter, and a game left with no other host
// out of the catalog (state/catalog.js). Nothing is removed from the catalog data; false brings
// every one of them back. Archive.org stays, its /details/ pages too.

import { sourceKind, webURL } from './download-sources.js';
import { vikingLinkPage } from './viking-capture.js';

  var PAUSE_BROWSER_HOSTS = true;
  // Taken out of the pause one at a time, as each is tested (2026-10-16: DataNodes and FileKeeper,
  // then Buzzheavier and AkiraBox). FileKeeper's own pages need no browser since: download-sources.js resolves
  // them. DataVaults went back: its file is the answer to the captcha form's own post, with no
  // link of its own to capture, and its ads keep the console's browser from the captcha. Buzzheavier
  // went back too: its capture works, but its ads made it too much on the console (2026-10-17).
  var TESTING = ["datanodes.to", "datanodes.co", "akirabox.com", "akirabox.to"];
  // The same hosts behind a LinkVault vault, named by the mirror the link picks (#DataNodes), or by
  // the label's suffix when the link names none ("Fpkg - DataNodes"; FileKeeper's reads "Filek").
  var TESTING_MIRRORS = ["DataNodes", "FileKeeper", "Filek", "AkiraBox"];
  function testing(release) {
    try {
      const url = release.browserUrl || release.url;
      const host = webURL(url).host.replace(/^www\./, "");
      if (host === "link-vault.org") return TESTING_MIRRORS.includes(url.split("#")[1] || (release.label || "").split(" - ").pop());
      return TESTING.some((domain) => host === domain || host.endsWith(`.${domain}`));
    } catch {
      return false;
    }
  }
  // Off for good, not a test: MediaFire removed most of the catalog's files in October 2026 (22 of 25 PS4
  // links checked answered 404, whole PS5 sets went with them) and answers a busy address with HTTP 429.
  // Its sources leave every game as a paused host's do, and a game with no other host leaves the catalog.
  var DISABLED_FILTERS = /* @__PURE__ */ new Set(["mediafire"]);
  function disabled(release) {
    try {
      return /(?:^|\.)mediafire\.com$/i.test(webURL(release.browserUrl || release.url).host);
    } catch {
      return /^mediafire$/i.test(release.provider || "");
    }
  }
  // The catalog's own host keys (game.providers) whose every source needs the browser.
  var PAUSED_FILTERS = /* @__PURE__ */ new Set([
    "1fichier", "datavaults", "buzzheavier", "gofile", "rapidgator", "filecrypt",
    "ranoz", "transfer", "mega", "urlvanish", "fileditchfiles", "tinyurl", "fuckingfast", "rootz.so",
    "1024terabox"
  ]);
  function pausedSource(release) {
    if (disabled(release)) return true;
    if (!PAUSE_BROWSER_HOSTS) return false;
    let kind;
    try {
      kind = sourceKind(release);
    } catch {
      return false;
    }
    if (kind === "vikingfile" || vikingLinkPage(release) || /archive\.org$/i.test(release.provider || "") || testing(release)) return false;
    return kind === "browser" || kind === "datanodes" || kind === "buzzheavier";
  }
  var pausedFilter = (host) => DISABLED_FILTERS.has(host) || PAUSE_BROWSER_HOSTS && PAUSED_FILTERS.has(host);

export { pausedFilter, pausedSource };
