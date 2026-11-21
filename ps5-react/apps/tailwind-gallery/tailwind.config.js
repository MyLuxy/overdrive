// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// theme.fontSize replaces the default scale, so the app bakes six Inter sizes in total.
export default {theme: {
  fontSize: {xs: ['14px', '20px'], sm: '16px', base: '20px', lg: '24px', xl: '32px', '2xl': ['48px', 1]},
  extend: {
    colors: {ink: '#0b1118', panel: {DEFAULT: '#16212b', focus: '#22384a'}, accent: '#7dd3fc'},
    fontFamily: {inter: './assets/Inter-Regular.ttf'},
    spacing: {18: '72px'},
  },
}};
