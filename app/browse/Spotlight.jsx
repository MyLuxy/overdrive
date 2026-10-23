// ../pub-game-store/native/browse/Spotlight.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { memo, useEffect, useRef, useState } from 'react';
import { FIRST_POPULAR } from './PopularRail.jsx';
import { FAMOUS, picked, shuffle } from './picks.js';
import { SpotlightList } from './SpotlightList.jsx';
import { useSlides } from './useSlides.js';
import { games } from '../data/catalog.js';
import { LATIN_IN_RTL, focusEnd, useLocale, useT } from '../i18n/index.js';
import { genreLabel, summaryOf } from '../state/catalog.js';
import { useNavActions, useNavState } from '../state/nav.jsx';
import { useStoreActions, useWishlist } from '../state/store.jsx';
import { Button2 } from '../ui/Button.jsx';
import { GameLogo, logoStyle } from '../ui/GameLogo.jsx';
import { WishHeart } from '../ui/WishHeart.jsx';
import { setFavoriteTarget } from '../ui/favoriteFocus.js';
import { HINT, useHints } from '../ui/Legend.jsx';
import { EASE_OUT } from '../ui/ease.js';
import { AnimatePresence, Image, Text, View, motion, useFocus } from '@ps5-react/core';

  // Five slides, new on every launch: four of the hand-picked famous games (picks.js), and one
  // surprise from the rest of the catalog's well-dressed games. A slide needs only its hero art: a
  // game with no logo shows its title in its place (GameLogo).
  function selectFeatured() {
    const famous = picked(games, FAMOUS).filter((game) => game.art.hero);
    const chosen = new Set(famous);
    const surprise = shuffle(games.filter((game) => game.art.hero && game.genres.length && !chosen.has(game) && (game.art.logo || game.recommendations > 0 || game.metacritic)));
    const slides = [...famous.slice(0, 4), ...surprise.slice(0, 5 - Math.min(4, famous.length))];
    return shuffle(slides.length ? slides : games.filter((game) => game.art.hero).slice(0, 5));
  }
  var featured = selectFeatured();
  const HERO_SCALE = 1.02;
  var ART = { width: 1410 * HERO_SCALE, height: 660 * HERO_SCALE };
  var LOGO2 = [320, 112, 48 * 256];
  function prefetchSlides() {
    for (const game of featured) {
      if (game.art.hero) Image.prefetch(game.art.hero, ART).catch(() => {
      });
      if (game.art.logo) Image.prefetch(game.art.logo, { ...logoStyle(game, ...LOGO2), resizeMode: "contain" }).catch(() => {
      });
    }
  }
  function Art({ game }) {
    const [shown, setShown] = (0, useState)(game);
    (0, useEffect)(() => {
      if (shown === game) return void 0;
      const id = setTimeout(() => setShown(game), 20);
      return () => clearTimeout(id);
    }, [game, shown]);
    if (!shown.art.hero) return null;
    return /* @__PURE__ */ (0, jsx)(
      Image,
      {
        source: { uri: shown.art.hero },
        resizeMode: "cover",
        style: [{ position: "absolute", top: 0, right: 0, bottom: 0, left: 0, borderRadius: 18 }, shown.art.tint ? { ...ART, backgroundColor: shown.art.tint } : ART]
      }
    );
  }
  function Blurb({ game }) {
    useT();
    const { rtl } = useLocale();
    const [ready, setReady] = (0, useState)(null);
    const current = (0, useRef)(game.id);
    current.current = game.id;
    (0, useEffect)(() => {
      const id2 = setTimeout(() => setReady(game.id), 800);
      return () => clearTimeout(id2);
    }, [game.id]);
    const id = game.id;
    return /* @__PURE__ */ (0, jsx)(AnimatePresence, { mode: "wait", initial: false, children: /* @__PURE__ */ (0, jsxs)(
      motion.View,
      {
        style: { gap: 30 },
        initial: { opacity: 0, y: 12 },
        animate: ready === game.id ? { opacity: 1, y: 0 } : { opacity: 0, y: 12 },
        exit: { opacity: 0, y: -6, transition: { type: "tween", duration: 0.15, ease: "easeIn" } },
        transition: { type: "tween", duration: 0.45, ease: EASE_OUT },
        children: [
          /* @__PURE__ */ (0, jsx)(
            GameLogo,
            {
              game,
              width: LOGO2[0],
              height: LOGO2[1],
              area: LOGO2[2],
              onReady: () => current.current === id && setReady(id)
            }
          ),
          /* @__PURE__ */ (0, jsx)(Text, { style: { marginBottom: -12, fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: game.genres.map(genreLabel).join(" \xB7 ") }),
          /* @__PURE__ */ (0, jsx)(Text, { style: [{ width: 552, fontFamily: "Inter-Regular", fontSize: 23, color: "#f2f2f3d9", numberOfLines: 3, ellipsizeMode: "tail", lineHeight: 37 }, rtl ? LATIN_IN_RTL : void 0], children: summaryOf(game) })
        ]
      },
      game.id
    ) });
  }
  function WishButton({ id, toList }) {
    const t2 = useT();
    const { rtl } = useLocale();
    const wishlist = useWishlist();
    const { toggleWish } = useStoreActions();
    const wished = wishlist.includes(id);
    const { focusedKey } = useFocus();
    useHints(focusedKey === 'spotlight:wish' ? [HINT.select, wished ? HINT.unfavorite : HINT.favorite, HINT.top, HINT.sections] : null);
    return /* @__PURE__ */ (0, jsx)(
      Button2,
      {
        variant: "outline",
        size: "lg",
        label: wished ? t2("browse.favorited") : t2("browse.addToFavorites"),
        focusKey: "spotlight:wish",
        nextFocusUp: "nav:current",
        nextFocusDown: FIRST_POPULAR,
        ...focusEnd(rtl, toList),
        onPress: () => toggleWish(id),
        children: /* @__PURE__ */ (0, jsx)(WishHeart, { active: wished })
      }
    );
  }
  function Spotlight() {
    return /* @__PURE__ */ (0, jsx)(Carousel, { shown: useNavState().top.name === "browse" });
  }
  var Carousel = (0, memo)(function Carousel2({ shown }) {
    const t2 = useT();
    const { rtl } = useLocale();
    const slides = useSlides(featured.length, shown);
    const { openGame } = useNavActions();
    const game = featured[slides.active];
    (0, useEffect)(() => {
      setFavoriteTarget('spotlight:cta', game.id);
      setFavoriteTarget('spotlight:wish', game.id);
      return () => {
        setFavoriteTarget('spotlight:cta', null);
        setFavoriteTarget('spotlight:wish', null);
      };
    }, [game.id]);
    (0, useEffect)(() => {
      const id = setTimeout(prefetchSlides, 1500);
      return () => clearTimeout(id);
    }, []);
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 16 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { position: "relative", width: ART.width, height: ART.height, overflow: "hidden", borderRadius: 18, backgroundColor: "#212125" }, children: [
        /* @__PURE__ */ (0, jsx)(Art, { game }),
        /* @__PURE__ */ (0, jsx)(View, { style: rtl ? { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundGradient: { type: "linear", to: "left", stops: [{ color: "#000000", offset: 0 }, { color: "#000000bf", offset: 0.35 }, { color: "transparent", offset: 0.75 }] } } : { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundGradient: { type: "linear", to: "right", stops: [{ color: "#000000", offset: 0 }, { color: "#000000bf", offset: 0.35 }, { color: "transparent", offset: 0.75 }] } } }),
        /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundGradient: { type: "linear", to: "top", stops: [{ color: "#000000b3", offset: 0 }, { color: "transparent", offset: 0.5 }] } } }),
        /* @__PURE__ */ (0, jsxs)(View, { style: rtl ? { position: "absolute", top: 0, bottom: 0, right: 0, width: 672, justifyContent: "flex-end", padding: 60 } : { position: "absolute", top: 0, bottom: 0, left: 0, width: 672, justifyContent: "flex-end", padding: 60 }, children: [
          /* @__PURE__ */ (0, jsx)(Blurb, { game }),
          /* @__PURE__ */ (0, jsxs)(View, { style: { marginTop: 30, flexDirection: "row", gap: 12 }, children: [
            /* @__PURE__ */ (0, jsx)(
              Button2,
              {
                variant: "primary",
                size: "lg",
                label: t2("browse.viewGame"),
                // The plain ring of the page's other buttons, not the primary button's halo.
                halo: false,
                focusKey: "spotlight:cta",
                nextFocusUp: "nav:current",
                nextFocusDown: FIRST_POPULAR,
                onPress: () => openGame(game.id, "spotlight:cta")
              }
            ),
            /* @__PURE__ */ (0, jsx)(WishButton, { id: game.id, toList: `spotlight:${slides.active}` })
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, jsx)(SpotlightList, { games: featured, slides })
    ] });
  });

export { Spotlight };
