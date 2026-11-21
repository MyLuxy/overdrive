// ../pub-game-store/native/game/DownloadLabel.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { hasStateLabel, stateLabel } from '../downloads/labels.js';
import { t } from '../i18n/core.js';
import { useT } from '../i18n/index.js';
import { BUSY, COMPLETE } from '../state/download-queue.js';
import { formatSize } from '../state/size.js';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { Text, View } from '@ps5-react/core';

  // "streamed": the PS5's own Downloads have it, and nothing is left to press here.
  var DISABLED = ["unavailable", "no-space", "removing", "streamed"];
  var CONTENT = {
    idle: { icon: "download", text: "download.button.idle" },
    unavailable: { icon: "download", text: "download.button.unavailable" },
    "awaiting-browser": { icon: "external", text: "download.button.awaiting-browser" },
    "no-space": { icon: "download", text: "download.button.no-space" },
    queued: { icon: "pause", text: "download.button.queued" },
    resolving: { icon: "pause", text: "download.button.pause" },
    connecting: { icon: "pause", text: "download.button.pause" },
    downloading: { icon: "pause", text: "download.button.pause" },
    verifying: { icon: "pause", text: "download.button.verifying" },
    pausing: { icon: "pause", text: "download.button.pausing" },
    extracting: { icon: "pause", text: "download.button.extracting" },
    // The engine writes the last files to disk: nothing left to count, so no percentage either.
    finishing: { icon: "pause", text: "download.button.finishing" },
    extracted: { icon: "circleCheck", text: "download.button.extracted" },
    paused: { icon: "play", text: "download.button.paused" },
    failed: { icon: "download", text: "download.button.failed" },
    // A failure whose saved progress no longer matches the file: only starting over recovers it.
    stale: { icon: "download", text: "download.button.stale" },
    "file-downloaded": { icon: "circleCheck", text: "download.button.file-downloaded" },
    downloaded: { icon: "circleCheck", text: "download.button.downloaded" },
    "installer-required": { icon: "download", text: "download.button.installer-required" },
    installing: { icon: "download", text: "download.button.installing" },
    installed: { icon: "circleCheck", text: "download.button.installed" },
    // Handed to the PS5's own Downloads: not installed yet, and followed there, not here.
    streamed: { icon: "controller", text: "download.button.streamed" },
    "extraction-required": { icon: "circleCheck", text: "download.button.extraction-required" },
    removing: { icon: "delete", text: "download.button.removing" }
  };
  var INK = { dark: { color: "#0d0d0f" }, light: { color: "#f2f2f3" }, disabled: { color: "#a3a3ab" } };
  function statusLine(status, progress, sizeGb) {
    if (status === "unavailable") return [t("download.status.unavailable"), null];
    if (status === "awaiting-browser") return [t("download.status.awaitingLink"), null];
    if (status === "finishing") return [stateLabel(status), t("downloads.writingToDisk")];
    if (status === "streamed") return [stateLabel(status), null];
    if (status === "no-space") return [t("download.status.noSpace"), sizeGb && t("download.status.needs", { size: formatSize(sizeGb) })];
    if (COMPLETE.includes(status)) return [stateLabel(status), sizeGb && formatSize(sizeGb)];
    const of = sizeGb && t("download.status.progress", { done: formatSize(sizeGb * progress), total: formatSize(sizeGb) });
    if (hasStateLabel(status)) return [stateLabel(status), of];
    return [t("download.status.ready"), sizeGb && formatSize(sizeGb)];
  }
  function DownloadLabel({ status, amount, dark }) {
    const t2 = useT();
    const { icon, text } = CONTENT[status];
    const inProgress = BUSY.includes(status) || status === "paused";
    const disabled = DISABLED.includes(status);
    const ink2 = dark ? INK.dark : disabled ? INK.disabled : INK.light;
    return /* @__PURE__ */ (0, jsxs)(View, { style: [{ height: 72, width: 408, flexDirection: "row", alignItems: "center", paddingHorizontal: 30 }, inProgress ? { justifyContent: "space-between" } : { justifyContent: "center" }], children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 12 }, children: [
        /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 16, color: dark ? colors.accentFg : disabled ? colors.muted : colors.fg }),
        /* @__PURE__ */ (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 23 }, ink2], children: t2(text) })
      ] }),
      inProgress && /* @__PURE__ */ (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 23 }, ink2], children: amount })
    ] });
  }

export { DISABLED, DownloadLabel, statusLine };
