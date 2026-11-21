// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {Children, createContext, createElement, isValidElement, useEffect, useMemo, useRef, useState}
  from 'react';
import {nextPresence} from './presence-list.js';

/**
 * Read by the nearest motion element under each AnimatePresence child.
 * @type {import('react').Context<{isPresent: boolean, initial: false | undefined,
 *   register: (id: object) => () => void, complete: (id: object) => void} | null>}
 */
export const PresenceContext = createContext(null);

function PresenceChild({present, initial, onExitComplete, children}) {
  const latest = useRef(onExitComplete);
  latest.current = onExitComplete;
  const registered = useRef(new Set()).current;
  const exited = useRef(new Set()).current;
  const context = useMemo(() => {
    const check = () => {
      if (!present && [...registered].every(id => exited.has(id))) latest.current();
    };
    return {
      isPresent: present,
      initial,
      register(id) {
        registered.add(id);
        return () => {
          registered.delete(id);
          exited.delete(id);
          check();
        };
      },
      complete(id) {
        exited.add(id);
        check();
      },
    };
  }, [present, initial]);
  useEffect(() => {
    if (present) exited.clear();
    else if (!registered.size) latest.current();
  }, [present]);
  return createElement(PresenceContext.Provider, {value: context}, children);
}

/**
 * Keeps removed keyed children mounted until their motion `exit` finishes.
 * @param {{children?: import('react').ReactNode, initial?: boolean, mode?: 'sync' | 'wait',
 *   onExitComplete?: () => void}} props
 */
export function AnimatePresence({children, initial = true, mode = 'sync', onExitComplete}) {
  if (mode !== 'sync' && mode !== 'wait') {
    throw new Error(`AnimatePresence: mode must be 'sync' or 'wait', got '${mode}'`);
  }
  const list = useRef([]);
  const firstRender = useRef(true);
  const [, rerender] = useState(0);
  const keyed = Children.toArray(children).filter(isValidElement)
    .map(element => ({key: element.key, element}));
  list.current = nextPresence(list.current, keyed, mode, !(firstRender.current && initial === false));
  useEffect(() => { firstRender.current = false; }, []);

  const remove = key => {
    const entry = list.current.find(other => other.key === key);
    if (!entry || entry.present) return;
    list.current = list.current.filter(other => other !== entry);
    rerender(count => count + 1);
    if (onExitComplete && list.current.every(other => other.present)) onExitComplete();
  };
  return list.current.map(({key, element, present, entering}) => createElement(PresenceChild,
    {key, present, initial: entering ? undefined : false, onExitComplete: () => remove(key)}, element));
}
