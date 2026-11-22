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

var PRESET_COLORS = {
  default: BASE_COLORS,
  midnight: {
    canvas: "#04060f",
    surface: "#0b1122",
    surface2: "#141b33",
    surface3: "#1e2748",
    line: "#1a2240",
    fg: "#e7ecff",
    muted: "#9aa7d8",
    subtle: "#7481b3",
    accentFg: "#04060f",
    ok: "#a7f3d0",
    warn: "#fde68a",
    info: "#a5f3fc"
  },
  ember: {
    canvas: "#0c0405",
    surface: "#1d0a0d",
    surface2: "#2b1218",
    surface3: "#3c1c24",
    line: "#341620",
    fg: "#ffeef2",
    muted: "#d8a4b3",
    subtle: "#a87385",
    accentFg: "#0c0405",
    ok: "#a7f3d0",
    warn: "#fde68a",
    info: "#fcd9e2"
  },
  forest: {
    canvas: "#030805",
    surface: "#0a1710",
    surface2: "#122418",
    surface3: "#1b3524",
    line: "#162c1e",
    fg: "#eafff3",
    muted: "#a0d0b4",
    subtle: "#71a184",
    accentFg: "#030805",
    ok: "#d5f7e0",
    warn: "#fde68a",
    info: "#a5f3fc"
  },
  sakura: {
    canvas: "#0b040c",
    surface: "#190d1d",
    surface2: "#26142c",
    surface3: "#371e40",
    line: "#301938",
    fg: "#fdf0fa",
    muted: "#d3a8d9",
    subtle: "#a675b0",
    accentFg: "#0b040c",
    ok: "#a7f3d0",
    warn: "#fde68a",
    info: "#e6c8f5"
  },
  graphite: {
    canvas: "#050506",
    surface: "#131315",
    surface2: "#1e1e21",
    surface3: "#2b2b30",
    line: "#242428",
    fg: "#f4f4f5",
    muted: "#b3b3b8",
    subtle: "#82828a",
    accentFg: "#050506",
    ok: "#dcdce0",
    warn: "#dcdce0",
    info: "#dcdce0"
  }
};

export var PRESETS = Object.entries(PRESET_COLORS).map(([id, palette]) => ({
  id: `builtin:${id}`,
  nameKey: `themes.preset.${id}`,
  builtin: true,
  colors: { ...palette }
}));

var THEMES_DIR = `${FileSystem.dataDir}/overdrive/themes`;
var CHOICE_FILE = `${FileSystem.dataDir}/overdrive/theme.json`;
var HEX = /^#[0-9a-f]{8}$|^#[0-9a-f]{6}$|^#[0-9a-f]{4}$|^#[0-9a-f]{3}$/i;
var NAME_BAD = /[\\/:*?"<>|\u0000-\u001f]/g;
var USER_TTL_MS = 2000;
var userThemes = [];
var userAt = 0;
var chosen = null;

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

export function themeDisplayName(theme, t) {
  return theme.builtin ? t(theme.nameKey) : theme.name;
}

export function listThemes() {
  const now = Date.now();
  if (now - userAt > USER_TTL_MS) {
    userThemes = readUserThemes();
    userAt = now;
  }
  return [...PRESETS, ...userThemes];
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
    themes.push({
      id: `user:${name}`,
      name: safeName(record.name, name),
      builtin: false,
      colors: normalizeTheme(record)
    });
  }
  return themes;
}

export function findTheme(id) {
  return listThemes().find((theme) => theme.id === id) ?? PRESETS[0];
}

function readChoice() {
  return readJSON(FileSystem, CHOICE_FILE, null, isRecord, (message) => console.log(`[themes] ${message}`));
}

export function activeThemeId() {
  return chosen?.id ?? "builtin:default";
}

export function activeTheme() {
  return chosen ?? PRESETS[0];
}

function applyTheme(theme) {
  chosen = theme;
  Object.assign(colors, theme.colors);
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
