// ../pub-game-store/native/downloads/errors.js
// reconstructed from the esbuild bundle in eboot.bin

import { t } from '../i18n/core.js';

  // "partial download" is the queue's own wording for a partial it adopted from an earlier session
  // (issue #111): its Retry is the one that deletes it and starts over.
  var STALE_PARTIAL = /partial (?:file|download)|checkpoint/i;
  var TASK = /^\w+\.\w+ \/.*?: /;
  var cause = (message) => message.replace(TASK, "");
  var INCOMPLETE_PART = /Volume (\d+) of \d+ looks incomplete/;
  var SHORTFALL = /^Not enough space on (\S+): needs (.+?), (.+?) free(?:( after queued downloads)(?:: (.+))?)?$/;
  var CASES = [
    // Before STALE_PARTIAL: a full disk fails "write partial file".
    [/no space left|ENOSPC/i, "noSpace", "freeThenResume"],
    // An extraction is capped at the space free when it starts: its files outgrew it.
    [/extraction size limit/i, "noSpaceExtract", "freeThenRetryExtract"],
    [/partial files were deleted/i, "partialDeleted", "restart"],
    [STALE_PARTIAL, "staleProgress", "restart"],
    [/file changed since this partial/i, "fileChanged", "restart"],
    [/needs more memory to extract/i, "archiveTooLarge", "otherSource"],
    // A 7z too large for the app's heap extracts in rar-extract (a payload): with the console short of free
    // memory it stops before decoding, and without a payload loader it cannot start.
    [/too little free memory/i, "consoleMemoryBusy", "closeAppsRetry"],
    [/needs the payload loader to extract/i, "archiveNoLoader", "startLoaderRetry"],
    // The engine's heap had no room for the extraction; a fresh launch frees it.
    [/not enough memory to extract/i, "noMemory", "reopenApp"],
    // Every known password was tried before this shows (download-queue.js), and the downloaded files stay:
    // cancelling would delete them (issue #54).
    [/password is missing|passphrase required/i, "archivePasswordMissing", "passwordKeepFiles"],
    [/archive password|RAR5 password|passphrase/i, "archivePasswordUnknown", "passwordKeepFiles"],
    [/not a game file/i, "notGameFile", "otherSource"],
    [/fake PKGs install only/i, "pkgFirmware", "otherSource"],
    // The package installer is sent to the payload loader (etaHEN, an elfldr): without one the PKG is
    // ready on the drive and only needs installing by hand.
    [/payload loader on port 9021/i, "pkgNoLoader", "installByHand"],
    // A set's last volume ends where the archive goes on, or its first is not where it starts: the source lists
    // too few volumes, and downloading them again fails the same way. A lone archive the worker cannot open
    // fails with the same words; that one is downloaded again.
    [/^(?:Incomplete RAR archive or missing volume|Missing first RAR volume)\.$/, "missingParts", "otherSource", "set"],
    [/missing volume|damaged RAR|cannot read the RAR/i, "damaged", "restartFromZero"],
    [/browser verification/i, "needsBrowser", "openSource"],
    [/interrupted/i, "interrupted", "resume"],
    [/space/i, "noSpace", "freeThenRetry"],
    [/storage (disconnected|changed|identity)|reconnect|original storage root/i, "driveDisconnected", "reconnect"],
    [/HTTP (404|410|403|401)\b/, "linkGone", "otherSource"],
    [/HTTP (429|5\d\d)\b/, "serverBusy", "retryLater"],
    [/resolve|connect|timeout|timed out|unreachable|receiving data|SSL|network/i, "noConnection", "checkConnection"],
    [/SHA|hash|verification|mismatch|changed the resource|truncated/i, "damaged", "restartFromZero"]
  ];
  var PLAIN = /ShadowMount|from another source holds this name/;
  function explainError(error2, set = false) {
    const message = cause(error2);
    if (PLAIN.test(message)) return { title: message, action: "" };
    const part = INCOMPLETE_PART.exec(message);
    if (part) return { title: t("errors.partIncomplete", { part: part[1] }), action: t("errors.action.retryPart") };
    const shortfall = SHORTFALL.exec(message);
    if (shortfall) {
      const [, root2, need, free, queued, holders] = shortfall;
      const action = t("errors.action.freeOrOtherDrive");
      return {
        title: t("errors.noSpaceOn", { root: root2, need, free, queued: queued ? "yes" : "no" }),
        action: holders ? `${action} ${holders}` : action
      };
    }
    const known = CASES.find(([pattern, , , only]) => (!only || set) && pattern.test(message));
    if (!known) return { title: message, action: t("errors.action.retryOrOtherSource") };
    return { title: t(`errors.${known[1]}`), action: t(`errors.action.${known[2]}`) };
  }

export { INCOMPLETE_PART, STALE_PARTIAL, cause, explainError };
