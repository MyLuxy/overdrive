// ../pub-game-store/native/ui/DownloadToast.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { useDownloadAlerts } from '../downloads/useDownloadAlerts.js';
import { useT } from '../i18n/index.js';
import { getGame } from '../state/catalog.js';
import { useNavActions, useNavState } from '../state/nav.jsx';
import { Toast } from './Toast.jsx';
import { pulseNotice } from './haptics.js';
import { AnimatePresence } from '@ps5-react/core';

  var TOAST_MS2 = 6e3;
  function DownloadToast({ actionRef }) {
    const t2 = useT();
    const [alert, setAlert] = (0, useState)(null);
    useDownloadAlerts((next) => {
      pulseNotice();
      setAlert((last) => ({ ...next, n: (last?.n ?? 0) + 1 }));
    });
    const { top } = useNavState();
    const nav = useNavActions();
    const quiet = top.name === "downloads" || top.name === "game" && top.id === alert?.gameId;
    const shown = alert && !quiet ? alert : null;
    const game = shown && getGame(shown.gameId);
    const failed = shown?.kind === "failed";
    (0, useEffect)(() => {
      if (!alert) return void 0;
      const id = setTimeout(() => setAlert(null), TOAST_MS2);
      return () => clearTimeout(id);
    }, [alert]);
    actionRef.current = shown && (() => {
      setAlert(null);
      if (failed || !game) nav.push({ name: "downloads" });
      else nav.openGame(game.id);
    });
    return /* @__PURE__ */ (0, jsx)(AnimatePresence, { children: shown && /* @__PURE__ */ (0, jsx)(
      Toast,
      {
        game,
        icon: failed ? "alert" : "circleCheck",
        status: shown.message,
        title: shown.title,
        failed,
        action: { button: "r2", label: t2(failed ? "toast.openDownloads" : "toast.viewGame") },
        duration: TOAST_MS2
      },
      shown.n
    ) });
  }

export { DownloadToast };
