// Baked fonts cover printable ASCII by default, and every codepoint outside it
// draws as `?`. The store separates genres and sources with U+00B7 and writes
// em dashes, curly quotes and ellipses, and the shipped locales add accented
// Latin and Cyrillic, so both faces bake the whole European set.
//
// The ellipsis is asked for by name as well: the text engine ends every
// truncated line with U+2026 (text_shaper.cpp), and the truncated release notes
// in the update dialog drew that as `?` until it was baked here (2026-10-26).
export default {
  fonts: {
    'Inter-Regular': { glyphs: 'european', extraGlyphs: '…' },
    'JetBrainsMono-Regular': { glyphs: 'european', extraGlyphs: '…' },
  },
};
