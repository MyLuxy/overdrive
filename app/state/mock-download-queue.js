// ../pub-game-store/native/state/mock-download-queue.js
// reconstructed from the esbuild bundle in eboot.bin

import { games } from '../data/catalog.js';
import { preferredRelease } from '../game/sources.js';

  var GB = 1024 ** 3;
  var artifact = { destination: "/data/homebrew/mock.ffpfsc", nextAction: "shadowmount" };
  function job(game, state, written, total, extra = {}) {
    const release = { ...game.releases[preferredRelease(game.releases)], provider: "Archive.org" };
    return {
      id: `${game.id}/mock`,
      gameId: game.id,
      titleId: game.id,
      title: game.title,
      release,
      root: "/data",
      artifact,
      state,
      written,
      received: written,
      total,
      bytesPerSecond: 0,
      connections: 0,
      error: "",
      message: "",
      ...extra
    };
  }
  function createMockDownloadQueue() {
    const [a, b, c, d, e] = games.filter((game) => game.art.cover && game.releases?.length);
    let jobs = [
      job(a, "downloading", 2.1 * GB, 11.8 * GB),
      job(e, "connecting", 0, 9.6 * GB),
      job(b, "paused", 1.6 * GB, 5.4 * GB, { error: "Stopped when the app closed (interrupted)" }),
      job(c, "failed", 0.8 * GB, 3.2 * GB, { error: "partial file has no matching durable checkpoint" }),
      job(d, "downloaded", 7.3 * GB, 7.3 * GB)
    ];
    const listeners4 = /* @__PURE__ */ new Set();
    const emit2 = () => {
      for (const listener of listeners4) listener(jobs);
    };
    const update = (id, change) => {
      jobs = jobs.map((item) => item.id === id ? { ...item, ...change } : item);
      emit2();
    };
    setInterval(() => {
      jobs = jobs.map((item) => {
        if (item.state !== "downloading") return item;
        const speed = (34 + Math.random() * 12) * 1024 ** 2;
        const written = Math.min(item.total, item.written + speed / 4);
        return {
          ...item,
          written,
          received: written + 2 * 1024 ** 2,
          bytesPerSecond: speed,
          connections: 14 + Math.floor(Math.random() * 3),
          state: written === item.total ? "downloaded" : "downloading"
        };
      });
      emit2();
    }, 250);
    return {
      snapshot: () => jobs,
      subscribe(listener) {
        listeners4.add(listener);
        listener(jobs);
        return () => listeners4.delete(listener);
      },
      enqueue: () => {
      },
      pause: (id) => update(id, { state: "paused", bytesPerSecond: 0, connections: 0 }),
      resume: (id) => update(id, { state: "downloading", error: "" }),
      restart: (id) => update(id, { state: "downloading", written: 0, received: 0, error: "" }),
      register: (id) => update(id, { message: "Install requested. Close Overdrive to finish: ShadowMount installs once no game is open." }),
      remove: (id) => {
        jobs = jobs.filter((item) => item.id !== id);
        emit2();
      },
      cancel(id) {
        this.remove(id);
      },
      async deleteFromDisk(id) {
        this.remove(id);
      },
      syncInstalls: async () => false,
      get awake() {
        return jobs.some((item) => item.state === "downloading");
      }
    };
  }

export { createMockDownloadQueue };
