// ../pub-game-store/native/i18n/core.js
// reconstructed from the esbuild bundle in eboot.bin

import { fitBytes } from './fit.js';
import { formatDate, formatNumber, formatPercent } from './format.js';
import { compile, format } from './icu.js';
import { SOURCE_LOCALE } from './locales.js';

  var load = () => ({});
  var bundled = null;
  var english = null;
  var active = null;
  var locale = SOURCE_LOCALE;
  var compiled = /* @__PURE__ */ new Map();
  var listeners2 = /* @__PURE__ */ new Set();
  function configure(read, source2 = null) {
    load = read;
    bundled = source2;
    english = null;
    active = null;
    compiled = /* @__PURE__ */ new Map();
  }
  function messages(code) {
    try {
      return load(code);
    } catch (error2) {
      console.log(`i18n: ${code} not loaded: ${error2.message}`);
      return {};
    }
  }
  var source = () => english ?? (english = bundled ?? messages(SOURCE_LOCALE));
  function entry(key) {
    if (compiled.has(key)) return compiled.get(key);
    active ?? (active = locale === SOURCE_LOCALE ? source() : messages(locale));
    let found = null;
    for (const [code, catalog] of [[locale, active], [SOURCE_LOCALE, source()]]) {
      const text = catalog[key];
      if (typeof text !== "string") continue;
      try {
        found = { code, parts: compile(text) };
        break;
      } catch (error2) {
        console.log(`i18n: ${code} ${key}: ${error2.message}`);
      }
    }
    compiled.set(key, found);
    return found;
  }
  function t(key, params) {
    const found = entry(key);
    return found ? fitBytes(format(found.parts, params, found.code)) : key;
  }
  var getLocale = () => locale;
  function setLocale(code) {
    if (code === locale) return;
    locale = code;
    active = null;
    compiled = /* @__PURE__ */ new Map();
    for (const listener of listeners2) listener(code);
  }
  function subscribe(listener) {
    listeners2.add(listener);
    return () => {
      listeners2.delete(listener);
    };
  }
  var formatNumber2 = (n, options) => formatNumber(locale, n, options);
  var formatPercent2 = (percent) => formatPercent(locale, percent);
  var formatDate2 = (iso) => formatDate(locale, iso);

export { configure, formatDate2, formatNumber2, formatPercent2, getLocale, setLocale, subscribe, t };
