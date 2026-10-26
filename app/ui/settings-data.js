// The new Settings page's content, kept apart from its layout: three groups of tiles, each tile's
// current value, the choices its own page lists and the panel that says what the focused choice
// does. Keys are i18n keys and everything else is plain data, so SettingsScreen.jsx stays markup.
//
// The groups are the PS5's order: General first, then what Downloads does, then the services a link
// or a magnet can be handed to. "Disk for downloads" shows only when there is more than one drive,
// as before (issue #103).

import { formatPercent2 } from '../i18n/core.js';
import { LOCALES, isRTL } from '../i18n/locales.js';
import { driveName } from '../state/drive-names.js';
import { LIMITS } from '../state/speed-limit.js';
import { MODES } from '../state/pkg-mode.js';
import { formatBytes } from '../state/size.js';
import { LEVELS } from './haptics.js';

  var GROUPS = [
    { key: "general", title: "settings.group.general", items: ["vibration", "language"] },
    { key: "downloads", title: "settings.group.downloads", items: ["speed", "disk", "pkg", "cleanup", "seeding"] },
    { key: "services", title: "settings.group.services", items: ["torbox", "realdebrid", "premiumize", "qbittorrent"] }
  ];

  // `brand` draws the service's own logo, the same mark the Downloads page puts on its cards.
  var ITEMS = {
    vibration: { icon: "controller", title: "settings.vibration", lead: "settings.vibrationDetail" },
    language: { icon: "languages", title: "language.title", lead: "language.subtitle" },
    speed: { icon: "gauge", title: "settings.speedLimit", lead: "settings.speedLimitDetail" },
    disk: { icon: "hardDrive", title: "settings.disk", lead: "settings.diskDetail" },
    pkg: { icon: "package", title: "settings.pkgMode", lead: "settings.pkgModeDetail" },
    cleanup: { icon: "trash", title: "settings.deletePackages", lead: "settings.deletePackagesDetail" },
    // The torrent engine's own switch: it shares what it downloaded only while the app is open.
    seeding: { icon: "globe", title: "settings.seeding", lead: "settings.seedingDetail" },
    torbox: { brand: "torbox", title: "add.torboxName", lead: "settings.torboxLead" },
    realdebrid: { brand: "realdebrid", title: "add.realdebridName", lead: "settings.realdebridLead" },
    premiumize: { brand: "premiumize", title: "add.premiumizeName", lead: "settings.premiumizeLead" },
    qbittorrent: { brand: "qbittorrent", title: "add.qbittorrentName", lead: "settings.qbittorrentLead" }
  };

  // The services a page opens, and the two whose account is linked from the phone with a QR code
  // (device-login.js); the typed key stays beside it, as on the Downloads page.
  var SERVICES = ["torbox", "realdebrid", "premiumize", "qbittorrent"];
  var PHONE = ["torbox", "realdebrid"];
  var MODE_DETAIL = { ask: "settings.pkgAskDetail", console: "settings.pkgConsoleDetail", overdrive: "settings.pkgOverdriveDetail" };

  function mask(key) {
    return `••••${key.slice(-4)}`;
  }

  function localeName(code) {
    const found = LOCALES.find((locale) => locale.code === code);
    return found ? found.name : code;
  }

  // "50%" or "Off", the one wording the vibration step has everywhere it shows.
  function levelText(t2, level) {
    return level ? formatPercent2(level) : t2("settings.vibrationOff");
  }

  /** The value a page's radio list marks as chosen. */
  function currentOf(id, values) {
    switch (id) {
      case "vibration": return values.vibration;
      case "language": return values.choice ?? "system";
      case "speed": return values.limit;
      case "disk": return values.root ?? "auto";
      case "pkg": return values.mode;
      case "cleanup": return values.cleanup;
      case "seeding": return values.seeding;
      default: return null;
    }
  }

  /** What the tile under a setting's name reads. */
  function valueOf(id, ctx, t2) {
    const values = ctx.values;
    if (id === "vibration") return levelText(t2, values.vibration);
    if (id === "language") return values.choice ? localeName(values.choice) : `${t2("language.system")} · ${localeName(ctx.system)}`;
    if (id === "speed") return values.limit ? `${values.limit} MB/s` : t2("settings.speedUnlimited");
    if (id === "disk") return values.root ? driveName(values.root) : t2("settings.diskAuto");
    if (id === "pkg") return t2(`settings.pkgMode.${values.mode}`);
    if (id === "cleanup") return t2(values.cleanup ? "settings.on" : "settings.off");
    if (id === "seeding") return t2(values.seeding ? "settings.on" : "settings.off");
    if (id === "qbittorrent") return values.services.address || t2("add.notSet");
    if (SERVICES.includes(id)) {
      const key = values.services[id];
      return key ? mask(key) : t2("add.serviceNeeds");
    }
    return "";
  }

  // A row is a choice when it has `value` (the radio fills in), or an action when it has `action`
  // (the icon its square carries): a phone login, a field to type, an unlink.
  function serviceRows(service, values, t2) {
    if (service === "qbittorrent") {
      const { address, user, password } = values.services;
      return [
        { key: "address", action: "globe", label: t2("add.field.address"), valueText: address || t2("add.notSet"), field: "address", initial: address },
        { key: "user", action: "controller", label: t2("add.field.user"), valueText: user || t2("add.notSet"), field: "user", initial: user },
        { key: "password", action: "controller", label: t2("add.field.password"), valueText: password ? "••••••••" : t2("add.notSet"), field: "password", initial: password }
      ];
    }
    const saved = values.services[service];
    const rows = [];
    if (PHONE.includes(service)) rows.push({ key: "phone", action: "link", label: t2("add.serviceLink"), phone: service });
    rows.push({ key: "key", action: "file", label: t2(`add.field.${service}`), valueText: saved ? mask(saved) : t2("add.notSet"), field: service, initial: saved });
    if (saved) rows.push({ key: "unlink", action: "x", label: t2("settings.unlink"), unlink: service });
    return rows;
  }

  /** The rows a setting's page lists, top to bottom. */
  function optionsOf(id, ctx, t2) {
    const values = ctx.values;
    if (id === "vibration") return LEVELS.map((level) => ({ key: `level:${level}`, label: levelText(t2, level), value: level }));
    if (id === "language") return [
      { key: "system", label: t2("language.system"), detail: localeName(ctx.system), value: "system" },
      ...LOCALES.map(({ code }) => ({ key: code, label: localeName(code), detail: t2(`language.name.${code}`), value: code }))
    ];
    if (id === "speed") return LIMITS.map((limit) => ({
      key: `limit:${limit}`, value: limit,
      label: limit ? `${limit} MB/s` : t2("settings.speedUnlimited"),
      detail: limit ? "" : t2("settings.speedUnlimitedDetail")
    }));
    if (id === "disk") return [
      { key: "auto", label: t2("settings.diskAuto"), detail: t2("settings.diskAutoDetail"), value: "auto" },
      ...ctx.drives.map((drive) => ({
        key: drive.root, value: drive.root, label: driveName(drive.root),
        detail: drive.total ? t2("files.free", { free: formatBytes(drive.free), total: formatBytes(drive.total) }) : ""
      }))
    ];
    if (id === "pkg") return MODES.map((mode) => ({
      key: `mode:${mode}`, value: mode, mark: mode,
      label: t2(`settings.pkgMode.${mode}`),
      detail: t2(MODE_DETAIL[mode]),
      tag: mode === "overdrive" ? t2("settings.faster") : ""
    }));
    if (id === "cleanup") return [
      { key: "on", label: t2("settings.on"), value: true },
      { key: "off", label: t2("settings.off"), detail: t2("settings.cleanupOffDetail"), value: false }
    ];
    if (id === "seeding") return [
      { key: "on", label: t2("settings.on"), value: true },
      { key: "off", label: t2("settings.off"), value: false }
    ];
    if (SERVICES.includes(id)) return serviceRows(id, values, t2);
    return [];
  }

  /** The row a page's focus starts on: the chosen one, or the first. */
  function selectedIndex(id, ctx, t2) {
    const rows = optionsOf(id, ctx, t2);
    const current = currentOf(id, ctx.values);
    const found = rows.findIndex((row) => row.value !== void 0 && row.value === current);
    return found < 0 ? 0 : found;
  }

  // "34 min" / "1 h 19 min": a 50 GB game at a speed, with the source at full speed.
  function downloadTime(limit, t2) {
    const minutes = Math.round(50e9 / (limit * 1048576) / 60);
    if (minutes < 60) return t2("settings.minutes", { n: minutes });
    return t2("settings.hoursMinutes", { h: Math.floor(minutes / 60), m: String(minutes % 60).padStart(2, "0") });
  }

  /**
   * The panel on the right of a page. Plain data: an eyebrow, a big line, rows (label, value, on),
   * drives (name, a bar, free of total), a sample of the app in another language, the vibration
   * preview, the marks of where a PKG goes, and the note underneath.
   */
  function sideOf(id, ctx, row, t2) {
    const values = ctx.values;
    const chosen = row && row.value !== void 0 ? row.value : currentOf(id, values);
    if (id === "vibration") return {
      eyebrow: t2("settings.vibrationSide"),
      preview: chosen,
      small: chosen ? t2("settings.vibrationSideOn", { level: chosen }) : t2("settings.vibrationSideOff")
    };
    if (id === "language") {
      const code = chosen === "system" ? ctx.system : chosen;
      return {
        eyebrow: t2("settings.languageSide"),
        sample: { title: ctx.titleIn(code), name: localeName(code) },
        rtl: isRTL(code),
        small: isRTL(code) ? t2("settings.languageSideRtl") : t2("settings.languageSideNote")
      };
    }
    if (id === "speed") return {
      eyebrow: t2("settings.speedSide"),
      rows: LIMITS.map((limit) => ({
        label: limit ? `${limit} MB/s` : t2("settings.speedUnlimited"),
        value: limit ? downloadTime(limit, t2) : t2("settings.speedSideBest"),
        on: limit === chosen
      })),
      small: t2("settings.speedSideNote")
    };
    if (id === "disk") return {
      eyebrow: t2("settings.diskSide"),
      drives: ctx.drives.map((drive) => ({ name: driveName(drive.root), free: drive.free, total: drive.total, on: drive.root === chosen })),
      small: chosen === "auto" ? t2("settings.diskSideAuto") : t2("settings.diskSideNote")
    };
    if (id === "pkg") return {
      eyebrow: t2("settings.pkgSide"),
      marks: chosen,
      markLabel: chosen === "console" ? t2("settings.pkgSideConsole") : chosen === "overdrive" ? t2("settings.pkgSideOverdrive") : "",
      big: t2(`settings.pkgMode.${chosen}`),
      small: t2(MODE_DETAIL[chosen])
    };
    if (id === "cleanup") return {
      eyebrow: t2("settings.cleanupSide"),
      big: t2(chosen ? "settings.on" : "settings.off"),
      small: t2(chosen ? "settings.cleanupSideOn" : "settings.cleanupSideOff")
    };
    if (id === "seeding") return {
      eyebrow: t2("settings.seeding"),
      big: t2(chosen ? "settings.on" : "settings.off"),
      small: t2("settings.seedingDetail")
    };
    if (id === "qbittorrent") {
      const { address, user } = values.services;
      return address
        ? { eyebrow: t2("add.qbittorrentName"), big: address, rows: user ? [{ label: t2("add.field.user"), value: user }] : [], small: t2("settings.qbitSideSet") }
        : { eyebrow: t2("add.qbittorrentName"), big: t2("add.notSet"), small: t2("add.fieldBody.address") };
    }
    if (SERVICES.includes(id)) {
      const key = values.services[id];
      if (key) return { eyebrow: t2("settings.account"), big: t2("add.phone.linked"), small: t2("settings.serviceSideLinked") };
      return {
        eyebrow: PHONE.includes(id) ? t2("add.phone.title") : t2("settings.account"),
        big: t2("add.serviceNeeds"),
        small: PHONE.includes(id) ? t2("settings.servicePhone") : t2(`add.fieldBody.${id}`)
      };
    }
    return {};
  }

export { GROUPS, ITEMS, currentOf, localeName, optionsOf, selectedIndex, sideOf, valueOf };
