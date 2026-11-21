// ../pub-game-store/native/downloads/format.js
// reconstructed from the esbuild bundle in eboot.bin

import { formatNumber2, t } from '../i18n/core.js';

  var formatSpeed = (bytesPerSecond) => t("units.speed", { n: formatNumber2(bytesPerSecond / 1024 ** 2, { minimumFractionDigits: 1, useGrouping: false }) });
  function formatDuration(seconds2) {
    if (seconds2 < 59.5) return t("time.seconds", { n: Math.max(1, Math.round(seconds2)) });
    const minutes = Math.round(seconds2 / 60);
    if (minutes < 60) return t("time.minutes", { n: minutes });
    return t("time.hoursMinutes", { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
  }
  var formatTimeLeft = (seconds2) => t("downloads.timeLeft", { time: formatDuration(seconds2) });

export { formatDuration, formatSpeed, formatTimeLeft };
