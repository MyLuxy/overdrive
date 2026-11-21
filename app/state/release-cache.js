// ../pub-game-store/native/state/release-cache.js
// reconstructed from the esbuild bundle in eboot.bin

import { pausedSource } from './paused-hosts.js';
import { isDlcPack, isPatchOnly, releaseSets } from './release-sets.js';

  var KEPT2 = 6;
  function createReleaseCache(read) {
    const games2 = /* @__PURE__ */ new Map();
    return (file) => {
      if (!/^data\/releases\/[a-z0-9%_-]+\.json$/i.test(file)) throw new Error("Invalid release data path.");
      let releases = games2.get(file);
      if (!releases) {
        const parsed = JSON.parse(read(file));
        if (!Array.isArray(parsed)) throw new Error("Invalid release data; rebuild the catalog.");
        // Each source carries its game's title ID (CUSA for PS4, PPSA for PS5): the firmware limit on
        // fake PKGs is the PS5's alone, and a source never says which console it is for.
        const titleId = /([a-z0-9]+)\.json$/i.exec(file)[1].toUpperCase();
        // A paused browser host's sources are left out here, before any screen sees them. A source that
        // names its own file's title ID (another region's edition, tools/import-superpsx.py) keeps it:
        // the queue downloads by it, and the browser capture looks for it in the file's name.
        // A DLC pack (the scene's dlc_emu kits) or a backport's files alone go too: nothing on the
        // console installs them, so offering them only leads to a download that then says there was
        // nothing to install. A DLC in a PS5 package stays, as does anything holding the game itself.
        releases = releaseSets(parsed.filter((release) => !pausedSource(release) && !isDlcPack(release) && !isPatchOnly(release)).map((release) => ({
          titleId,
          ...release,
          platform: String(release.platform || "").toLowerCase() === "ps5" ? "ps5"
            : String(release.platform || "").toLowerCase() === "ps4" ? "ps4"
            : (release.titleId || titleId).startsWith("PPSA") ? "ps5" : "ps4"
        })));
        if (games2.size === KEPT2) games2.delete(games2.keys().next().value);
      }
      games2.delete(file);
      games2.set(file, releases);
      return releases;
    };
  }

export { createReleaseCache };
