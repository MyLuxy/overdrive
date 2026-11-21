// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// <Screens>: a page switcher that keeps every screen it has shown mounted, hidden while off stage.
import {Children, createContext, createElement, isValidElement, useContext, useLayoutEffect, useEffect, useRef,
  useState} from 'react';
import {FocusScope} from './focus/scope.js';
import {ReleaseImages} from './focus/image.js';
import {motion} from './motion/index.js';
import {transitions} from './motion/transitions.js';
import {activate, initialStage, preload, settle} from './screens-stage.js';

// The page transition ANIMATION.md recommends: translate only, the exit shorter than the entrance.
const SLIDE = Object.freeze({
  hidden: {x: 90},
  shown: {x: 0, transition: transitions.screen},
  gone: {x: -60, transition: transitions.exit},
});
// Jumps to the entry position; children still get `hidden`, so their own entrances replay.
const ENTER = 'screens:enter';
// How long the stage must rest before `preload` mounts the next unvisited screen.
const PRELOAD_IDLE_MS = 1000;
const FILL = {position: 'absolute', left: 0, top: 0, right: 0, bottom: 0};

const ScreenContext = createContext(true);

/** Same element type, key and props (compared one level deep). */
function sameElement(a, b) {
  if (a === b) return true;
  if (!isValidElement(a) || !isValidElement(b) || a.type !== b.type || a.key !== b.key) return false;
  const keys = Object.keys(a.props);
  return keys.length === Object.keys(b.props).length && keys.every(key => Object.is(a.props[key], b.props[key]));
}

// Hands React the element it rendered last, so the screen's subtree is skipped: always while off
// stage (an app re-rendering on each tab change would otherwise re-render every page it keeps), and
// on stage until the app passes different props. Context still reaches it.
function Frozen({frozen, children}) {
  const kept = useRef(children);
  if (!frozen && !sameElement(kept.current, children)) kept.current = children;
  return kept.current;
}

/** Whether the calling component's screen is on stage and not leaving (true outside <Screens>). */
export function useIsScreenActive() {
  return useContext(ScreenContext);
}

/**
 * One page of a <Screens>. Its children are mounted when it is first shown (or preloaded) and stay
 * mounted, off screen, after it leaves.
 * @param {{id: string | number, onBack?: () => boolean | void, children?: import('react').ReactNode}} props
 */
export function Screen() {
  throw new Error('Screen: render it as a direct child of <Screens>');
}

/**
 * Shows the <Screen> whose `id` is `active`. Switching works like AnimatePresence mode="wait" over
 * keyed pages: the current screen leaves, then the next one enters, with `variants` labels `hidden`,
 * `shown` and `gone` (a slide by default). Unlike it, a screen that leaves is not unmounted: it stays
 * with `display: 'none'`, out of navigation (FocusScope `inert`), its images released
 * (ReleaseImages), and comes back with its state, scroll and focus as they were. Screens skipped
 * over while another one leaves are not mounted. `focusKey` and `onBack` go to the FocusScope of the
 * screen on stage. With `preload`, screens not shown yet are mounted one at a time while the stage
 * rests, so their first visit does not build them either. An off-stage screen does not re-render when
 * the component rendering <Screens> does (context changes still reach it), and catches up when shown.
 * Hidden screens still hold their engine nodes and keep their timers running: pause work with
 * useIsScreenActive().
 * @param {{active: string | number, variants?: {hidden: object, shown: object, gone: object},
 *   focusKey?: string, onBack?: () => boolean | void, preload?: boolean,
 *   children?: import('react').ReactNode}} props
 */
export function Screens({active, variants = SLIDE, focusKey, onBack, preload: preloading = false, children}) {
  const screens = new Map();
  Children.forEach(children, child => {
    if (!isValidElement(child)) return;
    if (child.type !== Screen) throw new Error('Screens: children must be <Screen> elements');
    if (screens.has(child.props.id)) throw new Error(`Screens: two screens have id ${JSON.stringify(child.props.id)}`);
    screens.set(child.props.id, child.props);
  });
  if (!screens.has(active)) throw new Error(`Screens: no <Screen id=${JSON.stringify(active)}>`);

  const [state, setState] = useState(() => initialStage(active));
  const latest = useRef(active);
  latest.current = active;
  const labels = {...variants, [ENTER]: {...variants.hidden, transition: {duration: 0}}};
  const stageExists = screens.has(state.stage);
  useLayoutEffect(() => setState(current => activate(current, active, stageExists)), [active, stageExists]);

  const resting = state.phase === 'shown';
  const next = preloading && resting ? [...screens.keys()].find(id => !state.mounted.includes(id)) : undefined;
  useEffect(() => {
    if (next === undefined) return undefined;
    const timer = setTimeout(() => setState(current => preload(current, next)), PRELOAD_IDLE_MS);
    return () => clearTimeout(timer);
  }, [next, state.stage]);

  const pages = [];
  for (const [id, screen] of screens) {
    if (!state.mounted.includes(id)) continue;
    const onStage = id === state.stage;
    const phase = onStage ? state.phase : 'off';
    const live = onStage && phase !== 'leaving';
    const animate = phase === 'entering' ? ['hidden', ENTER] : phase === 'shown' ? 'shown' : 'gone';
    pages.push(createElement(motion.View, {
      key: id, variants: labels, initial: false, animate,
      style: {...FILL, display: onStage ? 'flex' : 'none'},
      onAnimationComplete: () => {
        if (onStage) setState(current => settle(current, id, phase, latest.current));
      },
    }, createElement(FocusScope, {focusKey: live ? focusKey : undefined, inert: !live, onBack: screen.onBack ?? onBack},
      createElement(ReleaseImages, {when: !onStage},
        createElement(ScreenContext.Provider, {value: live},
          createElement(Frozen, {frozen: !onStage}, screen.children))))));
  }
  return pages;
}
