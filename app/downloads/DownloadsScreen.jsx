// ../pub-game-store/native/downloads/DownloadsScreen.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useRef, useState } from 'react';
import { DownloadRow, primaryKey } from './DownloadRow.jsx';
import { SummaryPanel } from './SummaryPanel.jsx';
import { useJobs } from './useQueue.js';
import { formatNumber2, t } from '../i18n/core.js';
import { SPAN_MAX, fitBytes } from '../i18n/fit.js';
import { useT } from '../i18n/index.js';
import { getGame } from '../state/catalog.js';
import { BUSY, COMPLETE } from '../state/download-queue.js';
import { downloadQueue } from '../state/downloads.js';
import { useNavActions } from '../state/nav.jsx';
import { Button2 } from '../ui/Button.jsx';
import { ButtonHints } from '../ui/ButtonHints.jsx';
import { Icon } from '../ui/Icon.jsx';
import { HINT } from '../ui/Legend.jsx';
import { colors } from '../ui/colors.js';
import { FocusScope, ScrollView, Text, View } from '@ps5-react/core';

  var LIST_HINTS = [
    HINT.select,
    { button: "square", label: "hints.pauseResume" },
    { button: "triangle", label: "hints.gamePage" },
    HINT.back
  ];
  var EMPTY_HINTS = [HINT.select, HINT.back];
  var EMPTY_KEY = "downloads:empty";
  function summary(jobs) {
    const count = (states) => jobs.filter((job2) => states.includes(job2.state)).length;
    return [
      [count(BUSY), "inProgress"],
      [count(["paused", "awaiting-browser"]), "paused"],
      [count(["failed"]), "failed"],
      [count(COMPLETE), "completed"]
    ].filter(([n]) => n > 0).map(([n, key]) => t(`downloads.summary.${key}`, { count: n })).join(" \xB7 ");
  }
  function Section({ title, jobs, first, handlers }) {
    const t2 = useT();
    if (!jobs.length) return null;
    return /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 18 }, children: [
      /* @__PURE__ */ (0, jsx)(Text, { style: { paddingHorizontal: 6, fontFamily: "Inter-Regular", fontSize: 20, fontWeight: 600, color: "#8a8a94", letterSpacing: 1 }, children: `${t2(title)}  ${formatNumber2(jobs.length)}` }),
      jobs.map(
        (job2) => /* @__PURE__ */ (0, jsx)(
          DownloadRow,
          {
            job: job2,
            game: getGame(job2.gameId) ?? { title: job2.title, art: {} },
            autoFocus: job2 === first,
            run: handlers.run,
            onOpenGame: handlers.openGame,
            onFocusRow: handlers.focusRow
          },
          job2.id
        )
      )
    ] });
  }
  function Empty({ error: error2, onBrowse }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 144 }, children: [
      /* @__PURE__ */ (0, jsx)(Icon, { name: "download", size: 32, color: colors.subtle }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { marginTop: 24, fontFamily: "Inter-Regular", fontSize: 27, fontWeight: 600, color: "#f2f2f3", lineHeight: 42 }, children: t2(error2 ? "downloads.unavailable" : "downloads.empty") }),
      /* @__PURE__ */ (0, jsx)(Text, { style: { marginTop: 6, width: 720, textAlign: "center", fontFamily: "Inter-Regular", fontSize: 24, color: "#a3a3ab", numberOfLines: 3, ellipsizeMode: "tail", lineHeight: 36 }, children: error2 || t2("downloads.emptyDetail") }),
      /* @__PURE__ */ (0, jsx)(View, { style: { marginTop: 36 }, children: /* @__PURE__ */ (0, jsx)(Button2, { variant: "outline", label: t2("downloads.browseGames"), focusKey: EMPTY_KEY, autoFocus: true, onPress: onBrowse }) })
    ] });
  }
  function DownloadsScreen({ onBack, onBrowse, onOpenGame }) {
    const t2 = useT();
    const { jobs, error: error2 } = useJobs();
    (0, useEffect)(() => {
      try {
        void downloadQueue().syncInstalls();
      } catch {
      }
    }, []);
    const [failure, setFailure] = (0, useState)("");
    const { focusLater } = useNavActions();
    const focused = (0, useRef)(null);
    const latest2 = (0, useRef)(jobs);
    latest2.current = jobs;
    const neighbor = (job2) => {
      const index = latest2.current.findIndex((item) => item.id === job2.id);
      const next = latest2.current[index + 1] ?? latest2.current[index - 1];
      return next ? primaryKey(next.id) : EMPTY_KEY;
    };
    const [handlers] = (0, useState)(() => ({
      run(job2, name) {
        setFailure("");
        const target = ["remove", "cancel"].includes(name) ? neighbor(job2) : null;
        try {
          void Promise.resolve(downloadQueue()[name](job2.id)).catch((caught) => setFailure(caught.message));
          if (target) focusLater(target);
        } catch (caught) {
          setFailure(caught.message);
        }
      },
      openGame: (job2) => {
        if (getGame(job2.gameId)) onOpenGame(job2.gameId, primaryKey(job2.id));
      },
      focusRow: (job2) => {
        focused.current = job2;
      }
    }));
    const back2 = () => {
      onBack();
      return true;
    };
    const onAction = (action) => {
      const job2 = focused.current && jobs.find((item) => item.id === focused.current.id);
      if (!job2) return false;
      if (action === "triangle") handlers.openGame(job2);
      else if (action === "square" && BUSY.includes(job2.state)) handlers.run(job2, "pause");
      else if (action === "square" && ["paused", "failed"].includes(job2.state)) handlers.run(job2, "resume");
      else
        return false;
      return true;
    };
    const placed = (job2) => job2.removingFrom ?? job2.state;
    const active2 = jobs.filter((job2) => BUSY.includes(placed(job2)));
    const stopped = jobs.filter((job2) => ["paused", "failed", "awaiting-browser"].includes(placed(job2)));
    const done = jobs.filter((job2) => COMPLETE.includes(placed(job2)));
    const first = active2[0] ?? stopped[0] ?? done[0];
    return /* @__PURE__ */ (0, jsx)(FocusScope, { autoFocus: true, onBack: back2, onAction, children: /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "flex-end", gap: 48, paddingHorizontal: 48, paddingTop: 48, paddingBottom: 36 }, children: [
        /* @__PURE__ */ (0, jsxs)(Text, { style: { width: 1356, fontFamily: "Inter-Regular", fontSize: 30, fontWeight: 600, color: "#f2f2f3", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 42, letterSpacing: -0.75 }, children: [
          fitBytes(t2("downloads.title"), SPAN_MAX),
          /* @__PURE__ */ (0, jsx)(Text, { style: { fontWeight: 400, color: "#8a8a94" }, children: jobs.length ? fitBytes(`  ${summary(jobs)}`, SPAN_MAX) : "" })
        ] }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { width: 420, fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", numberOfLines: 2, ellipsizeMode: "tail", lineHeight: 30 }, children: failure })
      ] }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, flexDirection: "row", gap: 48, paddingHorizontal: 48 }, children: [
        jobs.length > 0 ? /* @__PURE__ */ (0, jsx)(ScrollView, { style: { flex: 1 }, children: /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 60, paddingBottom: 60 }, children: [
          /* @__PURE__ */ (0, jsx)(Section, { title: "downloads.section.active", jobs: active2, first, handlers }),
          /* @__PURE__ */ (0, jsx)(Section, { title: "downloads.section.stopped", jobs: stopped, first, handlers }),
          /* @__PURE__ */ (0, jsx)(Section, { title: "downloads.section.completed", jobs: done, first, handlers })
        ] }) }) : /* @__PURE__ */ (0, jsx)(Empty, { error: error2, onBrowse }),
        /* @__PURE__ */ (0, jsx)(SummaryPanel, { error: error2, onFocus: () => {
          focused.current = null;
        } })
      ] }),
      /* @__PURE__ */ (0, jsx)(ButtonHints, { hints: jobs.length > 0 ? LIST_HINTS : EMPTY_HINTS })
    ] }) });
  }

export { DownloadsScreen };
