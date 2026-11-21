// ../pub-game-store/native/downloads/BrowserCaptureDialog.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { URLDialog } from './URLDialog.jsx';
import { useT } from '../i18n/index.js';
import { downloadQueue } from '../state/downloads.js';
import { formatBytes } from '../state/size.js';
import { Button2 } from '../ui/Button.jsx';
import { ShimmerText } from '../ui/ShimmerText.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, Text, View } from '@ps5-react/core';

  var INSTRUCTION = { fontFamily: "Inter-Regular", fontSize: 24, lineHeight: 36 };
  function BrowserCaptureDialog({ job: job2 }) {
    const t2 = useT();
    const close = () => downloadQueue().cancelBrowserCapture(job2.id);
    if (job2.captureState === "failed") return /* @__PURE__ */ (0, jsx)(
      URLDialog,
      {
        title: t2("download.fileLink"),
        detail: job2.captureError || t2("download.fileLinkDetail"),
        submit: (url) => downloadQueue().continueWithURL(job2.id, url),
        onClose: close
      }
    );
    // A captured file that names no game: the player says whether it is the one they chose.
    if (job2.captureState === "confirm" && job2.captureFile) return /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, autoFocus: true, onBack: () => {
      downloadQueue().confirmCapturedFile(job2.id, false);
      return true;
    }, children: /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, alignItems: "center", justifyContent: "center", backgroundColor: "#000000f2" }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { width: 1380, gap: 30, borderRadius: 18, borderWidth: 2, borderColor: "#2a2a2f", backgroundColor: "#17171a", padding: 48 }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 36, color: "#f2f2f3", lineHeight: 48 }, children: t2("capture.confirm.title") }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { width: 1260, fontFamily: "Inter-Regular", fontSize: 24, color: "#a3a3ab", numberOfLines: 2, ellipsizeMode: "tail", lineHeight: 36 }, children: job2.title }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { ...INSTRUCTION, width: 1260, color: "#f2f2f3", numberOfLines: 2, ellipsizeMode: "tail" }, children: `${job2.captureFile.name || t2("capture.confirm.noName")} \xB7 ${formatBytes(job2.captureFile.bytes)}` }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { width: 1260, fontFamily: "Inter-Regular", fontSize: 24, color: "#a3a3ab", numberOfLines: 3, ellipsizeMode: "tail", lineHeight: 36 }, children: t2("capture.confirm.detail") }),
      /* @__PURE__ */ (0, jsx)(Button2, { label: t2("capture.confirm.accept"), icon: "download", onPress: () => downloadQueue().confirmCapturedFile(job2.id, true) }),
      /* @__PURE__ */ (0, jsx)(Button2, { label: t2("capture.confirm.refuse"), variant: "outline", onPress: () => downloadQueue().confirmCapturedFile(job2.id, false) })
    ] }) }) });
    return /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, autoFocus: true, onBack: () => {
      close();
      return true;
    }, children: /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, alignItems: "center", justifyContent: "center", backgroundColor: "#000000f2" }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { width: 1380, gap: 30, borderRadius: 18, borderWidth: 2, borderColor: "#2a2a2f", backgroundColor: "#17171a", padding: 48 }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 36, color: "#f2f2f3", lineHeight: 48 }, children: t2(job2.captureMode === "link" ? "capture.link.title" : "capture.title") }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { width: 1260, fontFamily: "Inter-Regular", fontSize: 24, color: "#a3a3ab", numberOfLines: 2, ellipsizeMode: "tail", lineHeight: 36 }, children: job2.title }),
      /* @__PURE__ */ (0, jsx)(ShimmerText, { textStyle: INSTRUCTION, background: colors.surface, children: t2(`capture.${job2.captureState}`) }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { width: 1260, fontFamily: "Inter-Regular", fontSize: 24, color: "#a3a3ab", numberOfLines: 3, ellipsizeMode: "tail", lineHeight: 36 }, children: t2(job2.captureMode === "link" ? "capture.link.detail" : "capture.detail") }),
      /* @__PURE__ */ (0, jsx)(Button2, { label: t2("download.enterLink"), variant: "outline", onPress: () => {
        downloadQueue().cancelBrowserCapture(job2.id, { manual: true });
      } }),
      /* @__PURE__ */ (0, jsx)(Button2, { label: t2("urlDialog.cancel"), variant: "outline", onPress: close })
    ] }) }) });
  }

export { BrowserCaptureDialog };
