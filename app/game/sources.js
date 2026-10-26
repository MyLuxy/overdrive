// ../pub-game-store/native/game/sources.js
// reconstructed from the esbuild bundle in eboot.bin

import { t } from '../i18n/core.js';
import { sourceKind } from '../state/download-sources.js';
import { isPs5Package } from '../state/firmware.js';
import { isDlc, isPatchOnly } from '../state/release-sets.js';
import { formatBytes } from '../state/size.js';

  var KIND = {
    ffpfsc: "sources.kind.image",
    ffpfs: "sources.kind.image",
    ffpkg: "sources.kind.image",
    exfat: "sources.kind.image",
    pkg: "sources.kind.package",
    fpkg: "sources.kind.package",
    "archive-set": "sources.kind.archive"
  };
  function edition({ label, provider }) {
    const text = (label || "").replace(/\s*·\s*\d+ parts$/, "").trim();
    const split = text.lastIndexOf(" - ");
    const host2 = provider.toLowerCase().replace(/^www\./, "").slice(0, 4);
    const edition2 = split >= 0 && text.slice(split + 3).toLowerCase().startsWith(host2) ? text.slice(0, split) : text;
    return provider.toLowerCase().startsWith(edition2.toLowerCase()) ? "" : edition2;
  }
  var GATED = /* @__PURE__ */ new Set(["vikingfile", "buzzheavier"]);
  function access(release) {
    const first = release.parts?.[0]?.sources[0] ?? release;
    let kind;
    try {
      kind = sourceKind(first);
    } catch {
      return "browser";
    }
    if (kind === "direct" || kind === "manifest") return "direct";
    if (kind === "torrent") return "torrent";
    return kind === "browser" || kind === "datanodes" || kind === "unavailable" || GATED.has(kind) ? "browser" : "page";
  }
  // The firmware a source needs, from its label ("USA 10.xx Base", "10.xx BackPort 4.xx"): a backport
  // runs from the lowest firmware it names, anything else needs the highest. Null when it names none.
  function requiredFirmware(release) {
    const named = [...(release.label || "").matchAll(/\b(\d{1,2})\.xx\b/gi)].map((match) => Number(match[1]));
    if (!named.length) return null;
    return isBackport(release) ? Math.min(...named) : Math.max(...named);
  }
  // A line under the source for what it is beyond a game image (issue #13). Nothing reads the
  // console's firmware here: the jailbreak can raise what the title is told (13.59 on a 13.20
  // console), so a "works on your firmware" verdict could be wrong either way. The firmware a source
  // needs is shown where the player checks it themselves (game details, the download tips).
  function compatibility(release) {
    if (isPatchOnly(release)) return { tone: "warn", text: t("sources.status.patch") };
    // A PS5 PKG's firmware limit outweighs its being a DLC: the source list has room for one line.
    if (isPs5Package(release)) return { tone: "warn", text: t("sources.status.package") };
    if (isDlc(release)) return { tone: "info", text: t("sources.status.dlc") };
    return null;
  }
  var SPEED = { "archive.org": "sources.speed.archive", mediafire: "sources.speed.mediafire", "overdrive cdn": "sources.cdnFastest" };
  var isOverdriveCdn = (provider) => /^overdrive\s*cdn$/i.test(provider ?? "");
  function describeSource(release) {
    const parts = release.parts?.length;
    const detail2 = [
      edition(release),
      release.version ? `v${release.version.replace(/^v/i, "")}` : null,
      isPatchOnly(release) ? t("sources.kind.patch") : KIND[release.format] && t(KIND[release.format]),
      parts ? t("sources.parts", { count: parts }) : null
    ].filter(Boolean).join(" \xB7 ");
    const reach = access(release);
    const speed = SPEED[release.provider.toLowerCase()];
    return {
      name: release.provider.replace(/^www\./, ""),
      detail: speed ? [detail2, t(speed)].filter(Boolean).join(" \xB7 ") : detail2,
      size: release.sizeBytes ? formatBytes(release.sizeBytes) : null,
      group: release.unavailableReason ? "unavailable" : reach,
      reason: release.unavailableReason ?? null,
      status: release.unavailableReason ? null : compatibility(release)
    };
  }
  // A torrent comes after the app's own direct links (the queue holds nothing to fetch), ahead of
  // the host pages and the browser ones.
  var GROUP_RANK = { direct: 0, torrent: 1, page: 2, browser: 3, unavailable: 4 };
  var HEALTH_RANK = { ok: 0, flaky: 2 };
  var isBackport = ({ label }) => /\bback\s*port\b/i.test(label || "");
  // After the direct hosts, the browser hosts confirmed on the console (Vikingfile, DataNodes, FileKeeper),
  // then MediaFire: its files are often removed (most of the PS4 ones taken from DLPSGAME in October 2026)
  // and it answers a busy address with HTTP 429. Then the hosts still being tried (AkiraBox, a vault's
  // other mirrors).
  var CONFIRMED = /^(?:vik[i1]ngfile|datanodes|filekeeper(?:\.net)?)$/i;
  var hostRank = ({ provider }) => isOverdriveCdn(provider) ? 0 : provider.toLowerCase() === "archive.org" ? 1 : CONFIRMED.test(provider) ? 2 : provider.toLowerCase() === "mediafire" ? 3 : 4;
  var ranked = (release, index) => ({ release, index, rank: [
    isDlc(release) ? 1 : 0,
    release.unavailableReason ? 1 : 0,
    isPatchOnly(release) ? 1 : 0,
    isPs5Package(release) ? 1 : 0,
    // A backport is the game fixed for older firmware, or only the files to copy over it (a 40 MB
    // download, issue #47): the full game comes first whatever its host.
    isBackport(release) ? 1 : 0,
    hostRank(release),
    GROUP_RANK[describeSource(release).group],
    HEALTH_RANK[release.health] ?? 1,
    release.source === "orbit" ? 0 : 1,
    release.requiresBrowser ? 1 : 0
  ] });
  var compare = (a, b) => a.rank.reduce((order, value, i) => order || value - b.rank[i], 0) || a.index - b.index;
  function preferredRelease(releases) {
    return releases.map(ranked).sort(compare)[0]?.index ?? 0;
  }
  function sourceSections(releases) {
    const sections = ["direct", "torrent", "page", "browser", "dlc", "unavailable"].map((group) => ({ group, items: [] }));
    releases.forEach((release, index) => {
      const { group } = describeSource(release);
      const into = group !== "unavailable" && isDlc(release) ? "dlc" : group;
      sections.find((section) => section.group === into).items.push({ release, index });
    });
    const links = ({ release }) => release.parts?.length ?? 1;
    const browser2 = sections.find((section) => section.group === "browser");
    browser2?.items.sort((a, b) => links(a) - links(b));
    return sections.filter((section) => section.items.length);
  }

export { describeSource, isDlc, isOverdriveCdn, preferredRelease, requiredFirmware, sourceSections };
