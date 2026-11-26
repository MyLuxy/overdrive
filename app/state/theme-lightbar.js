// Theme Engine 2.0, stage 3 (docs/theme-engine-2.md): the lightbar side of a theme.
//
// The generated lightBar module (../pub-game-store/native/ui/lightBar.js) colors the controller
// from the focused game's cover; a theme can now override that per theme:
//   cover — the current behavior, the cover's average color
//   fixed — the theme's color, always
//   off   — the lightbar stays neutral/reset
//
// Wiring point: call useThemeLightBar() once inside App (app/index.jsx) so a theme switch applies
// immediately, and lightBar.js can consult lightBarColorForCover() before it sets a cover color.

import { useEffect } from 'react';
import { Controller } from '@ps5-react/core';
import { onThemeChange, themeLightBar } from './themes.js';

function applyLightBar() {
  const setting = themeLightBar();
  try {
    if (setting.mode === "fixed" && setting.color) Controller.setLightBar(setting.color);
    else if (setting.mode === "off") Controller.resetLightBar();
  } catch (error) {
    console.log(`[themes] lightbar: ${error.message}`);
  }
}

export function useThemeLightBar() {
  useEffect(() => {
    applyLightBar();
    return onThemeChange(applyLightBar);
  }, []);
}

/** What lightBar.js should use for a focused cover: the theme's choice, or the cover color. */
export function lightBarColorForCover(coverColor) {
  const setting = themeLightBar();
  if (setting.mode === "fixed") return setting.color || coverColor;
  if (setting.mode === "off") return null;
  return coverColor;
}
