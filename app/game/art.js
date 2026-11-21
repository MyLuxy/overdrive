// ../pub-game-store/native/game/art.js
// reconstructed from the esbuild bundle in eboot.bin

import { logoStyle } from '../ui/GameLogo.jsx';
import { px } from '../ui/scale.js';
import { Image } from '@ps5-react/core';

  var HERO = { width: 1920, height: 900 };
  var COVER = { width: px(192), height: px(256), borderRadius: px(8) };
  var SHOT = { width: 1308, height: 735 };
  var THUMB = { width: 192, height: 108 };
  var VIEW = { width: 1920, height: 1080 };
  var LOGO = { width: 384, height: 120 };
  var ignore = () => {
  };
  function prefetchGameArt(game) {
    const { art: art2 } = game;
    if (art2.hero) Image.prefetch(art2.hero, HERO).catch(ignore);
    if (art2.cover) Image.prefetch(art2.cover, COVER).catch(ignore);
    if (art2.logo) Image.prefetch(art2.logo, { ...logoStyle(game, LOGO.width, LOGO.height), resizeMode: "contain" }).catch(ignore);
    for (const shot of game.shots.slice(0, 1)) Image.prefetch(shot.url, SHOT).catch(ignore);
    for (const shot of game.shots) Image.prefetch(shot.thumb, THUMB).catch(ignore);
  }
  var settle = null;
  function prefetchWhenSettled(game) {
    clearTimeout(settle);
    settle = setTimeout(() => prefetchGameArt(game), 300);
  }

export { COVER, HERO, LOGO, SHOT, THUMB, VIEW, prefetchWhenSettled };
