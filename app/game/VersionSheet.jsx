// ../pub-game-store/native/game/VersionSheet.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useMemo } from 'react';
import { preferredRelease, sourceSections } from './sources.js';
import { t } from '../i18n/core.js';
import { useLocale, useT } from '../i18n/index.js';
import { formatBytes, formatSize } from '../state/size.js';
import { FocusRing } from '../ui/FocusRing.jsx';
import { PlatformBadge } from '../ui/PlatformBadge.jsx';
import { SideSheet } from '../ui/SideSheet.jsx';
import { colors } from '../ui/colors.js';
import { Text, View, useIsFocused } from '@ps5-react/core';

  function summary2(edition2) {
    const releases = edition2.releases || [];
    const bytes = releases[preferredRelease(releases)]?.sizeBytes;
    const sources = sourceSections(releases).filter(({ group }) => group !== "dlc" && group !== "unavailable").reduce((sum, { items }) => sum + items.length, 0);
    return [bytes ? formatBytes(bytes) : edition2.sizeGb ? formatSize(edition2.sizeGb) : null, t("versions.sources", { count: sources })];
  }
  function VersionFace({ edition: edition2, here, twin, recommended }) {
    const t2 = useT();
    const { locale: locale2 } = useLocale();
    const focused = useIsFocused();
    const facts = (0, useMemo)(() => summary2(edition2), [edition2, locale2]);
    const detail2 = [...facts, here ? t2("versions.thisPage") : null].filter(Boolean).join(" \xB7 ");
    const name = t2("versions.name", { platform: edition2.platform.toUpperCase() });
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(PlatformBadge, { platforms: [edition2.platform] }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 3 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: "#f2f2f3" }, children: twin ? [name, edition2.region, edition2.titleId].filter(Boolean).join(" \xB7 ") : name }),
        /* @__PURE__ */ (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 21, lineHeight: 30 }, { color: focused ? colors.fg : colors.muted }], children: t2(recommended ? "versions.recommended" : `versions.note.${edition2.platform}`) }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: detail2 })
      ] })
    ] });
  }
  function VersionSheet({ title, editions, current, submit, onClose }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsx)(SideSheet, { title: t2("versions.title"), subtitle: title, onClose, children: /* @__PURE__ */ (0, jsx)(View, { style: { gap: 6, padding: 9 }, children: editions.map(
      (edition2, index) => /* @__PURE__ */ (0, jsx)(View, { autoFocus: index === 0, onPress: () => {
        onClose();
        submit(edition2);
      }, style: (_state) => [{ position: "relative", flexDirection: "row", alignItems: "center", gap: 24, borderRadius: 12, paddingHorizontal: 18, paddingVertical: 24 }, _state.focused ? { backgroundColor: "#212125" } : null], children: /* @__PURE__ */ (0, jsx)(
        VersionFace,
        {
          edition: edition2,
          here: edition2.id === current,
          recommended: index === 0 && edition2.platform === "ps5",
          twin: editions.some((other) => other !== edition2 && other.platform === edition2.platform)
        }
      ) }, edition2.id)
    ) }) });
  }

export { VersionFace, VersionSheet };
