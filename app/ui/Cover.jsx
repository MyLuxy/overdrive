// ../pub-game-store/native/ui/Cover.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useRef, useState } from 'react';
import { Image, Text, View } from '@ps5-react/core';

  var SKELETON = { backgroundColor: "#212125" };
  var tinted = /* @__PURE__ */ new Map();
  var skeleton = (tint) => tint ? tinted.get(tint) ?? tinted.set(tint, { backgroundColor: tint }).get(tint) : SKELETON;
  var STALL_MS = 8e3;
  var waiting = /* @__PURE__ */ new Map();
  var sweep = null;
  function watchStall(onStall) {
    const token = {};
    waiting.set(token, { deadline: Date.now() + STALL_MS, onStall });
    sweep ?? (sweep = setInterval(() => {
      const now = Date.now();
      for (const [key, entry2] of waiting) if (entry2.deadline <= now) {
        waiting.delete(key);
        entry2.onStall();
      }
      if (!waiting.size) {
        clearInterval(sweep);
        sweep = null;
      }
    }, 1e3));
    return () => waiting.delete(token);
  }
  var fill = (style) => ({
    width: "100%",
    height: "100%",
    borderRadius: Object.assign({}, ...[style].flat(Infinity).filter(Boolean)).borderRadius
  });
  // A full engine image registry fails a load for a moment, not for this image: the cover tries again
  // a little later, a few times, instead of falling back to its title for as long as it stays mounted
  // (on the store front, for the whole session).
  var TRANSIENT = /registry is full/;
  var RETRY_MS = 1500;
  var RETRIES = 6;
  function Cover({ game, style, label = true, defer = false }) {
    const [failed, setFailed] = (0, useState)([]);
    const [loaded, setLoaded] = (0, useState)(null);
    const [attempt, setAttempt] = (0, useState)(0);
    const retry = (0, useRef)({ count: 0, timer: 0 });
    (0, useEffect)(() => () => clearTimeout(retry.current.timer), []);
    const failedLoad = (uri2, event) => {
      if (TRANSIENT.test(event?.nativeEvent?.error ?? "") && retry.current.count < RETRIES) {
        retry.current.count += 1;
        clearTimeout(retry.current.timer);
        retry.current.timer = setTimeout(() => setAttempt((count) => count + 1), RETRY_MS);
        return;
      }
      setFailed((previous) => [...previous, uri2]);
    };
    const copies = [game.art.cover, ...game.art.coverFallbacks || []].filter((url) => url && !failed.includes(url));
    const uri = copies[0];
    const last = copies.length < 2;
    (0, useEffect)(() => {
      // A deferred card loads nothing yet, so it has no stall to watch.
      if (defer || !uri || loaded === uri || last) return void 0;
      return watchStall(() => setFailed((previous) => [...previous, uri]));
    }, [uri, loaded, last, defer]);
    // `defer`: a card a row has not reached yet draws the placeholder tile and loads nothing. An image
    // in use is never evicted, so a row of forty cards pinned forty covers (1.0.8 thrashed the cache).
    if (defer) return /* @__PURE__ */ (0, jsx)(View, { style: [skeleton(game.art.tint), style] });
    // A homebrew app's art is its square icon: shown whole in the middle of the tile rather than cropped
    // to a cover's shape. One image: a dimmed copy behind it doubled every icon's decoded memory.
    if (uri && game.art.square) {
      const { width = 0, height = 0, borderRadius } = Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
      const side = Math.round(Math.min(width, height) * 0.72);
      return /* @__PURE__ */ (0, jsxs)(View, { style: [{ overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: "#17171a" }, style], children: [
        /* @__PURE__ */ (0, jsx)(
          Image,
          {
            source: { uri },
            resizeMode: "contain",
            style: { width: side, height: side, borderRadius: borderRadius ? Math.round(borderRadius * 1.5) : 0 },
            onLoad: () => setLoaded(uri),
            onError: (event) => failedLoad(uri, event)
          },
          `${uri}#${attempt}`
        )
      ] });
    }
    if (uri) {
      return /* @__PURE__ */ (0, jsx)(View, { style: loaded === uri ? style : [skeleton(game.art.tint), style], children: /* @__PURE__ */ (0, jsx)(
        Image,
        {
          source: { uri },
          resizeMode: "cover",
          style: fill(style),
          onLoad: () => setLoaded(uri),
          onError: (event) => failedLoad(uri, event)
        },
        `${uri}#${attempt}`
      ) });
    }
    return /* @__PURE__ */ (0, jsx)(View, { style: [{ overflow: "hidden" }, style], children: /* @__PURE__ */ (0, jsx)(View, { style: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#212125", padding: 12 }, children: label && /* @__PURE__ */ (0, jsx)(Text, { style: { width: "100%", textAlign: "center", fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", numberOfLines: 3, ellipsizeMode: "tail", lineHeight: 30 }, children: game.title }) }) });
  }

export { Cover };
