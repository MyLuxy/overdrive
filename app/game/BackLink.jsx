// ../pub-game-store/native/game/BackLink.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useT } from '../i18n/index.js';
import { getGame } from '../state/catalog.js';
import { useNavState } from '../state/nav.jsx';
import { FocusRing } from '../ui/FocusRing.jsx';
import { Icon } from '../ui/Icon.jsx';
import { colors } from '../ui/colors.js';
import { Text, View, useIsFocused } from '@ps5-react/core';

  function useOrigin() {
    const t2 = useT();
    const { stack } = useNavState();
    const previous = stack[stack.length - 2];
    // A homebrew app can leave the catalog while its page is open: the label then names the library.
    return previous.name === "game" ? getGame(previous.id)?.title ?? t2("game.back.browse") : t2(`game.back.${previous.name}`);
  }
  function Label2() {
    const focused = useIsFocused();
    const origin = useOrigin();
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(Icon, { name: "chevronLeft", size: 16, color: focused ? colors.fg : colors.muted }),
      /* @__PURE__ */ (0, jsx)(Text, { focused, style: [{ maxWidth: 720, fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30 }, focused ? { color: "#f2f2f3" } : null], children: origin })
    ] });
  }
  function BackLink({ onPress }) {
    return /* @__PURE__ */ (0, jsxs)(View, { onPress, nextFocusUp: "nav:search", style: { position: "relative", alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 6 }, children: [
      /* @__PURE__ */ (0, jsx)(Label2, {}),
      /* @__PURE__ */ (0, jsx)(FocusRing, {})
    ] });
  }

export { BackLink };
