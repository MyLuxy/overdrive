// ../pub-game-store/native/state/release-sets.js
// reconstructed from the esbuild bundle in eboot.bin

import { archivePassword } from './archive-password.js';

  function stableKey(value) {
    let first = 2166136261, second = 5381;
    for (let index = 0; index < value.length; index++) {
      first = Math.imul(first ^ value.charCodeAt(index), 16777619);
      second = Math.imul(second, 33) ^ value.charCodeAt(index);
    }
    return `${(first >>> 0).toString(16)}${(second >>> 0).toString(16)}`;
  }
  var hostKey = (provider) => provider.toLowerCase().replace(/^www\./, "").replace(/\.[a-z]+$/, "");
  // DLPSGAME's "backport files" downloads hold only the eboot and a few files to copy over the base
  // game (issue #8). The catalog sometimes numbers one as a part of a full backport archive; it is
  // its own file, so it never joins a set.
  var PATCH_FILES = /backport[+_ -]*files/i;
  var isPatchOnly = (release) => {
    const first = release.parts?.[0]?.sources[0] ?? release;
    return PATCH_FILES.test(`${first.url || ""} ${first.browserUrl || ""} ${release.label || ""}`);
  };
  // A source that is only DLC, never the game itself: the scene packs these as a dlc_emu kit (an ini and
  // a fakelib of replacement modules) or a DLC package, neither of which a console installs on its own.
  // A label naming the game as well ("Game (DLCs)", "Game + DLC") is the game, so it is not one.
  var isDlc = ({ label }) => /\bDLCs?\b/i.test(label || "") && !/\b(?:game|full)\b|\+\s*(?:all\s+)?DLCs?\b|\bwith\s+(?:all\s+)?DLCs?\b|\bincl/i.test(label);
  // The DLC-only sources a console cannot install: the scene's dlc_emu kits (an ini and a fakelib of
  // replacement modules) and DLC images. A DLC in a PS5 package installs like any other, so it stays.
  var isDlcPack = (release) => isDlc(release) && release.format !== "pkg" && release.format !== "fpkg";
  var VOLUME_NAME =/\bpart(\d+)\.(?:rar|7z|zip)\b/i;
  function missingVolumes(parts, declaredBytes) {
    if (parts.some((part, index) => part.number !== index + 1)) return "gap";
    const volumes = parts.map((part) => VOLUME_NAME.exec(part.name || "")?.[1]);
    if (volumes.some((digits, index) => digits && Number(digits) !== index + 1)) return "renumbered";
    if (parts.length === 1 && volumes[0]) return "count";
    const [first, last] = [parts[0], parts.at(-1)];
    if (volumes[0] && volumes.at(-1) && first.bytes && last.bytes && Math.abs(last.bytes - first.bytes) <= first.bytes / 100 && (!declaredBytes || first.bytes * (parts.length - 1) + last.bytes < declaredBytes * 0.97)) return "last";
    return null;
  }
  function releaseSets(releases) {
    const groups = /* @__PURE__ */ new Map();
    const output = [];
    for (const release of releases) {
      const match = !isPatchOnly(release) && /\bpart\s*(\d+)\b/i.exec(release.label || release.volume || "");
      if (!match) {
        output.push(release);
        continue;
      }
      const number2 = Number(match[1]);
      if (!Number.isSafeInteger(number2) || number2 < 1 || number2 > 1024) {
        output.push({ ...release, unavailableReason: "Invalid volume number." });
        continue;
      }
      const label = (release.label || "").replace(/\bpart\s*\d+\b/i, "").trim();
      const record = release.record ?? release.id.replace(/-\d+$/, "");
      const key = `${record}/${hostKey(release.provider)}/${label.toLowerCase()}`;
      let group = groups.get(key);
      const first = group?.parts.find((part2) => part2.number === 1);
      if (number2 === 1 && first && !first.sources.some((source2) => source2.url === release.url && source2.browserUrl === release.browserUrl)) group = void 0;
      if (!group) {
        group = { ...release, label, format: "archive-set", parts: [], sizeBytes: null, sha256: void 0, volume: void 0 };
        delete group.url;
        delete group.browserUrl;
        delete group.manifestUrl;
        groups.set(key, group);
        output.push(group);
      }
      let part = group.parts.find((part2) => part2.number === number2);
      if (!part) {
        part = { number: number2, sources: [] };
        group.parts.push(part);
      }
      if (!part.sources.some((source2) => source2.url === release.url && source2.browserUrl === release.browserUrl))
        if (part.sources.length) group.unavailableReason = "Ambiguous duplicate volume. Choose another complete set.";
        else part.sources.push(release);
    }
    for (const group of output.filter((release) => release.parts)) {
      group.parts.sort((a, b) => a.number - b.number);
      const spellings = [...new Set(group.parts.map((part) => part.sources[0].provider))].join("+");
      group.id = group.filename = `set-${stableKey(`${spellings}/${group.label.toLowerCase()}/${group.parts[0].sources[0].id}`)}`;
      if (missingVolumes(group.parts.map((part) => ({ number: part.number, name: part.sources[0].url || part.sources[0].browserUrl }))))
        group.unavailableReason = "This source has missing volumes. Choose another complete set.";
      try {
        const password = archivePassword(group);
        if (password !== void 0) group.archivePassword = password;
      } catch (error2) {
        group.unavailableReason = error2.message;
      }
      group.label = `${group.label} \xB7 ${group.parts.length} parts`;
    }
    return output;
  }
  var link = (release) => {
    const first = release.parts?.[0]?.sources[0] ?? release;
    return first.manifestUrl || first.url || first.browserUrl;
  };
  var sameRelease = (saved, release) => saved.id === release.id || Boolean(link(saved)) && link(saved) === link(release) && saved.parts?.length === release.parts?.length;

export { isDlc, isDlcPack, isPatchOnly, releaseSets, sameRelease };
