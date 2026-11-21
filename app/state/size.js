// ../pub-game-store/native/state/size.js
// reconstructed from the esbuild bundle in eboot.bin

import { formatNumber2, t } from '../i18n/core.js';

  var plain = { maximumFractionDigits: 1, useGrouping: false };
  function formatSize(gb) {
    const mb = Math.round(gb * 1e3);
    return mb < 1e3 ? t("units.megabytes", { n: formatNumber2(mb, plain) }) : t("units.gigabytes", { n: formatNumber2(gb, plain) });
  }
  var formatBytes = (bytes) => formatSize(bytes / 1e9);

export { formatBytes, formatSize };
