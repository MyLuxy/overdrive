import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useRef, useState } from 'react';
import { useT } from '../i18n/index.js';
import { FocusScope, Text, Video, View } from '@ps5-react/core';
import { Button2 } from '../ui/Button.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { colors } from '../ui/colors.js';

function TrailerPlayer({ game, trailer, onClose }) {
  const t2 = useT();
  const video = useRef(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState("");
  return /* @__PURE__ */ (0, jsx)(FocusScope, {
    trap: true, autoFocus: true, inert: false,
    onBack: () => {
      onClose();
      return true;
    },
    children: /* @__PURE__ */ (0, jsxs)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 60, backgroundColor: "#000000" }, children: [
      /* @__PURE__ */ (0, jsx)(Video, {
        ref: video,
        key: trailer.url,
        source: { uri: trailer.url },
        paused,
        resizeMode: "cover",
        style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
        onEnd: () => setPaused(true),
        onError: ({ error: message }) => setError(String(message || "unknown"))
      }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { position: "absolute", top: 0, right: 0, left: 0, flexDirection: "row", alignItems: "center", gap: 22, padding: 36, backgroundGradient: { type: "linear", to: "bottom", stops: [{ color: "#000000cc", offset: 0 }, { color: "#00000000", offset: 1 }] } }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontSize: 27, fontWeight: 600, color: colors.fg, letterSpacing: -0.6 }, children: t2("game.trailer") }),
        trailer.title ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontSize: 21, color: colors.muted }, children: trailer.title }) : null
      ] }),
      error ? /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", bottom: 130, right: 0, left: 0, alignItems: "center" }, children: /* @__PURE__ */ (0, jsx)(Text, { style: { marginHorizontal: 96, textAlign: "center", fontSize: 21, color: colors.warn, lineHeight: 30 }, children: t2("trailer.error", { error }) }) }) : null,
      /* @__PURE__ */ (0, jsxs)(View, { style: { position: "absolute", bottom: 0, right: 0, left: 0, flexDirection: "row", alignItems: "center", gap: 14, padding: 36, backgroundGradient: { type: "linear", to: "top", stops: [{ color: "#000000cc", offset: 0 }, { color: "#00000000", offset: 1 }] } }, children: [
        /* @__PURE__ */ (0, jsx)(Button2, { label: paused ? t2("trailer.play") : t2("trailer.pause"), focusKey: "trailer:toggle", autoFocus: true, onPress: () => setPaused((value) => !value), nextFocusDown: "trailer:restart" }),
        /* @__PURE__ */ (0, jsx)(Button2, { label: t2("trailer.restart"), focusKey: "trailer:restart", variant: "outline", onPress: () => video.current?.seek(0), nextFocusUp: "trailer:toggle" }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { marginLeft: "auto", fontSize: 19, color: colors.subtle }, children: t2("trailer.hint") })
      ] })
    ] })
  });
}

export { TrailerPlayer };
