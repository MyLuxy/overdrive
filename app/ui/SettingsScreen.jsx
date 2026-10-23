
import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { formatPercent2 } from '../i18n/core.js';
import { chooseLanguage, languageChoice, systemLocale, useT } from '../i18n/index.js';
import { LOCALES } from '../i18n/locales.js';
import { FocusRing } from './FocusRing.jsx';
import { Icon } from './Icon.jsx';
import { colors } from './colors.js';
import { LEVELS, setVibrationLevel, useVibrationLevel } from './haptics.js';
import { LIMITS, setSpeedLimit, useSpeedLimit } from '../state/speed-limit.js';
import { setDeletePackages, useDeletePackages } from '../state/package-cleanup.js';
import { FocusScope, ScrollView, Text, View, useIsFocused } from '@ps5-react/core';

  var nameOf = (code) => LOCALES.find((locale2) => locale2.code === code).name;
  function LanguageFace({ name, detail: detail2, checked }) {
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 0 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: checked ? "#000000" : "#f2f2f3" }, children: name }),
        /* @__PURE__ */ (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 20, lineHeight: 26 }, { color: checked ? "#34343a" : focused ? colors.fg : colors.muted }], children: detail2 })
      ] })
    ] });
  }
  function Row4({ code, name, detail: detail2, checked, onPress }) {
    return /* @__PURE__ */ (0, jsx)(View, { focusKey: `language:${code}`, onPress, style: (_state) => [{ position: "relative", width: 610, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, minHeight: 66, backgroundColor: checked ? "#f2f2f3" : "transparent", paddingHorizontal: 16, paddingVertical: 10 }, _state.focused && !checked ? { backgroundColor: "#212125" } : null], children: /* @__PURE__ */ (0, jsx)(LanguageFace, { name, detail: detail2, checked }) });
  }
  // One segment of the speed limit (issue #15): every value in view, the chosen one filled. The D-pad
  // moves along the row and Cross picks, so no value has to be typed.
  function SpeedSegment({ limit, chosen }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsxs)(View, { focusKey: `settings:speed:${limit}`, autoFocus: chosen, nextFocusUp: 'nav:current', onPress: () => setSpeedLimit(limit), style: { position: "relative", flex: limit ? 1 : 2, height: 60, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: chosen ? colors.fg : colors.surface2 }, children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, fontWeight: 600, color: chosen ? colors.accentFg : colors.muted, numberOfLines: 1 }, children: limit ? String(limit) : t2("settings.speedUnlimited") })
    ] });
  }
  function SpeedLimit() {
    const t2 = useT();
    const limit = useSpeedLimit();
    return /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 3 }, children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: colors.fg }, children: t2("settings.speedLimit") })
        ] }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, children: t2("settings.speedLimitDetail") })
      ] }),
      /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", gap: 9 }, children: LIMITS.map((value) => /* @__PURE__ */ (0, jsx)(SpeedSegment, { limit: value, chosen: value === limit }, value)) })
    ] });
  }
  // Whether a PKG is deleted once installed, laid out like the speed limit: both choices in view.
  function PackagesSegment({ on, chosen }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsxs)(View, { focusKey: `settings:packages:${on ? "on" : "off"}`, onPress: () => setDeletePackages(on), style: { position: "relative", flex: 1, height: 60, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: chosen ? colors.fg : colors.surface2 }, children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, fontWeight: 600, color: chosen ? colors.accentFg : colors.muted, numberOfLines: 1 }, children: t2(on ? "settings.on" : "settings.off") })
    ] });
  }
  function DeletePackages() {
    const t2 = useT();
    const on = useDeletePackages();
    return /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 3 }, children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: colors.fg }, children: t2("settings.deletePackages") })
        ] }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, children: t2("settings.deletePackagesDetail") })
      ] }),
      /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", gap: 9 }, children: [true, false].map((value) => /* @__PURE__ */ (0, jsx)(PackagesSegment, { on: value, chosen: value === on }, String(value))) })
    ] });
  }
  // The vibration level (issue #32), laid out like the speed limit: every step in view, Cross picks.
  var levelName = (t2, level) => level ? formatPercent2(level) : t2("settings.vibrationOff");
  function VibrationSegment({ level, chosen }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsxs)(View, { focusKey: `settings:vibration:${level}`, onPress: () => setVibrationLevel(level), style: { position: "relative", flex: level ? 1 : 2, height: 60, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: chosen ? colors.fg : colors.surface2 }, children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, fontWeight: 600, color: chosen ? colors.accentFg : colors.muted, numberOfLines: 1 }, children: levelName(t2, level) })
    ] });
  }
  function VibrationLevel() {
    const t2 = useT();
    const level = useVibrationLevel();
    return /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 10, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 3 }, children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: colors.fg }, children: t2("settings.vibration") })
        ] }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, children: t2("settings.vibrationDetail") })
      ] }),
      /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", gap: 9 }, children: LEVELS.map((value) => /* @__PURE__ */ (0, jsx)(VibrationSegment, { level: value, chosen: value === level }, value)) })
    ] });
  }
  function SectionLabel({ icon, title, detail: detail2 }) {
    const text = /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 3 }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 19, fontWeight: 600, color: colors.muted, letterSpacing: 1.5 }, children: title }),
      detail2 ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 19, color: colors.muted, lineHeight: 27 }, children: detail2 }) : null
    ] });
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 12, paddingTop: 12, paddingBottom: 4 }, children: [
      icon ? /* @__PURE__ */ (0, jsx)(Icon, { name: icon, size: 26, color: colors.muted }) : null,
      text
    ] });
  }
  function SettingsScreen({ onBack }) {
    const t2 = useT();
    const choice2 = languageChoice();
    const pick2 = (code) => chooseLanguage(code);
    return /* @__PURE__ */ (0, jsx)(FocusScope, {
      autoFocus: true,
      onBack: () => { onBack(); return true; },
      children: /* @__PURE__ */ (0, jsxs)(View, {
        style: { flex: 1 },
        children: [
          /* @__PURE__ */ (0, jsx)(Text, {
            style: { paddingHorizontal: 48, paddingTop: 36, paddingBottom: 28,
              fontFamily: "Inter-Regular", fontSize: 36, fontWeight: 700,
              color: colors.fg, lineHeight: 50, letterSpacing: -0.75 },
            children: t2("settings.title")
          }),
          /* Only language options scroll; the left column stays in place. */
          /* @__PURE__ */ (0, jsxs)(View, {
            style: { flex: 1, flexDirection: "row", paddingHorizontal: 48, gap: 104 },
            children: [
                /* Download and controller settings in a narrower left column. */
                /* @__PURE__ */ (0, jsxs)(View, {
                  style: { width: 830, gap: 6 },
                  children: [
                    /* @__PURE__ */ (0, jsx)(SectionLabel, { icon: "download", title: t2("settings.downloads") }),
                    /* @__PURE__ */ (0, jsx)(SpeedLimit, {}),
                    /* @__PURE__ */ (0, jsx)(DeletePackages, {}),
                    /* @__PURE__ */ (0, jsx)(SectionLabel, { title: t2("settings.controller") }),
                    /* @__PURE__ */ (0, jsx)(VibrationLevel, {})
                  ]
                }),
                /* Independent scrolling language column, shifted 56px right. */
                /* @__PURE__ */ (0, jsxs)(View, {
                  style: { width: 650, flex: 1, position: 'relative' },
                  children: [
                    /* Keep the title visible while only the language options scroll. */
                    /* @__PURE__ */ (0, jsx)(SectionLabel, { icon: "languages", title: t2("language.title"), detail: t2("language.subtitle") }),
                    /* @__PURE__ */ (0, jsx)(ScrollView, {
                      style: { flex: 1, marginBottom: 90 },
                      children: /* @__PURE__ */ (0, jsxs)(View, {
                        style: { paddingTop: 12, paddingBottom: 80, gap: 8 },
                        children: [
                          /* @__PURE__ */ (0, jsx)(Row4, { code: "system", name: t2("language.system"), detail: nameOf(systemLocale()), checked: choice2 === null, onPress: () => pick2(null) }),
                    LOCALES.map(
                      ({ code, name }) => /* @__PURE__ */ (0, jsx)(Row4, { code, name, detail: t2(`language.name.${code}`), checked: choice2 === code, onPress: () => pick2(code) }, code)
                    )
                        ]
                      })
                    }),
                    /* Stop the list early and softly fade languages before the screen footer. */
                    /* @__PURE__ */ (0, jsx)(View, {
                      pointerEvents: 'none',
                      style: { position: 'absolute', left: 0, right: 0, bottom: 90,
                        height: 62, backgroundGradient: { type: 'linear', to: 'top',
                          stops: [{ color: '#000000', offset: 0 }, { color: '#00000000', offset: 1 }] } }
                    })
                  ]
                })
              ]
          })
        ]
      })
    });
  }

export { SettingsScreen };
