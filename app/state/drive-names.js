// A drive's name, for the places that only label it (Settings, the game page, Files).
// Kept apart from downloads.js so it can be tested without the PS5 host: importing the queue
// chain pulls in @ps5-react/core, which Node only has a stub for.

import { t } from '../i18n/core.js';

function driveName(root) {
  if (root === "/data") return t("drives.internal");
  const mount = /^\/mnt\/(usb|ext)(\d+)$/.exec(root);
  if (!mount) return t("drives.thisDevice");
  return t(mount[1] === "usb" ? "drives.usb" : "drives.extended", { number: String(Number(mount[2]) + 1) });
}

// The same drive, short enough for the Settings segments: five of them share 830 px, and the long
// names ("Archiviazione estesa 1" is 221 px, a segment 154) would lose the number that tells them apart.
function driveShortName(root) {
  if (root === "/data") return t("drives.short.internal");
  const mount = /^\/mnt\/(usb|ext)(\d+)$/.exec(root);
  if (!mount) return t("drives.thisDevice");
  return t(mount[1] === "usb" ? "drives.short.usb" : "drives.short.extended", { number: String(Number(mount[2]) + 1) });
}

export { driveName, driveShortName };
