// ../pub-game-store/native/ui/DownloadsBadge.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useState } from 'react';
import { BUSY } from '../state/download-queue.js';
import { downloadQueue } from '../state/downloads.js';
import { colors } from './colors.js';
import { Text, View, useIsFocused } from '@ps5-react/core';

  var IDLE = { count: 0, percent: null };
  function summary3(jobs) {
    const busy = jobs.filter((job2) => BUSY.includes(job2.state));
    if (!busy.length) return IDLE;
    const sized = busy.filter((job2) => job2.total > 0);
    const total = sized.reduce((sum, job2) => sum + job2.total, 0);
    const written = sized.reduce((sum, job2) => sum + Math.min(job2.written, job2.total), 0);
    return { count: busy.length, percent: total ? Math.floor(written / total * 100) : null };
  }
  // `inset` is the item's own horizontal padding, so the bar runs from the start of the icon to the
  // end of the count: 24 on a full NavItem, 14 on a compact one.
  function DownloadsBadge({ inset = 24 }) {
    const [state, setState] = (0, useState)(IDLE);
    const focused = useIsFocused();
    (0, useEffect)(() => {
      let last = IDLE;
      try {
        return downloadQueue().subscribe((jobs) => {
          const next = summary3(jobs);
          if (last.count === next.count && last.percent === next.percent) return;
          last = next;
          setState(next);
        });
      } catch (error2) {
        console.log(`[downloads] queue unavailable: ${error2.message}`);
        return void 0;
      }
    }, []);
    if (!state.count) return null;
    return /* @__PURE__ */ (0, jsxs)(Fragment, { children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: [{ fontFamily: "Inter-Regular", fontSize: 23 }, { color: focused ? colors.fg : "#f2f2f3a6" }], children: String(state.count) }),
      state.percent === null ? null : /* @__PURE__ */ (0, jsx)(View, { style: { position: "absolute", left: inset, right: inset, bottom: 6, height: 5, overflow: "hidden", borderRadius: 14999, backgroundColor: "#ffffff33" }, children: /* @__PURE__ */ (0, jsx)(View, { style: [{ height: "100%", backgroundColor: "#f2f2f3" }, { width: `${state.percent}%` }] }) })
    ] });
  }

export { DownloadsBadge };
