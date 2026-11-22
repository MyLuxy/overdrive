import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { Image, View } from '@ps5-react/core';
import { activeTheme } from '../state/themes.js';
import { colors } from './colors.js';

function ThemeBackdrop() {
  const theme = activeTheme();
  if (!theme.background) return null;
  return /* @__PURE__ */ (0, jsxs)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }, children: [
    /* @__PURE__ */ (0, jsx)(Image, { source: { uri: theme.background }, resizeMode: "cover", style: { width: "100%", height: "100%" } }),
    /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.canvas, opacity: theme.backgroundDim } })
  ] });
}

export { ThemeBackdrop };
