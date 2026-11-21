// ../pub-game-store/native/ui/UpdateDialog.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import '../assets/JetBrainsMono-Regular.ttf';
import asciiDial from '../assets/ascii-dial.png';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { formatPercent2 } from '../i18n/core.js';
import { useT } from '../i18n/index.js';
import { formatBytes } from '../state/size.js';
import { installUpdate, useAvailableUpdate } from '../state/update.js';
import { ImageReplaceError } from '../state/updater.js';
import { Button2 } from './Button.jsx';
import { ProgressBar } from './ProgressBar.jsx';
import { ShimmerText } from './ShimmerText.jsx';
import { px } from './scale.js';
import { VERSION } from '../version.js';
import { BackHandler, FocusScope, Image, Text, View } from '@ps5-react/core';

  var CLOSE_DELAY_MS = 2e3;
  var REOPEN_DELAY_MS = 11e3;
  var DIAL = 324;
  var STATUS2 = { fontFamily: "JetBrainsMono-Regular", fontSize: 23 };
  function UpdateDialog() {
    const t2 = useT();
    const update = useAvailableUpdate();
    const [dismissed, setDismissed] = (0, useState)(false);
    const [progress, setProgress] = (0, useState)(null);
    const [error2, setError] = (0, useState)(null);
    const state = progress?.state;
    const relaunch = progress?.relaunch;
    (0, useEffect)(() => {
      if (state !== "done") return;
      const id = setTimeout(() => BackHandler.exitApp({ relaunch }), relaunch ? CLOSE_DELAY_MS : REOPEN_DELAY_MS);
      return () => clearTimeout(id);
    }, [state, relaunch]);
    if (!update || dismissed) return null;
    const install = async () => {
      setError(null);
      setProgress({ state: "downloading", written: 0, total: update.size });
      try {
        const { relaunch: relaunch2 } = await installUpdate(update, setProgress);
        setProgress({ state: "done", relaunch: relaunch2 });
      } catch (failure) {
        setProgress(null);
        setError(failure instanceof ImageReplaceError ? [t2("update.replaceFailed"), t2("update.replaceByHand")] : [failure.message]);
      }
    };
    const close = () => {
      if (!progress) setDismissed(true);
      return true;
    };
    const fraction = state === "downloading" && progress.total ? progress.written / progress.total : state ? 1 : 0;
    const installed = update.installed;
    const paragraphs = installed ? [t2("update.reopenInstalled", { version: update.version }), ...update.stuck ? [t2("update.restartConsole")] : []] : error2 ?? [update.notes || t2("update.detail")];
    const label = error2 ? t2("update.failed") : state === "done" || installed ? t2("update.done") : state ? t2("update.updating") : t2("update.available");
    const status = state === "downloading" ? `${formatPercent2(Math.round(fraction * 100)).replace(/\u202f/g, "\xA0")}  \xB7  ${formatBytes(progress.written)} / ${formatBytes(progress.total)}` : state === "installing" ? t2("update.installing") : state === "done" ? t2(relaunch ? "update.restarting" : "update.reopen") : null;
    return (
      // A modal: the page's actions stop here, and nothing leaves it while it installs.
      /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, autoFocus: true, onBack: close, onAction: () => true, children: /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, alignItems: "center", justifyContent: "center", backgroundColor: "#000000e6" }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { width: 1410, flexDirection: "row", alignItems: "center", gap: 72, borderRadius: 24, borderWidth: 2, borderColor: "#2a2a2f", backgroundColor: "#000000", paddingHorizontal: 72, paddingVertical: 60 }, children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 24 }, children: [
          /* @__PURE__ */ (0, jsx)(Image, { source: asciiDial, resizeMode: "contain", style: { width: px(DIAL), height: px(DIAL) } }),
          state ? /* @__PURE__ */ (0, jsx)(ProgressBar, { fraction, width: DIAL, active: true }) : null
        ] }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 36 }, children: [
          /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 18 }, children: [
            /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "JetBrainsMono-Regular", fontSize: 20, color: "#8a8a94", letterSpacing: 3 }, children: label }),
            /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 66, fontWeight: 600, color: "#f2f2f3", letterSpacing: -1.65 }, children: `v${update.version}` }),
            /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "JetBrainsMono-Regular", fontSize: 23, color: "#a3a3ab" }, children: `v${VERSION}  \u2192  v${update.version}` })
          ] }),
          state ? null : /* @__PURE__ */ (0, jsx)(View, { style: { width: 690, gap: 12 }, children: paragraphs.map((text) => /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 24, color: "#a3a3ab", numberOfLines: 4, ellipsizeMode: "tail", lineHeight: 36 }, children: text }, text)) }),
          status ? /* @__PURE__ */ (0, jsx)(View, { focusable: true, children: /* @__PURE__ */ (0, jsx)(ShimmerText, { textStyle: STATUS2, children: status }) }) : installed ? /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 18 }, children: [
            /* @__PURE__ */ (0, jsx)(Button2, { variant: "primary", size: "lg", label: t2("update.quit"), autoFocus: true, onPress: () => BackHandler.exitApp({ relaunch: false }) }),
            /* @__PURE__ */ (0, jsx)(Button2, { variant: "outline", size: "lg", label: t2("update.later"), onPress: close })
          ] }) : /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 18 }, children: [
            /* @__PURE__ */ (0, jsx)(Button2, { variant: "primary", size: "lg", icon: "download", label: t2(error2 ? "update.retry" : "update.install"), autoFocus: true, onPress: install }),
            /* @__PURE__ */ (0, jsx)(Button2, { variant: "outline", size: "lg", label: t2(error2 ? "update.close" : "update.later"), onPress: close })
          ] })
        ] })
      ] }) }) })
    );
  }

export { UpdateDialog };
