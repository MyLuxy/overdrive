// ../pub-game-store/native/i18n/plural.js
// reconstructed from the esbuild bundle in eboot.bin
// MODIFIED: Italian, European Portuguese and Polish plural rules.


  function operands(n) {
    const abs = Math.abs(n);
    const text = String(abs);
    const dot = text.indexOf(".");
    return { n: abs, i: Math.floor(abs), v: dot < 0 ? 0 : text.length - dot - 1 };
  }
  var millions = ({ i, v }) => i !== 0 && i % 1e6 === 0 && v === 0;
  var RULES = {
    en: ({ i, v }) => i === 1 && v === 0 ? "one" : "other",
    de: ({ i, v }) => i === 1 && v === 0 ? "one" : "other",
    ur: ({ i, v }) => i === 1 && v === 0 ? "one" : "other",
    hi: ({ n, i }) => i === 0 || n === 1 ? "one" : "other",
    bn: ({ n, i }) => i === 0 || n === 1 ? "one" : "other",
    es: (o) => o.n === 1 ? "one" : millions(o) ? "many" : "other",
    it: (o) => o.i === 1 && o.v === 0 ? "one" : millions(o) ? "many" : "other",
    fr: (o) => o.i === 0 || o.i === 1 ? "one" : millions(o) ? "many" : "other",
    "pt-BR": (o) => o.i === 0 || o.i === 1 ? "one" : millions(o) ? "many" : "other",
    // Unlike Brazil's, Portugal's "one" is 1 alone: "0 jogos".
    "pt-PT": (o) => o.i === 1 && o.v === 0 ? "one" : millions(o) ? "many" : "other",
    ru: ({ i, v }) => {
      if (v !== 0) return "other";
      const mod10 = i % 10, mod100 = i % 100;
      if (mod10 === 1 && mod100 !== 11) return "one";
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "few";
      return "many";
    },
    // Polish counts like Russian, with "one" for 1 alone: "1 gra", "2 gry", "5 gier", "0 gier".
    pl: ({ i, v }) => {
      if (v !== 0) return "other";
      if (i === 1) return "one";
      const mod10 = i % 10, mod100 = i % 100;
      return mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? "few" : "many";
    },
    ar: ({ n }) => {
      const mod100 = n % 100;
      if (n === 0) return "zero";
      if (n === 1) return "one";
      if (n === 2) return "two";
      if (Number.isInteger(n) && mod100 >= 3 && mod100 <= 10) return "few";
      if (Number.isInteger(n) && mod100 >= 11 && mod100 <= 99) return "many";
      return "other";
    },
    "zh-Hans": () => "other",
    "zh-Hant": () => "other",
    ja: () => "other",
    id: () => "other"
  };
  var pluralCategory = (locale2, n) => (RULES[locale2] ?? RULES.en)(operands(n));

export { pluralCategory };
