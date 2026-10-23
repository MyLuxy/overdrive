// ../pub-game-store/native/ui/GameCard.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useRef, useState } from 'react';
import { prefetchWhenSettled } from '../game/art.js';
import { favoriteTarget, setFavoriteTarget } from './favoriteFocus.js';
import { focusEnd, focusStart, latin, useLocale } from '../i18n/index.js';
import { genreLabel, onCdn } from '../state/catalog.js';
import { useStoreActions, useWishlist } from '../state/store.jsx';
import { CardFocus } from './CardFocus.jsx';
import { CdnMark } from './CdnAura.jsx';
import { Cover } from './Cover.jsx';
import { Icon } from './Icon.jsx';
import { PlatformBadge } from './PlatformBadge.jsx';
import { colors } from './colors.js';
import { EASE_OUT } from './ease.js';
import { lightGame, unlight } from './lightBar.js';
import { canScale, px } from './scale.js';
import { Text, View, motion, transitions, useFocus, useIsFocused } from '@ps5-react/core';

  var focusMotion = { type: "tween", duration: 0.3, ease: EASE_OUT };
  var CAPTION = 54;
  var DETAILED_CAPTION = 74;
  var DETAILS_HEIGHT = px(DETAILED_CAPTION);
  var press = { scale: 0.95 };
  var rest = { y: 0 };
  var lift = { y: -6 };
  var focusedCard = null;
  function useFavoriteAction(fallback = null) {
    const { toggleWish } = useStoreActions();
    const { focusedKey } = useFocus();
    return (action) => {
      if (action !== "square") return false;
      const id = favoriteTarget(focusedKey)
        ?? (focusedCard?.key === focusedKey ? focusedCard.game.id : null)
        ?? fallback?.id;
      if (!id) return false;
      toggleWish(id);
      return true;
    };
  }
  function WishBadge({ id, focused, compact = false, placement = 'cover' }) {
    const wished = useWishlist().includes(id);
    const added = (0, useRef)(0);
    const last = (0, useRef)(wished);
    if (wished && !last.current) added.current += 1;
    last.current = wished;
    if (!wished && !focused) return null;
    return /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute",
      ...(placement === 'row-end'
        ? { right: 10, top: '50%', marginTop: -18 }
        : { left: compact ? 3 : 12, top: compact ? 3 : 12 }),
      width: placement === 'row-end' ? 36 : compact ? 27 : 42,
      height: placement === 'row-end' ? 36 : compact ? 27 : 42,
      alignItems: "center", justifyContent: "center", borderRadius: 14999,
      backgroundColor: 'transparent' }, children: /* @__PURE__ */ (0, jsx)(
      motion.View,
      {
        initial: wished && added.current ? { scale: 1.7 } : false,
        animate: { scale: 1 },
        transition: transitions.pop,
        children: /* @__PURE__ */ (0, jsx)(Icon, { name: "star", size: compact ? 15 : 21, color: wished ? "#ffd54a" : "#f2f2f3", fill: wished ? "#ffd54a" : "none" })
      },
      added.current
    ) });
  }
  var boxes = /* @__PURE__ */ new Map();
  function boxOf(width, detailed) {
    const id = detailed ? -width : width;
    if (!boxes.has(id)) {
      const height = Math.round(width * 4 / 3);
      boxes.set(id, {
        height,
        card: { width: px(width) },
        tile: { height: px(height) },
        text: { width: px(width) },
        cover: { width: px(width), height: px(height), borderRadius: px(8) }
      });
    }
    return boxes.get(id);
  }
  function TitleWithPlatform({ game, focused, rtl, box, detailed = false }) {
    const platforms = !game.homebrew && Array.isArray(game.platforms)
      ? game.platforms.filter((platform) => platform === "ps4" || platform === "ps5")
      : [];
    const spacer = platforms.length ? "\u00a0".repeat(platforms.length * 7 + 1) + " " : "";
    return /* @__PURE__ */ (0, jsxs)(View, {
      style: [{ position: "relative", marginTop: detailed ? 6 : 18 }, box.text],
      children: [
        platforms.length ? /* @__PURE__ */ (0, jsx)(View, {
          style: { position: "absolute", left: 0, top: 7, zIndex: 1 },
          children: /* @__PURE__ */ (0, jsx)(PlatformBadge, { platforms, compact: true })
        }) : null,
        /* @__PURE__ */ (0, jsx)(Text, {
          focused, style: { width: "100%", fontFamily: "Inter-Regular", fontSize: 23,
            fontWeight: detailed ? 600 : 400, color: focused ? "#f2f2f3" : "#f2f2f3e6",
            numberOfLines: detailed ? 2 : 1, ellipsizeMode: "tail",
            lineHeight: 30, height: detailed ? 60 : 30 },
          children: spacer + latin(rtl, game.title)
        })
      ]
    });
  }
  function Details({ game, focused, box }) {
    const { rtl } = useLocale();
    return /* @__PURE__ */ (0, jsxs)(View, { style: [{ height: DETAILS_HEIGHT, paddingTop: 15 }, box.text], children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { height: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, children: [
        /* @__PURE__ */ (0, jsx)(Text, {
          style: { flex: 1, fontFamily: "Inter-Regular", fontSize: 20, color: "#8a8a94", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 24 },
          children: game.genres[0] ? genreLabel(game.genres[0]) : game.platform.toUpperCase()
        }),

      ] }),
      /* @__PURE__ */ (0, jsx)(TitleWithPlatform, { game, focused, rtl, box, detailed: true })
    ] });
  }
  function Body({ game, width, caption, detailed, deferArt, highlightFocus = false }) {
    const { rtl } = useLocale();
    const { focusedKey } = useFocus();
    const focused = useIsFocused() || (highlightFocus && focusedKey?.startsWith('popular:') && focusedKey === `popular:${game.id}`);
    const box = boxOf(width, detailed);
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsxs)(
        motion.View,
        {
          style: [{ borderRadius: 12, backgroundColor: "#17171a" }, box.tile],
          initial: false,
          animate: focused ? lift : rest,
          transition: focusMotion,
          children: [
            /* @__PURE__ */ (0, jsx)(Cover, { game, style: box.cover, defer: deferArt }),
            /* @__PURE__ */ (0, jsx)(WishBadge, { id: game.id, focused }),
            onCdn(game) ? /* @__PURE__ */ (0, jsx)(CdnMark, {}) : null,
            /* @__PURE__ */ (0, jsx)(CardFocus, { focused, width, height: box.height, platforms: game.platforms, sizeGb: game.sizeGb }),
            focused && highlightFocus ? /* @__PURE__ */ (0, jsx)(View, {
              style: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
                borderWidth: 3, borderColor: '#f2f2f3', borderRadius: 12 }
            }) : null
          ]
        }
      ),
      caption ?? (detailed ? /* @__PURE__ */ (0, jsx)(Details, { game, focused, box }) : /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
        /* @__PURE__ */ (0, jsx)(TitleWithPlatform, { game, focused, rtl, box }),
        /* @__PURE__ */ (0, jsx)(Text, { style: [{ marginTop: 3, fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", numberOfLines: 1, ellipsizeMode: "tail" }, box.text], children: game.genres.slice(0, 2).map(genreLabel).join(" \xB7 ") })
      ] }))
    ] });
  }
  function GameCard({
    game,
    onPress,
    width = 150,
    focusKey = `card:${game.id}`,
    rowEnd,
    rowStart,
    enterDelay,
    caption,
    detailed,
    onFocus,
    deferArt,
    highlightFocus = false,
    ...rest2
  }) {
    const { rtl } = useLocale();
    const box = boxOf(width, detailed);
    const scales = canScale(width, box.height + (detailed ? DETAILED_CAPTION : CAPTION));
    const [entering, setEntering] = (0, useState)(enterDelay != null);
    const card = (0, useRef)({}).current;
    card.game = game;
    card.key = focusKey;
    (0, useEffect)(() => () => {
      if (focusedCard !== card) return;
      focusedCard = null;
      unlight(card.key);
    }, []);
    const entrance = entering && {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { ...focusMotion, duration: 0.4, delay: enterDelay },
      onAnimationComplete: () => setEntering(false)
    };
    return /* @__PURE__ */ (0, jsx)(
      motion.View,
      {
        ...focusEnd(rtl, rowEnd ? focusKey : void 0),
        // A grid's first column: Left stops there instead of looking up the page for something to its left,
        // or goes where rowStart names (Search's keyboard).
        ...focusStart(rtl, typeof rowStart === "string" ? rowStart : rowStart ? focusKey : void 0),
        ...rest2,
        focusKey,
        onPress,
        onFocus: () => {
          focusedCard = card;
          setFavoriteTarget(focusKey, game.id);
          prefetchWhenSettled(game);
          lightGame(focusKey, game);
          onFocus?.();
        },
        onBlur: () => {
          if (focusedCard === card) focusedCard = null;
          unlight(focusKey);
        },
        whilePress: scales ? press : void 0,
        transition: focusMotion,
        ...entrance,
        style: box.card,
        children: /* @__PURE__ */ (0, jsx)(Body, { game, width, caption, detailed, deferArt, highlightFocus })
      }
    );
  }

export { DETAILED_CAPTION, DETAILS_HEIGHT, GameCard, WishBadge, useFavoriteAction };
