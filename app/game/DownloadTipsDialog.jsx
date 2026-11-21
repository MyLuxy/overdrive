// Shown before a new download starts: what the chosen source is, what to watch for with it, and
// tips for choosing one behind a dropdown, so the provider's browser page opens only once the player
// has read it and pressed Continue.

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { describeSource, isDlc, requiredFirmware } from './sources.js';
import { useT } from '../i18n/index.js';
import { sourceKind } from '../state/download-sources.js';
import { isPs5Package } from '../state/firmware.js';
import { useNavActions } from '../state/nav.jsx';
import { isPatchOnly } from '../state/release-sets.js';
import { Button2 } from '../ui/Button.jsx';
import { Cover } from '../ui/Cover.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, Text, View, useIsFocused } from '@ps5-react/core';

  var LABEL = { fontFamily: "Inter-Regular", fontSize: 19, fontWeight: 600, color: colors.muted, letterSpacing: 1.5 };
  var BODY = { fontFamily: "Inter-Regular", fontSize: 22, color: colors.muted, lineHeight: 31 };
  var TINT = { warn: [colors.warn, "#fde68a1f"], info: [colors.info, "#a5f3fc1a"] };
  var TIPS = ["firmware", "fullGame", "top", "retry"];
  // Text wraps only at a set width here, never at flex: the dialog's 1200 px inside, less a note's
  // 44 px badge and its gap, or half of it (less the 44 px column gap) for a tip.
  var NOTE_TEXT = 1200 - 44 - 18;
  var TIP_WIDTH = (1200 - 44) / 2;
  var TIP_TEXT = TIP_WIDTH - 9 - 16;
  // The notes that apply to this source, most important first. The firmware comes from its label,
  // never from the console, which can be told a raised version.
  function notesFor(release) {
    const notes = [];
    if (isDlc(release)) notes.push({ tone: "warn", icon: "package", key: "dlc" });
    if (isPatchOnly(release)) notes.push({ tone: "warn", icon: "fileMinus", key: "patch" });
    if (isPs5Package(release)) notes.push({ tone: "warn", icon: "alert", key: "package" });
    let kind = "direct";
    try {
      kind = sourceKind(release.parts?.[0]?.sources[0] ?? release);
    } catch {
    }
    if (kind === "vikingfile") notes.push({ tone: "info", icon: "globe", key: "browserViking" });
    else if (kind === "browser" || kind === "datanodes" || kind === "buzzheavier") notes.push({ tone: "info", icon: "globe", key: "browserOther" });
    const need = requiredFirmware(release);
    if (need !== null && !isDlc(release)) notes.push({ tone: "info", icon: "cpu", key: "firmware", values: { need: `${need}.xx` } });
    return notes;
  }
  function Note({ tone, icon, text }) {
    const [ink, wash] = TINT[tone];
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "flex-start", gap: 18 }, children: [
      /* @__PURE__ */ (0, jsx)(View, { style: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: wash }, children: /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 24, color: ink }) }),
      /* @__PURE__ */ (0, jsx)(Text, { style: [BODY, { width: NOTE_TEXT, paddingTop: 6 }], children: text })
    ] });
  }
  function Tip({ title, body }) {
    // The title on its own line and the line under it: short, and wrapping cleanly in any language.
    return /* @__PURE__ */ (0, jsxs)(View, { style: { width: TIP_WIDTH, flexDirection: "row", alignItems: "flex-start", gap: 16 }, children: [
      /* @__PURE__ */ (0, jsx)(View, { style: { width: 9, height: 9, borderRadius: 5, marginTop: 12, backgroundColor: colors.muted } }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 2 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: [BODY, { width: TIP_TEXT, fontWeight: 600, color: colors.fg }], children: title }),
        /* @__PURE__ */ (0, jsx)(Text, { style: [BODY, { width: TIP_TEXT }], children: body })
      ] })
    ] });
  }
  function ToggleFace({ open }) {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(View, { style: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }, children: /* @__PURE__ */ (0, jsx)(Icon, { name: "lightbulb", size: 24, color: colors.fg }) }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { flex: 1, fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: colors.fg }, children: t2("tips.toggle") }),
      /* @__PURE__ */ (0, jsx)(Icon, { name: open ? "chevronUp" : "chevronDown", size: 26, color: focused ? colors.fg : colors.muted })
    ] });
  }
  function DownloadTipsDialog({ game, release, submit, changeSource, onClose }) {
    const t2 = useT();
    const [open, setOpen] = (0, useState)(false);
    const { focusLater } = useNavActions();
    // The page moves focus with focusLater, retried until it lands: one still pending (back to the
    // Download button, from a sheet that just closed) took focus off this dialog on the console.
    // A newer request replaces it, so asking here is what makes the tips row win.
    (0, useEffect)(() => {
      focusLater("tips:toggle");
    }, []);
    const { name, detail: detail2, size } = describeSource(release);
    const notes = notesFor(release);
    const proceed = () => {
      onClose();
      submit();
    };
    // The source list replaces this dialog in place, as the options sheet's "next" items do: closing
    // first would send focus back to the Download button underneath.
    const pick = () => {
      changeSource();
    };
    const cancel = () => {
      onClose();
      return true;
    };
    return (
      // A modal like the update dialog: the page underneath takes no input until it closes.
      /* @__PURE__ */ (0, jsx)(FocusScope, { trap: true, autoFocus: true, onBack: cancel, onAction: () => true, children: /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, alignItems: "center", justifyContent: "center", backgroundColor: "#000000d9" }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { width: 1320, gap: 26, borderRadius: 24, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface, paddingHorizontal: 60, paddingTop: 44, paddingBottom: 40 }, children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 6 }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 19, fontWeight: 600, color: colors.subtle, letterSpacing: 3 }, children: t2("tips.eyebrow").toLocaleUpperCase() }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 44, fontWeight: 600, color: colors.fg, letterSpacing: -1.1, lineHeight: 52 }, children: t2("tips.title") })
        ] }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 14 }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: LABEL, children: t2("tips.downloading").toLocaleUpperCase() }),
          /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 24, borderRadius: 16, backgroundColor: colors.surface2, paddingHorizontal: 22, paddingVertical: 18 }, children: [
            /* @__PURE__ */ (0, jsx)(Cover, { game, label: false, style: { width: 78, height: 78, borderRadius: 10, overflow: "hidden" } }),
            /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 4 }, children: [
              /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 26, fontWeight: 600, color: colors.fg, numberOfLines: 1, ellipsizeMode: "tail" }, children: game.title }),
              /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, numberOfLines: 1, ellipsizeMode: "tail" }, children: [detail2, name].filter(Boolean).join(" \xB7 ") })
            ] }),
            size ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 22, color: colors.fg }, children: size }) : null
          ] })
        ] }),
        notes.length ? /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 14 }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: LABEL, children: t2("tips.about").toLocaleUpperCase() }),
          /* @__PURE__ */ (0, jsx)(View, { style: { gap: 12 }, children: notes.map((note) => /* @__PURE__ */ (0, jsx)(Note, { tone: note.tone, icon: note.icon, text: t2(`tips.note.${note.key}`, note.values) }, note.key)) })
        ] }) : null,
        /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 14 }, children: [
          // Closed at first, so the dialog stays short; anyone can open it again any time.
          /* @__PURE__ */ (0, jsx)(View, { focusKey: "tips:toggle", nextFocusDown: "tips:continue", onPress: () => setOpen(!open), style: (_state) => [{ position: "relative", flexDirection: "row", alignItems: "center", gap: 18, borderRadius: 14, marginHorizontal: -16, paddingHorizontal: 16, paddingVertical: 12 }, _state.focused ? { backgroundColor: colors.surface2 } : null], children: /* @__PURE__ */ (0, jsx)(ToggleFace, { open }) }),
          open ? /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", flexWrap: "wrap", rowGap: 16, columnGap: 44 }, children: TIPS.map((key) => /* @__PURE__ */ (0, jsx)(Tip, { title: t2(`tips.tip.${key}.title`), body: t2(`tips.tip.${key}.body`) }, key)) }) : null
        ] }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 18, borderTopWidth: 2, borderColor: colors.line, paddingTop: 26 }, children: [
          /* @__PURE__ */ (0, jsx)(Button2, { variant: "primary", size: "lg", icon: "download", label: t2("tips.continue"), halo: false, focusKey: "tips:continue", onPress: proceed }),
          /* @__PURE__ */ (0, jsx)(Button2, { variant: "secondary", size: "lg", icon: "layers", label: t2("tips.changeSource"), focusKey: "tips:source", onPress: pick })
        ] })
      ] }) }) })
    );
  }

export { DownloadTipsDialog };
