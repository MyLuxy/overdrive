// ../pub-game-store/native/state/download-queue.js
// reconstructed from the esbuild bundle in eboot.bin
// MODIFIED: an Archive.org refusal fails over or fails as a dead link instead of asking for the browser.
// MODIFIED: an archive the catalog's password doesn't open is tried with the known release passwords.
// MODIFIED: any provider that needs the console browser (LinkVault's mirrors, Akirabox, Datanodes)
// has its file link captured from the browser, like Vikingfile's.

import { INCOMPLETE_PART, STALE_PARTIAL, cause } from '../downloads/errors.js';
import { t } from '../i18n/core.js';
import { archivePassword } from './archive-password.js';
import { BrowserRequired, archiveRefusal, cancellation, createSourceResolver, sourceKind, webURL } from './download-sources.js';
import { LINK_PREFIX, captureAnchor, linkForLog, otherSourceLink, validateCapturedLink } from './browser-links.js';
import { readJSON } from './read-json.js';
import { mountedImages, shadowRequest, within2 } from './shadowmount.js';
import { MARGIN2, spaceShortfall, stillNeeded } from './space.js';
import { deletesPackages } from './package-cleanup.js';
import { formatBytes } from './size.js';
import { VIKING_PAGE_PREFIX, VIKING_PREFIX, describeVikingCapture, linkPageMetadata, requirePart, validateVikingCapture, vikingLinkPage } from './viking-capture.js';

  var ACTIVE = ["resolving", "connecting", "downloading", "verifying", "extracting", "installing", "pausing"];
  var BUSY = ["queued", ...ACTIVE];
  var COMPLETE = ["downloaded", "file-downloaded", "installer-required", "installed", "extraction-required", "extracted"];
  var ADOPTED = "A partial download from another source holds this name. Resume it from its original source, or delete it in Files.";
  var DELETED = "Its partial files were deleted. Restart to download it again, or remove it.";
  var REMOVAL_CUT = "The app closed while deleting its files. Delete it again.";
  // The passwords the catalog's archives are published with. Some entries name none or the wrong one,
  // so after the catalog's own (or none) these are tried in turn. A wrong or missing password is caught
  // on the archive's headers before anything is written ("RAR archive password is missing.",
  // "Incorrect RAR archive password.", "Incorrect RAR5 archive password."), and a failed attempt leaves
  // no staging behind, so each one costs a moment. They are checked on the console: nothing counts them.
  var KNOWN_PASSWORDS = ["DLPSGAME.COM", "[DLPSGAME.COM]", "www.DLPSGAME.COM", "SuperPSX", "downloadgameps3.com", "hako"];
  var PASSWORD_FAILURE = /archive password|RAR5 password|passphrase/i;
  // A LinkVault page adds its own check and a mirror page before the host's, so a link capture gets
  // the payload's longest window.
  var LINK_CAPTURE_SECONDS = 300;
  // The folder an extraction is written to, and its game's under homebrew: the source's file name
  // without the ".binary" a source of unknown format downloads under. Jobs extracted before used it
  // with that suffix, so ownedPaths claims both.
  var legacyFolderName = (release) => release.filename.replace(/[^a-z0-9_.-]/gi, "_");
  var folderName = (release) => legacyFolderName({ filename: release.filename.replace(/[.](?:binary|bin)$/i, "") });
  // The payload's first pass, before the page opens, fingerprints the links the browser already
  // holds; the task turns "capturing" when it ends (or settles if it fails), and only then may the
  // page open, so no link the page makes is counted as old.
  function armedCapture(task) {
    return new Promise((resolve) => {
      let off = null, settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        off?.();
        resolve();
      };
      off = task.subscribe((snapshot) => {
        if (snapshot.state !== "queued") finish();
      });
      if (settled) off();
      task.done.then(finish, finish);
    });
  }
  // Which source opened the browser, for the log: its provider, and the vault or host it opens.
  function sourceForLog(source2, browserUrl) {
    let host = "?";
    try {
      host = webURL(browserUrl).host;
    } catch {
    }
    return `${source2.provider || sourceKind(source2) || "?"} at ${host}${host.endsWith("link-vault.org") ? " (LinkVault)" : ""}`;
  }
  // A host's web page is kilobytes; a file this big with no known headers is the game itself.
  var WEB_PAGE_BYTES = 4 * 1024 ** 2;
  function durable(fs, stateDir2) {
    try {
      fs.mkdir(stateDir2, { recursive: true });
      // A folder that exists but takes no files (issue #9: every download failed with "Permission
      // denied" before it started) leaves the queue in the app data instead.
      const probe = `${stateDir2}/downloads.probe`;
      fs.writeFile(probe, "", { sync: false });
      fs.remove(probe);
      return true;
    } catch (error2) {
      console.log(`[download-queue] ${stateDir2} unavailable, queue kept in the app data: ${error2.message}`);
      return false;
    }
  }
  function restore(saved) {
    return saved.jobs.slice(0, 32).filter((job2) => {
      const valid = job2?.release?.id && job2.root && job2.artifact?.destination;
      if (!valid) console.log(`[download-queue] dropped an invalid queue entry ${job2?.id ?? ""}`);
      return valid;
    }).map((job2) => {
      delete job2.captureState;
      delete job2.captureError;
      delete job2.captureFile;
      delete job2.fallbacks;
      if (job2.state === "installing") return { ...job2, state: "installer-required" };
      if (job2.state === "extracting") job2.written = job2.total ?? job2.written;
      if (job2.state === "removing") {
        job2.state = job2.removingFrom ?? "failed";
        job2.error = REMOVAL_CUT;
      }
      delete job2.phase;
      delete job2.removingFrom;
      const interrupted = BUSY.includes(job2.state);
      return {
        ...job2,
        state: interrupted ? "paused" : job2.state,
        error: interrupted ? "Interrupted. Resume to continue." : job2.error,
        ...interrupted && job2.state !== "pausing" && { restore: job2.state === "queued" ? "queued" : "running" }
      };
    });
  }
  function createDownloadQueue({
    fs,
    downloads,
    http,
    formats,
    dataDir,
    stateDir: stateDir2 = `${dataDir}/overdrive`,
    platform,
    notifications,
    power,
    linking,
    sources,
    archives,
    packages,
    releasesOf,
    browserCapture,
    wait = (ms) => new Promise((resolve2) => setTimeout(resolve2, ms))
  }) {
    const legacy = `${dataDir}/overdrive/downloads.json`;
    const directory = stateDir2 === `${dataDir}/overdrive` || durable(fs, stateDir2) ? stateDir2 : `${dataDir}/overdrive`;
    const file = `${directory}/downloads.json`;
    const listeners4 = /* @__PURE__ */ new Set();
    sources ?? (sources = createSourceResolver({ http }));
    const captures = /* @__PURE__ */ new Map();
    let jobs = [];
    let active2 = null;
    let ticks = 0;
    let awake2 = false;
    const modified = (path) => {
      try {
        return fs.stat(path)?.modified ?? 0;
      } catch {
        return 0;
      }
    };
    const candidates = [.../* @__PURE__ */ new Set([file, `${file}.tmp`, legacy])].filter((path) => {
      try {
        return fs.exists(path);
      } catch {
        return false;
      }
    }).sort((a, b) => modified(b) - modified(a));
    let stored = null;
    for (const path of candidates) {
      const saved = readJSON(
        fs,
        path,
        null,
        (value) => value?.version === 1 && Array.isArray(value.jobs),
        (message) => console.log(`[download-queue] ${message}`)
      );
      if (saved) {
        jobs = restore(saved);
        stored = path;
        break;
      }
    }
    const snapshot = () => jobs.map((job2) => ({ ...job2 }));
    const emit2 = () => {
      const busy = captures.size > 0 || jobs.some((job2) => BUSY.includes(job2.state));
      if (busy !== awake2) {
        awake2 = busy;
        power.keepAwake(busy);
      }
      const value = snapshot();
      for (const listener of listeners4) listener(value);
    };
    const save = ({ sync = true } = {}) => {
      fs.mkdir(directory, { recursive: true });
      fs.writeFile(`${file}.tmp`, JSON.stringify({ version: 1, jobs }), { sync });
      fs.rename(`${file}.tmp`, file);
    };
    const change = () => {
      save();
      emit2();
    };
    if (legacy !== file && fs.exists(legacy)) {
      try {
        if (stored === legacy) save();
        fs.rename(legacy, `${legacy}.moved`);
      } catch (error2) {
        console.log(`[download-queue] queue not moved to ${file}: ${error2.message}`);
      }
    }
    if (stored === `${file}.tmp`) {
      try {
        save();
      } catch (error2) {
        console.log(`[download-queue] queue not saved to ${file}: ${error2.message}`);
      }
    }
    // A finished download that stayed a ".binary" before its header check knew PS5 packages and its
    // name was read (issues #24, #42) is routed now, once at launch, as a new one would be: a game
    // image to the homebrew folder for ShadowMount+, a PKG to the packages folder to install. One
    // still unknown, or one an archive after all, is left where it is.
    for (const job2 of jobs) {
      if (job2.state !== "file-downloaded" || job2.artifact?.nextAction !== "downloaded" || !/[.](?:binary|bin)$/i.test(job2.downloadDestination || "")) continue;
      const before = job2.artifact;
      try {
        if (!fs.exists(job2.downloadDestination)) continue;
        // At launch nothing is downloading yet, so the synchronous read does not wait on the drive.
        route(job2, archives?.inspect?.([job2.downloadDestination]));
        if (!["shadowmount", "installer-required"].includes(job2.artifact.nextAction)) {
          job2.artifact = before;
          continue;
        }
        job2.state = job2.artifact.nextAction === "shadowmount" ? "downloaded" : "installer-required";
        console.log(`[download-queue] ${job2.id}: a finished ".binary" is now ${job2.downloadDestination}`);
        change();
      } catch (error2) {
        if (!job2.routing) job2.artifact = before;
        console.log(`[download-queue] ${job2.id}: a finished ".binary" stays as it is: ${error2.message}`);
      }
    }
    // An archive's image published before 1.0.7 stayed inside "<homebrew>/<name>-extracted/", where
    // ShadowMount+ never looks (issue #42): it moves to the homebrew folder itself, once at launch.
    for (const job2 of jobs) {
      const folder = job2.publishTo;
      const image = job2.artifact?.destination;
      if (job2.state !== "downloaded" || job2.artifact?.nextAction !== "shadowmount" || job2.published || !folder?.endsWith("-extracted") || !image?.startsWith(`${folder}/`)) continue;
      try {
        if (!fs.exists(image)) continue;
        const [target] = publishedImages(job2, [image]);
        if (fs.exists(target)) throw new Error(`${target} already exists`);
        storageIdentity(job2);
        fs.rename(image, target);
        job2.published = [target];
        job2.artifact.destination = target;
        console.log(`[download-queue] ${job2.id}: the image moved out of its extraction folder to ${target}`);
        change();
      } catch (error2) {
        console.log(`[download-queue] ${job2.id}: an extracted image stays where it is: ${error2.message}`);
      }
    }
    const find = (id) => {
      const job2 = jobs.find((item) => item.id === id);
      if (!job2) throw new Error("Download is no longer in the queue.");
      return job2;
    };
    const artifactFor = (release, root2) => release.parts ? {
      directory: `${root2}/downloads/sets/${release.filename}`,
      destination: `${root2}/downloads/extracted/${release.filename}`,
      nextAction: "extracted"
    } : formats.artifact(release, root2);
    // Datanodes' dlproxy.uk gateway (FileKeeper's files too) can answer every range HTTP 503 with
    // Retry-After: 60 for a while. The engine honours it, with its connections down to a few, and the
    // download sits at 0 MB/s for minutes; a new transfer of the same link, which Pause and Resume
    // start, goes on at full speed at once (issue #77). So a download from it that gets nothing for
    // STALL_MS starts over by itself, from what it has written. A third start in a row with nothing
    // received asks the source for a new link; past STALL_RESTARTS the engine's own retries decide.
    var STALL_MS = 9e4;
    var STALL_RESTARTS = 10;
    function restartsAfterStall(job2) {
      try {
        return /(?:^|\.)dlproxy\.uk$/.test(webURL(job2.options?.url).host);
      } catch {
        return false;
      }
    }
    function stallWatch(job2, task) {
      let moved = Date.now(), seen = -1;
      return (progress) => {
        const bytes = (progress.received || 0) + (progress.completedBytes ?? progress.written ?? 0);
        if (bytes !== seen) {
          if (seen >= 0 && job2.stalls) {
            console.log(`[download-queue] ${job2.id}: receiving again after ${job2.stalls} restart(s)`);
            delete job2.stalls;
          }
          seen = bytes;
          moved = Date.now();
          return;
        }
        if (active2?.restarting || Date.now() - moved < STALL_MS || !["connecting", "downloading"].includes(progress.state) || !restartsAfterStall(job2)) return;
        if ((job2.stalls || 0) >= STALL_RESTARTS) return;
        job2.stalls = (job2.stalls || 0) + 1;
        // Only FileKeeper's link comes from a form the app posts again; DataNodes' needs the browser.
        const relink = job2.stalls % 3 === 0 && sourceKind(job2.release) === "filekeeper";
        console.log(`[download-queue] ${job2.id}: nothing received for ${Math.round((Date.now() - moved) / 1e3)} s (connections ${progress.connections || 0}, retries ${progress.retries || 0}); restart ${job2.stalls} of ${STALL_RESTARTS}${relink ? ", with a new link from the source" : ""}`);
        if (relink) delete job2.options;
        active2.restarting = true;
        task.cancel();
      };
    }
    function reresolve(job2) {
      const source2 = job2.parts ? job2.currentSource : job2.release;
      if ((job2.reresolved || 0) >= 2 || ["direct", "browser", "datanodes", "buzzheavier", "manifest", "unavailable"].includes(sourceKind(source2))) return false;
      job2.reresolved = (job2.reresolved || 0) + 1;
      delete job2.options;
      if (job2.parts) delete job2.parts[job2.partIndex].options;
      job2.error = "";
      job2.state = "queued";
      return true;
    }
    // Deletes the PKGs the console installed, when settings ask it (on by default): the ones it refused
    // stay to be installed by hand. An archive's extraction folder goes whole once every package in it
    // is installed, its other files with it. Returns the bytes freed; a file that won't go stays.
    async function deleteInstalled(job2, paths, installed) {
      if (!deletesPackages() || !installed.length) return 0;
      const size = (path) => fs.stat(path)?.size || 0;
      const freed = installed.reduce((sum, path) => sum + size(path), 0);
      const folder = job2.packages && installed.length === paths.length && job2.output?.startsWith(`${job2.root}/downloads/extracted/`) ? job2.output : null;
      try {
        if (folder) await fs.removeAsync(folder);
        else for (const path of installed) await Promise.all([path, `${path}.complete`].map((item) => fs.removeAsync(item)));
        console.log(`[download-queue] ${job2.id}: installed, so ${folder || installed.join(", ")} deleted (${freed} bytes)`);
        return freed;
      } catch (error2) {
        console.log(`[download-queue] ${job2.id}: installed, but the PKG was not deleted: ${error2.message}`);
        return 0;
      }
    }
    async function install(job2) {
      const paths = job2.packages ?? [job2.downloadDestination || job2.artifact.destination];
      const backport = (path) => /backport/i.test(path);
      const installed = [];
      try {
        for (const path of [...paths.filter((path2) => !backport(path2)), ...paths.filter(backport)]) {
          job2.state = "installing";
          job2.written = 0;
          job2.total = null;
          job2.error = "";
          job2.message = "";
          change();
          const task = packages.install({ path, name: job2.title });
          active2.task = task;
          const off = task.subscribe((progress) => {
            job2.written = progress.written || 0;
            job2.total = progress.total ?? null;
            emit2();
          });
          try {
            await task.done;
            installed.push(path);
          } catch (error2) {
            console.log(`[download-queue] install refused ${path}:`, error2.message);
            if (!backport(path) || paths.every(backport)) throw error2;
          } finally {
            off();
          }
        }
        job2.state = "installed";
        const freed = await deleteInstalled(job2, paths, installed);
        if (freed) job2.packagesDeleted = true;
        job2.message = freed ? t("downloads.installedFreed", { size: formatBytes(freed) }) : t("downloads.installed");
        notifications.show(t("downloads.notice.installed"), job2.title);
      } catch (error2) {
        job2.state = "installer-required";
        // The install's own reason is shown as it is (issue #44): putting the 11.60 limit in its place
        // blamed the firmware on an 11.60 console, whose jailbreak reports a higher one to the title,
        // and hid the usual cause, no payload loader on port 9021, which errors.js turns into "install
        // it by hand". The 11.60 limit is told before the download, in its tips.
        job2.error = error2.message;
        job2.message = t("downloads.installFailed");
      }
      job2.bytesPerSecond = 0;
      delete job2.install;
      change();
    }
    const canInstall = () => Boolean(packages) && platform === "ps5";
    async function execute(job2) {
      let task;
      let unsubscribe;
      if (job2.install) {
        try {
          await install(job2);
        } finally {
          active2 = null;
          pump();
        }
        return;
      }
      try {
        active2.cancel = cancellation();
        const signal = active2.cancel.signal;
        job2.state = "resolving";
        job2.error = "";
        change();
        if (job2.release.parts) {
          await executeSet(job2, signal);
          return;
        }
        job2.downloadDestination || (job2.downloadDestination = job2.artifact.destination);
        if (job2.routing) finishRouting(job2);
        if (!job2.options) {
          if (job2.release.manifestUrl) {
            const response = await http.request(job2.release.manifestUrl, { maxBytes: 4 * 1024 * 1024, signal });
            if (!response.ok) throw new Error(`Manifest HTTP ${response.status}. Choose another source or retry.`);
            job2.options = formats.manifest(await response.json());
          } else {
            if (!job2.release.url && !job2.release.browserUrl) throw new Error("This release has no download URL.");
            const resolved = job2.directURL || sourceKind(job2.release) !== "direct" ? await sources.resolve(job2.release, { signal, directURL: job2.directURL }) : { url: webURL(job2.release.url).url };
            job2.options = {
              ...resolved,
              rejectHtml: true,
              // A source that reads its file's real length (FileKeeper) outweighs the catalog's.
              expectedBytes: resolved.expectedBytes || job2.release.sizeBytes || void 0,
              sha256: job2.release.sha256 || void 0
            };
            delete job2.directURL;
          }
          job2.total = job2.options.expectedBytes || null;
          change();
        }
        if (job2.state === "pausing") return;
        const root2 = storageIdentity(job2);
        if (!job2.rootIdentity) {
          job2.rootIdentity = root2;
          change();
        }
        const held = Math.max(job2.written, fs.stat(`${job2.downloadDestination}.part`)?.size || 0);
        if (!fs.exists(job2.downloadDestination) && fs.diskUsage(job2.root).free < stillNeeded({ ...job2, written: held }) + MARGIN2)
          throw new Error("Not enough space on the selected drive. Free space and retry.");
        fs.mkdir(job2.artifact.directory, { recursive: true });
        active2.transferring = true;
        const rangeBytes = fs.exists(job2.downloadDestination + ".part")
          ? job2.checkpointRangeBytes || job2.options.rangeBytes || 16 * 1024 * 1024
          : 4 * 1024 * 1024;
        if (job2.options.rangeBytes !== rangeBytes || job2.checkpointRangeBytes !== rangeBytes) {
          job2.options.rangeBytes = job2.checkpointRangeBytes = rangeBytes;
          change();
        }
        task = downloads.enqueue({ ...job2.options, rejectHtml: true, mirrors: void 0, connections: 64, adaptive: true, rangeBytes: job2.options.rangeBytes, destination: job2.downloadDestination, storageRoot: job2.root, recoverCompleted: true });
        active2.task = task;
        const stalled = stallWatch(job2, task);
        unsubscribe = task.subscribe((progress) => {
          if (job2.state === "pausing") return;
          if (ACTIVE.includes(progress.state)) job2.state = progress.state;
          stalled(progress);
          const completedBytes = progress.completedBytes ?? progress.written ?? 0;
          if (completedBytes > 0 || !job2.written) job2.written = completedBytes;
          job2.total = progress.total ?? job2.total;
          job2.received = progress.received || 0;
          job2.connections = progress.connections || 0;
          job2.bytesPerSecond = progress.bytesPerSecond || 0;
          if (job2.written > 0) delete job2.adopted;
          if (++ticks % 20 === 0) {
            delete job2.launches;
            try {
              save({ sync: false });
            } catch (error2) {
              job2.error = `Queue save failed: ${error2.message}`;
              task.cancel();
            }
            if (["extraction-required", "downloaded"].includes(job2.artifact.nextAction)) checkHeaders(job2, `${job2.downloadDestination}.part`, task);
          }
          emit2();
        });
        await task.done;
        if (job2.artifact.nextAction === "downloaded") route(job2, archives?.inspect && await headers([job2.downloadDestination], "downloaded"));
        job2.state = job2.artifact.nextAction === "shadowmount" ? "downloaded" : job2.artifact.nextAction === "downloaded" ? "file-downloaded" : job2.artifact.nextAction;
        job2.written = job2.total || job2.written;
        job2.bytesPerSecond = 0;
        if ((job2.artifact.nextAction === "extraction-required" || job2.output) && archives) await extract(job2, [job2.downloadDestination]);
        delete job2.reresolved;
        notifications.show(t("downloads.notice.complete"), job2.title);
        if (job2.state === "installer-required" && canInstall()) await install(job2);
      } catch (error2) {
        console.log("[download-queue] transfer stopped:", error2.message);
        // Stopped by stallWatch: it starts over at once, as Pause and Resume would.
        if (active2.restarting && job2.state !== "pausing" && !job2.cancelling) {
          job2.state = "queued";
          job2.error = "";
          return;
        }
        // The engine words every 401/403 as a possible browser check; from Archive.org it is a
        // restricted or removed item, so it reads as a dead link.
        const refused = archiveRefusal(job2.parts ? job2.currentSource : job2.release, cause(error2.message));
        if (refused) error2 = new Error(`Source unavailable: HTTP ${refused}. Choose another source.`);
        // A link captured from the browser may wait in the queue past its life: refused before a byte
        // was written, it asks for the page's check again instead of reading as a dead source.
        const unwritten = !(job2.parts ? job2.parts[job2.partIndex]?.written : job2.written);
        const expired = !refused && job2.capturedLink && unwritten && /HTTP (?:401|403|404|410)/.test(cause(error2.message));
        if (expired) console.log("[download-queue] the captured link expired while queued; asking for the check again");
        const browser = !refused && (expired || error2 instanceof BrowserRequired || /browser verification required/i.test(cause(error2.message)));
        const retried = job2.state !== "pausing" && !job2.cancelling && browser && active2.transferring && reresolve(job2);
        // A source that fails stays failed: the player picks another (the automatic switch to an
        // "equivalent" source was removed on 2026-10-16 at the user's request).
        if (!retried && job2.state !== "pausing") {
          job2.state = browser ? "awaiting-browser" : "failed";
          job2.error || (job2.error = job2.adopted && STALE_PARTIAL.test(cause(error2.message)) ? ADOPTED : error2.message);
          if (browser) {
            delete job2.capturedLink;
            if (expired) job2.error = "The captured link expired while it waited in the queue. Open the source and pass its check again.";
            job2.browserUrl = (expired ? null : error2.url) || job2.currentSource?.browserUrl || job2.currentSource?.url || job2.release.browserUrl || job2.release.url;
            delete job2.options;
            if (job2.parts) delete job2.parts[job2.partIndex].options;
          } else if (!job2.cancelling) notifications.show(t("downloads.notice.failed"), job2.title);
        }
      } finally {
        unsubscribe?.();
        if (job2.state === "pausing") job2.state = "paused";
        if (COMPLETE.includes(job2.state)) delete job2.launches;
        const restarted = active2.restarting && job2.state === "queued";
        active2 = null;
        // A cancelled download's files are deleted after the queue moves on: deleting tens of GB from a
        // USB drive can take long, and the next download sat "queued" at 0 MB the whole time.
        if (job2.cancelling) void forgetCancelled(job2);
        try {
          change();
        } catch (error2) {
          job2.error = `Queue save failed: ${error2.message}`;
          emit2();
        }
        pump(restarted ? job2 : void 0);
      }
    }
    // Headers are read on a native worker thread (issue #71): a download's growing file can make the
    // read wait for the drive until the download ends, and on the render thread that froze the app.
    async function headers(sources, why) {
      const started = Date.now();
      let found;
      try {
        found = archives.inspectAsync ? await archives.inspectAsync(sources) : archives.inspect(sources);
      } catch (error2) {
        console.log(`[download-queue] header check (${why}) off the render thread failed, reading it here: ${error2.message}`);
        found = archives.inspect(sources);
      }
      console.log(`[download-queue] header check (${why}): ${found.kind || "no known format"}${found.refusal ? `, refused: ${found.refusal}` : ""} in ${Date.now() - started} ms (waited ${found.waitedMs ?? 0} ms, read ${found.tookMs ?? 0} ms)`);
      return found;
    }
    const inspections = /* @__PURE__ */ new WeakMap();
    const checking = /* @__PURE__ */ new WeakSet();
    // While the file downloads, so a refused archive stops early; the download goes on meanwhile. A
    // result that comes once the transfer has ended is left to the check after it.
    function checkHeaders(job2, path, task) {
      const tries = inspections.get(job2) || 0;
      if (job2.inspected || checking.has(job2) || tries >= 3 || !archives?.inspect || !fs.exists(path)) return;
      inspections.set(job2, tries + 1);
      checking.add(job2);
      headers([path], "while downloading").then(({ kind, refusal, title }) => {
        if (!kind || ["completed", "failed", "cancelled"].includes(task.snapshot.state)) return;
        job2.inspected = kind;
        noteTitle(job2, title);
        if (refusal) {
          job2.error = refusal;
          task.cancel();
        }
      }, (error2) => console.log(`[download-queue] header check failed: ${error2.message}`)).finally(() => checking.delete(job2));
    }
    // `found`: the finished file's headers, or nothing without the archives module.
    function route(job2, found) {
      if (!found) return;
      const { kind, refusal, title } = found;
      if (refusal) throw new Error(refusal);
      noteTitle(job2, title);
      // A source listed without a format is kept only for what its headers turn out to be: when they
      // are none Overdrive knows, the host sent something else, usually a web page. Leaving it as a
      // downloaded ".binary" (issue #8) told the user nothing. Only a small file reads as one, though:
      // gigabytes the headers don't name are still the game, in a format not checked (issue #24).
      if (!kind && job2.release.format === "binary" && (fs.stat(job2.downloadDestination)?.size || 0) < WEB_PAGE_BYTES) throw new Error("Not a game file: the host sent something else.");
      const named = kind ? null : namedKind(job2);
      if (!kind && !named) return;
      if (named) console.log(`[download-queue] headers name no format; the file's name says ${named}`);
      const artifact2 = formats.detected(job2.release, job2.root, kind || named);
      if (artifact2.nextAction === "extraction-required") {
        job2.artifact = { ...job2.artifact, format: kind, nextAction: artifact2.nextAction };
        return;
      }
      if (fs.exists(artifact2.destination)) throw new Error("Destination already exists. Choose another release or inspect the existing file.");
      fs.mkdir(artifact2.directory, { recursive: true });
      job2.routing = artifact2;
      change();
      finishRouting(job2);
    }
    // A game image or package whose first bytes the header check does not know (a .ffpfsc that does
    // not open on "PFSC", a PS5 package) would stay a ".binary" ShadowMount+ never sees (issues #24,
    // #42). Its name still tells: the one the host gave it, the link's own path, else the format the
    // same link has in another listing of this game. Archives are left to their headers, which name
    // every kind Overdrive extracts.
    function namedKind(job2) {
      const kinds = [...formats.images, "pkg", "fpkg"];
      const kindOf = (name) => {
        const lower = String(name || "").toLowerCase().replace(/[?#].*$/, "");
        const found = kinds.find((kind) => lower.endsWith(`.${kind}`));
        return found === "fpkg" ? "pkg" : found;
      };
      const segments = (url) => {
        try {
          return webURL(url).path.replace(/[?#].*$/, "").split("/").map((part) => {
            try {
              return decodeURIComponent(part);
            } catch {
              return part;
            }
          });
        } catch {
          return [];
        }
      };
      const fromName = kindOf(job2.fileName) || [job2.options?.url, job2.release.url].flatMap(segments).map(kindOf).find(Boolean);
      if (fromName) return fromName;
      if (!releasesOf) return null;
      const urls = new Set([job2.release.url, job2.release.browserUrl].filter(Boolean));
      const listed = releasesOf(job2.gameId).flatMap((release) => release.parts ? release.parts.flatMap((part) => part.sources) : [release]);
      return listed.filter((item) => urls.has(item.url) || urls.has(item.browserUrl)).map((item) => kindOf(`.${item.format}`) || kindOf(item.filename)).find(Boolean) || null;
    }
    function finishRouting(job2) {
      const from = job2.downloadDestination, to = job2.routing.destination;
      if (fs.exists(from)) fs.rename(from, to);
      if (fs.exists(`${from}.complete`)) fs.rename(`${from}.complete`, `${to}.complete`);
      job2.artifact = job2.routing;
      job2.downloadDestination = to;
      delete job2.routing;
      change();
    }
    // A dump can hold its game beside a patch, an update or an optional backport, each a folder with
    // its own eboot.bin (issue #76). gameFolder follows a lone folder down and takes it whatever its
    // name: a backported game's folder is often named so, and a merged dump "(Base + Update)". When
    // it gives up beside a second folder, every folder holding a game is listed. One is taken as it
    // was before (unless named a patch or an update); among several, patches, updates and backports
    // are left out by the names below the folder that holds them all (it may name a backport for
    // every one of them), then the chosen game's title id decides. Only one left is taken, else
    // nothing moves.
    var PATCH_FOLDER = /(?:^|[-_ .(\[])(?:patch|update|upd)(?:$|[-_ .)\]\d])/i;
    var BACKPORT_FOLDER = /(?:^|[-_ .(\[])backport(?:$|[-_ .)\]\d])/i;
    function gameFolders(output) {
      const found = [];
      const queue = [{ path: output, depth: 0 }];
      for (let visited = 0; queue.length && visited < 2e3 && found.length < 16; visited++) {
        const { path, depth } = queue.shift();
        if (fs.exists(`${path}/eboot.bin`) && fs.exists(`${path}/sce_sys/param.json`)) {
          found.push(path);
          continue;
        }
        if (depth >= 6) continue;
        let children;
        try {
          children = fs.readDir(path).filter((entry2) => entry2.isDirectory && !entry2.name.startsWith(".ps5-react"));
        } catch {
          continue;
        }
        for (const child of children) queue.push({ path: `${path}/${child.name}`, depth: depth + 1 });
      }
      return found;
    }
    function findGame(job2, output) {
      const lone = gameFolder(output);
      if (lone) return { folder: lone, beside: false };
      const found = gameFolders(output);
      const shown = (path) => path.slice(output.length) || "/";
      if (found.length) console.log(`[download-queue] game folders in ${output}: ${found.map(shown).join(", ")}`);
      const name = (path) => path.slice(path.lastIndexOf("/") + 1);
      let games;
      if (found.length > 1) {
        const parts = found.map((path) => path.split("/"));
        let shared = 0;
        while (parts.every((list) => shared < list.length - 1 && list[shared] === parts[0][shared])) shared++;
        const supplemental = (list) => list.slice(shared).some((segment) => PATCH_FOLDER.test(segment) || BACKPORT_FOLDER.test(segment));
        games = found.filter((path, index) => !supplemental(parts[index]));
      } else games = found.filter((path) => !PATCH_FOLDER.test(name(path)));
      const titled = games.filter((path) => String(titleIn(path) || "").toUpperCase() === String(job2.titleId || "").toUpperCase());
      if (titled.length) games = titled;
      if (games.length !== 1) {
        if (found.length) console.log(`[download-queue] none of them is plainly the game; left where they were extracted`);
        return { folder: null, beside: false };
      }
      console.log(`[download-queue] taking ${shown(games[0])} as the game`);
      return { folder: games[0], beside: true };
    }
    function gameFolder(output) {
      for (let depth = 0; depth <= 16; depth++) {
        if (fs.exists(`${output}/eboot.bin`) && fs.exists(`${output}/sce_sys/param.json`)) return output;
        let children;
        try {
          children = fs.readDir(output).filter((entry2) => entry2.isDirectory && !entry2.name.startsWith(".ps5-react"));
        } catch {
          return null;
        }
        if (children.length !== 1) return null;
        output = `${output}/${children[0].name}`;
      }
      return null;
    }
    // The extractor writes files 0666, without execute: ShadowMount mounts the folder, but its
    // eboot.bin won't launch (CE-107750-0, issue #11) until everything is opened up, as the updater
    // does for Overdrive's own folder. A frame every 256 entries keeps a large game from stalling the UI.
    async function openUp(path) {
      let count = 0;
      const visit = async (dir2) => {
        fs.chmod(dir2, 511);
        for (const entry2 of fs.readDir(dir2)) {
          if (++count % 256 === 0) await wait(0);
          if (entry2.isDirectory) await visit(`${dir2}/${entry2.name}`);
          else fs.chmod(`${dir2}/${entry2.name}`, 511);
        }
      };
      try {
        await visit(path);
      } catch (error2) {
        console.log("[download-queue] permissions not opened up:", error2.message);
      }
    }
    function extraction(job2, files) {
      if (!archives) throw new Error("Archive extraction requires the updated PS5 React runtime.");
      if (releasesOf) {
        const stored2 = job2.release.parts ? job2.release.parts.flatMap((part) => part.sources) : [job2.release];
        const current = releasesOf(job2.gameId).flatMap((release) => release.parts ? release.parts.flatMap((part) => part.sources) : [release]);
        for (const source2 of stored2) {
          const match = current.find((item) => item.url && item.url === source2.url && item.browserUrl === source2.browserUrl);
          if (source2.archivePassword == null && match?.archivePassword) source2.archivePassword = match.archivePassword;
        }
      }
      const password = archivePassword(job2.release);
      storageIdentity(job2);
      const directory2 = `${job2.root}/downloads/extracted`;
      fs.mkdir(directory2, { recursive: true });
      job2.output || (job2.output = `${directory2}/${folderName(job2.release)}`);
      if (job2.publishTo && fs.exists(job2.publishTo)) job2.output = job2.publishTo;
      return {
        sources: files,
        destination: job2.output,
        ...password !== void 0 ? { password } : {},
        maxBytes: fs.exists(job2.output) ? 1024 ** 4 : Math.min(1024 ** 4, Math.max(1, fs.diskUsage(job2.root).free - MARGIN2))
      };
    }
    const STREAM_FAILURE = /RAR worker|Only a RAR set|extraction thread|archive task is already running|^RAR extraction failed|^Extraction cancelled/;
    async function forgetPart(job2, error2) {
      const part = job2.parts?.[Number(INCOMPLETE_PART.exec(error2.message)?.[1]) - 1];
      if (!part) return false;
      try {
        await Promise.all(["", ".complete"].map((suffix) => fs.removeAsync(part.destination + suffix)));
      } catch (failure) {
        console.log("[download-queue] incomplete volume not deleted:", failure.message);
        return false;
      }
      part.completed = false;
      part.written = 0;
      delete part.options;
      return true;
    }
    async function extract(job2, files, streamed) {
      const options = extraction(job2, files);
      const downloaded = { written: job2.written, total: job2.total };
      let estimate = files.reduce((sum, path) => sum + (fs.stat(path)?.size || 0), 0) || null;
      // The archive's own size stands in for what it unpacks to until the engine reads that from its headers.
      // Games unpack to far more (issue #54: a 107.9 GB set to over 160 GB): past the guess the row counts
      // what is written, with no total, instead of holding at 99%.
      let guessed = true;
      job2.state = "extracting";
      job2.extractedFiles = 0;
      job2.written = 0;
      job2.total = estimate;
      job2.bytesPerSecond = 0;
      change();
      let sample = { at: Date.now(), bytes: 0 };
      const report = (bytes) => {
        const now = Date.now();
        if (guessed && estimate && bytes > estimate * 0.99) job2.total = estimate = null;
        job2.written = estimate ? Math.min(bytes, estimate * 0.99) : bytes;
        if (now - sample.at >= 1e3) {
          const speed = (bytes - sample.bytes) * 1e3 / (now - sample.at);
          job2.bytesPerSecond = job2.bytesPerSecond ? job2.bytesPerSecond * 0.7 + speed * 0.3 : speed;
          sample = { at: now, bytes };
        }
        emit2();
      };
      const follow = (progress) => {
        job2.extractedFiles = progress.entries || 0;
        // A total at the extraction's cap is the space free, not the files' size: they are bigger.
        if (progress.total && progress.total !== estimate && progress.total < options.maxBytes) {
          job2.total = estimate = progress.total;
          guessed = false;
        }
        if (progress.phase !== "finishing") {
          report(progress.written || 0);
          return;
        }
        if (job2.phase === "finishing") return;
        job2.phase = "finishing";
        job2.bytesPerSecond = 0;
        if (job2.total) job2.written = job2.total;
        emit2();
      };
      let result;
      try {
        if (streamed) {
          active2.task = streamed.task;
          sample = { at: Date.now(), bytes: streamed.written };
          report(streamed.written);
          const off = streamed.task.subscribe(follow);
          const outcome = await streamed.done;
          off();
          if (outcome.error && (job2.state === "pausing" || job2.cancelling)) throw outcome.error;
          // A password the stream couldn't use gets the known ones below, once every volume is here.
          if (outcome.error && !STREAM_FAILURE.test(cause(outcome.error.message)) && !PASSWORD_FAILURE.test(cause(outcome.error.message))) throw outcome.error;
          if (outcome.error) {
            console.log("[download-queue] extraction during download stopped, extracting again:", outcome.error.message);
            job2.written = 0;
            job2.extractedFiles = 0;
            delete job2.phase;
            sample = { at: Date.now(), bytes: 0 };
            emit2();
          }
          result = outcome.result;
        }
        if (!result) {
          if (!fs.exists(job2.output) && fs.diskUsage(job2.root).free < (estimate || 0) + MARGIN2)
            throw new Error("Not enough space to extract this download. Free space and retry.");
          const { password: listed, ...unlocked } = options;
          const passwords = [listed, ...KNOWN_PASSWORDS.filter((password) => password !== listed)];
          for (let index = 0; !result; index++) {
            const task = archives.extract(passwords[index] === void 0 ? unlocked : { ...unlocked, password: passwords[index] });
            active2.task = task;
            const off = task.subscribe(follow);
            try {
              result = await task.done;
            } catch (error2) {
              const last = index + 1 >= passwords.length;
              if (last || job2.state === "pausing" || job2.cancelling || !PASSWORD_FAILURE.test(cause(error2.message))) throw error2;
              console.log(`[download-queue] archive password ${index + 1} of ${passwords.length} did not open it, trying the next`);
              job2.written = 0;
              job2.extractedFiles = 0;
              sample = { at: Date.now(), bytes: 0 };
              emit2();
            } finally {
              off();
            }
          }
        }
      } catch (error2) {
        if (await forgetPart(job2, error2)) downloaded.written = job2.parts.reduce((sum, part) => sum + part.written, 0);
        throw error2;
      } finally {
        Object.assign(job2, downloaded, { bytesPerSecond: 0 });
        delete job2.extractedFiles;
        delete job2.phase;
      }
      const images = (result.artifacts || []).filter((path) => /\.(ffpfsc|ffpfs|ffpkg|exfat)$/i.test(path));
      if (images.length) {
        // ShadowMount+ finds an image only directly in the homebrew folder (issue #42: one left in a
        // "-extracted" folder there was never mounted), so the image file itself is published there,
        // named as a downloaded image would be; the archive's other files stay where it was extracted.
        const targets = publishedImages(job2, images);
        // A target already there while its image is still in the extraction is another file: kept.
        if (targets.some((target, index) => fs.exists(target) && fs.exists(`${job2.output}/${images[index]}`)))
          throw new Error("Extracted destination already exists; preserve it and inspect before retrying.");
        fs.mkdir(`${job2.root}/homebrew`, { recursive: true });
        storageIdentity(job2);
        images.forEach((image, index) => fs.exists(`${job2.output}/${image}`) && fs.rename(`${job2.output}/${image}`, targets[index]));
        job2.published = targets;
        job2.artifact.nextAction = "shadowmount";
        job2.artifact.destination = targets[0];
        job2.state = "downloaded";
        job2.message = t("downloads.extractedReady", { parts: job2.parts ? "all" : "one" });
      } else {
        job2.state = "extracted";
        job2.message = t("downloads.extractedTo", { path: job2.output });
        const packaged = (result.artifacts || []).filter((path) => /\.(pkg|fpkg)$/i.test(path));
        const { folder, beside } = packaged.length ? { folder: null, beside: false } : findGame(job2, job2.output);
        if (packaged.length) {
          job2.packages = packaged.map((path) => `${job2.output}/${path}`);
          job2.state = "installer-required";
          job2.message = t("downloads.packagesExtracted", { path: job2.output });
        } else if (folder) {
          noteTitle(job2, titleIn(folder));
          const destination = `${job2.root}/homebrew/${folderName(job2.release)}-app`;
          fs.mkdir(`${job2.root}/homebrew`, { recursive: true });
          if (fs.exists(destination)) throw new Error("Extracted destination already exists; preserve it and inspect before retrying.");
          storageIdentity(job2);
          const extracted = job2.output;
          fs.rename(folder, destination);
          // Whatever the wider search found the game beside (a patch, DLC, another game) stays where
          // it was extracted; a lone folder's leftovers are only the archive's loose files.
          if (folder !== extracted && !beside) await fs.removeAsync(extracted);
          await openUp(destination);
          job2.output = destination;
          job2.publishTo = destination;
          job2.artifact.nextAction = "shadowmount";
          job2.artifact.destination = destination;
          job2.state = "downloaded";
          job2.message = t("downloads.extractedReady", { parts: job2.parts ? "all" : "one" });
          if (beside) job2.message = `${job2.message} ${t("downloads.extractedLeft", { path: extracted })}`;
        } else {
          // No PKG and no game folder (a source holding something else): said, not left silent.
          job2.message = t("downloads.extractedNothing", { path: job2.output });
          console.log(`[download-queue] ${job2.id}: extracted to ${job2.output}, nothing in it to install`);
        }
      }
      change();
      try {
        await Promise.all(files.flatMap((path) => [path, `${path}.complete`]).map((path) => fs.removeAsync(path)));
        if (job2.release.parts) await fs.removeAsync(setDirectory(job2));
      } catch (error2) {
        console.log("[download-queue] archive not deleted:", error2.message);
        job2.message = `${job2.message} ${t("downloads.archiveNotDeleted", { error: error2.message })}`;
      }
    }
    async function streamSet(job2) {
      const first = job2.parts[0].destination;
      if (!archives?.streams || job2.parts.length < 2 || (await headers([first], "streamed set")).kind !== "rar") return null;
      let task;
      try {
        const options = extraction(job2, job2.parts.map((part) => part.destination));
        if (fs.exists(options.destination)) return null;
        change();
        task = archives.extract({ ...options, stream: true });
      } catch (error2) {
        console.log("[download-queue] extraction during download not started:", error2.message);
        return null;
      }
      const streamed = { task, written: 0 };
      const off = task.subscribe((progress) => {
        streamed.written = progress.written || 0;
      });
      streamed.done = task.done.then((result) => ({ result }), (error2) => ({ error: error2 })).finally(off);
      return streamed;
    }
    const setDirectory = (job2) => `${job2.root}/downloads/sets/${job2.release.filename}`;
    function setNeed(job2, extracted = 0) {
      const sizes = job2.parts.map((item) => item.total ?? item.options?.expectedBytes ?? null);
      const largest = Math.max(0, ...sizes.filter(Boolean));
      const size = (index) => sizes[index] ?? largest;
      return Math.max(0, job2.parts.reduce((sum, item, index) => sum + size(index) + (item.completed ? 0 : Math.max(0, size(index) - item.written)), 0) - extracted);
    }
    // Where an archive's images are published: the homebrew folder itself, under the name a
    // downloaded image of this release takes (a second image gets "-2", and so on).
    function publishedImages(job2, images) {
      return images.map((image, index) => `${job2.root}/homebrew/${folderName(job2.release)}${index ? `-${index + 1}` : ""}.${image.split(".").pop().toLowerCase()}`);
    }
    function ownedPaths(job2) {
      const managed = (path) => {
        const parts = path.startsWith(`${job2.root}/`) ? path.slice(job2.root.length + 1).split("/") : [];
        return !parts.some((part) => ["", ".", ".."].includes(part)) && (parts[0] === "homebrew" && parts.length >= 2 || parts[0] === "downloads" && parts.length >= 3);
      };
      const extracted = job2.output && [folderName(job2.release), legacyFolderName(job2.release)].map((name) => `${job2.root}/downloads/extracted/${name}`);
      const paths = [
        job2.artifact.destination,
        job2.downloadDestination,
        job2.output,
        job2.publishTo,
        ...job2.published || [],
        ...extracted || [],
        job2.release.parts && setDirectory(job2)
      ].filter(Boolean).flatMap((path) => [path, ...[".complete", ".complete.tmp", ".part", ".resume", ".resume.tmp"].map((suffix) => path + suffix)]);
      return [...new Set(paths)].filter((path) => managed(path) && !jobs.some((other) => other !== job2 && [other.artifact.destination, other.downloadDestination, other.output, other.publishTo].some((owned2) => owned2 && (owned2 === path || owned2.startsWith(`${path}/`)))));
    }
    async function executeSet(job2, signal) {
      if (job2.release.unavailableReason) throw new Error(job2.release.unavailableReason);
      const root2 = storageIdentity(job2);
      if (!job2.rootIdentity) job2.rootIdentity = root2;
      fs.mkdir(job2.artifact.directory, { recursive: true });
      job2.parts || (job2.parts = job2.release.parts.map((part) => ({
        number: part.number,
        destination: `${job2.artifact.directory}/part-${part.number}.bin`,
        written: 0,
        completed: false
      })));
      let streamed = null;
      try {
        for (let index = 0; index < job2.parts.length; index++) {
          if (!streamed && index > 0 && job2.parts[0].completed && fs.exists(job2.parts[0].destination)) streamed = active2.streamed = await streamSet(job2);
          job2.partIndex = index;
          const part = job2.parts[index];
          if (job2.state === "pausing") return;
          if (part.completed && fs.exists(part.destination)) continue;
          if (part.completed) {
            part.completed = false;
            part.written = 0;
            delete part.options;
          }
          job2.state = "resolving";
          job2.message = t("downloads.part", { part: index + 1, parts: job2.parts.length });
          active2.transferring = false;
          change();
          const source2 = job2.release.parts[index].sources[part.sourceIndex || 0];
          job2.currentSource = source2;
          if (!part.options) {
            const resolved = await sources.resolve(source2, { signal, directURL: job2.directURL });
            part.options = { ...resolved, expectedBytes: resolved.expectedBytes || source2.sizeBytes || void 0, sha256: source2.sha256 || void 0 };
            delete job2.directURL;
            change();
          }
          if (job2.state === "pausing") return;
          storageIdentity(job2);
          if (!fs.exists(part.destination) && fs.diskUsage(job2.root).free < setNeed(job2, streamed?.written) + MARGIN2)
            throw new Error("Not enough space for the remaining volumes and their extraction. Free space and resume.");
          active2.transferring = true;
          const rangeBytes = fs.exists(part.destination + ".part")
            ? part.checkpointRangeBytes || part.options.rangeBytes || 32 * 1024 * 1024
            : 4 * 1024 * 1024;
          if (part.options.rangeBytes !== rangeBytes || part.checkpointRangeBytes !== rangeBytes) {
            part.options.rangeBytes = part.checkpointRangeBytes = rangeBytes;
            change();
          }
          const task = downloads.enqueue({
            ...part.options,
            rejectHtml: true,
            connections: 64,
            adaptive: true,
            destination: part.destination,
            storageRoot: job2.root,
            recoverCompleted: true
          });
          active2.task = task;
          const off = task.subscribe((progress) => {
            if (job2.state === "pausing") return;
            if (ACTIVE.includes(progress.state)) job2.state = progress.state;
            const completedBytes = progress.completedBytes ?? progress.written ?? 0;
            if (completedBytes > 0 || !part.written) part.written = completedBytes;
            part.total = progress.total;
            job2.written = job2.parts.reduce((sum, item) => sum + item.written, 0);
            job2.total = job2.parts.every((item) => item.total != null) ? job2.parts.reduce((sum, item) => sum + item.total, 0) : null;
            job2.received = progress.received || 0;
            job2.connections = progress.connections || 0;
            job2.bytesPerSecond = progress.bytesPerSecond || 0;
            if (++ticks % 20 === 0) {
              delete job2.launches;
              try {
                save({ sync: false });
              } catch (error2) {
                job2.error = `Queue save failed: ${error2.message}`;
                task.cancel();
              }
              if (index === 0) checkHeaders(job2, `${part.destination}.part`, task);
            }
            emit2();
          });
          let result;
          try {
            result = await task.done;
          } finally {
            off();
          }
          part.written = result.written ?? part.total ?? part.written;
          job2.written = job2.parts.reduce((sum, item) => sum + item.written, 0);
          part.completed = true;
          change();
          const refusal = index === 0 && archives?.inspect && (await headers([part.destination], "first part")).refusal;
          if (refusal) throw new Error(refusal);
        }
      } finally {
        delete active2.streamed;
        if (streamed && (job2.state === "pausing" || job2.parts.some((part) => !part.completed))) {
          streamed.task.cancel();
          await streamed.done;
          streamed = null;
        }
      }
      if (job2.state === "pausing") return;
      await extract(job2, job2.parts.map((part) => part.destination), streamed);
      notifications.show(t("downloads.notice.complete"), job2.title);
      if (job2.state === "installer-required" && canInstall()) await install(job2);
    }
    function lostPartial(job2) {
      const kept = (path) => fs.exists(path) || fs.exists(`${path}.part`);
      if (job2.parts) return job2.parts.some((part) => (part.written || part.completed) && !kept(part.destination));
      return job2.written > 0 && !kept(job2.downloadDestination || job2.artifact.destination);
    }
    function holding(root2) {
      const lost = jobs.filter((job2) => job2.root === root2 && ["paused", "failed"].includes(job2.state) && lostPartial(job2));
      const unmarked = lost.filter((job2) => job2.error !== DELETED);
      for (const job2 of unmarked) job2.error = DELETED;
      if (unmarked.length) change();
      return jobs.filter((job2) => job2.root === root2 && (BUSY.includes(job2.state) || job2.state === "paused") && !lost.includes(job2));
    }
    function pump(first) {
      // An open verification no longer holds the queue: what is queued downloads meanwhile.
      if (active2) return;
      const job2 = first?.state === "queued" ? first : jobs.find((item) => item.state === "queued");
      if (!job2) return;
      active2 = { job: job2, task: null };
      void execute(job2);
    }
    function storageIdentity(job2) {
      const info = fs.stat(job2.root);
      if (!info?.isDirectory) throw new Error("Storage disconnected. Reconnect the selected drive.");
      if (typeof info.device !== "string" || typeof info.inode !== "string") throw new Error("Storage identity is unavailable. Update the runtime.");
      const identity = `${info.device}:${info.inode}`;
      if (job2.rootIdentity && job2.rootIdentity !== identity) {
        if (job2.root !== "/data") throw new Error("Storage changed. Reconnect the original drive.");
        job2.rootIdentity = identity;
      }
      return identity;
    }
    function partialFiles(job2) {
      storageIdentity(job2);
      if (!job2.rootIdentity) throw new Error("This older task has no storage identity. Preserve and inspect its partial files.");
      if (fs.exists(job2.parts?.[job2.partIndex]?.destination || job2.downloadDestination || job2.artifact.destination)) throw new Error("A final file exists. Retry to verify and recover it.");
      const destination = job2.parts?.[job2.partIndex]?.destination || job2.downloadDestination || job2.artifact.destination;
      const paths = [".part", ".resume", ".resume.tmp", ".complete", ".complete.tmp"].map((suffix) => destination + suffix);
      for (const path of paths) {
        const info = fs.stat(path);
        if (info && !info.isFile) throw new Error(`Cannot discard a non-file: ${path}`);
      }
      return paths;
    }
    function setFiles(job2) {
      storageIdentity(job2);
      if (!job2.rootIdentity) throw new Error("This older task has no storage identity. Preserve and inspect its partial files.");
      const extracted = job2.output?.startsWith(`${job2.root}/downloads/extracted/`) && !job2.publishTo ? [job2.output] : [];
      return [setDirectory(job2), ...extracted].filter((path) => !jobs.some((other) => other !== job2 && [other.release.parts && setDirectory(other), other.output, other.publishTo, other.artifact.destination, other.downloadDestination].some((owned2) => owned2 && (owned2 === path || owned2.startsWith(`${path}/`)))));
    }
    const removePath = (path) => fs.removeAsync(path).catch((error2) => {
      throw new Error(`Its files were not deleted: ${error2.message}`);
    });
    const removeAll = (paths) => Promise.all(paths.map(removePath));
    async function removing(job2, work) {
      const state = job2.state;
      job2.state = "removing";
      job2.removingFrom = state;
      try {
        change();
      } catch {
        emit2();
      }
      let result;
      try {
        result = await work();
      } catch (error2) {
        console.log(`[download-queue] ${job2.id} not deleted:`, error2.message);
        job2.state = state;
        delete job2.removingFrom;
        job2.error = error2.message;
        try {
          change();
        } catch {
          emit2();
        }
        throw error2;
      }
      job2.state = state;
      delete job2.removingFrom;
      return result;
    }
    const onOriginalStorage = (job2) => {
      try {
        storageIdentity(job2);
        return true;
      } catch {
        return false;
      }
    };
    async function forgetCancelled(job2) {
      const started = Date.now();
      console.log(`[download-queue] ${job2.id} cancelled; deleting its files`);
      try {
        await forget(job2);
        console.log(`[download-queue] ${job2.id} files deleted in ${Math.round((Date.now() - started) / 1e3)} s`);
      } catch (error2) {
        delete job2.cancelling;
        job2.error = error2.message;
        console.log(`[download-queue] ${job2.id} files not deleted:`, error2.message);
      }
      try {
        change();
      } catch {
        emit2();
      }
      pump();
    }
    async function forget(job2) {
      if ((job2.rootIdentity || job2.written) && !job2.adopted && onOriginalStorage(job2)) {
        const paths = job2.release.parts ? setFiles(job2) : partialFiles(job2);
        if (job2.state === "queued") job2.state = "paused";
        await removing(job2, () => removeAll(paths));
      }
      const previous = jobs;
      jobs = jobs.filter((item) => item !== job2);
      try {
        save();
      } catch (error2) {
        jobs = previous;
        throw error2;
      }
    }
    async function shadowRequest2(route2, body = {}) {
      if (platform !== "ps5") throw new Error("ShadowMount registration requires a PS5.");
      return shadowRequest(http, route2, body);
    }
    async function registered3(job2) {
      const paths = [job2.artifact.destination, job2.output, job2.publishTo, ...job2.published || []].filter(Boolean);
      const info = (title) => shadowRequest2("games/info", { title_id: title }).catch((error2) => {
        if (/HTTP 404/.test(error2.message)) return null;
        throw error2;
      });
      const listed2 = await info(job2.consoleTitleId ?? job2.titleId);
      if (within2(listed2?.path, paths, job2.root)) return listed2;
      for (const image of await mountedImages(shadowRequest2, paths, job2.root).catch(() => null) ?? []) {
        const title = mountedTitle(image);
        if (!title || title === listed2?.title_id) continue;
        const game = await info(title);
        if (within2(game?.path, paths, job2.root)) {
          job2.consoleTitleId = title;
          noteTitle(job2, title);
          return game;
        }
      }
      return !fs.exists(job2.artifact.destination) && listed2?.managed ? listed2 : null;
    }
    function titleIn(folder) {
      try {
        return JSON.parse(fs.readFile(`${folder}/sce_sys/param.json`)).titleId || null;
      } catch {
        return null;
      }
    }
    // The title id the files themselves carry (a PKG's header, an extracted or mounted game's
    // param.json) against the game the player chose. A link can bring another game's file past
    // every check before it downloads; this is the one that reads the game itself. Another region
    // of the same game has its own id too, so a difference is shown on the row, never acted on.
    function noteTitle(job2, title) {
      if (!title || !job2.titleId || job2.titleMismatch || String(title).toUpperCase() === String(job2.titleId).toUpperCase()) return;
      job2.titleMismatch = String(title).toUpperCase();
      console.log(`[download-queue] ${job2.id}: the files are ${job2.titleMismatch}, the game chosen is ${job2.titleId}`);
      change();
    }
    function mountedTitle(image) {
      let folders = [];
      try {
        folders = fs.readDir(image.mount_point).filter((entry2) => entry2.isDirectory).map((entry2) => `${image.mount_point}/${entry2.name}`);
      } catch {
      }
      for (const folder of [image.mount_point, ...folders]) {
        const title = titleIn(folder);
        if (title) return title;
      }
      return null;
    }
    async function logStorage(log2) {
      try {
        const { mounts = [] } = await shadowRequest2("storage");
        for (const mount of mounts) {
          log2(`statfs ${mount.mount_point} (${mount.source}, ${mount.filesystem}): total ${mount.total_bytes}, free ${mount.free_bytes}, available ${mount.available_bytes}, used ${mount.used_bytes}`);
        }
      } catch (error2) {
        log2(`storage not read: ${error2.message}`);
      }
    }
    const deletions = /* @__PURE__ */ new WeakMap();
    async function deleteJob(job2) {
      const log2 = (message) => console.log(`[download-queue] delete ${job2.id}: ${message}`);
      const paths = ownedPaths(job2);
      let uninstall = null;
      if (job2.artifact.nextAction === "shadowmount" && platform === "ps5") {
        const check = () => mountedImages(shadowRequest2, paths, job2.root).catch((error2) => {
          throw new Error(`ShadowMount could not say whether the image is mounted, so its files were kept: ${error2.message}`);
        });
        let mounted = await check();
        if (mounted === null) log2("ShadowMount is not running, so none of its files is mounted");
        else {
          let released = false;
          const game = await registered3(job2).catch((error2) => {
            log2(`game info failed: ${error2.message}`);
            return void 0;
          });
          log2(game ? `ShadowMount game ${game.title_id} at ${game.path}, runtime ${game.runtime_path || "none"}, installed ${game.installed}, managed ${game.managed}, mounted ${game.mounted}` : `ShadowMount ${game === null ? "has no game" : "was not asked about the game"} of ${job2.titleId}`);
          log2(mounted.length ? `mounted: ${mounted.map((image) => image.path).join(", ")}` : "none of its files is mounted");
          if (game !== null) {
            try {
              await shadowRequest2("games/uninstall", { title_id: game?.title_id ?? job2.installedTitleId ?? job2.titleId });
              log2("uninstalled");
              released = true;
            } catch (error2) {
              log2(`uninstall failed: ${error2.message}`);
              const unknown = /HTTP 404/.test(error2.message);
              if (game?.installed || game === void 0 && !unknown) throw new Error(`ShadowMount did not uninstall it, so its files were kept: ${error2.message}`);
              if (!unknown) uninstall = error2;
            }
          }
          const titles = new Set(mounted.map((image) => game && within2(game.path, [image.path], job2.root) ? game.title_id : mountedTitle(image)));
          if (game?.mounted) titles.add(game.title_id);
          titles.delete(null);
          for (const title of titles) {
            await shadowRequest2("games/unmount", { title_id: title }).then(() => {
              log2(`unmounted ${title}`);
              released = true;
            }, (error2) => log2(`unmount of ${title} failed: ${error2.message}`));
          }
          for (let attempt = 0; mounted.length && released && attempt < 5; attempt++) {
            if (attempt) await wait(1e3);
            mounted = await check() ?? [];
          }
          if (mounted.length) {
            log2(`still mounted: ${mounted.map((image) => image.path).join(", ")}`);
            throw new Error(`ShadowMount still has ${mounted[0].path} mounted, so its files were kept. Close any game and try again; if it stays mounted, delete the game from ShadowMount's web page (port 10101), which unmounts it first.`);
          }
        }
      }
      const before = fs.diskUsage(job2.root).free;
      for (const path of paths) {
        if (!fs.exists(path)) continue;
        const info = fs.stat(path);
        await removePath(path);
        log2(`deleted ${path}${info?.isDirectory ? " (folder)" : `, ${info?.size || 0} bytes`}`);
      }
      const after = fs.diskUsage(job2.root).free;
      log2(`${job2.root} free went from ${before} to ${after} bytes (${after - before} freed)`);
      if (platform === "ps5") void logStorage(log2);
      const previous = jobs;
      jobs = jobs.filter((item) => item !== job2);
      try {
        save();
      } catch (error2) {
        jobs = previous;
        throw error2;
      }
      emit2();
      return uninstall;
    }
    async function markInstalled(candidates2) {
      let found = false;
      let learned = false;
      for (const job2 of candidates2) {
        const known = job2.consoleTitleId;
        const game = await registered3(job2);
        learned || (learned = job2.consoleTitleId !== known);
        if (!game?.installed || !jobs.includes(job2) || job2.state !== "downloaded") continue;
        job2.state = "installed";
        job2.message = t("downloads.installed");
        job2.error = "";
        job2.installedTitleId = game.title_id;
        found = true;
      }
      if (found || learned) change();
      return found;
    }
    async function checkInstalls(id) {
      const candidates2 = jobs.filter((job2) => job2.state === "downloaded" && job2.artifact.nextAction === "shadowmount" && (id === void 0 || job2.id === id));
      if (platform !== "ps5" || !candidates2.length) return false;
      try {
        return await markInstalled(candidates2);
      } catch (error2) {
        console.log("[download-queue] ShadowMount install check failed:", error2.message);
        return false;
      }
    }
    let syncing = null;
    const syncInstalls = (id) => syncing ?? (syncing = checkInstalls(id).finally(() => {
      syncing = null;
    }));
    let running;
    for (const job2 of jobs.filter((item) => item.restore)) {
      const was = job2.restore;
      delete job2.restore;
      try {
        storageIdentity(job2);
        fs.diskUsage(job2.root);
      } catch {
        continue;
      }
      if (was === "running" && (job2.launches || 0) >= 2) continue;
      if (was === "running") {
        job2.launches = (job2.launches || 0) + 1;
        running = job2;
      }
      job2.state = "queued";
      job2.error = "";
    }
    if (jobs.some((job2) => job2.state === "queued")) {
      change();
      pump(running);
    }
    function stopCapture(job2) {
      const session = captures.get(job2.id);
      if (session) {
        captures.delete(job2.id);
        session.cancel.cancel();
        session.task?.cancel();
      }
      delete job2.captureState;
      delete job2.captureError;
      delete job2.captureMode;
      delete job2.captureFile;
    }
    function continueJob(job2, url, verifiedOptions) {
      if (job2.state !== "awaiting-browser" || active2?.job === job2) return;
      webURL(url);
      if (!(job2.parts?.[job2.partIndex]?.written ?? job2.written) && job2.rootIdentity && !job2.adopted) {
        for (const path of partialFiles(job2)) if (fs.exists(path)) fs.remove(path);
      }
      if (job2.parts) job2.parts[job2.partIndex].options = verifiedOptions;
      job2.options = job2.parts ? void 0 : verifiedOptions;
      job2.directURL = verifiedOptions ? void 0 : url;
      // Captured from the browser: if it waits in the queue too long, its refusal means expired.
      job2.capturedLink = Boolean(verifiedOptions);
      stopCapture(job2);
      delete job2.reresolved;
      job2.message = "";
      job2.error = "";
      job2.state = "queued";
      change();
      pump(job2);
    }
    // A multi-volume archive's last volume is smaller than the others. When a Vikingfile set's last
    // listed volume is as big as its first, the archive goes on past it and can never be extracted
    // (issue #42: 100 GB downloaded for nothing): checked from both pages' public sizes before the
    // first volume downloads. A page that can't be read lets the download go on, as before.
    const SIZE_UNITS = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, KIB: 1024, MIB: 1024 ** 2, GIB: 1024 ** 3, TIB: 1024 ** 4 };
    const pageBytes = (metadata) => metadata?.displaySize ? metadata.displaySize.value * (SIZE_UNITS[metadata.displaySize.unit] ?? 0) : 0;
    async function lastVolumeIsFull(job2, first, signal) {
      if (!job2.parts || job2.parts.length < 2 || job2.partIndex !== 0) return false;
      const lastPart = job2.release.parts?.at(-1);
      const last = lastPart?.sources?.[job2.parts.at(-1)?.sourceIndex || 0];
      if (!last || vikingLinkPage(last) || !/vik[i1]ngfile\.(?:com|site)\/f\//.test(last.browserUrl || last.url || "")) return false;
      try {
        const lastMetadata = await describeVikingCapture(http, last, signal);
        const [firstBytes, lastBytes] = [pageBytes(first), pageBytes(lastMetadata)];
        // The pages round sizes ("9.90 GB"): only a last volume shown at least as big as the first
        // counts as full, as all 30 cut sets found on 2026-10-18 were.
        return firstBytes > 0 && lastBytes >= firstBytes;
      } catch (error2) {
        console.log("[browser-capture] the last volume's page could not be read:", error2.message);
        return false;
      }
    }
    async function captureBrowser(job2, source2, session) {
      const current = () => captures.get(job2.id) === session && jobs.includes(job2) && job2.state === "awaiting-browser";
      let handingOff = false;
      try {
        const linkPage = vikingLinkPage(source2);
        console.log("[browser-capture] source:", sourceForLog(source2, job2.browserUrl));
        const deadline = Date.now() + (linkPage ? LINK_CAPTURE_SECONDS : 180) * 1e3;
        let metadata = null;
        if (linkPage) {
          // A vault hides which Vikingfile page it opens, so the capture first takes that page; its
          // public metadata then names the file exactly, as a direct Vikingfile source's does.
          session.task = browserCapture.capture({ prefix: VIKING_PAGE_PREFIX, suffix: "/", timeoutSeconds: LINK_CAPTURE_SECONDS });
        } else {
          console.log("[browser-capture] reading public file metadata");
          metadata = await describeVikingCapture(http, source2, session.cancel.signal);
          if (!current()) return;
          if (await lastVolumeIsFull(job2, metadata, session.cancel.signal)) {
            if (!current()) return;
            console.log("[browser-capture] the set's last volume is as big as the first: the archive goes on past it");
            captures.delete(job2.id);
            job2.state = "failed";
            job2.error = "Incomplete RAR archive or missing volume.";
            delete job2.captureState;
            change();
            pump();
            return;
          }
          session.task = browserCapture.capture({ prefix: VIKING_PREFIX, suffix: `/${metadata.filename}`, timeoutSeconds: 180 });
        }
        await armedCapture(session.task);
        if (!current()) return;
        job2.captureState = "capturing";
        change();
        console.log("[browser-capture] capture armed; opening browser");
        if (!linking?.openURL(webURL(job2.browserUrl).url)) throw new Error("The browser could not open. Retry or enter the final file link.");
        if (linkPage) {
          const page = await session.task.done;
          if (!current()) return;
          console.log("[browser-capture] the vault opened", page.url, "- reading its public file metadata");
          metadata = await describeVikingCapture(http, { ...source2, url: page.url, browserUrl: page.url }, session.cancel.signal);
          if (!current()) return;
          requirePart(linkPageMetadata(source2).part, metadata.filename);
          const seconds = Math.floor((deadline - Date.now()) / 1e3);
          if (seconds < 5) throw new Error("The verification ran out of time. Reopen the page and retry.");
          console.log("[browser-capture] Vikingfile names", metadata.filename, "- capturing that file");
          session.task = browserCapture.capture({ prefix: VIKING_PREFIX, suffix: `/${metadata.filename}`, timeoutSeconds: seconds, resume: true });
        }
        const result = await session.task.done;
        if (!current()) return;
        job2.captureState = "validating";
        change();
        console.log("[browser-capture] link captured:", linkForLog(result.url), "- validating one-byte range");
        const validated = await validateVikingCapture(http, result.url, metadata, session.cancel.signal);
        if (!current()) return;
        if (metadata.filename) job2.fileName = metadata.filename;
        source2.sizeBytes = validated.expectedBytes;
        if (!job2.parts) job2.total = validated.expectedBytes;
        notifications.show(t("downloads.notice.captured"), job2.title);
        console.log("[browser-capture] file validated; handing off to queue");
        handingOff = true;
        continueJob(job2, validated.url, {
          url: validated.url,
          expectedBytes: validated.expectedBytes,
          sha256: source2.sha256 || void 0,
          rejectHtml: true
        });
        console.log("[browser-capture] handoff finished; state:", job2.state);
      } catch (error2) {
        if (!current() && !(handingOff && jobs.includes(job2) && job2.state === "queued" && active2?.job !== job2)) return;
        console.log("[browser-capture] failed:", error2.message);
        session.cancel.cancel();
        session.task?.cancel();
        captures.delete(job2.id);
        job2.state = "awaiting-browser";
        job2.captureState = "failed";
        job2.captureError = error2.message;
        change();
        pump();
      }
    }
    // A file that names no game waits for the player's word, shown in the capture dialog.
    function confirmCapturedFile(job2, session, found) {
      return new Promise((resolve) => {
        session.decide = (accepted) => {
          delete session.decide;
          delete job2.captureFile;
          resolve(accepted);
        };
        session.cancel.signal.addEventListener("abort", () => session.decide?.(false));
        job2.captureState = "confirm";
        job2.captureFile = { name: found.filename, bytes: found.expectedBytes };
        change();
      });
    }
    /** The same capture for a host whose check only the browser can pass: the vault's mirrors,
     * Akirabox, Datanodes. The file link appears on the page, or when its download starts, and the
     * browser's memory is read for it: the human never types it. */
    async function captureBrowserLink(job2, source2, session) {
      const current = () => captures.get(job2.id) === session && jobs.includes(job2) && job2.state === "awaiting-browser";
      let handingOff = false;
      try {
        const anchor = captureAnchor(job2.titleId);
        console.log("[browser-capture] source:", sourceForLog(source2, job2.browserUrl), "- watching any file link carrying", anchor);
        // A LinkVault record's catalog size is the whole vault's, not the file's: compared with the
        // captured file it refused the right one every time. Only a direct host's size is evidence.
        const vaulted = webURL(job2.browserUrl).host === "link-vault.org";
        const catalogBytes = vaulted ? null : source2.sizeBytes || null;
        const akiraBox = /(?:^|\.)akirabox\.(?:com|to)$/.test(webURL(job2.browserUrl).host) || vaulted && /#AkiraBox$/.test(job2.browserUrl);
        const akiraPart = akiraBox ? linkPageMetadata(source2).part : null;
        // A link the probe refuses (a page, an expired route) does not end the session: the payload
        // scans on past it until the deadline, as Orbit Store 1.3.5 does, up to six refusals. The
        // restart resumes from the first pass's fingerprints, so the links that appeared since stay new.
        const deadline = Date.now() + LINK_CAPTURE_SECONDS * 1e3;
        const rejected = [];
        let validated = null;
        while (!validated) {
          const seconds = Math.floor((deadline - Date.now()) / 1e3);
          if (seconds < 5) throw new Error("Captured file failed validation or expired. Reopen the page and retry.");
          const resume = rejected.length > 0;
          session.task = browserCapture.capture({ prefix: LINK_PREFIX, suffix: `/${anchor}`, timeoutSeconds: seconds, rejected, resume });
          if (!resume) {
            await armedCapture(session.task);
            if (!current()) return;
            console.log("[browser-capture] capture armed; opening browser");
            if (!linking?.openURL(webURL(job2.browserUrl).url)) throw new Error("The browser could not open. Retry or enter the final file link.");
          }
          job2.captureState = "capturing";
          change();
          const result = await session.task.done;
          if (!current()) return;
          job2.captureState = "validating";
          change();
          if (otherSourceLink(result.url, source2)) {
            if (rejected.length >= 6) throw new Error("Captured link belongs to another source. Reopen the page and retry.");
            console.log("[browser-capture] passed over", linkForLog(result.url), "- another source's link, scanning on");
            rejected.push(result.url);
            continue;
          }
          console.log("[browser-capture] link captured:", linkForLog(result.url), "- validating one-byte range");
          let found;
          try {
            found = await validateCapturedLink(http, result.url, { anchor, sizeBytes: catalogBytes }, session.cancel.signal);
            // An AkiraBox set's parts are captured one by one, and the part before is still in the
            // browser's memory, on the same host and named for the same game: the file has to be the
            // part this source is.
            if (akiraPart) requirePart(akiraPart, found.filename);
          } catch (error2) {
            if (!current() || rejected.length >= 6) throw error2;
            console.log("[browser-capture] refused", linkForLog(result.url), "and scanning on:", error2.message);
            rejected.push(result.url);
            continue;
          }
          if (found.unbound) {
            console.log(`[browser-capture] ${linkForLog(result.url)} names no game (${found.filename || "no file name"}, ${found.expectedBytes} bytes); asking the player`);
            const accepted = await confirmCapturedFile(job2, session, found);
            if (!current()) return;
            console.log("[browser-capture] player", accepted ? "accepted it" : "refused it");
            if (!accepted) {
              if (rejected.length >= 6) throw new Error("None of the captured files was this game's. Reopen the page and retry.");
              rejected.push(result.url);
              continue;
            }
          }
          validated = found;
        }
        if (!current()) return;
        if (validated.filename) job2.fileName = validated.filename;
        // The file's real length replaces the one the catalog could not know, as for Vikingfile.
        source2.sizeBytes = validated.expectedBytes;
        if (!job2.parts) job2.total = validated.expectedBytes;
        notifications.show(t("downloads.notice.captured"), job2.title);
        console.log("[browser-capture] file validated; handing off to queue");
        handingOff = true;
        continueJob(job2, validated.url, {
          url: validated.url,
          expectedBytes: validated.expectedBytes,
          sha256: source2.sha256 || void 0,
          rejectHtml: true
        });
        console.log("[browser-capture] handoff finished; state:", job2.state);
      } catch (error2) {
        if (!current() && !(handingOff && jobs.includes(job2) && job2.state === "queued" && active2?.job !== job2)) return;
        console.log("[browser-capture] failed:", error2.message);
        session.cancel.cancel();
        session.task?.cancel();
        captures.delete(job2.id);
        job2.state = "awaiting-browser";
        job2.captureState = "failed";
        job2.captureError = error2.message;
        change();
        pump();
      }
    }
    return {
      snapshot,
      subscribe(listener) {
        listeners4.add(listener);
        listener(snapshot());
        return () => listeners4.delete(listener);
      },
      enqueue(game, release, root2) {
        const id = `${game.id}/${release.id}`;
        const existing = jobs.find((job2) => job2.id === id);
        if (existing) return existing.id;
        if (release.unavailableReason) throw new Error(release.unavailableReason);
        const artifact2 = artifactFor(release, root2);
        if (fs.exists(artifact2.destination)) throw new Error("Destination already exists. Choose another release or inspect the existing file.");
        if (jobs.some((job2) => job2.artifact.destination === artifact2.destination)) throw new Error("Another queued release owns this filename.");
        const orphan = fs.exists(`${artifact2.destination}.part`);
        if (jobs.length === 32) jobs = jobs.filter((job2) => !COMPLETE.includes(job2.state));
        if (jobs.length === 32) throw new Error("Queue has 32 unfinished downloads. Finish or remove one first.");
        if (release.sizeBytes) {
          const pending2 = holding(root2);
          const held = orphan ? Math.min(fs.stat(`${artifact2.destination}.part`)?.size || 0, release.sizeBytes) : 0;
          const need = stillNeeded({ release, artifact: artifact2, total: release.sizeBytes, written: held });
          const shortfall = spaceShortfall(root2, need, fs.diskUsage(root2).free, pending2);
          if (shortfall) throw new Error(shortfall);
        }
        jobs.push({
          id,
          gameId: game.id,
          titleId: game.titleId || game.id,
          title: game.title,
          release: { ...release },
          requestedId: release.id,
          root: root2,
          artifact: artifact2,
          state: "queued",
          written: 0,
          total: release.sizeBytes || null,
          error: ""
        });
        try {
          if (orphan) Object.assign(jobs.at(-1), { rootIdentity: storageIdentity(jobs.at(-1)), adopted: true });
          change();
        } catch (error2) {
          jobs.pop();
          throw error2;
        }
        if (active2) console.log(`[download-queue] ${id} queued behind ${active2.job.id} (${active2.job.state})`);
        pump();
        return id;
      },
      pause(id) {
        const job2 = find(id);
        if (job2.state === "queued") job2.state = "paused";
        else if (active2?.job === job2 && ACTIVE.includes(job2.state)) {
          job2.state = "pausing";
          active2.cancel?.cancel();
          active2.task?.cancel();
        }
        change();
      },
      /** Installs a downloaded PKG again, after the console refused it or the app closed while installing. */
      install(id) {
        const job2 = find(id);
        if (job2.state !== "installer-required" || !canInstall()) return;
        job2.install = true;
        job2.state = "queued";
        job2.error = "";
        change();
        pump();
      },
      get installs() {
        return canInstall();
      },
      resume(id) {
        const job2 = find(id);
        if (job2.state !== "paused" && job2.state !== "failed") return;
        delete job2.reresolved;
        job2.state = "queued";
        job2.error = "";
        change();
        pump();
      },
      async restart(id) {
        const job2 = find(id);
        if (!["paused", "failed", "awaiting-browser"].includes(job2.state) || active2?.job === job2) return;
        if (job2.adopted) throw new Error(ADOPTED);
        const paths = !job2.parts?.[job2.partIndex]?.completed && (job2.options || job2.rootIdentity || job2.written || fs.exists(job2.artifact.destination + ".part") || fs.exists(job2.artifact.destination + ".resume")) ? partialFiles(job2) : [];
        stopCapture(job2);
        if (paths.length) await removing(job2, () => removeAll(paths));
        delete job2.directURL;
        delete job2.reresolved;
        if (job2.parts?.[job2.partIndex] && !job2.parts[job2.partIndex].completed) {
          job2.parts[job2.partIndex].written = 0;
          delete job2.parts[job2.partIndex].options;
          delete job2.parts[job2.partIndex].checkpointRangeBytes;
        }
        job2.written = job2.parts ? job2.parts.reduce((sum, part) => sum + part.written, 0) : 0;
        job2.bytesPerSecond = 0;
        delete job2.options;
        delete job2.checkpointRangeBytes;
        delete job2.inspected;
        job2.state = "queued";
        job2.error = "";
        change();
        pump();
      },
      remove(id) {
        const job2 = find(id);
        if (!["paused", "failed", "awaiting-browser", ...COMPLETE].includes(job2.state) || active2?.job === job2) return;
        stopCapture(job2);
        const previous = jobs;
        jobs = jobs.filter((item) => item !== job2);
        try {
          save();
        } catch (error2) {
          jobs = previous;
          throw error2;
        }
        emit2();
        pump();
      },
      /**
       * Uninstalls a finished game from ShadowMount and, once ShadowMount's image list shows none of the
       * task's paths mounted, deletes everything the task put on its drive and forgets it. A ShadowMount
       * that does not answer mounts nothing, so the files go. Each step is logged.
       */
      async deleteFromDisk(id) {
        const job2 = find(id);
        if (deletions.has(job2)) return deletions.get(job2);
        if (!COMPLETE.includes(job2.state)) return;
        const deletion = (async () => {
          storageIdentity(job2);
          const uninstall = await removing(job2, () => deleteJob(job2));
          if (uninstall) throw new Error(`Deleted from disk, but ShadowMount did not uninstall it: ${uninstall.message}`);
        })().finally(() => deletions.delete(job2));
        deletions.set(job2, deletion);
        return deletion;
      },
      openBrowser(id) {
        const job2 = find(id);
        if (job2.state !== "awaiting-browser") return;
        const source2 = job2.parts ? job2.currentSource : job2.release;
        const viking = sourceKind(source2) === "vikingfile" || vikingLinkPage(source2);
        const anchor = viking ? "" : captureAnchor(job2.titleId);
        if (browserCapture && (viking || anchor)) {
          if (captures.has(id)) return;
          // A verification may be done while another download runs: the captured link waits in the
          // queue for its turn, and if it expired by then the download asks for the check again. The
          // console's browser is read for one capture at a time.
          if (captures.size) throw new Error("Another download's verification is open. Finish or cancel it first.");
          const session = { cancel: cancellation(), task: null };
          captures.set(id, session);
          job2.captureState = "preparing";
          delete job2.captureError;
          // A vault's Vikingfile capture takes the vault's longer window, and says so.
          if (viking && !vikingLinkPage(source2)) delete job2.captureMode;
          else job2.captureMode = "link";
          change();
          if (viking) void captureBrowser(job2, source2, session);
          else void captureBrowserLink(job2, source2, session);
          return;
        }
        if (!linking?.openURL(webURL(job2.browserUrl).url)) throw new Error("The browser could not open. Open this source on another device.");
        job2.message = t("downloads.afterVerification");
        change();
      },
      /** The player's answer about a captured file that names no game: download it, or scan on. */
      confirmCapturedFile(id, accepted) {
        captures.get(id)?.decide?.(Boolean(accepted));
      },
      cancelBrowserCapture(id, { manual = false } = {}) {
        const job2 = find(id);
        stopCapture(job2);
        if (manual) job2.captureState = "failed";
        change();
        pump();
      },
      continueWithURL(id, url) {
        continueJob(find(id), url);
      },
      /** Marks finished images (all, or job `id`'s) ShadowMount has installed since as installed; false when none or it can't be asked. */
      syncInstalls,
      /** A package the Files screen installed by itself: the download it came from no longer offers "Install
       * PKG" (testers, 2026-10-18). Only a download still waiting for its install moves. */
      packageInstalled(path) {
        let found = false;
        for (const job2 of jobs) {
          const paths = [job2.artifact?.destination, job2.downloadDestination, job2.output, ...job2.packages ?? []];
          if (job2.state !== "installer-required" || !paths.includes(path)) continue;
          job2.state = "installed";
          job2.message = t("downloads.installed");
          job2.error = "";
          found = true;
        }
        if (found) change();
        return found;
      },
      /** Frees the engine's one archive task, for the updater: a set extracting while it downloads extracts after its download instead. */
      async yieldArchives() {
        const streamed = active2?.streamed;
        if (streamed) {
          streamed.task.cancel();
          await streamed.done;
        }
      },
      /** Whether the queue keeps the console awake: some download is queued or running. */
      get awake() {
        return awake2;
      },
      /** Discards the partial file and forgets the task; an active one is paused first. */
      async cancel(id) {
        const job2 = find(id);
        if (COMPLETE.includes(job2.state) || job2.state === "removing") return;
        if (active2?.job === job2) {
          job2.cancelling = true;
          this.pause(id);
          return;
        }
        stopCapture(job2);
        await forget(job2);
        emit2();
        pump();
      },
      async register(id) {
        const job2 = find(id);
        if (job2.artifact.nextAction !== "shadowmount" || !COMPLETE.includes(job2.state)) return;
        try {
          if (await markInstalled([job2]).catch(() => false)) return;
          const version2 = await shadowRequest2("version");
          if (!version2.capabilities?.includes("rescan")) throw new Error("This ShadowMount version has no rescan API. Use its automatic scan.");
          await shadowRequest2("scan", { reset_attempts: false });
          job2.message = t("downloads.installRequested");
          job2.error = "";
        } catch (error2) {
          job2.error = error2.message;
        }
        change();
      }
    };
  }

export { BUSY, COMPLETE, createDownloadQueue };
