import { FileSystem } from '@ps5-react/core';
import { readJSON } from './read-json.js';
import { trailers as bundled } from '../data/trailers.js';

export var TRAILERS_DIR = `${FileSystem.dataDir}/overdrive/trailers`;
var MAX_TRAILERS = 8;
var URL_TEST = /^https?:\/\//i;

export function normalizeTrailer(entry) {
  if (typeof entry === "string") entry = { url: entry };
  if (!entry || typeof entry !== "object") return null;
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!URL_TEST.test(url) || url.length > 2048) return null;
  const title = typeof entry.title === "string" ? entry.title.trim().slice(0, 80) : "";
  return title ? { url, title } : { url };
}

export function trailersFor(gameId) {
  if (typeof gameId !== "string" || !gameId) return [];
  const found = [];
  const seen = new Set();
  for (const entry of [...(Array.isArray(bundled[gameId]) ? bundled[gameId] : []), ...readUserTrailers(gameId)]) {
    const trailer = normalizeTrailer(entry);
    if (trailer && !seen.has(trailer.url)) {
      seen.add(trailer.url);
      found.push(trailer);
    }
  }
  return found.slice(0, MAX_TRAILERS);
}

function readUserTrailers(gameId) {
  const valid = (value) => Array.isArray(value) || (typeof value === "object" && value !== null && Array.isArray(value.trailers));
  try {
    const record = readJSON(FileSystem, `${TRAILERS_DIR}/${gameId}.json`, null, valid, (message) => console.log(`[trailers] ${message}`));
    if (Array.isArray(record)) return record;
    if (record) return record.trailers;
  } catch (error) {
    console.log(`[trailers] ${gameId} not read: ${error.message}`);
  }
  return [];
}
