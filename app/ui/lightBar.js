// ../pub-game-store/native/ui/lightBar.js
// reconstructed from the esbuild bundle in eboot.bin

import { Controller, Image } from '@ps5-react/core';

  var NEUTRAL = "#ffffff";
  var colors2 = /* @__PURE__ */ new Map();
  var owner = null;
  var resetting = null;
  var RESET_DELAY_MS = 250;
  var LIGHT_DELAY_MS = 150;
  var lighting = null;
  var colorOf = (uri) => {
    if (!colors2.has(uri)) colors2.set(uri, Image.getColor(uri).catch(() => null));
    return colors2.get(uri);
  };
  function lightGame(key, game) {
    owner = key;
    clearTimeout(resetting);
    clearTimeout(lighting);
    if (!game.art.cover) {
      Controller.setLightBar(NEUTRAL);
      return;
    }
    lighting = setTimeout(() => void colorOf(game.art.cover).then((color) => {
      if (owner !== key) return;
      Controller.setLightBar(color ?? NEUTRAL);
    }), LIGHT_DELAY_MS);
  }
  function unlight(key) {
    if (owner !== key) return;
    owner = null;
    clearTimeout(resetting);
    resetting = setTimeout(() => {
      if (owner === null) Controller.resetLightBar();
    }, RESET_DELAY_MS);
  }

export { lightGame, unlight };
