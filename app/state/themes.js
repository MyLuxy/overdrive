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

export var DEFAULT_THEME = {
  id: "builtin:default",
  nameKey: "themes.preset.default",
  builtin: true,
  colors: { ...BASE_COLORS },
  background: "",
  backgroundDim: 0.5
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
    themes.push({
      id: `user:${name}`,
      name: safeName(record.name, name),
      builtin: false,
      colors: normalizeTheme(record),
      background: safeBackdrop(record.background, THEMES_DIR),
      backgroundDim: record.background === undefined ? 0.28 : normalizeDim(record.backgroundDim)
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
