// Resolve game IDs from non-card focus targets for Square actions and button hints.
import { useEffect, useState } from 'react';
const targets = new Map();
const listeners = new Set();
function setFavoriteTarget(key, id) {
  if (!key) return;
  const next = id ?? null;
  if (targets.get(key) === next) return;
  if (next === null) targets.delete(key);
  else targets.set(key, next);
  for (const listener of listeners) listener();
}
function favoriteTarget(key) {
  if (!key) return null;
  if (targets.has(key)) return targets.get(key);
  return key.startsWith('card:') ? key.slice(5) : null;
}
function useFavoriteTarget(key) {
  const [, refresh] = useState(0);
  useEffect(() => {
    const listener = () => refresh((count) => count + 1);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);
  return favoriteTarget(key);
}

export { setFavoriteTarget, favoriteTarget, useFavoriteTarget };
