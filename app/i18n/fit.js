// ../pub-game-store/native/i18n/fit.js
// reconstructed from the esbuild bundle in eboot.bin


  var TEXT_MAX = 255;
  var SPAN_MAX = 63;
  var ELLIPSIS = "\u2026";
  var ELLIPSIS_BYTES = 3;
  var utf8Length = (codePoint) => codePoint < 128 ? 1 : codePoint < 2048 ? 2 : codePoint < 65536 ? 3 : 4;
  function fitBytes(text, max = TEXT_MAX) {
    if (text.length * 3 <= max) return text;
    let bytes = 0;
    let at = 0;
    let cut = 0;
    for (const char of text) {
      bytes += utf8Length(char.codePointAt(0));
      if (bytes > max) return `${text.slice(0, cut).trimEnd()}${ELLIPSIS}`;
      at += char.length;
      if (bytes <= max - ELLIPSIS_BYTES) cut = at;
    }
    return text;
  }

export { SPAN_MAX, fitBytes };
