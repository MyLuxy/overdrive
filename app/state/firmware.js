import { DeviceInfo } from '@ps5-react/core';

  // Fake PKGs install only up to this firmware; above it the system refuses them, after the whole
  // download (issues #6 and #17). Version strings read like "13.200.001": major and two minor digits.
  // What the title is told can be raised by the jailbreak (a console showing 13.20 in System Software
  // reported 13.59), so the version only warns and explains a refusal; it never hides a source.
  var LAST_PKG_FIRMWARE = [11, 60];
  var PKG_FIRMWARE_ERROR = "PS5 fake PKGs install only on firmware 11.60 or older. Choose another source.";
  var PKG_FORMATS = /* @__PURE__ */ new Set(["pkg", "fpkg"]);
  function firmwareVersion() {
    let text;
    try {
      text = DeviceInfo.get().firmware;
    } catch {
      return null;
    }
    const match = /(\d+)\.(\d{2})/.exec(text || "");
    return match ? [Number(match[1]), Number(match[2])] : null;
  }
  // The console's firmware for display ("13.20"), or null where it can't be read.
  function consoleFirmware() {
    const version = firmwareVersion();
    return version ? { major: version[0], text: `${version[0]}.${String(version[1]).padStart(2, "0")}` } : null;
  }
  // Unknown firmware (the desktop preview, an old runtime) counts as one that installs them.
  function fakePackagesInstall() {
    const version = firmwareVersion();
    if (!version) return true;
    const [major, minor] = version, [lastMajor, lastMinor] = LAST_PKG_FIRMWARE;
    return major < lastMajor || major === lastMajor && minor <= lastMinor;
  }
  // A source of unknown format the catalog labels "Fpkg" or "PKG" is one too (233 PS5 sources, 2026-10-18:
  // RE Requiem recommended its Fpkg, which installs only up to 11.60).
  var isPackage = (release) => PKG_FORMATS.has(release.format) || release.format === "binary" && /\bf?pkg\b/i.test(release.label || "");
  // PS4 fake PKGs install on the PS5's later firmware too; the 11.60 limit is for PS5 ones (Orbit
  // Store's notes say the same). The title ID tells them apart; the filename starts with it too.
  var isPs5Title = (titleId) => /^PPSA/i.test(titleId || "");
  var isPs5Package = (release) => isPackage(release) && isPs5Title(release.titleId || release.filename);

export { PKG_FIRMWARE_ERROR, consoleFirmware, fakePackagesInstall, isPackage, isPs5Package, isPs5Title };
