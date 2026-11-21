// ../pub-game-store/native/state/nav.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx, jsxs } from 'react/jsx-runtime';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { recordVisit } from './recent.js';
import { useFocus } from '@ps5-react/core';

  var StateContext2 = (0, createContext)(null);
  var ActionsContext2 = (0, createContext)(null);
  var ImmersiveContext = (0, createContext)(false);
  var RETRY_MS = 50;
  var GIVE_UP_MS = 1500;
  function FocusRequest({ target }) {
    const { focus: focus2 } = useFocus();
    (0, useEffect)(() => {
      let waited = 0;
      let id = 0;
      const attempt = () => {
        if (focus2(target) || waited >= GIVE_UP_MS) return;
        waited += RETRY_MS;
        id = setTimeout(attempt, RETRY_MS);
      };
      id = setTimeout(attempt, 0);
      return () => clearTimeout(id);
    }, []);
    return null;
  }
  function NavProvider({ children }) {
    const [stack, setStack] = (0, useState)([{ name: "browse" }]);
    const [request, setRequest] = (0, useState)(null);
    const [immersive, setImmersive] = (0, useState)(0);
    const current = (0, useRef)(stack);
    current.current = stack;
    const [actions] = (0, useState)(() => {
      const focusLater = (target) => setRequest((last) => ({ target, n: (last?.n ?? 0) + 1 }));
      const push = (screen2, from) => {
        if (screen2.name === "game") recordVisit(screen2.id);
        setStack((list) => [...list.slice(0, -1), { ...list[list.length - 1], from }, screen2]);
      };
      return {
        focusLater,
        immerse: (delta) => setImmersive((count) => count + delta),
        push,
        openGame: (id, from) => push({ name: "game", id }, from),
        // Another edition of the open game takes its place, so Back still leaves the title.
        openEdition: (id, download) => {
          recordVisit(id);
          setStack((list) => [...list.slice(0, -1), { name: "game", id, download }]);
        },
        pop: () => {
          const list = current.current;
          if (list.length === 1) return false;
          const back2 = list[list.length - 2];
          setStack(list.slice(0, -1));
          if (back2.from) focusLater(back2.from);
          return true;
        },
        home: (target) => {
          setStack((list) => list.slice(0, 1));
          if (target) focusLater(target);
        }
      };
    });
    const state = (0, useMemo)(() => ({ stack, top: stack[stack.length - 1] }), [stack]);
    return /* @__PURE__ */ (0, jsx)(ActionsContext2.Provider, { value: actions, children: /* @__PURE__ */ (0, jsx)(StateContext2.Provider, { value: state, children: /* @__PURE__ */ (0, jsxs)(ImmersiveContext.Provider, { value: immersive > 0, children: [
      children,
      request && /* @__PURE__ */ (0, jsx)(FocusRequest, { target: request.target }, request.n)
    ] }) }) });
  }
  var useNavActions = () => (0, useContext)(ActionsContext2);
  var useNavState = () => (0, useContext)(StateContext2);
  function useImmersive(active2) {
    const { immerse } = (0, useContext)(ActionsContext2);
    (0, useEffect)(() => {
      if (!active2) return void 0;
      immerse(1);
      return () => immerse(-1);
    }, [active2]);
  }
  var useIsImmersive = () => (0, useContext)(ImmersiveContext);

export { NavProvider, useImmersive, useIsImmersive, useNavActions, useNavState };
