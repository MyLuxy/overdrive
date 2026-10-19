// ../pub-game-store/native/downloads/useQueue.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useState } from 'react';
import { createActivity } from './rates.js';
import { downloadQueue } from '../state/downloads.js';

  function subscribe2(listener) {
    try {
      return downloadQueue().subscribe(listener);
    } catch {
      return void 0;
    }
  }
  var shapeOf = (job2) => `${job2.id}|${job2.state}|${job2.phase || ""}|${job2.error}|${job2.message || ""}|${job2.total}`;
  var fractionOf = (progress) => progress?.total ? Math.min(1, progress.written / progress.total) : 0;
  function useJobs() {
    const [state, setState] = (0, useState)({ jobs: [], shape: "", error: "" });
    (0, useEffect)(() => {
      let last = "";
      try {
        return downloadQueue().subscribe((jobs) => {
          const shape = jobs.map(shapeOf).join("\n");
          if (shape === last) return;
          last = shape;
          setState({ jobs, shape, error: "" });
        });
      } catch (failure) {
        setState({ jobs: [], shape: "", error: failure.message });
        return void 0;
      }
    }, []);
    return state;
  }
  function useProgress(id) {
    const [progress, setProgress] = (0, useState)(null);
    (0, useEffect)(() => {
      let last = null;
      return subscribe2((jobs) => {
        const job2 = jobs.find((item) => item.id === id);
        if (!job2 || last && last.written === job2.written && last.total === job2.total && last.bytesPerSecond === (job2.bytesPerSecond || 0)) return;
        last = { written: job2.written, total: job2.total, bytesPerSecond: job2.bytesPerSecond || 0 };
        setProgress(last);
      });
    }, [id]);
    return progress;
  }
  function useActivity() {
    const [activity, setActivity] = (0, useState)({ speed: 0, left: 0, active: 0, connections: 0, peak: 0, low: 0, mean: 0, extracting: false, extractedFiles: 0 });
    (0, useEffect)(() => {
      const measure = createActivity();
      let shown = null;
      return subscribe2((jobs) => {
        const extracting = jobs.find((job2) => job2.state === "extracting");
        const next = { ...measure(jobs, Date.now()), extracting: Boolean(extracting), extractedFiles: extracting?.extractedFiles || 0 };
        if (shown && Object.keys(next).every((key) => shown[key] === next[key])) return;
        shown = next;
        setActivity(next);
      });
    }, []);
    return activity;
  }

export { fractionOf, shapeOf, subscribe2, useActivity, useJobs, useProgress };
