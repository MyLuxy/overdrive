// ../pub-game-store/native/downloads/DownloadRow.jsx
// reconstructed from the esbuild bundle in eboot.bin
// MODIFIED: game page info button; title/meta columns rebalanced so the meta still ends on the row's right edge.

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { memo, useEffect, useState } from 'react';
import { RowProgress, ROW } from './RowProgress.jsx';
import { StatsStrip } from './StatsStrip.jsx';
import { STALE_PARTIAL, cause, explainError } from './errors.js';
import { WAITING, clearAction, shownState, stateLabel } from './labels.js';
import { shapeOf } from './useQueue.js';
import { isOverdriveCdn } from '../game/sources.js';
import { focusEnd, useLocale, useT } from '../i18n/index.js';
import { getGame } from '../state/catalog.js';
import { BUSY, COMPLETE } from '../state/download-queue.js';
import { Button2 } from '../ui/Button.jsx';
import { CdnAura, CdnSpark } from '../ui/CdnAura.jsx';
import { Cover } from '../ui/Cover.jsx';
import { px } from '../ui/scale.js';
import { Text, View } from '@ps5-react/core';

  var THUMB2 = { width: px(54), height: px(72), borderRadius: px(4) };
  var PRIMARY = { width: 198 };
  var ARM_MS = 3e3;
  var primaryKey = (id) => `downloads:${id}`;
  // A source the catalog lists without a format (FileKeeper's, mostly) showed "BINARY" until the file
  // was done. Its kind is known long before: from the header the queue reads in the first megabytes, or
  // from the name the host gave the file.
  var FILE_KIND = /\.(exfat|ffpfsc|ffpfs|ffpkg|fpkg|pkg|rar|7z|zip)$/i;
  function shownFormat(job2, release) {
    const format = job2.artifact.format || release.format;
    if (format && format !== "binary") return format;
    return job2.inspected || FILE_KIND.exec(job2.fileName || "")?.[1] || format || "binary";
  }
  function primary({ state, error: error2 }, run, openGame) {
    if (state === "pausing") return { icon: "pause", label: "downloads.action.pausing", onPress: () => {
    } };
    if (BUSY.includes(state)) return { icon: "pause", label: "downloads.action.pause", onPress: () => run("pause") };
    if (["paused", "failed"].includes(state) && STALE_PARTIAL.test(cause(error2))) return { icon: "download", label: "downloads.action.restart", onPress: () => run("restart") };
    if (state === "paused") return { icon: "play", label: "downloads.action.resume", onPress: () => run("resume") };
    if (state === "failed") return { icon: "download", label: "downloads.action.retry", onPress: () => run("resume") };
    if (state === "awaiting-browser") return { icon: "play", label: "downloads.action.continueOnPage", onPress: openGame };
    if (state === "downloaded") return { icon: "circleCheck", label: "downloads.action.install", onPress: () => run("register") };
    return { icon: "chevronRight", label: "downloads.action.gamePage", onPress: openGame };
  }
  function DeleteButton({ id, action, run, onFocus }) {
    const { rtl } = useLocale();
    const [armed, setArmed] = (0, useState)(false);
    (0, useEffect)(() => {
      if (!armed) return void 0;
      const timer = setTimeout(() => setArmed(false), ARM_MS);
      return () => clearTimeout(timer);
    }, [armed]);
    return /* @__PURE__ */ (0, jsx)(
      Button2,
      {
        variant: armed ? "primary" : "secondary",
        size: "icon",
        icon: armed ? "delete" : "x",
        focusKey: `downloads-cancel:${id}`,
        // The summary is display-only; horizontal focus must stop at the action column.
        ...focusEnd(rtl, `downloads-cancel:${id}`),
        onFocus,
        onBlur: () => setArmed(false),
        onPress: () => {
          if (action === "remove") {
            run(action);
            return;
          }
          setArmed(!armed);
          if (armed) run(action);
        }
      }
    );
  }
  function InfoButton({ id, onPress, onFocus }) {
    return /* @__PURE__ */ (0, jsx)(
      Button2,
      {
        variant: "secondary",
        size: "icon",
        icon: "info",
        focusKey: `downloads-info:${id}`,
        onFocus,
        onPress
      }
    );
  }
  function DownloadRowView({ job: job2, game, autoFocus, run, onOpenGame, onFocusRow }) {
    const t2 = useT();
    const { state, release } = job2;
    const shown = shownState(job2);
    const complete = COMPLETE.includes(state);
    const openGame = () => onOpenGame(job2);
    const main = primary(job2, (name) => run(job2, name), openGame);
    // A job outside the catalog has no page to open, and a primary button that already leads there
    // (continue on page) needs no second one; the triangle shortcut opens it either way.
    const infoPage = !getGame(job2.gameId) || main.onPress === openGame ? null : () => openGame();
    const onFocus = () => onFocusRow(job2);
    const meta = [shownFormat(job2, release).toUpperCase(), `${release.provider} ${release.version || ""}`.trim(), job2.root].join(" \xB7 ");
    const problem = job2.error && explainError(job2.error, Boolean(release.parts));
    // The files' own title id differs from the game chosen: said before anything else but an error.
    const mismatch = job2.titleMismatch ? t2("downloads.titleMismatch", { found: job2.titleMismatch, expected: job2.titleId }) : "";
    const note = problem ? problem.action ? t2("downloads.problem", { title: problem.title, action: problem.action }) : problem.title : mismatch || (state === "downloaded" ? job2.message || t2("downloads.installHint") : state === "extracted" || job2.streamed ? job2.message || "" : "");
    const cdn = isOverdriveCdn(release.provider);
    return /* @__PURE__ */ (0, jsxs)(View, { style: cdn ? { position: "relative", borderRadius: 18, backgroundColor: "#17171a" } : { overflow: "hidden", borderRadius: 18, borderWidth: 2, borderColor: "#2a2a2f", backgroundColor: "#17171a" }, children: [
      cdn ? /* @__PURE__ */ (0, jsx)(CdnAura, { radius: 12, width: 904 }) : null,
      /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", alignItems: "center", gap: 30, paddingHorizontal: 30, paddingVertical: 24 }, children: [
        /* @__PURE__ */ (0, jsx)(Cover, { game, label: false, style: THUMB2 }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flex: 1, gap: 15 }, children: [
          /* @__PURE__ */ (0, jsxs)(View, { style: { width: ROW, flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }, children: [
            /* @__PURE__ */ (0, jsx)(Text, { style: { width: 505, fontFamily: "Inter-Regular", fontSize: 27, fontWeight: 600, color: "#f2f2f3", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 42, letterSpacing: -0.68 }, children: job2.title }),
            /* @__PURE__ */ (0, jsxs)(View, { style: { width: 315, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 9 }, children: [
              cdn ? /* @__PURE__ */ (0, jsx)(CdnSpark, { size: 13 }) : null,
              /* @__PURE__ */ (0, jsx)(Text, { style: cdn ? { maxWidth: 285, fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30 } : { width: 315, textAlign: "end", fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30 }, children: meta })
            ] })
          ] }),
          /* @__PURE__ */ (0, jsx)(
            RowProgress,
            {
              id: job2.id,
              label: stateLabel(shown),
              moving: BUSY.includes(state) && state !== "pausing",
              // An extraction past its size estimate has no total left to fill: the label shimmers instead.
              waiting: WAITING.includes(shown) || (shown === "extracting" && !job2.total),
              open: shown === "extracting" && !job2.total,
              complete,
              detail: shown === "finishing" ? t2("downloads.writingToDisk") : null
            }
          ),
          note ? /* @__PURE__ */ (0, jsx)(Text, { style: { width: ROW, fontFamily: "Inter-Regular", fontSize: 21, color: problem ? "#f2f2f3" : mismatch ? "#fde68a" : "#a3a3ab", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30 }, children: note }) : null
        ] }),
        /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", gap: 12 }, children: [
          infoPage ? /* @__PURE__ */ (0, jsx)(InfoButton, { id: job2.id, onPress: infoPage, onFocus }) : null,
          /* @__PURE__ */ (0, jsx)(
            Button2,
            {
              variant: "secondary",
              icon: main.icon,
              label: t2(main.label),
              style: PRIMARY,
              autoFocus,
              focusKey: primaryKey(job2.id),
              onFocus,
              onPress: main.onPress
            }
          ),
          /* @__PURE__ */ (0, jsx)(
            DeleteButton,
            {
              id: job2.id,
              action: clearAction(state),
              run: (name) => run(job2, name),
              onFocus
            }
          )
        ] })
      ] }),
      state === "downloading" ? /* @__PURE__ */ (0, jsx)(StatsStrip, { id: job2.id }) : null
    ] });
  }
  var DownloadRow = (0, memo)(
    DownloadRowView,
    (a, b) => shapeOf(a.job) === shapeOf(b.job) && a.autoFocus === b.autoFocus
  );

export { DownloadRow, primaryKey };
