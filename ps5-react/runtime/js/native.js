// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// React Native-style modules over the host contract in native/shared/host_api.hpp.
// Every call is synchronous and runs on the render thread; see docs/NATIVE-API.md.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {gamepadSource} from './controller-events.js';
import {normalizeDownloadManifest} from './download-formats.js';
import {onFrameUnbatched} from './frame.js';

function host() {
  const api = globalThis.__ps5ReactNative;
  if (!api) {
    throw new Error('Native modules need a PS5 React host (globalThis.__ps5ReactNative is missing); '
      + 'run the app with npm run dev, npm run preview, or a PS5 build');
  }
  return api;
}

/**
 * @typedef {{name: string, isDirectory: boolean, isFile: boolean, size: number, modified: number}} FileStat
 *   `modified` is milliseconds since the Unix epoch.
 * @typedef {{device: string, path: string, type: string}} Mount
 * @typedef {{id: number, name: string}} User
 * @typedef {{model: string | null, firmware: string | null, cpuTemperature: number | null,
 *   socTemperature: number | null, cpuFrequency: number | null, freeMemory: number | null,
 *   processTime: number | null, language: string | null}} Device
 *   Temperatures in °C, frequency in Hz, memory in bytes, process time in µs; language is the
 *   system language as a BCP 47 tag ('en-US', 'pt-BR', 'zh-Hans').
 * @typedef {'up' | 'down' | 'left' | 'right' | 'cross' | 'circle' | 'triangle' | 'square' | 'l1' | 'r1'
 *   | 'l2' | 'r2' | 'l3' | 'r3' | 'options' | 'touchpad'} Button
 * @typedef {{connected: boolean, leftX: number, leftY: number, rightX: number, rightY: number,
 *   l2: number, r2: number, buttons: Button[]}} GamepadState
 *   Sticks are -1..1 with the deadzone applied; triggers are 0..1.
 */

export const Platform = {
  /** @returns {'ps5' | 'desktop'} */
  get OS() { return host().platform; },
  /**
   * @template T
   * @param {{ps5?: T, desktop?: T, default?: T}} spec
   * @returns {T | undefined}
   */
  select(spec) {
    const os = host().platform;
    return os in spec ? spec[os] : spec.default;
  },
};

export const DeviceInfo = {
  /** @returns {Device} */
  get: () => host().device.info(),
  /**
   * Minutes east of UTC in the system time zone at `time` (default now), summer time included:
   * the local clock reads `time + utcOffset(time) * 60000` as UTC.
   * @param {number} [time] milliseconds since the epoch @returns {number}
   */
  utcOffset: (time = Date.now()) => host().device.utcOffset(time),
};

// The title is sandboxed: paths are app paths such as /app0 (read-only) and /download0.
export const FileSystem = {
  appDir: '/app0',
  dataDir: '/download0',
  tempDir: '/temp0',
  /** @param {string} path @returns {FileStat[]} */
  readDir: path => host().fs.readDir(path),
  /** @param {string} path @returns {FileStat | null} */
  // device/inode remain strings to preserve native 64-bit filesystem identities.
  stat: path => host().fs.stat(path),
  /** @param {string} path @returns {boolean} */
  exists: path => host().fs.stat(path) !== null,
  /** UTF-8, at most 8 MiB. @param {string} path @returns {string} */
  readFile: path => host().fs.readFile(path),
  /** `sync` waits until the text is on the disk, for a file saved then renamed into place.
   * @param {string} path @param {string} text @param {{sync?: boolean}} [options] */
  writeFile: (path, text, {sync = false} = {}) => host().fs.writeFile(path, text, false, sync),
  /** @param {string} path @param {string} text */
  appendFile: (path, text) => host().fs.writeFile(path, text, true),
  /** @param {string} path @param {{recursive?: boolean}} [options] */
  mkdir: (path, {recursive = false} = {}) => host().fs.mkdir(path, recursive),
  /** Removes a file or an empty directory. @param {string} path */
  remove: path => host().fs.remove(path),
  /** Removes a file, or a directory with everything in it, without following symbolic links.
   * Synchronous: meant for small app-owned trees. @param {string} path */
  removeTree: path => host().fs.removeTree(path),
  /** Removes as `removeTree` does, on a worker thread, in the order asked. Resolves once the path is
   * gone, or if it never existed; rejects with an Error naming the path and the system error.
   * @param {string} path @returns {Promise<void>} */
  removeAsync: async path => { await networkTask(host().fs.removeAsync(path), 'fs.removeAsync', path, 'removals').done; },
  /** @param {string} from @param {string} to */
  rename: (from, to) => host().fs.rename(from, to),
  /** Copies a file's bytes (readFile and writeFile carry text only), written beside `to` and renamed
   * over it. @param {string} from @param {string} to */
  copyFile: (from, to) => host().fs.copyFile(from, to),
  /** Sets a file's or directory's permission bits, such as 0o777. */
  chmod: (path, mode) => host().fs.chmod(path, mode),
  /** Mounted filesystems visible to the host process. Console access requires
   * filesystemAccess: "console" in app.json. @returns {Mount[]} */
  mounts: () => host().fs.mounts(),
  /** Filesystem bytes; free is available to the app, clamped to 0..total.
   * @param {string} path @returns {{total: number, free: number}} */
  diskUsage: path => host().fs.diskUsage(path),
};

export const Notifications = {
  /** @param {string} message @param {string} [subMessage] @returns {boolean} */
  show: (message, subMessage = '') => host().notify(message, subMessage),
};

export const Users = {
  /** @returns {User | null} */
  getForeground: () => host().users.foreground(),
  /** @returns {User[]} */
  getLoggedIn: () => host().users.loggedIn(),
};

function rgb(color) {
  if (typeof color !== 'string') return color;
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!match) throw new Error(`Controller.setLightBar: expected '#rrggbb' or {r, g, b}, got '${color}'`);
  const [r, g, b] = match.slice(1).map(hex => parseInt(hex, 16));
  return {r, g, b};
}

export const Controller = {
  /** @param {string | {r: number, g: number, b: number}} color '#rrggbb' or 0..255 channels */
  setLightBar(color) {
    const {r, g, b} = rgb(color);
    host().pad.setLightBar(r, g, b);
  },
  resetLightBar: () => host().pad.resetLightBar(),
  /** @param {number} [strength] 0..1 @param {number} [ms] */
  vibrate: (strength = 1, ms = 200) => host().pad.vibrate(strength, ms / 1000),
  /**
   * DualSense adaptive trigger resistance: `setTriggerEffect(trigger, {type: 'resistance', from,
   * strength})`. From `from` of the travel (0 top, 1 bottom) on, the trigger pushes back at `strength`
   * (0..1, in eight steps); `strength` 0 releases it.
   * @param {'l2' | 'r2' | 'both'} trigger @param {number} strength @param {number} [from]
   */
  setTriggerResistance(trigger, strength, from = 0) {
    applyTriggerEffect('Controller.setTriggerResistance', trigger, {type: 'resistance', from, strength});
  },
  /**
   * A DualSense adaptive trigger effect, replacing the trigger's last one. Positions are fractions of
   * the travel (0 top, 1 bottom), strengths and amplitudes 0..1 in eight steps (0 is off):
   * - `{type: 'off'}`
   * - `{type: 'resistance', from = 0, strength}`: pushes back from `from` to the bottom.
   * - `{type: 'weapon', start, end, strength}`: resists between `start` and `end`, then gives way
   *   with a click, like a gun trigger. The controller places them in zones: `start` 0.2..0.8, `end`
   *   at least a zone (0.1) past it and at most 0.9; values outside are moved there.
   * - `{type: 'vibration', from = 0, amplitude, frequency}`: buzzes from `from` on, at `frequency`
   *   Hz (1..255).
   * The PS5 turns the triggers off when the app quits; the desktop preview only logs the request.
   * @param {'l2' | 'r2' | 'both'} trigger @param {TriggerEffect} effect
   */
  setTriggerEffect(trigger, effect) {
    applyTriggerEffect('Controller.setTriggerEffect', trigger, effect);
  },
  /** @returns {GamepadState} */
  getState: () => host().pad.state(),
  /**
   * Calls `listener` with the controller's events, once per frame, until the returned function is
   * called: `press` and `release` (with `heldMs`) for every button in GamepadState, L2 and R2 at the
   * host's press threshold and the touchpad included, then `trigger` when L2's or R2's travel changes.
   * With `frames`, a `frame` event ends every frame, for work that steps while something is held. A
   * button held when the listener starts is not a press for it. A press and release within one frame
   * are not seen; the host's actions (useController) are.
   * @param {(event: ControllerEvent) => void} listener
   * @param {{frames?: boolean}} [options]
   * @returns {() => void}
   */
  subscribe(listener, {frames = false} = {}) {
    return pad.watch((state, events, elapsedMs) => {
      for (const event of events) listener(event);
      if (frames) listener({type: 'frame', elapsedMs, state});
    });
  },
};

/**
 * @typedef {import('./controller-events.js').ControllerEvent} ControllerEvent
 * @typedef {{type: 'off'} | {type: 'resistance', from?: number, strength: number}
 *   | {type: 'weapon', start: number, end: number, strength: number}
 *   | {type: 'vibration', from?: number, amplitude: number, frequency: number}} TriggerEffect
 */

const TRIGGER_MASKS = {l2: 1, r2: 2, both: 3};
const fraction = value => value >= 0 && value <= 1;
const zone = value => Math.round(value * 9);
const step8 = value => Math.max(1, Math.round(value * 8));

// libScePad modes and parameter bytes (host_api.hpp pad.setTriggerEffect).
function applyTriggerEffect(call, trigger, effect) {
  const mask = TRIGGER_MASKS[trigger];
  if (!mask) throw new Error(`${call}: trigger must be 'l2', 'r2' or 'both', got '${trigger}'`);
  const type = effect?.type;
  let command;
  if (type === 'off') command = [0];
  else if (type === 'resistance') {
    const {from = 0, strength} = effect;
    if (!fraction(strength) || !fraction(from))
      throw new RangeError(`${call}: strength and from must be 0..1, got ${strength} and ${from}`);
    command = strength > 0 ? [1, zone(from), step8(strength)] : [0];
  } else if (type === 'weapon') {
    const {start, end, strength} = effect;
    if (!fraction(start) || !fraction(end) || !(start < end) || !fraction(strength))
      throw new RangeError(`${call}: weapon start < end and strength must be 0..1, got ${start}, ${end} and ${strength}`);
    const from = Math.min(7, Math.max(2, zone(start)));
    command = strength > 0 ? [2, from, Math.min(8, Math.max(from + 1, zone(end))), step8(strength)] : [0];
  } else if (type === 'vibration') {
    const {from = 0, amplitude, frequency} = effect;
    if (!fraction(amplitude) || !fraction(from) || !(frequency >= 1 && frequency <= 255))
      throw new RangeError(`${call}: vibration from and amplitude must be 0..1 and frequency 1..255 Hz, `
        + `got ${from}, ${amplitude} and ${frequency}`);
    command = amplitude > 0 ? [3, zone(from), step8(amplitude), Math.round(frequency)] : [0];
  } else {
    throw new Error(`${call}: effect type must be 'off', 'resistance', 'weapon' or 'vibration', got '${type}'`);
  }
  host().pad.setTriggerEffect(mask, ...command);
}

const pad = gamepadSource(() => host().pad.state());

function sameState(a, b) {
  return a.connected === b.connected && a.leftX === b.leftX && a.leftY === b.leftY
    && a.rightX === b.rightX && a.rightY === b.rightY && a.l2 === b.l2 && a.r2 === b.r2
    && a.buttons.join() === b.buttons.join();
}

/**
 * The controller state while mounted, read once per frame (with the events' shared reader); re-renders
 * only when it changes. `intervalMs` reads at most that often instead of every frame.
 * @param {number} [intervalMs]
 * @returns {GamepadState}
 */
export function useGamepad(intervalMs = 0) {
  const [state, setState] = useState(Controller.getState);
  useEffect(() => {
    let waited = intervalMs;
    return pad.watch((next, events, elapsedMs) => {
      waited += elapsedMs;
      if (waited < intervalMs) return;
      waited = 0;
      setState(previous => (sameState(previous, next) ? previous : next));
    });
  }, [intervalMs]);
  return state;
}

/**
 * Controller.subscribe while mounted, for the latest `handler`; pass null to stop listening (a button
 * held when listening starts again is not a press).
 * @param {((event: ControllerEvent) => void) | null | undefined} handler
 * @param {{frames?: boolean}} [options]
 */
export function useControllerEvents(handler, {frames = false} = {}) {
  const current = useRef(handler);
  useLayoutEffect(() => { current.current = handler; });
  const listening = Boolean(handler);
  useLayoutEffect(() => (listening ? Controller.subscribe(event => current.current?.(event), {frames}) : undefined),
    [listening, frames]);
}

/**
 * Short interface sounds. Import a 16-bit PCM WAV (`import tick from './tick.wav'`) and the build
 * bakes it into the app; the import is the sound's name. Mixing runs on an audio thread.
 */
export const Sound = {
  /**
   * Starts a sound and returns at once. A sound plays one voice at a time: while it still sounds,
   * playing it again is skipped (so a held D-pad keeps ticking without stacking).
   * @param {string} name @param {{volume?: number, pan?: number}} [options] volume 0..1, pan -1..1
   * @returns {boolean} whether it started; false without an audio output
   */
  play: (name, {volume = 1, pan = 0} = {}) => host().sound.play(name, volume, pan),
  /** Master volume for every sound, 0..1 (0 mutes). @param {number} volume */
  setVolume: volume => host().sound.setVolume(volume),
};

export const Linking = {
  /** Opens an http(s) URL in the system browser. @param {string} url @returns {boolean} */
  openURL(url) {
    if (!/^https?:\/\//i.test(url)) throw new Error(`Linking.openURL: only http and https URLs are supported, got '${url}'`);
    return host().openURL(url);
  },
};

export const Power = {
  /**
   * While on, the console does not enter rest mode for inactivity (the desktop display does not
   * sleep): turn it on for a long download, off when it ends. The last call wins.
   * @param {boolean} enabled
   */
  keepAwake: enabled => host().power.keepAwake(Boolean(enabled)),
};

export const Display = {
  /**
   * The rate in Hz the display presents at. On the PS5 it is the mode the TV accepted, known after
   * the first frame at a rate: a TV without 120 Hz input stays at 60.
   * @returns {60 | 120}
   */
  refreshRate: () => host().display.refreshRate(),
  /**
   * Switches the display to 60 or 120 Hz after this frame. The rate must be listed in app.json
   * "refreshRates". On the PS5 the screen goes black for a second or two while the TV resyncs;
   * app state is kept. The desktop preview keeps the monitor's rate and reports the requested one.
   * @param {60 | 120} hz
   */
  setRefreshRate: hz => host().display.setRefreshRate(hz),
};

export const AudioOutput = {
  /**
   * What the TV or AV receiver the console outputs to takes, from its EDID, read now: decide from it what
   * to ask a media server for, and whether a `<Video audioOutput="auto">` will pass a track through.
   * `passthrough` lists the codecs this host can send undecoded to it ('ac3', 'eac3', 'dts': the DTS core);
   * `pcmChannels` is the most PCM channels it takes (decoded audio still plays as 48 kHz stereo). `known` is
   * false without an EDID (the desktop preview): then `formats` and `passthrough` are empty.
   * @returns {{known: boolean, name: string, formats: Array<{codec: string, channels: number,
   *   sampleRates: number[], bitDepths?: number[], maxBitrate?: number}>,
   *   passthrough: Array<'ac3' | 'eac3' | 'dts'>, pcmChannels: number}}
   */
  capabilities: () => host().audioOutput.capabilities(),
};

export const Fonts = {
  /**
   * The interface language, as a BCP 47 tag ('ja', 'zh-Hans', 'ar'), for text drawn from the
   * runtime fonts (docs/TEXT.md): it picks Japanese or Chinese forms of Han characters and the
   * shaping language. Defaults to the system language; set it before text renders.
   * @param {string} tag
   */
  setLanguage: tag => host().text.setLanguage(String(tag)),
};

const backListeners = [];

export const BackHandler = {
  /**
   * Closes the app after the current frame, like React Native's BackHandler.exitApp. With `relaunch`,
   * the app opens again once closed: true when that is arranged; otherwise it only closes, and the
   * reason is logged.
   * @param {{relaunch?: boolean}} [options]
   * @returns {boolean}
   */
  exitApp({relaunch = false} = {}) {
    const result = host().exit(relaunch);
    if (!relaunch) return false;
    if (result !== true) console.log(`BackHandler.exitApp: not reopening: ${result}`);
    return result === true;
  },
  /**
   * Circle, after the innermost FocusScope.onBack; the last listener added runs first.
   * @param {'hardwareBackPress'} event
   * @param {() => boolean | void} listener returns true to consume Circle
   * @returns {{remove: () => void}}
   */
  addEventListener(event, listener) {
    if (event !== 'hardwareBackPress') {
      throw new Error(`BackHandler.addEventListener: only 'hardwareBackPress' is supported, got '${event}'`);
    }
    backListeners.push(listener);
    return {remove() {
      const index = backListeners.indexOf(listener);
      if (index !== -1) backListeners.splice(index, 1);
    }};
  },
};

/** Internal: offers Circle to the listeners, last added first. @returns {boolean} consumed */
export function dispatchBackPress() {
  for (const listener of [...backListeners].reverse()) if (listener() === true) return true;
  return false;
}

const networkTasks = new Map();
let networkTimer = null;

function stopNetworkTimer() {
  if (networkTasks.size === 0 && networkTimer !== null) {
    clearInterval(networkTimer);
    networkTimer = null;
  }
}

function taskError(task, snapshot) {
  const error = new Error(`${task.call}${task.destination ? ` ${task.destination}` : ''}: `
    + (snapshot.error || snapshot.state));
  if (snapshot.state === 'cancelled') error.name = 'AbortError';
  return error;
}

function pollNetwork() {
  let snapshots;
  try {
    snapshots = [];
    for (const backend of new Set([...networkTasks.values()].map(task => task.backend)))
      snapshots.push(...host()[backend].poll().map(snapshot => ({...snapshot, backend})));
  } catch (error) {
    for (const task of networkTasks.values()) {
      try { host()[task.backend].cancel(task.id); } catch {}
      task.listeners.clear();
      task.reject(error);
    }
    networkTasks.clear();
    stopNetworkTimer();
    return;
  }
  for (const snapshot of snapshots) {
    const key = `${snapshot.backend}:${snapshot.id}`;
    const task = networkTasks.get(key);
    if (!task) continue;
    const {body, backend, ...progress} = snapshot;
    task.snapshot = Object.freeze({...progress, destination: task.destination});
    for (const listener of [...task.listeners]) {
      try { listener(task.snapshot); }
      catch (error) { console.error('Download progress listener failed:', error); }
    }
    // A completed torrent that seeds stays in the poll: the native side keeps the job alive until
    // its seeder stops, and every poll reports the upload total. Its promise settles once, at
    // completion; the subscription ends with the final snapshot, where `seeding` is false.
    if (snapshot.state === 'completed' && snapshot.seeding === true) {
      if (!task.settled) {
        task.settled = true;
        task.resolve({...snapshot, destination: task.destination});
      }
      continue;
    }
    if (snapshot.state === 'completed' || snapshot.state === 'failed' || snapshot.state === 'cancelled') {
      networkTasks.delete(key);
      task.listeners.clear();
      if (task.settled) continue;
      task.settled = true;
      if (snapshot.state === 'completed') task.resolve({...snapshot, destination: task.destination});
      else task.reject(taskError(task, snapshot));
    }
  }
  stopNetworkTimer();
}

function networkTask(id, call, destination = '', backend = 'network') {
  const key = `${backend}:${id}`;
  const task = {id, backend, call, destination, listeners: new Set(), settled: false,
    snapshot: Object.freeze({id, destination, state: 'queued', received: 0, written: 0, total: null,
      bytesPerSecond: 0, connections: 0, retries: 0, bufferedBytes: 0})};
  const done = new Promise((resolve, reject) => { task.resolve = resolve; task.reject = reject; });
  // A task can be observed through subscriptions without awaiting its completion.
  done.catch(() => {});
  networkTasks.set(key, task);
  if (networkTimer === null) networkTimer = setInterval(pollNetwork, 250);
  return Object.freeze({
    id, done,
    cancel() { if (networkTasks.has(key)) host()[backend].cancel(id); },
    get snapshot() { return task.snapshot; },
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('Downloads.subscribe: expected a function');
      listener(task.snapshot);
      if (networkTasks.has(key)) task.listeners.add(listener);
      return () => task.listeners.delete(listener);
    },
  });
}

/** Native HTTP subset for bounded text/JSON responses; does not require a browser. */
export const Http = {
  async request(url, options = {}) {
    const signal = options.signal;
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('Http.request: signal must support abort event listeners');
    }
    const id = host().network.request(url, options);
    const task = networkTask(id, 'Http.request');
    const abort = () => task.cancel();
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, {once: true});
    }
    try {
      const response = await task.done;
      return Object.freeze({status: response.status, ok: response.status >= 200 && response.status < 300,
        url: response.url || url, headers: Object.freeze({...response.headers}),
        text: async () => response.body, json: async () => JSON.parse(response.body)});
    } finally {
      if (signal) signal.removeEventListener('abort', abort);
    }
  },
};

/** Large binary files stay native; only progress and the completion result reach JavaScript. */
export const Downloads = {
  // recoverCompleted verifies a native completion receipt and the final file's SHA-256.
  // It never accepts an existing destination based on size or filename alone.
  enqueue({url, destination, ...options}) {
    const id = host().network.download(url ?? options.pieces?.[0]?.url, destination, options);
    return networkTask(id, 'Downloads.enqueue', destination);
  },
  enqueueManifest({manifest, destination, ...options}) {
    return Downloads.enqueue({...options, ...normalizeDownloadManifest(manifest), destination});
  },
  /** Bytes per second every file download shares, 0 for no limit (ABI v17). It applies at once,
   * to running downloads too; one enqueued with `unlimited: true` (an app's own update) is exempt. */
  setRateLimit(bytesPerSecond) {
    if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0)
      throw new TypeError('Downloads.setRateLimit: expected bytes per second, 0 for no limit.');
    host().network.setRateLimit(Math.floor(bytesPerSecond));
  },
  get transportVersion() { return host().network.version(); },
};

/** Streaming archive extraction off-thread; source volumes are preserved on failure/cancel. */
export const Archives = Object.freeze({
  /** `stream: true` starts a RAR set while its later volumes still download: only the first must exist;
   * each next one is read once a file appears under its final name (write volumes elsewhere and rename). */
  extract({sources, destination, maxBytes = 1024**4, password, stream = false}) {
    if (password != null && (typeof password !== 'string' || password.length > 1024 || password.includes('\0')))
      throw new TypeError('Archives.extract: password must be a string without NUL, at most 1024 UTF-8 bytes.');
    const id = host().archives.extract(sources, destination, maxBytes, password ?? '', stream === true);
    return networkTask(id, 'Archives.extract', destination, 'archives');
  },
  /** What the files' leading bytes are, and why their headers so far already rule out extraction.
   * Reads headers synchronously: a RAR's first file header, then more for about 100 ms and one header past it.
   * Also works on a download's growing `.part` file.
   * @param {string[]} sources ordered volumes @returns {{kind: string, refusal: string}} */
  inspect: sources => host().archives.inspect(sources),
  /** Whether native inspection has a worker (ABI v19); older hosts read synchronously. */
  get supportsAsyncInspection() { return typeof host().archives.inspectAsync === 'function'; },
  /** `inspect` on a native worker thread, one at a time in the order asked: a download's growing file
   * can make the read wait for the drive while it is written, which would hold the render thread.
   * Resolves with `{kind, refusal, title, waitedMs, tookMs}` (waitedMs: behind the ones asked before it).
   * Falls back to `inspect` on a host without it (ABI < 19).
   * Use `supportsAsyncInspection` before calling if you are on a render-sensitive path so that you don't use the synchronous fallback.
   * @param {string[]} sources ordered volumes */
  async inspectAsync(sources) {
    if (typeof host().archives.inspectAsync !== 'function') return {...host().archives.inspect(sources), waitedMs: 0, tookMs: 0};
    const {kind, refusal, title, waitedMs, tookMs} = await networkTask(host().archives.inspectAsync(sources), 'Archives.inspectAsync', '', 'inspections').done;
    return {kind, refusal, title, waitedMs, tookMs};
  },
  /** Whether `extract` takes `stream`. */
  streams: true,
});

/**
 * PKG installation through the console's install service (PS5 only; it needs a payload loader on port
 * 9021). The task's snapshot carries `written`/`total` bytes, the console's install `status` and the
 * package's `contentId`; it completes once the title is playable. Cancelling stops reporting only.
 * `url` in place of `path` (ABI v20) hands an http(s) link to the console's own download queue, which
 * fetches and installs it in the background; a PS4 package needs its `contentId`.
 * `proxy({url, total, file, token, port})` (ABI v21) serves `url` for that queue and returns
 * `{url, localUrl, token, port}`: `url` on the console's LAN address (empty without one), `localUrl` on
 * 127.0.0.1. The HEAD the console asks first is answered by the app, from `total`, and each GET range
 * is fetched from `url`. It is for a link whose origin refuses that HEAD (a pre-signed S3 or R2 link),
 * and it works only while the app runs; the `token` and `port` of an earlier session serve the same
 * link again. `proxyStats()` lists what the console fetched of each, `proxyRemove(token)` forgets one.
 */
export const Packages = Object.freeze({
  install({path, url, name = '', contentId = ''}) {
    const id = host().packages.install(url ?? path, name, contentId);
    return networkTask(id, 'Packages.install', url ?? path, 'packages');
  },
  proxy({url, total, file = '', token = '', port = 0}) {
    return host().packages.proxy(url, total, file, token, port);
  },
  proxyStats() {
    return host().packages.proxyStats();
  },
  proxyRemove(token) {
    host().packages.proxyRemove(token);
  },
  /**
   * Starts the same server as a payload of its own (PS5 only, through the loader on 9021), which keeps
   * serving after the app closes. Resolves to `{port}`; the app then adds links to it over HTTP at
   * `http://127.0.0.1:<port>/control/<secret>/` (docs/NATIVE-API.md). `log` is the file it writes.
   */
  async startHelper({port = 0, secret, log = ''}) {
    const id = host().packages.startHelper(port, secret, log);
    for (;;) {
      await new Promise(resolve => setTimeout(resolve, 100));
      const done = host().packages.pollHelper().find(item => item.id === id);
      if (!done) continue;
      if (done.state === 'ready') return {port: done.port};
      throw new Error(`Packages.startHelper: ${done.error}`);
    }
  },
});

/**
 * UDP broadcast on the local network, for finding services that answer one (Jellyfin and Emby on
 * 7359, for instance). Replies come from anyone on the network: check what they claim before use.
 */
export const LocalNetwork = Object.freeze({
  /**
   * Sends `message` to every host on the network at `port` and gathers the replies for `timeoutMs`
   * (100–10000) or until `maxReplies` (1–64) arrive.
   * @param {{port: number, message: string, timeoutMs?: number, maxReplies?: number,
   *   signal?: {aborted: boolean, addEventListener: Function, removeEventListener: Function}}} options
   * @returns {Promise<ReadonlyArray<{address: string, port: number, text: string}>>} `address` is the sender's IPv4
   */
  async broadcast({port, message, timeoutMs = 1500, maxReplies = 16, signal}) {
    if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      throw new TypeError('LocalNetwork.broadcast: signal must support abort event listeners');
    }
    const id = host().lan.broadcast(port, message, timeoutMs, maxReplies);
    const task = networkTask(id, `LocalNetwork.broadcast ${port}`, '', 'lan');
    const abort = () => task.cancel();
    if (signal) {
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, {once: true});
    }
    try {
      const {replies} = await task.done;
      return Object.freeze(replies.map(reply => Object.freeze({address: reply.address, port: reply.port, text: reply.body})));
    } finally {
      if (signal) signal.removeEventListener('abort', abort);
    }
  },
});

/**
 * The app's own BitTorrent client (ABI v21), with no external client or service. One job fetches a
 * magnet's metadata (BEP 9) or reads a `.torrent`, downloads the wanted file's pieces, verifies each
 * by SHA-1 and writes them straight to `destination`. There is no DHT or web seed: a magnet needs its
 * trackers and/or `x.pe` peers. Progress reaches the snapshot every 250 ms, including while running:
 * `state` is `starting`, `metadata`, `downloading`, `completed`, `failed` or `cancelled`; it adds
 * `size`, `total`, `downloaded`, `verified`, `uploaded`, `bytesPerSecond`, `pieces`, `piecesDone`,
 * `peers`, `seeds`, `leechers`, `swarmSeeds`, `swarmLeechers`, `listenPort`, and `metadata`/`seeding`
 * flags. A cancelled or failed job keeps a `<destination>.torrent-parts` sidecar and resumes from it.
 * A completed job keeps seeding only when `seeding` is set and the user's setting allows it
 * (`setSeeding`), and stops when the app closes.
 */
export const Torrents = Object.freeze({
  /**
   * @param {{magnet?: string, torrentPath?: string, destination: string, wanted?: string,
   *   seeding?: boolean, connections?: number, listenPort?: number}} options
   * @returns {{id: number, done: Promise<object>, cancel(): void, snapshot: object,
   *   subscribe(listener: (snapshot: object) => void): () => void}}
   */
  download({magnet = '', torrentPath = '', destination, wanted = '', seeding = false,
    connections = 16, listenPort = 0}) {
    if (typeof destination !== 'string' || !destination)
      throw new TypeError('Torrents.download: destination must be a non-empty path.');
    if ((magnet ? 1 : 0) + (torrentPath ? 1 : 0) !== 1)
      throw new TypeError('Torrents.download: pass exactly one of magnet or torrentPath.');
    const id = host().torrent.start({magnet, torrentPath, destination, wanted,
      seeding: seeding === true, connections, listenPort});
    return networkTask(id, 'Torrents.download', destination, 'torrent');
  },
  /** Whether completed jobs seed while the app is open; it applies to running jobs too. */
  setSeeding(enabled) { host().torrent.setSeeding(enabled === true); },
  /** Whether this host carries the engine (ABI v21); older hosts return false. */
  get supported() { return typeof globalThis.__ps5ReactNative?.torrent?.start === 'function'; },
});

/** Read-only, filename-bound Vikingfile capture on PS5; no browser data is retained. */
export const BrowserCapture = Object.freeze({
  capture({prefix = 'https://vikingfile.com/d/', suffix, timeoutSeconds = 180, rejected = [], resume = false}) {
    const id = host().browser.capture(prefix, suffix, timeoutSeconds, rejected, Boolean(resume));
    return networkTask(id, 'BrowserCapture.capture', '', 'browser');
  },
});

const pendingImages = new Map();
// Finished loads the host has handed over and no listener has received yet, by id in arrival order.
const arrivedImages = new Map();
let stopImagePolling = null;

// Each image listener runs outside the frame batch, so its LegacyRoot render commits before elapsed
// time is checked. A single synchronous render cannot be preempted, but delivery stops after the
// first listener that carries the frame past the budget.
const IMAGE_DELIVERY_BUDGET_MS = 4;

function pollImages() {
  for (const result of host().image.poll()) {
    if (pendingImages.has(result.id)) arrivedImages.set(result.id, result);
  }
  const start = performance.now();
  for (const [id, result] of arrivedImages) {
    const listeners = pendingImages.get(id);
    if (!listeners?.size) {
      arrivedImages.delete(id);
      continue;
    }
    for (const listener of listeners) {
      listeners.delete(listener);
      listener(result);
      if (listeners.size === 0) {
        pendingImages.delete(id);
        arrivedImages.delete(id);
      }
      if (performance.now() - start >= IMAGE_DELIVERY_BUDGET_MS) break;
    }
    if (performance.now() - start >= IMAGE_DELIVERY_BUDGET_MS) break;
  }
  if (pendingImages.size === 0 && arrivedImages.size === 0) {
    stopImagePolling();
    stopImagePolling = null;
  }
}

// One more poll: a release can push unused images over the cache budget, and polls evict.
function pollImagesSoon() {
  stopImagePolling ??= onFrameUnbatched(pollImages);
}

/**
 * Internal: the native reference behind one `<Image source={{uri}}>`. `listener` receives
 * `{state, name, width, height, error}` now and, while loading, once more when the load finishes;
 * the returned function releases the reference, cancelling the load when nothing else holds it.
 * @param {string} uri @param {number} width @param {number} height box in render pixels
 * @param {number} fit 0 cover, 1 contain, 2 stretch, 3 none
 * @param {boolean} prefetch loads after images that elements draw
 * @param {(result: {state: string, name: string, width: number, height: number, error: string, color: string | null}) => void} listener
 * @returns {() => void}
 */
/**
 * Internal: replaces the list of URLs the host fetches into its disk cache in the background, while
 * no image load waits. @param {string[]} uris
 */
export function warmImages(uris) {
  host().image.warm(uris);
}

/**
 * Internal: holds image requests to the network back for `ms`, called every frame a ScrollView
 * moves, so a held key does not fetch the art of every row it passes. @param {number} ms
 */
export function deferImageFetches(ms) {
  host().image.defer(ms);
}

export function acquireImage(uri, width, height, fit, prefetch, listener) {
  const result = host().image.load(uri, width, height, fit, prefetch);
  const {id} = result;
  if (result.state === 'loading') {
    if (!pendingImages.has(id)) pendingImages.set(id, new Set());
    pendingImages.get(id).add(listener);
    pollImagesSoon();
  }
  const release = () => {
    const listeners = pendingImages.get(id);
    listeners?.delete(listener);
    if (listeners?.size === 0) {
      pendingImages.delete(id);
      arrivedImages.delete(id);
    }
    host().image.release(id, prefetch);
    pollImagesSoon();
  };
  try {
    listener(result);
  } catch (error) {
    release();
    throw error;
  }
  return release;
}

const players = new Map();
let stopVideoPolling = null;

function pollVideos() {
  for (const status of host().video.poll()) players.get(status.id)?.(status);
}

/**
 * Internal: one native player behind a `<Video>`. `listener` receives the player's status every frame
 * while it is open. Returns the engine image name its `<Image layer>` draws and the controls.
 * @param {string} source an app path or http(s) URL
 * @param {{paused?: boolean, muted?: boolean, loop?: boolean, volume?: number, start?: number,
 *   audio?: boolean, headers?: Record<string, string>, audioOutput?: 'pcm' | 'auto' | 'passthrough'}} options
 * @param {(status: object) => void} listener
 */
export function openVideo(source, options, listener) {
  const video = host().video;
  const {id, name} = video.open(source, options);
  players.set(id, listener);
  stopVideoPolling ??= onFrameUnbatched(pollVideos);
  return {
    name,
    setPaused: paused => video.setPaused(id, !!paused),
    seek: seconds => video.seek(id, seconds),
    setVolume: volume => video.setVolume(id, volume),
    setMuted: muted => video.setMuted(id, !!muted),
    setLoop: loop => video.setLoop(id, !!loop),
    setAudioDelay: seconds => video.setAudioDelay(id, seconds),
    setAudioOutput: mode => video.setAudioOutput(id, mode),
    setResizeMode: mode => video.setResizeMode(id, mode),
    setUpscale: model => video.setUpscale(id, model),
    setCompare: (model, split) => video.setCompare(id, model, split),
    selectAudioTrack: index => video.selectAudioTrack(id, index),
    selectSubtitleTrack: index => video.selectSubtitleTrack(id, index),
    addSubtitle: ({uri, language = '', title = ''}) => video.addSubtitle(id, uri, language, title),
    close() {
      if (!players.delete(id)) return;
      video.close(id);
      if (players.size === 0) {
        stopVideoPolling?.();
        stopVideoPolling = null;
      }
    },
  };
}
