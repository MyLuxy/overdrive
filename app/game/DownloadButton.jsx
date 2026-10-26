// ../pub-game-store/native/game/DownloadButton.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { useEffect, useRef, useState } from 'react';
import { STALE_PARTIAL, cause, explainError } from '../downloads/errors.js';
import { WAITING, shownState } from '../downloads/labels.js';
import { Choice, TextAction } from './Choice.jsx';
import { DISABLED, DownloadLabel, statusLine } from './DownloadLabel.jsx';
import { MoreOptions, ProblemNote } from './DownloadProblem.jsx';
import { canDownload, spaceAdvice, spaceNeeded } from './releases.js';
import { isOverdriveCdn, preferredRelease } from './sources.js';
import { useDownload } from './useDownload.js';
import { useFreeSpace } from './useFreeSpace.js';
import { useShadowMount } from './useShadowMount.js';
import { formatPercent2 } from '../i18n/core.js';
import { useT } from '../i18n/index.js';
import { editionsOf } from '../state/catalog.js';
import { BUSY, COMPLETE } from '../state/download-queue.js';
import { downloadRoot, setDownloadRoot, storageIndex } from '../state/download-root.js';
import { downloadQueue, driveName, freeBytes, storageRoots } from '../state/downloads.js';
import { useNavActions } from '../state/nav.jsx';
import { formatBytes } from '../state/size.js';
import { MARGIN2 } from '../state/space.js';
import { FocusRing } from '../ui/FocusRing.jsx';
import { glide } from '../ui/ProgressBar.jsx';
import { ShimmerText } from '../ui/ShimmerText.jsx';
import { Shine } from '../ui/Shine.jsx';
import { EASE_OUT } from '../ui/ease.js';
import { pkgMode } from '../state/pkg-mode.js';
import { DownloadFormats, Platform, Text, View, motion } from '@ps5-react/core';

  var WIDTH6 = 272;
  var GB2 = 1e9;
  var STATUS = { fontFamily: "Inter-Regular", fontSize: 21, lineHeight: 30 };
  function DownloadButton({ game, start, onDownloaded, nextDown, onRequestDialog }) {
    const t2 = useT();
    const releases = game.releases || [];
    const [selected, setSelected] = (0, useState)(() => {
      let jobs = [];
      try {
        jobs = downloadQueue().snapshot().filter((job3) => job3.gameId === game.id);
      } catch {
      }
      const owned2 = jobs.map((job3) => releases.findIndex((release2) => release2.id === (job3.requestedId ?? job3.release.id))).find((index) => index >= 0);
      return owned2 ?? preferredRelease(releases);
    });
    const [roots] = (0, useState)(() => {
      try {
        return storageRoots();
      } catch {
        return ["/data"];
      }
    });
    const [storage, setStorage] = (0, useState)(() => {
      const first = releases[preferredRelease(releases)];
      // The drive picked last time (issue #103), unless it went away or has no room for this release.
      return storageIndex(roots, downloadRoot(), (root2) => {
        const need2 = spaceNeeded(first, root2);
        return !need2 || freeBytes(root2) >= need2 + MARGIN2;
      });
    });
    const release = releases[selected];
    const download = useDownload(game, release, roots[storage]);
    const { progress, restart, remove, deleteFromDisk, job: job2, error: error2 } = download;
    const free = useFreeSpace(roots, download.status, !job2);
    const need = spaceNeeded(release, roots[storage]);
    const lacking = download.status === "idle" && need && free[storage] !== null && free[storage] < need + MARGIN2;
    const stale = ["paused", "failed"].includes(download.status) && STALE_PARTIAL.test(cause(error2));
    // A PKG the PS5's Downloads took is theirs to install: "Installed" here said what had not happened.
    const streamedOut = job2?.state === "installed" && job2.streamed;
    const status = lacking ? "no-space" : stale ? "stale" : streamedOut ? "streamed" : download.status;
    // A new download first shows what the chosen source is and how to use it (DownloadTipsDialog);
    // resuming, installing or pausing one already queued goes straight on.
    // A PKG goes to the PS5's own Downloads, in the background, or stays in Overdrive: the player says
    // which before it starts, or once for every PKG (pkg-mode.js). A file that may turn out to be a PKG
    // (a ".binary") follows what was remembered, and tries the console first otherwise.
    const startNew = () => {
      const mode = pkgMode();
      const pkg = Platform.OS === "ps5" && ["pkg", "fpkg"].includes(String(release?.format || "").toLowerCase()) && !release?.parts;
      if (pkg && mode === "ask") onRequestDialog({ kind: "stream", game, release, submit: (choice) => download.advance(choice) });
      else download.advance(mode === "overdrive" ? "here" : mode === "console" ? "console" : void 0);
    };
    const begin = () => {
      if (stale) restart();
      else if (lacking) return;
      // A homebrew app has one source, its developer's GitHub release: the tips are about choosing hosts.
      else if (status === "idle" && release && !game.homebrew) onRequestDialog({ kind: "tips", game, release, submit: startNew, changeSource: () => chooseSource() });
      else if (status === "idle") startNew();
      else download.advance();
    };
    const { openEdition, focusLater, push } = useNavActions();
    const editions = editionsOf(game);
    const advance = () => {
      if (status !== "idle" || editions.length < 2) {
        begin();
        return;
      }
      onRequestDialog({
        kind: "version",
        title: game.title,
        editions,
        current: game.id,
        submit: (edition2) => {
          if (edition2.id === game.id) begin();
          else openEdition(edition2.id, true);
        }
      });
    };
    const latest2 = (0, useRef)(null);
    latest2.current = { status, begin };
    (0, useEffect)(() => {
      if (!start) return void 0;
      const id = setTimeout(() => {
        if (latest2.current.status === "idle") latest2.current.begin();
      }, 0);
      return () => clearTimeout(id);
    }, []);
    const shadowMount = useShadowMount(DownloadFormats.images.includes(release?.format));
    const browser = status === "awaiting-browser";
    const step = job2?.parts ? { part: job2.partIndex + 1, parts: job2.parts.length } : null;
    const requestFile = () => onRequestDialog({
      title: step ? t2("download.partFileLink", step) : t2("download.fileLink"),
      detail: t2("download.fileLinkDetail"),
      submit: (url) => downloadQueue().continueWithURL(job2.id, url)
    });
    const written = (job2?.parts?.[job2.partIndex]?.written ?? job2?.written) > 0;
    const recoverable = ["paused", "failed", "stale"].includes(status) || browser;
    const choosing = !job2 || browser && !written;
    const sizeGb = job2?.total ? job2.total / GB2 : release?.sizeBytes ? release.sizeBytes / GB2 : game.sizeGb;
    const inProgress = BUSY.includes(status) || status === "paused";
    const sizeless = inProgress && !job2?.total;
    const amount = sizeless ? formatBytes(job2?.written || 0) : formatPercent2(Math.round(progress * 100));
    const shown = job2 && shownState(job2) === "finishing" ? "finishing" : status;
    const [state, line] = statusLine(stale ? download.status : shown, progress, sizeGb);
    const detail2 = sizeless ? t2("download.soFar", { size: formatBytes(job2?.written || 0) }) : line;
    const problem = browser ? {
      title: step ? t2("download.browser.partTitle", step) : t2("download.browser.title"),
      action: t2("download.browser.action")
    } : error2 ? explainError(error2, Boolean(job2?.release.parts)) : lacking ? { title: t2("download.noFit"), action: spaceAdvice(roots, free, storage, need) } : shadowMount || status === "installed" || status === "streamed" ? null : { title: t2("shadowMount.offTitle"), action: t2("shadowMount.offAction") };
    const notice = job2?.message;
    const pick2 = (index) => {
      if (index !== selected && job2 && !written && ["awaiting-browser", "failed", "paused"].includes(job2.state)) downloadQueue().remove(job2.id);
      setSelected(index);
    };
    const chooseSource = (from) => onRequestDialog({
      kind: "source",
      title: game.title,
      releases,
      selected,
      submit: pick2,
      from,
      editions,
      current: game.id,
      onEdition: (id) => openEdition(id)
    });
    const saved = job2?.written ? formatBytes(job2.written) : null;
    const removal = { icon: "x", label: t2("download.remove.label"), detail: t2("download.remove.detail"), onSelect: remove };
    const deletion = job2 && {
      icon: "trash",
      label: t2("hints.delete"),
      detail: job2.artifact.destination,
      onSelect: deleteFromDisk,
      armed: { label: t2("hints.confirmDelete"), detail: t2("files.confirmDelete", { size: formatBytes(job2.total || 0) }) }
    };
    const options = COMPLETE.includes(status) ? [removal, deletion] : recoverable ? [
      stale ? null : {
        icon: "restart",
        label: t2("download.restart.label"),
        detail: saved ? t2("download.restart.detailSaved", { size: saved }) : t2("download.restart.detail"),
        onSelect: restart
      },
      removal,
      releases.length > 1 ? {
        icon: "list",
        label: t2("download.otherSource.label"),
        detail: t2("download.otherSource.detail"),
        onSelect: () => chooseSource(),
        next: true
      } : null
    ].filter(Boolean) : [];
    const openOptions = () => onRequestDialog({ kind: "options", title: game.title, items: options });
    const [pulse3, setPulse] = (0, useState)(false);
    const hidden = (1 - progress) * WIDTH6;
    const sourceFocus = `download-source:${game.id}`;
    const storageFocus = `download-storage:${game.id}`;
    const moreFocus = `download-more:${game.id}`;
    const browserFocus = `download-continue:${game.id}`;
    const queueFocus = `download-queue:${game.id}`;
    const mainFocus = `download:${game.id}`;
    const disabled = DISABLED.includes(status);
    const sourceChoice = releases.length > 1 || editions.length > 1;
    const chain = [
      mainFocus,
      choosing && release && sourceChoice && sourceFocus,
      !job2 && roots.length > 1 && storageFocus,
      browser && browserFocus,
      job2 && queueFocus,
      options.length > 0 && moreFocus
    ].filter(Boolean);
    const after = (key) => chain[chain.indexOf(key) + 1] ?? nextDown;
    (0, useEffect)(() => {
      if (canDownload(game) && disabled) focusLater(`favorite:${game.id}`);
    }, []);
    (0, useEffect)(() => {
      if (!COMPLETE.includes(status)) return;
      setPulse(true);
      onDownloaded();
    }, [status]);
    return /* @__PURE__ */ (0, jsxs)(View, { style: { width: 408, gap: 12 }, children: [
      /* @__PURE__ */ (0, jsxs)(View, { onPress: advance, autoFocus: canDownload(game) && !disabled, focusKey: mainFocus, nextFocusDown: after(mainFocus), style: (_state) => [
        { position: "relative", height: 72, width: 408, borderRadius: 9 },
        disabled ? { borderWidth: 2, borderColor: "#2a2a2f" } : inProgress ? { backgroundColor: "#212125" } : [{ backgroundColor: "#f2f2f3" }, _state.focused ? { backgroundColor: "#fff" } : null]
      ], children: [
        /* @__PURE__ */ (0, jsxs)(
          motion.View,
          {
            style: { overflow: "hidden", borderRadius: 9 },
            initial: false,
            animate: { scale: pulse3 ? 1.035 : 1 },
            transition: { duration: 0.225, ease: EASE_OUT },
            onAnimationComplete: () => setPulse(false),
            children: [
              /* @__PURE__ */ (0, jsx)(DownloadLabel, { status: shown, amount, dark: !inProgress && !disabled }),
              inProgress && /* @__PURE__ */ (0, jsx)(
                motion.View,
                {
                  style: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, overflow: "hidden", backgroundColor: "#f2f2f3" },
                  initial: { x: -WIDTH6 },
                  animate: { x: -hidden },
                  transition: glide,
                  children: /* @__PURE__ */ (0, jsx)(motion.View, { initial: { x: WIDTH6 }, animate: { x: hidden }, transition: glide, children: /* @__PURE__ */ (0, jsx)(DownloadLabel, { status: shown, amount, dark: true }) })
                }
              ),
              /* @__PURE__ */ (0, jsx)(Shine, { width: WIDTH6 })
            ]
          }
        ),
        /* @__PURE__ */ (0, jsx)(FocusRing, {})
      ] }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", justifyContent: "space-between" }, children: [
        WAITING.includes(shown) ? /* @__PURE__ */ (0, jsx)(ShimmerText, { textStyle: STATUS, children: state }) : /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: state }),
        detail2 ? /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, color: "#8a8a94", lineHeight: 30 }, children: detail2 }) : null
      ] }),
      problem ? /* @__PURE__ */ (0, jsx)(ProblemNote, { title: problem.title, action: problem.action }) : // The notice is up to four lines in this 408px column: an install request in the longer locales
      // needs more than three, and the engine cuts anything past the last line with "…" (2026-10-26).
      notice ? /* @__PURE__ */ (0, jsx)(Text, { style: { width: 408, fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", numberOfLines: 4, ellipsizeMode: "tail", lineHeight: 30 }, children: notice.slice(0, 160) }) : null,
      choosing && release ? /* @__PURE__ */ (0, jsx)(
        Choice,
        {
          focusKey: sourceFocus,
          nextFocusDown: after(sourceFocus),
          onPress: sourceChoice ? () => chooseSource(sourceFocus) : null,
          magic: isOverdriveCdn(release.provider) ? {
            name: release.provider,
            detail: [t2("sources.cdnFastest"), release.sizeBytes && formatBytes(release.sizeBytes)].filter(Boolean).join(" \xB7 ")
          } : null,
          text: [t2("download.source", { source: release.provider }), release.sizeBytes && formatBytes(release.sizeBytes)].filter(Boolean).join(" \xB7 ")
        }
      ) : null,
      !job2 ? /* @__PURE__ */ (0, jsx)(
        Choice,
        {
          focusKey: storageFocus,
          nextFocusDown: after(storageFocus),
          onPress: roots.length > 1 ? () => {
            // Picking a drive here picks it for the games after this one too (issue #103).
            const next = (storage + 1) % roots.length;
            setDownloadRoot(roots[next]);
            setStorage(next);
          } : null,
          text: [t2("download.saveTo", { drive: driveName(roots[storage]) }), free[storage] !== null && t2("download.free", { size: formatBytes(free[storage]) })].filter(Boolean).join(" \xB7 ")
        }
      ) : null,
      browser ? /* @__PURE__ */ (0, jsx)(
        TextAction,
        {
          focusKey: browserFocus,
          nextFocusDown: after(browserFocus),
          onPress: requestFile,
          text: step ? t2("download.enterPartLink", step) : t2("download.enterLink")
        }
      ) : null,
      job2 ? /* @__PURE__ */ (0, jsx)(
        TextAction,
        {
          focusKey: queueFocus,
          nextFocusDown: after(queueFocus),
          text: t2("download.openQueue"),
          onPress: () => push({ name: "downloads" }, queueFocus)
        }
      ) : null,
      options.length ? /* @__PURE__ */ (0, jsx)(MoreOptions, { focusKey: moreFocus, nextFocusDown: nextDown, onPress: openOptions }) : null
    ] });
  }

export { DownloadButton };
