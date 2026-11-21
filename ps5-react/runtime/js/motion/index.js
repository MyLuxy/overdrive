// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Motion-style animation over Embedded React's engine-driven Animated; see docs/ANIMATION.md.
import {Image, Text, View} from 'embedded-react';
import {createMotion} from './motion.js';

export {AnimatePresence} from './presence.js';
export {transitions} from './transitions.js';

export const motion = {
  View: createMotion(View),
  Text: createMotion(Text, {wrapOpacity: true}),
  Image: createMotion(Image, {wrapOpacity: true}),
  /** @type {typeof createMotion} */
  create: Component => createMotion(Component),
};
