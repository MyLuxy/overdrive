// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.

/**
 * @template E
 * @typedef {{key: string, element: E, present: boolean, entering: boolean}} PresenceEntry
 *   `entering` is false for children rendered on the first pass (AnimatePresence initial={false}).
 */

/**
 * Next rendered list: current children in order, with removed ones kept at their previous position
 * while they exit. In 'wait' mode, children that are new are held back until no child is exiting.
 * @template E
 * @param {PresenceEntry<E>[]} previous
 * @param {Array<{key: string, element: E}>} children
 * @param {'sync' | 'wait'} mode
 * @param {boolean} entering
 * @returns {PresenceEntry<E>[]}
 */
export function nextPresence(previous, children, mode, entering) {
  const known = new Map(previous.map(entry => [entry.key, entry]));
  const current = new Set(children.map(child => child.key));
  const out = children.map(({key, element}) => ({
    key, element, present: true, entering: known.get(key)?.entering ?? entering,
  }));
  previous.forEach((entry, index) => {
    if (current.has(entry.key)) return;
    const before = previous[index - 1];
    const at = before ? out.findIndex(other => other.key === before.key) + 1 : 0;
    out.splice(at, 0, {...entry, present: false});
  });
  if (mode !== 'wait' || out.every(entry => entry.present)) return out;
  return out.filter(entry => known.has(entry.key));
}
