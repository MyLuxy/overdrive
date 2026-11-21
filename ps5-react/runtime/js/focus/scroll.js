// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// A ScrollView that keeps its focused descendant in view by scrolling natively through
// NativeUI.scrollTo (patches/embeddedReact-scroll-to.patch). Layout rectangles stay pre-scroll; the
// focus manager subtracts each enclosing frame's offset.
import {createElement, forwardRef, useContext, useLayoutEffect, useState} from 'react';
import {ScrollView as HostScrollView} from 'embedded-react';
import {FrameContext} from './runtime.js';
import {createFrame} from './scroll-frame.js';

/**
 * Embedded React's ScrollView, plus scrolling its focused descendant into view (minimal movement
 * with a margin, or aligned to its `scrollAnchor` ancestor; eased and speed-capped).
 * `onScrollTarget({x, y})` reports each new focus-scroll target offset, when the scroll starts.
 */
export const ScrollView = forwardRef((props, ref) => {
  const parent = useContext(FrameContext);
  const [frame] = useState(() => createFrame(parent));
  frame.props = props;
  frame.forwardedRef = ref;
  useLayoutEffect(() => () => frame.stop(), []);
  const {children, onScrollTarget, ...rest} = props;
  return createElement(HostScrollView, {...rest, ref: frame.ref, onLayout: frame.onLayout, onScroll: frame.onScroll},
    createElement(FrameContext.Provider, {value: frame}, children));
});
ScrollView.displayName = 'ScrollView';
