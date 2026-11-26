import { ratings as bundled } from '../data/ratings.js';

export function ratingFor(gameId) {
  if (typeof gameId !== "string" || !gameId) return null;
  const record = bundled && typeof bundled === "object" ? bundled[gameId] : null;
  if (!record || typeof record !== "object") return null;
  const average = record.average;
  const count = record.count;
  if (typeof average !== "number" || !(average >= 0) || average > 5) return null;
  if (typeof count !== "number" || !(count >= 1) || count > 100000000) return null;
  return { average: Math.round(average * 100) / 100, count: Math.floor(count) };
}
