// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useLayoutEffect, useRef} from 'react';
import {subscribeInput} from './input.js';
import {Text as EngineText, unstable_batchedUpdates} from 'embedded-react';
import {setFrameBatcher} from './frame.js';
import {inspectableText} from './focus/inspect-text.js';
export {AppRegistry, Animated, useAnimatedValue, Easing, LayoutAnimation, Svg, Path, Circle, Rect, Line, G}
  from 'embedded-react';
export const Text = inspectableText(EngineText);
setFrameBatcher(unstable_batchedUpdates);
export {View, Image, ReleaseImages, Pressable, ScrollView, VirtualList, FocusScope, useFocusable, useFocus, useFocusActions,
  useIsFocused, useNavigationEvents} from './focus/index.js';
export {motion, AnimatePresence, transitions} from './motion/index.js';
export {Screens, Screen, useIsScreenActive} from './screens.js';
export {Video} from './video.js';
export {DownloadFormats} from './download-formats.js';
export {Platform, DeviceInfo, FileSystem, Notifications, Users, Controller, useGamepad, useControllerEvents, Linking, Power, Display, AudioOutput, Fonts, BackHandler,
  Http, Downloads, Archives, Packages, BrowserCapture, LocalNetwork, Torrents, Sound} from './native.js';

// Input protocol v1 compatibility: each direction is followed by its legacy action.
const legacyActions = {up: 'previous', left: 'previous', down: 'next', right: 'next'};

/**
 * Subscribe while mounted. Options arrives as the `options` action.
 * @param {(action: import('./input.js').Action | 'previous' | 'next') => void} handler
 */
export function useController(handler) {
  const current = useRef(handler);
  useLayoutEffect(() => { current.current = handler; });
  useLayoutEffect(() => subscribeInput(action => {
    current.current(action);
    if (legacyActions[action]) current.current(legacyActions[action]);
  }), []);
}

/**
 * Tailwind-style classes → a style object, compiled by the build (see docs/TAILWIND.md).
 * @param {TemplateStringsArray} classes
 * @returns {object}
 */
export function tw(classes) {
  throw new Error(`tw\`${classes.join('')}\` was not compiled; use it in an app source file`);
}
