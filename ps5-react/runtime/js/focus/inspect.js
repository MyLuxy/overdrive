// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Development hooks the desktop host's control channel calls (tools/ps5_drive.py): the focusable
// elements as text, and focus by key. Nodes do not know their rendered text, so it is read from the
// React elements they were given, labels and titles included.
import {screenRect} from './frames.js';

export function textOf(value, depth = 0) {
  if (value == null || typeof value === 'boolean' || depth > 12) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(item => textOf(item, depth + 1)).filter(Boolean).join(' ');
  if (typeof value === 'object' && value.props) {
    const {label, title, children} = value.props;
    return [typeof label === 'string' ? label : '', typeof title === 'string' ? title : '', textOf(children, depth + 1)]
      .filter(Boolean).join(' ');
  }
  return '';
}

function inert(scope) {
  for (; scope; scope = scope.parent) if (scope.props.inert) return true;
  return false;
}

/** @param {import('./manager.js').FocusManager} manager */
export function installInspector(manager) {
  globalThis.__ps5ReactInspect = () => JSON.stringify([...manager.nodes].map(node => {
    const rect = screenRect(node);
    const round = value => Math.round(value ?? 0);
    return {
      focusKey: node.props.focusKey ?? null,
      text: (node.texts?.size ? [...node.texts.values()].join(' ') : textOf(node.props)).replace(/\s+/g, ' ').trim().slice(0, 160),
      x: round(rect?.x), y: round(rect?.y), width: round(rect?.width), height: round(rect?.height),
      focused: manager.focused === node,
      // In a hidden layer (browse under another screen): laid out and on screen, but unreachable.
      inert: inert(node.scope),
      // On screen: inside the 1920×1080 render, not merely laid out somewhere in a scrolled page.
      visible: Boolean(rect && (rect.width > 0 || rect.height > 0) && rect.x < screen.width && rect.y < screen.height
        && rect.x + rect.width > 0 && rect.y + rect.height > 0),
    };
  }));
  globalThis.__ps5ReactFocus = key => manager.focus(key);
  // A pointer at (nx, ny), fractions of the screen: focuses the smallest navigable element under it,
  // as a mouse click on the desktop preview would. Returns whether one took focus. Only the desktop
  // host has a pointer (it sets the flag before the bundle loads); the PS5 gets no hook.
  if (!globalThis.__ps5ReactPointer) return;
  globalThis.__ps5ReactHit = (nx, ny) => {
    const x = nx * screen.width, y = ny * screen.height;
    let best = null, bestArea = Infinity;
    for (const node of manager.nodes) {
      const rect = screenRect(node);
      if (!rect || inert(node.scope) || x < rect.x || y < rect.y || x >= rect.x + rect.width || y >= rect.y + rect.height) continue;
      const area = rect.width * rect.height;
      if (area < bestArea) { best = node; bestArea = area; }
    }
    return best ? manager.focus(best) : false;
  };
}
