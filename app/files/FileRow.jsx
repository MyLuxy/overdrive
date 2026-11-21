// ../pub-game-store/native/files/FileRow.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { memo } from 'react';
import { KINDS, isPackage } from './scan.js';
import { explainError } from '../downloads/errors.js';
import { formatPercent2 } from '../i18n/core.js';
import { useT } from '../i18n/index.js';
import { formatBytes } from '../state/size.js';
import { ButtonGlyph } from '../ui/ButtonHints.jsx';
import { Cover } from '../ui/Cover.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { Icon } from '../ui/Icon.jsx';
import { PlatformBadge } from '../ui/PlatformBadge.jsx';
import { ProgressBar } from '../ui/ProgressBar.jsx';
import { colors } from '../ui/colors.js';
import { px } from '../ui/scale.js';
import { Text, View, useIsFocused } from '@ps5-react/core';

  var COVER2 = { width: px(36), height: px(48), borderRadius: px(4) };
  var TEXT_WIDTH = 560;
  var ICON_OF = Object.fromEntries(KINDS.map((kind) => [kind.key, kind.icon]));
  function typeOf2(file) {
    if (isPackage(file.name)) return "files.type.package";
    if (file.kind === "images") return "files.type.image";
    if (file.kind === "archives") return "files.type.archive";
    return file.isDirectory ? "files.type.folder" : "files.type.file";
  }
  function Thumb({ file, dark }) {
    if (file.game?.art?.cover) return /* @__PURE__ */ (0, jsx)(Cover, { game: file.game, label: false, style: COVER2 });
    return /* @__PURE__ */ (0, jsx)(View, { style: [{ height: 72, width: 54, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: "#212125" }, dark ? { backgroundColor: "#dcdce0" } : null], children: /* @__PURE__ */ (0, jsx)(Icon, { name: ICON_OF[file.kind], size: 18, color: dark ? colors.canvas : colors.muted }) });
  }
  function detail(t2, file, shadowMount) {
    const parts = [t2(typeOf2(file))];
    if (file.titleId) parts.push(file.titleId);
    if (file.installed) parts.push(t2("files.installed"));
    else if (file.kind === "images") parts.push(t2(shadowMount ? "files.byShadowMount" : "files.waitingShadowMount"));
    else if (isPackage(file.name)) parts.push(t2("files.notInstalled"));
    return parts.join(" \xB7 ");
  }
  // The install's own reason, as the download rows show it (issue #44): a fixed "check kstuff" line
  // hid a PS5 package the installer did not take at all (issue #24).
  function installReason(t2, error2) {
    const reason = explainError(error2).title;
    return reason ? t2("files.installFailedReason", { reason }) : t2("files.installFailed");
  }
  function Face2({ file, armed, installing, shadowMount }) {
    const t2 = useT();
    const focused = useIsFocused();
    const busy = installing && !installing.done && !installing.error;
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      armed ? null : /* @__PURE__ */ (0, jsx)(FocusRing, {}),
      /* @__PURE__ */ (0, jsx)(Thumb, { file, dark: armed }),
      /* @__PURE__ */ (0, jsxs)(View, { style: [{ gap: 9 }, { width: px(TEXT_WIDTH) }], children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 15 }, children: [
          file.platform ? /* @__PURE__ */ (0, jsx)(PlatformBadge, { platforms: [file.platform] }) : null,
          /* @__PURE__ */ (0, jsx)(
            Text,
            {
              style: [armed ? { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: "#000000", numberOfLines: 1, ellipsizeMode: "tail" } : { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: "#f2f2f3", numberOfLines: 1, ellipsizeMode: "tail" }, { width: px(file.platform ? TEXT_WIDTH - 54 : TEXT_WIDTH) }],
              children: file.game?.title ?? file.name
            }
          )
        ] }),
        armed ? /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 9 }, children: [
          /* @__PURE__ */ (0, jsx)(ButtonGlyph, { button: "square", size: 14 }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, fontWeight: 600, color: "#000000" }, children: t2("files.confirmDelete", { size: formatBytes(file.size) }) })
        ] }) : busy ? /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 18 }, children: [
          /* @__PURE__ */ (0, jsx)(ProgressBar, { fraction: installing.fraction, width: 240, active: true }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, color: "#f2f2f3" }, children: t2("files.installing", { percent: formatPercent2(Math.round(installing.fraction * 100)) }) })
        ] }) : /* @__PURE__ */ (0, jsx)(
          Text,
          {
            style: [installing?.error ? { fontFamily: "Inter-Regular", fontSize: 20, color: "#f2f2f3", numberOfLines: 1, ellipsizeMode: "tail" } : focused ? { fontFamily: "Inter-Regular", fontSize: 20, color: "#a3a3ab", numberOfLines: 1, ellipsizeMode: "tail" } : { fontFamily: "Inter-Regular", fontSize: 20, color: "#8a8a94", numberOfLines: 1, ellipsizeMode: "tail" }, { width: px(TEXT_WIDTH) }],
            children: installing?.error ? installReason(t2, installing.error) : installing?.done ? t2("files.installDone") : file.game ? `${file.name} \xB7 ${detail(t2, file, shadowMount)}` : detail(t2, file, shadowMount)
          }
        )
      ] }),
      /* @__PURE__ */ (0, jsx)(View, { style: { flex: 1 } }),
      /* @__PURE__ */ (0, jsx)(Text, { style: armed ? { fontFamily: "Inter-Regular", fontSize: 23, fontWeight: 600, color: "#000000" } : { fontFamily: "Inter-Regular", fontSize: 23, color: "#f2f2f3" }, children: formatBytes(file.size) })
    ] });
  }
  var FileRow = (0, memo)(function FileRow2({ file, armed, installing, shadowMount, autoFocus, focusKey, onPress, onFocus }) {
    return /* @__PURE__ */ (0, jsx)(View, { focusKey, autoFocus, onPress, onFocus, style: (_state) => armed ? { height: 102, flexDirection: "row", alignItems: "center", gap: 24, borderRadius: 12, backgroundColor: "#f2f2f3", paddingHorizontal: 24 } : [{ height: 102, flexDirection: "row", alignItems: "center", gap: 24, borderRadius: 12, paddingHorizontal: 24 }, _state.focused ? { backgroundColor: "#212125" } : null], children: /* @__PURE__ */ (0, jsx)(Face2, { file, armed, installing, shadowMount }) });
  });

export { FileRow };
