// ../pub-game-store/native/downloads/SummaryPanel.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { formatDuration, formatSpeed } from './format.js';
import { useActivity } from './useQueue.js';
import { formatNumber2 } from '../i18n/core.js';
import { useT } from '../i18n/index.js';
import { downloadQueue, driveName, storageRoots } from '../state/downloads.js';
import { formatBytes } from '../state/size.js';
import { useSpeedLimit } from '../state/speed-limit.js';
import { ProgressBar } from '../ui/ProgressBar.jsx';
import { FileSystem, Text, View } from '@ps5-react/core';

  var WIDTH5 = 280;
  var INSET = 8;
  var INNER = { width: WIDTH5 - 2 * INSET };
  function awake() {
    try {
      return downloadQueue().awake;
    } catch {
      return false;
    }
  }
  function Block({ title, children }) {
    return /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 6, borderBottomWidth: 2, borderColor: "#2a2a2f", paddingBottom: 8 }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { paddingHorizontal: 12, fontFamily: "Inter-Regular", fontSize: 20, fontWeight: 600, color: "#8a8a94", letterSpacing: 1 }, children: title }),
      children
    ] });
  }
  function Figure({ label, value }) {
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", justifyContent: "space-between" }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: label }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", lineHeight: 30 }, children: value })
    ] });
  }
  function Activity() {
    const t2 = useT();
    const { active: active2, speed, left, connections, peak, low, mean, extracting, extractedFiles } = useActivity();
    const limit = useSpeedLimit();
    return /* @__PURE__ */ (0, jsx)(Block, { title: t2("downloads.panel.activity"), children: /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 6, borderRadius: 12, padding: 6 }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 38, fontWeight: 600, color: "#f2f2f3", lineHeight: 44, letterSpacing: -1.13 }, children: active2 ? formatSpeed(speed) : t2("downloads.panel.idle") }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 3 }, children: [
        /* @__PURE__ */ (0, jsx)(
          Figure,
          {
            label: t2("downloads.panel.downloading"),
            value: active2 ? t2("catalog.gameCount", { count: active2 }) : t2("downloads.panel.none")
          }
        ),
        /* @__PURE__ */ (0, jsx)(Figure, { label: t2("downloads.panel.timeLeft"), value: active2 && speed && left ? formatDuration(left / speed) : "\u2014" }),
        /* @__PURE__ */ (0, jsx)(Figure, { label: t2("downloads.panel.peak"), value: peak ? formatSpeed(peak) : "\u2014" }),
        /* @__PURE__ */ (0, jsx)(Figure, { label: t2("downloads.panel.low"), value: low ? formatSpeed(low) : "\u2014" }),
        /* @__PURE__ */ (0, jsx)(Figure, { label: t2("downloads.panel.average"), value: mean ? formatSpeed(mean) : "\u2014" }),
        /* @__PURE__ */ (0, jsx)(Figure, { label: t2("downloads.panel.connections"), value: connections ? formatNumber2(connections) : "\u2014" }),
        // Why a download goes no faster: the cap chosen in Settings (issue #15).
        /* @__PURE__ */ (0, jsx)(Figure, { label: t2("settings.speedLimit"), value: limit ? t2("units.speed", { n: String(limit) }) : t2("settings.speedUnlimited") }),
        extracting && extractedFiles > 0 ? /* @__PURE__ */ (0, jsx)(Figure, { label: t2("downloads.filesExtracted"), value: formatNumber2(extractedFiles) }) : null
      ] }),
      /* @__PURE__ */ (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, INNER], children: awake() ? t2("downloads.panel.awake") : " " })
    ] }) });
  }
  function Drive({ root: root2 }) {
    const t2 = useT();
    let usage = null;
    try {
      usage = FileSystem.diskUsage(root2);
    } catch {
    }
    return /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 4, borderRadius: 12, padding: 6 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", justifyContent: "space-between" }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", lineHeight: 30 }, children: driveName(root2) }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: usage ? t2("download.free", { size: formatBytes(usage.free) }) : t2("downloads.panel.unavailable") })
      ] }),
      /* @__PURE__ */ (0, jsx)(ProgressBar, { fraction: usage?.total ? 1 - usage.free / usage.total : 0, width: INNER.width, active: false }),
      usage ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: t2("downloads.panel.used", { used: formatBytes(usage.total - usage.free), total: formatBytes(usage.total) }) }) : null
    ] });
  }
  function SummaryPanel({ error: error2 }) {
    const t2 = useT();
    // The entire summary is visible; it must not become a focusable scroll region.
    return /* @__PURE__ */ (0, jsx)(View, { style: { width: 420 }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 8, paddingBottom: 6 }, children: [
      error2 ? null : /* @__PURE__ */ (0, jsx)(Activity, {}),
      /* @__PURE__ */ (0, jsx)(Block, { title: t2("downloads.panel.storage"), children: storageRoots().map((root2, index) => /* @__PURE__ */ (0, jsx)(
        Drive,
        {
          root: root2
        },
        root2
      )) }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 4, borderRadius: 12, padding: 6 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, fontWeight: 600, color: "#8a8a94", letterSpacing: 1 }, children: t2("downloads.panel.installing") }),
        /* @__PURE__ */ (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, INNER], children: t2("downloads.panel.installNote") })
      ] })
    ] }) });
  }

export { SummaryPanel };
