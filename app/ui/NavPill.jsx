// ../pub-game-store/native/ui/NavPill.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { useRef, useState } from 'react';
import { logical } from './scale.js';
import { motion } from '@ps5-react/core';

  var slide2 = { x: { type: "spring", stiffness: 520, damping: 42, mass: 1 }, opacity: { type: "tween", duration: 0.15 } };
  function useNavLayouts() {
    const [layouts, setLayouts] = (0, useState)({});
    const handlers = (0, useRef)({}).current;
    const track = (name) => handlers[name] ?? (handlers[name] = (event) => {
      const { x, width } = event.layout;
      setLayouts((current) => current[name]?.x === x && current[name]?.width === width ? current : { ...current, [name]: { x, width } });
    });
    return [layouts, track];
  }
  function NavPill({ section, layouts }) {
    const last = (0, useRef)(null);
    const item = layouts[section];
    if (item && layouts.header) last.current = { x: logical(item.x - layouts.header.x), width: item.width };
    if (!last.current) return null;
    return /* @__PURE__ */ (0, jsx)(
      motion.View,
      {
        style: [{ position: "absolute", left: 0, top: 18, height: 60, borderRadius: 14999, backgroundColor: "#ffffff1f" }, { width: last.current.width }],
        initial: false,
        animate: { x: last.current.x, opacity: item ? 1 : 0 },
        transition: slide2
      }
    );
  }

export { NavPill, useNavLayouts };
