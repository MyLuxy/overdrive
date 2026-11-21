// ../pub-game-store/native/game/useDownload.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useRef, useState } from 'react';
import { fractionOf } from '../downloads/useQueue.js';
import { BUSY } from '../state/download-queue.js';
import { downloadQueue } from '../state/downloads.js';
import { sameRelease } from '../state/release-sets.js';

  function useDownload(game, release, root2) {
    const matching = (jobs) => jobs.find((item) => item.gameId === game.id && release && ((item.requestedId ?? item.release.id) === release.id || sameRelease(item.release, release))) || null;
    const [job2, setJob] = (0, useState)(() => {
      try {
        return matching(downloadQueue().snapshot());
      } catch {
        return null;
      }
    });
    const [error2, setError] = (0, useState)("");
    const started = (0, useRef)(false);
    (0, useEffect)(() => {
      setError("");
      try {
        return downloadQueue().subscribe((jobs) => setJob(matching(jobs)));
      } catch (failure) {
        setError(failure.message);
        return void 0;
      }
    }, [game.id, release?.id]);
    (0, useEffect)(() => {
      try {
        if (job2?.state === "downloaded") void downloadQueue().syncInstalls(job2.id);
      } catch {
      }
    }, [job2?.id]);
    // `streamMode` for a new download: "console" or "here" (pkg-mode.js), none to try the console first.
    const advance = (streamMode) => {
      try {
        setError("");
        const queue = downloadQueue();
        if (!job2) {
          if (release) {
            started.current = true;
            queue.enqueue(game, release, root2, { streamMode });
          }
        } else if (BUSY.includes(job2.state) && job2.state !== "pausing" && job2.state !== "installing") queue.pause(job2.id);
        else if (job2.state === "installer-required") queue.install(job2.id);
        else if (job2.state === "paused" || job2.state === "failed") {
          started.current = true;
          queue.resume(job2.id);
        } else if (job2.state === "awaiting-browser") queue.openBrowser(job2.id);
        else if (job2.state === "downloaded") void queue.register(job2.id).catch((failure) => setError(failure.message));
      } catch (failure) {
        setError(failure.message);
      }
    };
    (0, useEffect)(() => {
      if (!started.current || !job2) return;
      if (job2.state === "awaiting-browser") {
        started.current = false;
        try {
          downloadQueue().openBrowser(job2.id);
        } catch (failure) {
          setError(failure.message);
        }
      } else if (!["queued", "resolving", "connecting"].includes(job2.state)) started.current = false;
    }, [job2?.state]);
    const status = job2?.state || (release ? "idle" : "unavailable");
    const action = (name) => {
      try {
        setError("");
        if (job2) void Promise.resolve(downloadQueue()[name](job2.id)).catch((failure) => setError(failure.message));
      } catch (failure) {
        setError(failure.message);
      }
    };
    const deleteFromDisk = () => {
      setError("");
      void downloadQueue().deleteFromDisk(job2.id).catch((failure) => setError(failure.message));
    };
    return {
      status,
      progress: fractionOf(job2),
      advance,
      restart: () => action("restart"),
      remove: () => action("remove"),
      deleteFromDisk,
      job: job2,
      error: error2 || job2?.error || ""
    };
  }

export { useDownload };
