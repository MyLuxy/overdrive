// ../pub-game-store/native/ui/haptics.js
// reconstructed from the esbuild bundle in eboot.bin
// MODIFIED: navigation haptics are a setting, off unless the player turns them on.

import { useEffect, useState } from 'react';
import { loadList, saveList } from '../state/saved.js';
import { Controller, useNavigationEvents } from '@ps5-react/core';

  var TICK = [0.09, 35];
  var PRESS = [0.15, 30];
  var BACK = [0.11, 20];
  var PAGE = [0.18, 35];
  var EDGE = [0.18, 25];
  var NOTICE = [0.25, 140];
  var PAGE_ACTIONS = /* @__PURE__ */ new Set(["l1", "r1", "l2", "r2"]);
  var EDGE_GAP_MS = 70;
  var pulse2 = ([strength, ms]) => Controller.vibrate(strength, ms);
  // A pulse on every focus move, press and page change is a lot to hold for a whole browse, so
  // it starts off and lives in settings.json beside the language. The finished-download pulse
  // is a notice, not navigation, and stays on either way.
  // Navigation pulses are scaled by a level in percent, 0 being off (issue #32). The setting
  // used to be `vibration: true`, which reads as full strength.
  var LEVELS = [0, 25, 50, 75, 100];
  var SETTINGS = "settings.json";
  var saved = loadList(SETTINGS, "settings").vibration;
  var vibrationLevel = saved === true ? 100 : LEVELS.includes(saved) ? saved : 0;
  var listeners = /* @__PURE__ */ new Set();
  var navigationPulse = ([strength, ms]) => pulse2([strength * vibrationLevel / 100, ms]);
  // A chosen level is felt at once, so the player can tell the steps apart while picking one.
  function setVibrationLevel(level) {
    vibrationLevel = level;
    const { vibration, ...settings } = loadList(SETTINGS, "settings");
    saveList(SETTINGS, "settings", level ? { ...settings, vibration: level } : settings);
    for (const listener of listeners) listener(level);
    if (level) navigationPulse(PAGE);
  }
  function useVibrationLevel() {
    const [level, setLevel] = (0, useState)(vibrationLevel);
    (0, useEffect)(() => {
      listeners.add(setLevel);
      return () => {
        listeners.delete(setLevel);
      };
    }, []);
    return level;
  }
  function useInterfaceHaptics() {
    useNavigationEvents((event) => {
      if (!vibrationLevel) return;
      if (event.type === "move") navigationPulse(TICK);
      else if (event.type === "blocked") {
        navigationPulse(EDGE);
        setTimeout(() => navigationPulse(EDGE), EDGE_GAP_MS);
      } else if (event.type === "press") navigationPulse(event.handled ? PRESS : EDGE);
      else if (event.handled && event.type === "back") navigationPulse(BACK);
      else if (event.handled && PAGE_ACTIONS.has(event.action)) navigationPulse(PAGE);
      else if (event.handled) navigationPulse(PRESS);
    });
  }
  var pulseNotice = () => pulse2(NOTICE);

export { LEVELS, pulseNotice, setVibrationLevel, useInterfaceHaptics, useVibrationLevel };
