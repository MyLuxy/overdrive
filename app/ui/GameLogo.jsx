// ../pub-game-store/native/ui/GameLogo.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useLayoutEffect, useState } from 'react';
import { Skeleton } from './Skeleton.jsx';
import { colors } from './colors.js';
import { px } from './scale.js';
import { Image, Text } from '@ps5-react/core';

  function logoBox({ logoAspect }, width, height, area) {
    if (!logoAspect) return { width, height };
    let h = Math.min(height, Math.sqrt(area / logoAspect));
    let w = h * logoAspect;
    if (w > width) {
      w = width;
      h = w / logoAspect;
    }
    return { width: w, height: h };
  }
  function logoStyle(game, width, height, area = width * height * 0.6) {
    const box = logoBox(game.art, width, height, area);
    return { width: px(box.width), height: px(box.height) };
  }
  function Title({ game, width }) {
    return /* @__PURE__ */ (0, jsx)(
      Text,
      {
        style: [{ fontFamily: "Inter-Regular", fontSize: 54, fontWeight: 600, color: "#f2f2f3", numberOfLines: 2, ellipsizeMode: "tail", lineHeight: 60, letterSpacing: -1.35 }, { width: px(width) }],
        children: game.title
      }
    );
  }
  function GameLogo({ game, width, height, area = width * height * 0.6, onReady }) {
    const { logo } = game.art;
    const [loaded, setLoaded] = (0, useState)(null);
    const [failed, setFailed] = (0, useState)(null);
    (0, useLayoutEffect)(() => {
      if (!logo) onReady?.();
    }, [logo]);
    if (!logo || failed === logo) return /* @__PURE__ */ (0, jsx)(Title, { game, width });
    const box = logoStyle(game, width, height, area);
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      loaded !== logo && /* @__PURE__ */ (0, jsx)(Skeleton, { pulse: true, style: box }),
      /* @__PURE__ */ (0, jsx)(
        Image,
        {
          source: { uri: logo },
          resizeMode: "contain",
          tintColor: game.art.logoDark ? colors.fg : void 0,
          style: loaded === logo ? box : { ...box, display: "none" },
          onLoad: () => {
            setLoaded(logo);
            onReady?.();
          },
          onError: () => {
            setFailed(logo);
            onReady?.();
          }
        }
      )
    ] });
  }

export { GameLogo, logoStyle };
