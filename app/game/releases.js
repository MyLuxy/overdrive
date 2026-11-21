// ../pub-game-store/native/game/releases.js
// reconstructed from the esbuild bundle in eboot.bin

import { t } from '../i18n/core.js';
import { driveName } from '../state/downloads.js';
import { formatBytes } from '../state/size.js';
import { MARGIN2, stillNeeded } from '../state/space.js';
import { DownloadFormats } from '@ps5-react/core';

  function spaceNeeded(release, root2) {
    if (!release?.sizeBytes) return 0;
    let artifact2;
    try {
      artifact2 = release.parts ? void 0 : DownloadFormats.artifact(release, root2);
    } catch {
      artifact2 = void 0;
    }
    return stillNeeded({ release, artifact: artifact2, total: release.sizeBytes, written: 0 });
  }
  var canDownload = (game) => game.hasDownloads ?? (game.releases || []).some((release) => release.url || release.manifestUrl || release.browserUrl);
  function spaceAdvice(roots, free, storage, need) {
    const other = roots.findIndex((root2, i) => i !== storage && free[i] >= need + MARGIN2);
    if (other >= 0) return t("download.space.otherDrive", { drive: driveName(roots[other]), size: formatBytes(free[other]) });
    return t("download.space.free", { size: formatBytes(need + MARGIN2 - free[storage]), drive: driveName(roots[storage]) });
  }

export { canDownload, spaceAdvice, spaceNeeded };
