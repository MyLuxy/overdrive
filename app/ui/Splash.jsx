// ../pub-game-store/native/ui/Splash.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { Path, Svg, motion } from '@ps5-react/core';
import { colors } from './colors.js';
import { px } from './scale.js';

  var SIZE3 = 200 / 1.5;
  var UNIT = SIZE3 / 32;
  var HUB = { x: 15.45, y: 16.55 };
  var needleBox = { position: "absolute", left: px((HUB.x - 16) * UNIT), top: px((HUB.y - 16) * UNIT) };
  var STEPS = [
    // Swings back like a revved engine settling...
    { rotate: -120, transition: { type: "tween", duration: 0.4, ease: "easeInOut", delay: 0.15 } },
    // ...then kicks through the limit and settles in the gap.
    { rotate: 0, transition: { type: "spring", stiffness: 260, damping: 11 } }
  ];
  // `onDone` reports the end of the intro so the store can mount behind it: nothing of the
  // store is rendered or loaded while the needle swings.
  // The store's first render takes about 300 ms on the console. Started in the same update that
  // removes the faded logo, it held the fade's last frame on screen all that time; so the black
  // screen is shown first, and the store starts a few frames later.
  var MOUNT_AFTER_MS = 50;
  function Splash({ onDone }) {
    const [step, setStep] = (0, useState)(0);
    const [done, setDone] = (0, useState)(false);
    (0, useEffect)(() => {
      if (!done || !onDone) return;
      const id = setTimeout(onDone, MOUNT_AFTER_MS);
      return () => clearTimeout(id);
    }, [done]);
    if (done) return null;
    const leaving = step === STEPS.length;
    return /* @__PURE__ */ (0, jsx)(
      motion.View,
      {
        style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#000000" },
        initial: false,
        animate: { opacity: leaving ? 0 : 1 },
        transition: { duration: 0.35, ease: "easeIn", delay: 0.1 },
        onAnimationComplete: () => {
          if (!leaving) return;
          setDone(true);
        },
        children: /* @__PURE__ */ (0, jsxs)(
          motion.View,
          {
            style: { width: px(SIZE3), height: px(SIZE3) },
            initial: false,
            animate: { scale: leaving ? 0.9 : 1 },
            transition: { duration: 0.45, ease: "easeIn" },
            children: [
              /* @__PURE__ */ (0, jsx)(Svg, { width: px(SIZE3), height: px(SIZE3), viewBox: "0 0 32 32", children: /* @__PURE__ */ (0, jsx)(Path, { d: "M26.34 12.24A11 11 0 1 1 19.76 5.66", fill: "none", stroke: colors.fg, strokeWidth: 4.5 }) }),
              /* @__PURE__ */ (0, jsx)(
                motion.View,
                {
                  style: needleBox,
                  initial: { rotate: 0 },
                  animate: STEPS[Math.min(step, STEPS.length - 1)],
                  onAnimationComplete: () => setStep((s) => Math.min(s + 1, STEPS.length)),
                  children: /* @__PURE__ */ (0, jsx)(Svg, { width: px(SIZE3), height: px(SIZE3), viewBox: `${HUB.x - 16} ${HUB.y - 16} 32 32`, children: /* @__PURE__ */ (0, jsx)(Path, { d: "M28.4 3.6 17.6 18.1a2.9 2.9 0 1 1-3.7-3.7Z", fill: colors.fg }) })
                }
              )
            ]
          }
        )
      }
    );
  }

export { Splash };
