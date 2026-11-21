// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {Animated} from 'embedded-react';

/** @type {import('./values.js').Engine} */
export const engine = {
  create(initial) {
    const value = new Animated.Value(initial);
    if (!value._handle) {
      throw new Error('motion: the engine Animated.Value pool is full; animate fewer keys or elements at once, '
        + 'or raise ERUI_MAX_ANIM_VALUES in native/ps5/CMakeLists.txt');
    }
    return value;
  },
  animate(value, toValue, {type, ...config}, done) {
    const animation = (type === 'spring' ? Animated.spring : Animated.timing)(value, {toValue, ...config});
    animation.start(({finished}) => done(finished));
    return () => animation.stop();
  },
  set: (value, to) => value.setValue(to),
  get: value => value.__getValue(),
  destroy: value => value.destroy(),
};
