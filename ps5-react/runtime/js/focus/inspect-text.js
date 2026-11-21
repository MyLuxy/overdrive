// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Under the desktop control channel only (the host sets __ps5ReactInspecting before the bundle
// loads), each Text tells its nearest focusable element what it says, for the inspector's snapshot.
// Elsewhere Text stays the engine's own: a hook per Text would cost every list on the console.
import {Children, createElement, isValidElement, useContext, useLayoutEffect, useRef} from 'react';
import {textOf} from './inspect.js';
import {NodeContext} from './runtime.js';

/**
 * `children` with every nested `Wrapper` element turned back into `Text`. The engine flattens a
 * Text's nested Text children into inline spans only when they are its own element type; a wrapped
 * child made the line fall back to separate, default-styled nodes (tiny, and wrapped).
 */
export function unwrapText(children, Text, Wrapper) {
  return Children.map(children, child => isValidElement(child) && child.type === Wrapper
    ? createElement(Text, {...child.props, key: child.key}, unwrapText(child.props.children, Text, Wrapper))
    : child);
}

export function inspectableText(Text) {
  if (!globalThis.__ps5ReactInspecting) return Text;
  // The outer Text reports its nested ones' text too, so only it keeps the wrapper.
  function InspectText(props) {
    const node = useContext(NodeContext);
    const token = useRef({});
    const text = textOf(props.children);
    useLayoutEffect(() => {
      if (!node || !text) return undefined;
      (node.texts ??= new Map()).set(token.current, text);
      return () => node.texts.delete(token.current);
    }, [node, text]);
    return createElement(Text, props, unwrapText(props.children, Text, InspectText));
  }
  return InspectText;
}
