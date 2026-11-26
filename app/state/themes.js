import { FileSystem } from '@ps5-react/core';
import { isRecord, readJSON } from './read-json.js';
import { colors } from '../ui/colors.js';
import { useState } from 'react';

export var BASE_COLORS = {
  canvas: "#000000",
  surface: "#17171a",
  surface2: "#212125",
  surface3: "#2b2b30",
  line: "#2a2a2f",
  fg: "#f2f2f3",
  muted: "#a3a3ab",
  subtle: "#8a8a94",
  accentFg: "#0d0d0f",
  ok: "#a7f3d0",
  warn: "#fde68a",
  info: "#a5f3fc"
};

export var THEMES_DIR = `${FileSystem.dataDir}/overdrive/themes`;
var CHOICE_FILE = `${FileSystem.dataDir}/overdrive/theme.json`;
var HEX = /^#[0-9a-f]{8}$|^#[0-9a-f]{6}$|^#[0-9a-f]{4}$|^#[0-9a-f]{3}$/i;
var BACKDROP_FILE = /\.(png|jpe?g|webp|gif)$/i;
var NAME_BAD = /[\\/:*?"<>|\u0000-\u001f]/g;
var USER_TTL_MS = 2000;
var userThemes = [];
var userAt = 0;
var chosen = null;
var listeners = new Set();

// --- Theme Engine 2.0 (docs/theme-engine-2.md) -------------------------------------------------
// The v2 layer is opt-in data: an extended palette (accent, focus, overlay), layout overrides,
// interface sounds and a lightbar setting. A v1 theme without the new fields behaves exactly as
// it did before — every v2 value falls back to the defaults here, and screens consume them
// through the accessors below as they are wired up (wiring checklist in the doc).

export var EXTRA_COLOR_DEFAULTS = {
  // What fg doubles as today (docs/themes.md, "Glass, and what each color does"); separate keys
  // let a theme give buttons, the focus ring and overlays their own color without touching text.
  accent: "#f2f2f3",
  focus: "#f2f2f3",
  overlay: "#000000"
};

export var DEFAULT_OVERRIDES = {
  cardRadius: 18,
  buttonRadius: 14,
  chipRadius: 999,
  glowSize: 0,
  glowColor: ""
};

export var DEFAULT_LIGHTBAR = { mode: "cover", color: "" };

var SOUND_KEYS = ["focus", "confirm", "back", "error", "notify", "page"];
var SOUND_FILE = /\.wav$/i;
var LIGHTBAR_MODES = ["cover", "fixed", "off"];

var EMPTY_V2 = { colors: {}, overrides: { ...DEFAULT_OVERRIDES }, sounds: {}, lightbar: { ...DEFAULT_LIGHTBAR } };

export var DEFAULT_THEME = {
  id: "builtin:default",
  nameKey: "themes.preset.default",
  builtin: true,
  colors: { ...BASE_COLORS },
  background: "",
  backgroundDim: 0.5,
  v2: EMPTY_V2
};

function expandHex(value) {
  const digits = value.slice(1);
  if (digits.length === 6 || digits.length === 8) return `#${digits.toLowerCase()}`;
  return `#${[...digits].map((digit) => digit + digit).join("").toLowerCase()}`;
}

export function normalizeTheme(record) {
  const input = isRecord(record) && isRecord(record.colors) ? record.colors : {};
  const palette = {};
  for (const key of Object.keys(BASE_COLORS)) {
    const value = input[key];
    palette[key] = typeof value === "string" && HEX.test(value) ? expandHex(value) : BASE_COLORS[key];
  }
  return palette;
}

export function safeName(name, fallback) {
  const clean = typeof name === "string" ? name.replace(NAME_BAD, "").trim().slice(0, 64) : "";
  return clean || fallback;
}

export function safeBackdrop(value, baseDir = "") {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (/^https?:\/\//i.test(text) && text.length <= 2048) return text;
  if (BACKDROP_FILE.test(text) && !text.includes("/") && !text.includes("\\") && text.length <= 128) {
    return baseDir ? `${baseDir}/${text}` : text;
  }
  return "";
}

// --- Theme Engine 2.0 validators ----------------------------------------------------------------

export function normalizeExtraColors(input) {
  const out = {};
  if (!isRecord(input)) return out;
  for (const key of Object.keys(EXTRA_COLOR_DEFAULTS)) {
    const value = input[key];
    if (typeof value === "string" && HEX.test(value)) out[key] = expandHex(value);
  }
  return out;
}

function clampInt(value, min, max, fallback) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function oneHex(value) {
  return typeof value === "string" && HEX.test(value) ? expandHex(value) : "";
}

export function normalizeOverrides(input) {
  const overrides = { ...DEFAULT_OVERRIDES };
  if (!isRecord(input)) return overrides;
  overrides.cardRadius = clampInt(input.cardRadius, 0, 48, overrides.cardRadius);
  overrides.buttonRadius = clampInt(input.buttonRadius, 0, 48, overrides.buttonRadius);
  overrides.chipRadius = clampInt(input.chipRadius, 0, 999, overrides.chipRadius);
  overrides.glowSize = clampInt(input.glowSize, 0, 40, overrides.glowSize);
  overrides.glowColor = oneHex(input.glowColor);
  return overrides;
}

function safeSound(value, baseDir) {
  if (typeof value !== "string") return "";
  const text = value.trim();
  if (/^https?:\/\//i.test(text) && text.length <= 2048) return text;
  if (SOUND_FILE.test(text) && !text.includes("/") && !text.includes("\\") && text.length <= 128) {
    return baseDir ? `${baseDir}/${text}` : text;
  }
  return "";
}

export function normalizeSounds(input, baseDir = "") {
  const sounds = {};
  if (!isRecord(input)) return sounds;
  for (const key of SOUND_KEYS) {
    const src = safeSound(input[key], baseDir);
    if (src) sounds[key] = src;
  }
  return sounds;
}

export function normalizeLightbar(input) {
  if (!isRecord(input)) return { ...DEFAULT_LIGHTBAR };
  const mode = LIGHTBAR_MODES.includes(input.mode) ? input.mode : "cover";
  return { mode, color: oneHex(input.color) };
}

function normalizeV2(record, baseDir) {
  const has = isRecord(record);
  return {
    colors: normalizeExtraColors(has ? record.colors : null),
    overrides: normalizeOverrides(has ? record.overrides : null),
    sounds: normalizeSounds(has ? record.sounds : null, baseDir),
    lightbar: normalizeLightbar(has ? record.lightbar : null)
  };
}

export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function normalizeDim(value) {
  if (value === null || value === undefined || value === "") return DEFAULT_THEME.backgroundDim;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return DEFAULT_THEME.backgroundDim;
  return Math.min(1, Math.max(0, Math.round(number * 100) / 100));
}

export function themeDisplayName(theme, t) {
  return theme.builtin ? t(theme.nameKey) : theme.name;
}

export function themeBackdrop(theme) {
  return theme.background || "";
}

export function listThemes() {
  const now = Date.now();
  if (now - userAt > USER_TTL_MS) {
    userThemes = readUserThemes();
    userAt = now;
  }
  return [DEFAULT_THEME, ...userThemes];
}

function readUserThemes() {
  let names;
  try {
    names = FileSystem.readDir(THEMES_DIR)
      .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(".json"))
      .map((entry) => entry.name.slice(0, -5));
  } catch {
    return [];
  }
  const valid = (value) => isRecord(value) && isRecord(value.colors);
  const themes = [];
  for (const name of names) {
    const record = readJSON(FileSystem, `${THEMES_DIR}/${name}.json`, null, valid, (message) => console.log(`[themes] ${message}`));
    if (!record) continue;
    const v2 = normalizeV2(record, THEMES_DIR);
    themes.push({
      id: `user:${name}`,
      name: safeName(record.name, name),
      builtin: false,
      colors: { ...normalizeTheme(record), ...v2.colors },
      background: safeBackdrop(record.background, THEMES_DIR),
      backgroundDim: record.backgroundDim === undefined ? (record.background === undefined || record.background === "" ? DEFAULT_THEME.backgroundDim : 0.28) : normalizeDim(record.backgroundDim),
      v2
    });
  }
  return themes;
}

export function findTheme(id) {
  return listThemes().find((theme) => theme.id === id) ?? DEFAULT_THEME;
}

function readChoice() {
  return readJSON(FileSystem, CHOICE_FILE, null, isRecord, (message) => console.log(`[themes] ${message}`));
}

export function activeThemeId() {
  return chosen?.id ?? DEFAULT_THEME.id;
}

export function activeTheme() {
  return chosen ?? DEFAULT_THEME;
}

// Theme Engine 2.0 accessors. The defaults come back when no v2 values are set, so callers never
// need their own fallbacks.
export function themeExtraColors() {
  return { ...EXTRA_COLOR_DEFAULTS, ...(chosen ? chosen.v2.colors : {}) };
}

export function themeOverrides() {
  return { ...(chosen ? chosen.v2.overrides : EMPTY_V2.overrides) };
}

export function themeSounds() {
  return { ...(chosen ? chosen.v2.sounds : {}) };
}

export function themeLightBar() {
  return { ...(chosen ? chosen.v2.lightbar : EMPTY_V2.lightbar) };
}

function applyTheme(theme) {
  chosen = theme;
  // Rebuild the shared palette from scratch, so switching back to the default theme also drops
  // the v2 extras a user theme had added to it.
  for (const key of Object.keys(colors)) delete colors[key];
  Object.assign(colors, theme.colors, theme.v2.colors);
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

export function selectTheme(id) {
  const theme = findTheme(id);
  applyTheme(theme);
  try {
    FileSystem.mkdir(`${FileSystem.dataDir}/overdrive`, { recursive: true });
    FileSystem.writeFile(`${CHOICE_FILE}.tmp`, JSON.stringify({ id: theme.id }), { sync: true });
    FileSystem.rename(`${CHOICE_FILE}.tmp`, CHOICE_FILE);
  } catch (error) {
    console.log(`[themes] choice not saved: ${error.message}`);
  }
  return theme;
}

export function useThemeSetting() {
  const [id, setId] = useState(activeThemeId);
  const pick = (next) => setId(selectTheme(next).id);
  return [id, pick];
}

try {
  applyTheme(findTheme(readChoice()?.id));
} catch (error) {
  console.log(`[themes] not applied at boot: ${error.message}`);
}
