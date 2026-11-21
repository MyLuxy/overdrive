// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {createElement, useContext, useLayoutEffect, useRef, useState} from 'react';
import {manager, navigationListeners, ScopeContext} from './runtime.js';

/**
 * Groups focusable elements: navigation searches the innermost scope first, then its parents.
 * @param {import('./manager.js').ScopeProps & {children?: import('react').ReactNode}} props
 *   `restoreFocus` defaults to true.
 */
export function FocusScope(props) {
  const parent = useContext(ScopeContext);
  const [scope] = useState(() => manager.createScope(parent, props));
  useLayoutEffect(() => { manager.setProps(scope, props); });
  useLayoutEffect(() => {
    manager.mountScope(scope);
    return () => manager.unmountScope(scope);
  }, []);
  return createElement(ScopeContext.Provider, {value: scope}, props.children);
}

const focusedKey = () => manager.focused?.props.focusKey ?? null;

/**
 * The focused element's key, and imperative focus by `focusKey` (an element or a FocusScope).
 * Re-renders the caller when the focused key changes.
 * @returns {{focusedKey: string | null, focus: (key: string) => boolean, blur: () => void}}
 */
export function useFocus() {
  const [key, setKey] = useState(focusedKey);
  useLayoutEffect(() => {
    setKey(focusedKey());
    return manager.subscribe(() => setKey(focusedKey()));
  }, []);
  return {focusedKey: key, ...actions};
}

const actions = {
  focus: target => manager.focus(target),
  blur: () => manager.blur(),
  focusedRect: () => manager.focusedRect(),
};

/**
 * `useFocus()` without `focusedKey`: imperative focus that never re-renders the caller, for components
 * that move focus but do not draw it (an app root, a page).
 * @returns {{focus: (key: string) => boolean, blur: () => void, focusedRect: () => object | null}}
 */
export function useFocusActions() {
  return actions;
}

/**
 * Calls `listener` after the focus manager handles each input: a move or a blocked direction, Cross,
 * Circle and the other buttons, with whether something handled them. For feedback such as sounds;
 * it does not re-render the caller.
 * @param {(event: import('./runtime.js').NavigationEvent) => void} listener
 */
export function useNavigationEvents(listener) {
  const current = useRef(listener);
  useLayoutEffect(() => { current.current = listener; });
  useLayoutEffect(() => {
    const forward = event => current.current(event);
    navigationListeners.add(forward);
    return () => { navigationListeners.delete(forward); };
  }, []);
}
