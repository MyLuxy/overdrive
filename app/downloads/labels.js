// ../pub-game-store/native/downloads/labels.js
// reconstructed from the esbuild bundle in eboot.bin

import { t } from '../i18n/core.js';
import { COMPLETE } from '../state/download-queue.js';

  var LABELED = /* @__PURE__ */ new Set([
    "awaiting-browser",
    "queued",
    "resolving",
    "connecting",
    "downloading",
    "verifying",
    "pausing",
    "extracting",
    "finishing",
    "extracted",
    "paused",
    "failed",
    "file-downloaded",
    "downloaded",
    "installer-required",
    "installing",
    "installed",
    "streamed",
    "extraction-required",
    "removing"
  ]);
  var WAITING = ["resolving", "connecting", "verifying", "pausing", "finishing", "removing"];
  // A PKG handed to the console's own downloads is done here, but not installed yet.
  var shownState = (job2) => job2.state === "extracting" && job2.phase === "finishing" ? "finishing" : job2.state === "installed" && job2.streamed ? "streamed" : job2.state;
  var hasStateLabel = (state) => LABELED.has(state);
  var stateLabel = (state) => t(`downloadState.${state}`);
  var clearAction = (state) => COMPLETE.includes(state) ? "remove" : "cancel";
  // The service that fetched the file, once one did: a converted catalog download keeps the source
  // it was offered as, so the screens have to say where it is really coming from. A multi-part set
  // converts part by part (download-queue.js), so the part in flight answers first.
  var clientOf = (job2) => {
    const source = job2?.parts ? job2.parts[job2.partIndex] : job2;
    if (source?.viaRealDebrid) return "Real-Debrid";
    if (source?.viaTorbox) return "TorBox";
    return "";
  };

export { WAITING, clearAction, clientOf, hasStateLabel, shownState, stateLabel };
