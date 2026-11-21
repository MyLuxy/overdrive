// ../pub-game-store/native/files/useFiles.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useMemo, useState } from 'react';
import { deletionTargets, scanDrive } from './scan.js';
import { getGame } from '../state/catalog.js';
import { deletesPackages } from '../state/package-cleanup.js';
import { COMPLETE } from '../state/download-queue.js';
import { downloadQueue, shadowMountUp } from '../state/downloads.js';
import { mountedImages, shadowRequest } from '../state/shadowmount.js';
import { FileSystem, Http, Packages, Platform } from '@ps5-react/core';

  function installedTitles() {
    try {
      return new Set(FileSystem.readDir("/user/app").map((entry2) => entry2.name));
    } catch {
      return /* @__PURE__ */ new Set();
    }
  }
  var owned = (job2) => [job2.artifact?.destination, job2.downloadDestination, job2.output, ...job2.packages ?? []];
  function finishedJobs(path) {
    try {
      const queue = downloadQueue();
      return { queue, jobs: queue.snapshot().filter((job2) => COMPLETE.includes(job2.state) && owned(job2).includes(path)) };
    } catch {
      return { queue: null, jobs: [] };
    }
  }
  async function checkUnmounted(file, root2) {
    if (Platform.OS !== "ps5" || file.kind !== "images") return;
    let mounted;
    try {
      mounted = await mountedImages((route, body) => shadowRequest(Http, route, body), deletionTargets(file), root2);
    } catch (error2) {
      throw new Error(`ShadowMount could not say whether it is mounted, so it was kept: ${error2.message}`);
    }
    console.log(`[files] ${file.path}: ${mounted === null ? "ShadowMount is not running, so it is not mounted" : mounted.length ? `still mounted (${mounted.map((image) => image.path).join(", ")})` : "not mounted"}`);
    if (mounted?.length) throw new Error("ShadowMount still has it mounted, so it was kept. Close any game and try again.");
  }
  function useFiles(root2) {
    const [version2, setVersion] = (0, useState)(0);
    const rescan = () => setVersion((value) => value + 1);
    const files = (0, useMemo)(() => {
      const installed = installedTitles();
      return scanDrive(FileSystem, root2).map((file) => ({
        ...file,
        game: file.titleId ? getGame(file.titleId) ?? null : null,
        installed: Boolean(file.titleId && installed.has(file.titleId))
      }));
    }, [root2, version2]);
    const [installing, setInstalling] = (0, useState)(null);
    const [shadowMount, setShadowMount] = (0, useState)(true);
    (0, useEffect)(() => {
      let live = true;
      void shadowMountUp().then((up) => {
        if (live) setShadowMount(up);
      });
      return () => {
        live = false;
      };
    }, [version2]);
    const install = (file) => {
      if (installing && !installing.done && !installing.error) return;
      let task;
      try {
        task = Packages.install({ path: file.path, name: file.game?.title ?? file.name });
      } catch (error2) {
        setInstalling({ path: file.path, fraction: 0, error: error2.message });
        return;
      }
      setInstalling({ path: file.path, fraction: 0 });
      task.subscribe((progress) => setInstalling((state) => state?.path === file.path ? { ...state, fraction: progress.total ? progress.written / progress.total : 0 } : state));
      task.done.then(
        async () => {
          setInstalling((state) => ({ ...state, fraction: 1, done: true }));
          try {
            downloadQueue().packageInstalled(file.path);
          } catch {
          }
          // The installed PKG goes when settings ask it, as after an install from the queue.
          if (deletesPackages()) {
            try {
              await Promise.all([file.path, `${file.path}.complete`].map((path) => FileSystem.removeAsync(path)));
              console.log(`[files] ${file.path}: installed, so deleted`);
            } catch (error2) {
              console.log(`[files] ${file.path}: installed, but not deleted: ${error2.message}`);
            }
          }
          rescan();
        },
        (error2) => setInstalling((state) => ({ ...state, error: error2.message }))
      );
    };
    const remove = async (file) => {
      const { queue, jobs } = finishedJobs(file.path);
      const image = jobs.find((job2) => job2.artifact.nextAction === "shadowmount");
      if (image) {
        await queue.deleteFromDisk(image.id);
        rescan();
        return;
      }
      await checkUnmounted(file, root2);
      for (const path of deletionTargets(file)) {
        if (!FileSystem.exists(path)) continue;
        try {
          await FileSystem.removeAsync(path);
        } catch (error2) {
          console.log(`[files] ${path} not deleted: ${error2.message}`);
          throw error2;
        }
        console.log(`[files] deleted ${path}`);
      }
      for (const job2 of jobs) queue.remove(job2.id);
      rescan();
    };
    return { files, installing, install, remove, rescan, shadowMount };
  }

export { useFiles };
