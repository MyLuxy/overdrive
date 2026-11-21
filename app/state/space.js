// ../pub-game-store/native/state/space.js
// reconstructed from the esbuild bundle in eboot.bin

import { formatBytes } from './size.js';

  var MARGIN2 = 16 * 1024 ** 2;
  var extracts = (job2) => Boolean(job2.release?.parts) || job2.artifact?.nextAction === "extraction-required";
  function stillNeeded(job2) {
    if (job2.state === "installing") return 0;
    const factor = extracts(job2) && job2.state !== "extracting" ? 2 : 1;
    return Math.max(0, (job2.total ?? job2.release?.sizeBytes ?? 0) * factor - job2.written);
  }
  var SHOWN = 3;
  function spaceShortfall(root2, need, free, pending2) {
    const holders = pending2.map((job2) => ({ title: job2.title, bytes: stillNeeded(job2) })).filter((job2) => job2.bytes > 0).sort((a, b) => b.bytes - a.bytes);
    const reserved = holders.reduce((sum, job2) => sum + job2.bytes, 0);
    const left = Math.max(0, free - reserved);
    if (left >= need + MARGIN2) return "";
    const message = `Not enough space on ${root2}: needs ${formatBytes(need)}, ${formatBytes(left)} free`;
    if (!reserved) return message;
    const named2 = holders.slice(0, SHOWN).map((job2) => `${job2.title} (${formatBytes(job2.bytes)})`);
    if (holders.length > SHOWN) named2.push(`+${holders.length - SHOWN}`);
    return `${message} after queued downloads: ${named2.join(", ")}`;
  }

export { MARGIN2, spaceShortfall, stillNeeded };
