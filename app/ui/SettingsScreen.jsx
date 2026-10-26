// Settings, rebuilt as the PS5's own settings are: every entry a tile that shows its value, and
// pressing it opens that setting's page — its choices on the left, what the focused choice does on
// the right. The order is General first, then the Downloads settings, then the linked services.
// Services wear the same brand marks the Downloads page draws.
//
// The page's content lives in settings-data.js; this file is layout and what a press does. Back (○)
// leaves a setting for the tiles, and leaves the tiles for the app.

import '../assets/Inter-Regular.ttf';
import '../assets/JetBrainsMono-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useState } from 'react';
import { chooseLanguage, languageChoice, systemLocale, useT } from '../i18n/index.js';
import en from '../i18n/locales/en.json';
import { useNavActions } from '../state/nav.jsx';
import { setService, useServices } from '../state/download-services.js';
import { setSpeedLimit, useSpeedLimit } from '../state/speed-limit.js';
import { setDeletePackages, useDeletePackages } from '../state/package-cleanup.js';
import { setDownloadRoot, useDownloadRoot } from '../state/download-root.js';
import { storageRoots } from '../state/downloads.js';
import { setPkgMode, usePkgMode } from '../state/pkg-mode.js';
import { setVibrationLevel, useVibrationLevel } from './haptics.js';
import { GROUPS, ITEMS, currentOf, optionsOf, selectedIndex, sideOf, valueOf } from './settings-data.js';
import { Button2 } from './Button.jsx';
import { FocusRing } from './FocusRing.jsx';
import { Icon } from './Icon.jsx';
import { LogoMark } from './Logo.jsx';
import { PlatformBadge } from './PlatformBadge.jsx';
import { HINT, useHints } from './Legend.jsx';
import { colors } from './colors.js';
import { formatBytes } from '../state/size.js';
import { URLDialog } from '../downloads/URLDialog.jsx';
import { PhoneSetup } from '../downloads/PhoneSetup.jsx';
import { FileSystem, FocusScope, ScrollView, Text, View, useIsFocused } from '@ps5-react/core';

  // The screen is 1920 wide and the tiles sit inside two 96 px margins, each row inset 14 more: two
  // columns, 18 apart, come to 841 each.
  var PAGE_PAD = 96;
  var INSET = 14;
  var GAP = 18;
  var TILE_W = (1920 - PAGE_PAD * 2 - INSET * 2 - GAP) / 2;
  var HOME_HINTS = [HINT.select, HINT.back];
  var PAGE_HINTS = [HINT.select, HINT.back];

  var TITLES = /* @__PURE__ */ new Map();

  // A language's own word for "Settings", for the sample on its page: read once per language.
  function titleIn(code) {
    if (TITLES.has(code)) return TITLES.get(code);
    let text = en["settings.title"];
    try {
      text = JSON.parse(FileSystem.readFile(`${FileSystem.appDir}/i18n/locales/${code}.json`))["settings.title"] || text;
    } catch (error) {
      console.log(`[settings] ${code} not read: ${error.message}`);
    }
    TITLES.set(code, text);
    return text;
  }

  // Every setting's value, from the modules that save it to settings.json. The drives are measured
  // once, as the page opens, rather than on every focus move.
  function useSettingsValues() {
    const services = useServices();
    const limit = useSpeedLimit();
    const root = useDownloadRoot();
    const mode = usePkgMode();
    const cleanup = useDeletePackages();
    const vibration = useVibrationLevel();
    const [drives] = useState(() => {
      let roots = [];
      try {
        roots = storageRoots();
      } catch (error) {
        console.log(`[settings] drives not listed: ${error.message}`);
      }
      return roots.map((value) => {
        try {
          const usage = FileSystem.diskUsage(value);
          return { root: value, free: usage.free, total: usage.total };
        } catch (error) {
          console.log(`[settings] ${value}: ${error.message}`);
          return { root: value, free: 0, total: 0 };
        }
      });
    });
    return { services, limit, root, mode, cleanup, vibration, choice: languageChoice(), drives };
  }

  // A tile: its mark, its name, the value it has now, and the chevron into its page.
  function Tile({ id, item, value, onPress }) {
    const t2 = useT();
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsx)(View, {
      focusKey: `settings:tile:${id}`,
      onPress,
      style: (state) => [{ position: "relative", width: TILE_W, height: 128, flexDirection: "row", alignItems: "center", gap: 26, borderRadius: 20, paddingLeft: 26, paddingRight: 34, backgroundColor: colors.surface }, state.focused ? { backgroundColor: colors.surface2 } : null],
      children: /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
        /* @__PURE__ */ (0, jsx)(FocusRing, { round: "lg" }),
        /* @__PURE__ */ (0, jsx)(View, { style: { width: 76, height: 76, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: focused ? colors.surface3 : colors.surface2 }, children: item.brand
          ? /* @__PURE__ */ (0, jsx)(Icon, { name: item.brand, size: 44, color: colors.fg })
          : /* @__PURE__ */ (0, jsx)(Icon, { name: item.icon, size: 36, color: colors.fg }) }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 6 }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 27, fontWeight: 600, color: colors.fg, letterSpacing: -0.3, numberOfLines: 1, ellipsizeMode: "tail" }, children: t2(item.title) }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, numberOfLines: 1, ellipsizeMode: "tail" }, children: value })
        ] }),
        /* @__PURE__ */ (0, jsx)(Icon, { name: "chevronRight", size: 26, color: focused ? colors.fg : colors.muted })
      ] })
    });
  }

  function Section({ group, ctx, t2, onOpen }) {
    const items = group.items.filter((id) => id !== "disk" || ctx.values.drives.length > 1);
    if (!items.length) return null;
    // Two tiles a row, as the grid draws them: built by hand rather than wrapped, so a rounding of
    // the row's width can never push the second column down to a row of its own.
    const rows = [];
    for (let at = 0; at < items.length; at += 2) rows.push(items.slice(at, at + 2));
    return /* @__PURE__ */ (0, jsxs)(View, { style: { marginBottom: 26 }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { marginLeft: 4, marginRight: 4, marginBottom: 16, fontFamily: "Inter-Regular", fontSize: 19, fontWeight: 600, letterSpacing: 2.4, color: colors.subtle }, children: t2(group.title) }),
      /* @__PURE__ */ (0, jsx)(View, { style: { gap: GAP }, children: rows.map((pair) => /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", gap: GAP }, children: pair.map((id) => /* @__PURE__ */ (0, jsx)(Tile, {
        id, item: ITEMS[id], value: valueOf(id, ctx, t2), onPress: () => onOpen(id)
      }, id)) }, pair.join(":"))) })
    ] });
  }

  function Home({ ctx, t2, onOpen }) {
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, paddingTop: 34, paddingHorizontal: PAGE_PAD }, children: [
      /* @__PURE__ */ (0, jsx)(View, { style: { height: 60, justifyContent: "center" }, children: /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 44, fontWeight: 600, color: colors.fg, letterSpacing: -1.2 }, children: t2("settings.title") }) }),
      /* @__PURE__ */ (0, jsx)(ScrollView, { style: { flex: 1, marginTop: 18 }, children: /* @__PURE__ */ (0, jsx)(View, { style: { paddingTop: 14, paddingHorizontal: INSET, paddingBottom: 90 }, children: GROUPS.map((group) => /* @__PURE__ */ (0, jsx)(Section, { group, ctx, t2, onOpen }, group.key)) }) })
    ] });
  }

  // A row of a setting's page: a radio that fills when it is the choice, or the square an action
  // carries its icon in, then the name, the line under it, and what the row holds now.
  function Option({ id, index, row, t2, selected, onFocus, onPress }) {
    const focused = useIsFocused();
    return /* @__PURE__ */ (0, jsxs)(View, {
      focusKey: `settings:option:${id}:${index}`,
      onPress,
      onFocus,
      style: [{ position: "relative", minHeight: 88, flexDirection: "row", alignItems: "center", gap: 22, borderRadius: 18, paddingVertical: 18, paddingHorizontal: 28, backgroundColor: focused ? colors.surface2 : colors.surface }],
      children: [
        /* @__PURE__ */ (0, jsx)(FocusRing, { round: "lg" }),
        row.action
          ? /* @__PURE__ */ (0, jsx)(View, { style: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }, children: /* @__PURE__ */ (0, jsx)(Icon, { name: row.action, size: 22, color: colors.fg }) })
          : /* @__PURE__ */ (0, jsx)(View, { style: { width: 34, height: 34, borderRadius: 17, borderWidth: 3, borderColor: selected ? colors.fg : colors.subtle, alignItems: "center", justifyContent: "center", backgroundColor: selected ? colors.fg : "transparent" }, children: selected ? /* @__PURE__ */ (0, jsx)(Icon, { name: "check", size: 20, color: colors.accentFg }) : null }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 4 }, children: [
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 27, fontWeight: 600, color: colors.fg }, children: row.label }),
          row.detail ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, color: colors.muted, lineHeight: 28 }, children: row.detail }) : null
        ] }),
        row.tag ? /* @__PURE__ */ (0, jsx)(View, { style: { borderRadius: 999, backgroundColor: colors.ok, paddingVertical: 5, paddingHorizontal: 14 }, children: /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 17, fontWeight: 600, color: colors.accentFg }, children: row.tag }) }) : null,
        // The marks sit on the row itself, with no box behind them.
        row.mark ? /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", alignItems: "center", gap: 10 }, children: row.mark === "console"
          ? /* @__PURE__ */ (0, jsx)(PlatformBadge, { platforms: ["ps5"], scale: 1.5 })
          : row.mark === "overdrive" ? /* @__PURE__ */ (0, jsx)(LogoMark, { size: 36 }) : /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
            /* @__PURE__ */ (0, jsx)(PlatformBadge, { platforms: ["ps5"], scale: 1.05 }),
            /* @__PURE__ */ (0, jsx)(LogoMark, { size: 24 })
          ] }) }) : null,
        row.valueText ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 20, color: row.valueText === t2("add.notSet") ? colors.subtle : colors.muted, numberOfLines: 1, ellipsizeMode: "head" }, children: row.valueText }) : null
      ]
    });
  }

  // The vibration level, drawn: four bars, as many lit as the level holds.
  function Preview({ level }) {
    const lit = Math.round(level / 25);
    return /* @__PURE__ */ (0, jsxs)(View, { style: { alignItems: "center", gap: 20, paddingVertical: 8 }, children: [
      // The pad's own mark sits a little high in its square: the glyph's drawing leans below the
      // centre of its box, so a margin under it is what puts it in the middle to the eye.
      /* @__PURE__ */ (0, jsx)(View, { style: { width: 200, height: 200, borderRadius: 56, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }, children: /* @__PURE__ */ (0, jsx)(View, { style: { marginBottom: 16 }, children: /* @__PURE__ */ (0, jsx)(Icon, { name: "controller", size: 96, color: colors.fg }) }) }),
      /* @__PURE__ */ (0, jsx)(View, { style: { flexDirection: "row", gap: 10 }, children: [0, 1, 2, 3].map((step) => /* @__PURE__ */ (0, jsx)(View, { style: { width: 44, height: 6, borderRadius: 3, backgroundColor: step < lit ? colors.fg : colors.surface3 } }, String(step))) })
    ] });
  }

  // The panel on the right of a page: an eyebrow, the marks or the sample, the big line, the rows,
  // the drives, and the note that says what the choice does. Its width is what the row leaves after
  // the 980 left column and the 72 between them, so its lines know where to wrap.
  var SIDE_W = 1920 - PAGE_PAD * 2 - 980 - 72;
  function Side({ data, t2 }) {
    return /* @__PURE__ */ (0, jsxs)(View, { style: { width: SIDE_W, borderRadius: 26, backgroundColor: colors.surface, paddingVertical: 44, paddingHorizontal: 48, gap: 26 }, children: [
      data.eyebrow ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 18, fontWeight: 600, letterSpacing: 2.4, color: colors.subtle }, children: data.eyebrow }) : null,
      data.sample ? /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 6 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 60, fontWeight: 600, color: colors.fg, letterSpacing: -1.4, writingDirection: data.rtl ? "rtl" : "ltr", textAlign: data.rtl ? "right" : "left" }, children: data.sample.title }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 26, color: colors.muted, writingDirection: data.rtl ? "rtl" : "ltr", textAlign: data.rtl ? "right" : "left" }, children: data.sample.name })
      ] }) : null,
      data.preview !== void 0 ? /* @__PURE__ */ (0, jsx)(Preview, { level: data.preview }) : null,
      data.marks ? /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 22 }, children: [
        data.marks === "console" ? /* @__PURE__ */ (0, jsx)(PlatformBadge, { platforms: ["ps5"], scale: 2 }) : null,
        data.marks === "overdrive" ? /* @__PURE__ */ (0, jsx)(LogoMark, { size: 56 }) : null,
        data.marks === "ask" ? /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 14 }, children: [
          /* @__PURE__ */ (0, jsx)(PlatformBadge, { platforms: ["ps5"], scale: 1.4 }),
          /* @__PURE__ */ (0, jsx)(LogoMark, { size: 34 })
        ] }) : null,
        data.markLabel ? /* @__PURE__ */ (0, jsx)(Text, { style: { flex: 1, fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, children: data.markLabel }) : null
      ] }) : null,
      data.big ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 40, fontWeight: 600, color: colors.fg, letterSpacing: -0.8 }, children: data.big }) : null,
      data.rows && data.rows.length ? /* @__PURE__ */ (0, jsx)(View, { style: { gap: 14 }, children: data.rows.map((row) => /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 18, backgroundColor: row.on ? colors.fg : colors.surface2 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 22, color: row.on ? colors.accentFg : colors.muted }, children: row.label }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 22, fontWeight: 600, color: row.on ? colors.accentFg : colors.fg }, children: row.value })
      ] }, row.label)) }) : null,
      data.drives && data.drives.length ? /* @__PURE__ */ (0, jsx)(View, { style: { gap: 14 }, children: data.drives.map((drive) => /* @__PURE__ */ (0, jsxs)(View, { style: [{ gap: 10, borderRadius: 16, paddingVertical: 18, paddingHorizontal: 20, backgroundColor: colors.surface2 }, drive.on ? { borderWidth: 3, borderColor: colors.fg } : null], children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 22, fontWeight: 600, color: colors.fg }, children: drive.name }),
        drive.total ? /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
          /* @__PURE__ */ (0, jsx)(View, { style: { height: 12, borderRadius: 6, backgroundColor: colors.surface3 }, children: /* @__PURE__ */ (0, jsx)(View, { style: { width: Math.max(2, Math.round((drive.total - drive.free) / drive.total * 100)) + "%", height: 12, borderRadius: 6, backgroundColor: colors.fg } }) }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 19, color: colors.muted }, children: t2("files.free", { free: formatBytes(drive.free), total: formatBytes(drive.total) }) })
        ] }) : null
      ] }, drive.name)) }) : null,
      data.small ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 32 }, children: data.small }) : null
    ] });
  }

  // A setting's page: its name and what it is, the choices under it, and what the focused choice
  // does beside them. The block is short or tall as its choices are, and the page centres it: the
  // list stops at a screenful and scrolls past that (a language list is longer than the screen).
  var LIST_MAX_H = 620;
  function Detail({ id, ctx, t2, onPick }) {
    const [focused, setFocused] = useState(() => selectedIndex(id, ctx, t2));
    const rows = optionsOf(id, ctx, t2);
    const row = rows[Math.min(focused, rows.length - 1)];
    const current = currentOf(id, ctx.values);
    const item = ITEMS[id];
    return /* @__PURE__ */ (0, jsx)(View, { style: { flex: 1, justifyContent: "center", paddingHorizontal: PAGE_PAD, paddingVertical: 30 }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 72 }, children: [
        /* @__PURE__ */ (0, jsxs)(View, { style: { width: 980 }, children: [
          item.brand
            // A service's page opens with its own mark beside its name, as its tile draws it.
            ? /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 24, height: 76 }, children: [
              /* @__PURE__ */ (0, jsx)(View, { style: { width: 76, height: 76, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface2 }, children: /* @__PURE__ */ (0, jsx)(Icon, { name: item.brand, size: 44, color: colors.fg }) }),
              /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 46, fontWeight: 600, color: colors.fg, letterSpacing: -1.2 }, children: t2(item.title) })
            ] })
            : /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 46, fontWeight: 600, color: colors.fg, letterSpacing: -1.2, lineHeight: 58 }, children: t2(item.title) }),
          /* @__PURE__ */ (0, jsx)(Text, { style: { width: 800, marginTop: 4, marginBottom: 18, fontFamily: "Inter-Regular", fontSize: 24, color: colors.muted, lineHeight: 35 }, children: t2(item.lead) }),
          /* @__PURE__ */ (0, jsx)(ScrollView, { style: { maxHeight: LIST_MAX_H }, children: /* @__PURE__ */ (0, jsx)(View, { style: { gap: 12, padding: 10, paddingBottom: 12 }, children: rows.map((entry, index) => /* @__PURE__ */ (0, jsx)(Option, {
            id, index, row: entry, t2,
            selected: entry.value !== void 0 && entry.value === current,
            onFocus: () => setFocused(index),
            onPress: () => onPick(id, entry, index)
          }, entry.key)) }) })
        ] }),
        /* @__PURE__ */ (0, jsx)(Side, { data: sideOf(id, ctx, row, t2), t2 })
      ] }) });
  }

  function UnlinkDialog({ service, t2, onConfirm, onCancel }) {
    return /* @__PURE__ */ (0, jsx)(FocusScope, {
      trap: true, autoFocus: true,
      onBack: () => { onCancel(); return true; },
      onAction: () => true,
      children: /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 50, alignItems: "center", justifyContent: "center", backgroundColor: "#000000f2" }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { width: 900, gap: 24, padding: 48, borderRadius: 18, borderWidth: 2, borderColor: colors.line, backgroundColor: colors.surface }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 34, fontWeight: 600, color: colors.fg, lineHeight: 46 }, children: t2("settings.unlinkTitle", { service: t2(`add.${service}Name`) }) }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: colors.muted, lineHeight: 30 }, children: t2("settings.unlinkBody") }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 12, paddingTop: 6 }, children: [
          /* @__PURE__ */ (0, jsx)(Button2, { label: t2("settings.unlink"), focusKey: "settings:unlink:yes", autoFocus: true, onPress: onConfirm }),
          /* @__PURE__ */ (0, jsx)(Button2, { label: t2("add.cancel"), variant: "outline", onPress: onCancel })
        ] })
      ] }) })
    });
  }

  function SettingsScreen({ onBack }) {
    const t2 = useT();
    const values = useSettingsValues();
    const { focusLater } = useNavActions();
    const [page, setPage] = useState(null);
    const [dialog, setDialog] = useState(null);
    useHints(page ? PAGE_HINTS : HOME_HINTS);
    const ctx = { values, drives: values.drives, system: systemLocale(), titleIn };
    const optionKey = (id, index) => `settings:option:${id}:${index}`;
    const open = (id) => {
      setPage(id);
      focusLater(optionKey(id, selectedIndex(id, ctx, t2)));
    };
    const closePage = () => {
      setPage(null);
      focusLater(`settings:tile:${page}`);
    };
    const closeDialog = (index) => {
      setDialog(null);
      focusLater(optionKey(page, index));
    };
    const fieldIndex = (field) => optionsOf(page, ctx, t2).findIndex((entry) => entry.field === field);
    const pick = (id, row, index) => {
      if (row.value !== void 0) {
        if (id === "vibration") setVibrationLevel(row.value);
        else if (id === "language") chooseLanguage(row.value === "system" ? null : row.value);
        else if (id === "speed") setSpeedLimit(row.value);
        else if (id === "disk") setDownloadRoot(row.value === "auto" ? null : row.value);
        else if (id === "pkg") setPkgMode(row.value);
        else if (id === "cleanup") setDeletePackages(row.value);
        return;
      }
      if (row.phone) return setDialog({ type: "phone", service: row.phone, index });
      if (row.unlink) return setDialog({ type: "unlink", service: row.unlink, index });
      if (row.field) return setDialog({ type: "field", field: row.field, service: page, value: row.initial || "", index });
    };
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1 }, children: [
      // The tiles stay mounted under a setting's page, hidden and out of navigation: Back finds them
      // as they were left, at the scroll the player had, instead of a fresh grid at the top.
      /* @__PURE__ */ (0, jsx)(View, { style: page ? { flex: 1, display: "none" } : { flex: 1 }, children: /* @__PURE__ */ (0, jsx)(FocusScope, {
        focusKey: "settings:home", autoFocus: true, inert: page !== null,
        onBack: () => {
          onBack();
          return true;
        },
        children: /* @__PURE__ */ (0, jsx)(Home, { ctx, t2, onOpen: open })
      }) }),
      page ? /* @__PURE__ */ (0, jsx)(FocusScope, {
        focusKey: `settings:page:${page}`, autoFocus: true, trap: true,
        onBack: () => {
          closePage();
          return true;
        },
        children: /* @__PURE__ */ (0, jsx)(Detail, { id: page, ctx, t2, onPick: pick })
      }) : null,
      dialog && dialog.type === "phone" ? /* @__PURE__ */ (0, jsx)(PhoneSetup, {
        service: dialog.service,
        onField: (field) => setDialog({ type: "field", field, service: dialog.service, value: values.services[field] || "", index: Math.max(0, fieldIndex(field)) }),
        onDone: () => closeDialog(dialog.index),
        onCancel: () => closeDialog(dialog.index)
      }) : null,
      dialog && dialog.type === "field" ? /* @__PURE__ */ (0, jsx)(URLDialog, {
        title: t2(`add.field.${dialog.field}`),
        detail: t2(`add.fieldBody.${dialog.field}`),
        initial: dialog.value,
        submit: (value) => setService(dialog.field, value),
        onClose: () => closeDialog(dialog.index)
      }) : null,
      dialog && dialog.type === "unlink" ? /* @__PURE__ */ (0, jsx)(UnlinkDialog, {
        service: dialog.service,
        t2,
        onConfirm: () => {
          setService(dialog.service, "");
          // The unlink row was the last one and it is gone with the key.
          closeDialog(Math.max(0, dialog.index - 1));
        },
        onCancel: () => closeDialog(dialog.index)
      }) : null
    ] });
  }

export { SettingsScreen };
