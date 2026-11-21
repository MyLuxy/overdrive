// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// <Screens> state: which screen is on stage and where its transition is. Pure, so it is testable
// without a renderer; screens.js renders it.

/**
 * One screen is on stage at a time, like AnimatePresence mode="wait": it is `entering` (jumping to
 * the entry position, then animating in), `shown`, or `leaving`. Every other mounted screen is off.
 * `mounted` lists screens in the order they were first shown or preloaded; they stay mounted.
 * @typedef {string | number} ScreenId
 * @typedef {{stage: ScreenId, phase: 'entering' | 'shown' | 'leaving', mounted: ScreenId[]}} Stage
 */

/** @param {ScreenId} active @returns {Stage} */
export function initialStage(active) {
  return {stage: active, phase: 'shown', mounted: [active]};
}

const mount = (mounted, id) => (mounted.includes(id) ? mounted : [...mounted, id]);

/**
 * `active` changed. The screen on stage leaves; the next one enters when it has left (see settle).
 * Going back to the leaving screen before it has left turns it around.
 * @param {Stage} state @param {ScreenId} active @param {boolean} stageExists
 * @returns {Stage}
 */
export function activate(state, active, stageExists = true) {
  if (!stageExists) return {stage: active, phase: 'entering', mounted: mount(state.mounted, active)};
  if (active === state.stage) return state.phase === 'leaving' ? {...state, phase: 'shown'} : state;
  if (state.phase === 'leaving') return state;
  return {...state, phase: 'leaving'};
}

/**
 * The screen `id` finished animating to `phase`. A screen that has left hands the stage to the
 * screen active now, mounting it if it never was: screens passed over meanwhile are never mounted.
 * @param {Stage} state @param {ScreenId} id @param {Stage['phase']} phase @param {ScreenId} active
 * @returns {Stage}
 */
export function settle(state, id, phase, active) {
  if (id !== state.stage || phase !== state.phase) return state;
  if (phase === 'entering') return {...state, phase: 'shown'};
  if (phase === 'leaving') return {stage: active, phase: 'entering', mounted: mount(state.mounted, active)};
  return state;
}

/**
 * Mounts a screen off stage ahead of its first visit.
 * @param {Stage} state @param {ScreenId} id @returns {Stage}
 */
export function preload(state, id) {
  const mounted = mount(state.mounted, id);
  return mounted === state.mounted ? state : {...state, mounted};
}
