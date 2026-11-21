// ../pub-game-store/native/state/updater.js
// reconstructed from the esbuild bundle in eboot.bin

import { formatBytes } from './size.js';

  var SECTOR = 512;
  var MIN_IMAGE_BYTES = 1024 ** 2;
  var MIB = 1024 ** 2;
  var MTIME_SLACK_MS = 2e3;
  var STUCK_LAUNCHES = 2;
  var BUDGET_MS = 8;
  var CHANGES_PER_FRAME = 8;
  var log = (message) => console.log(`overdrive: update ${message}`);
  var ImageReplaceError = class extends Error {
  };
  function newer(a, b) {
    const parts = (version2) => version2.replace(/^v/, "").split(".").map(Number);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++)
      if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  }
  function createUpdater({ http, downloads, archives, fs, version: version2, feeds, asset, installDir, image, workDir, marker, now = Date.now }) {
    // Every feed is asked, a feed that fails is only said in the log, and the newest release among
    // those that answered is the update: GitHub being down, or gone, must not make an install that
    // could update look current. A release is still refused without its sha256, whichever feed
    // carried it, because installing one replaces the app's image.
    async function check() {
      const installed = installedImage();
      if (installed) return installed;
      const answers = await Promise.allSettled(feeds.map(async ({ url }) => {
        const response = await http.request(url, { headers: { Accept: "application/vnd.github+json", "User-Agent": "Overdrive" }, maxBytes: 1024 ** 2 });
        if (!response.ok) throw new Error(`Update feed ${url} answered HTTP ${response.status}`);
        return response.json();
      }));
      const said = [];
      const found = [];
      answers.forEach((answer, index) => {
        const { name } = feeds[index];
        if (answer.status === "rejected") {
          said.push(`${name} ${answer.reason?.message ?? answer.reason}`);
          return;
        }
        const release = answer.value;
        const file = (release.assets || []).find((item) => item.name === asset);
        const sha256 = /^sha256:([0-9a-f]{64})$/i.exec(file?.digest || "")?.[1];
        if (!release.tag_name || !newer(release.tag_name, version2) || !file || !sha256) {
          said.push(`${name}: nothing to offer`);
          return;
        }
        said.push(`${name}: v${release.tag_name.replace(/^v/, "")}`);
        found.push({ version: release.tag_name.replace(/^v/, ""), notes: release.body || "", url: file.browser_download_url, size: file.size, sha256 });
      });
      log(said.join("; "));
      return found.reduce((best, item) => (!best || newer(item.version, best.version) ? item : best), null);
    }
    const entriesOf = (dir2) => fs.readDir(dir2).filter((entry2) => !entry2.name.startsWith(".ps5-react-"));
    function contentOf(dir2) {
      const entries2 = entriesOf(dir2);
      return entries2.length === 1 && entries2[0].isDirectory ? contentOf(`${dir2}/${entries2[0].name}`) : dir2;
    }
    function pacer(perFrame) {
      let since = now(), steps = 0;
      async function frame() {
        await new Promise((resolve2) => setTimeout(resolve2, 0));
        since = now();
        steps = 0;
      }
      async function step() {
        if (steps >= perFrame || now() - since >= BUDGET_MS) await frame();
        steps++;
      }
      return { step, frame };
    }
    async function openUp(path, pace) {
      await pace.step();
      fs.chmod(path, 511);
      const entries2 = fs.readDir(path);
      await pace.frame();
      for (const entry2 of entries2) {
        if (entry2.isDirectory) await openUp(`${path}/${entry2.name}`, pace);
        else {
          await pace.step();
          fs.chmod(`${path}/${entry2.name}`, 511);
        }
      }
    }
    async function swap(staged, backup, pace) {
      fs.mkdir(backup, { recursive: true });
      const done = [];
      try {
        for (const { name } of entriesOf(staged)) {
          await pace.step();
          const replaced = fs.exists(`${installDir}/${name}`);
          if (replaced) fs.rename(`${installDir}/${name}`, `${backup}/${name}`);
          done.push({ name, replaced });
          fs.rename(`${staged}/${name}`, `${installDir}/${name}`);
        }
      } catch (error2) {
        for (const { name, replaced } of done.reverse()) {
          if (fs.exists(`${installDir}/${name}`)) fs.rename(`${installDir}/${name}`, `${staged}/${name}`);
          if (replaced) fs.rename(`${backup}/${name}`, `${installDir}/${name}`);
        }
        throw error2;
      }
    }
    function ensureRoomForImage(update) {
      const needed = Math.ceil(fs.stat(image).size * 1.1) + update.size + 64 * MIB;
      const { free } = fs.diskUsage(workDir);
      if (free < needed) throw new Error(`The update needs ${formatBytes(needed)} free next to ${image}; ${formatBytes(free)} is`);
    }
    function installedImage() {
      if (!fs.exists(marker)) return null;
      let pending2;
      try {
        const recorded = JSON.parse(fs.readFile(marker));
        const file = fs.stat(recorded.image);
        if (newer(recorded.version, version2) && file?.size === recorded.size && Math.abs(file.modified - recorded.modified) < MTIME_SLACK_MS)
          pending2 = recorded;
      } catch (error2) {
        log(`marker ignored: ${error2.message}`);
      }
      if (!pending2) {
        try {
          fs.remove(marker);
        } catch (error2) {
          log(`marker kept: ${error2.message}`);
        }
        return null;
      }
      const launches = (pending2.launches || 0) + 1;
      log(`v${pending2.version} is installed but v${version2} runs (launch ${launches} since)`);
      try {
        fs.writeFile(marker, JSON.stringify({ ...pending2, launches }));
      } catch (error2) {
        log(`marker not counted: ${error2.message}`);
      }
      return { version: pending2.version, installed: true, stuck: launches >= STUCK_LAUNCHES };
    }
    function replaceImage(extracted, update) {
      const entries2 = entriesOf(extracted);
      const [entry2] = entries2;
      if (entries2.length !== 1 || !entry2.isFile || !entry2.name.endsWith(".exfat") || entry2.size < MIN_IMAGE_BYTES || entry2.size % SECTOR)
        throw new Error(`The update holds ${entries2.map((item) => item.name).join(", ") || "nothing"} instead of one exFAT image`);
      const file = `${extracted}/${entry2.name}`;
      try {
        fs.chmod(file, 511);
      } catch (error2) {
        log(`image left closed: ${error2.message}`);
      }
      try {
        const { size, modified } = fs.stat(file);
        fs.mkdir(marker.slice(0, marker.lastIndexOf("/")), { recursive: true });
        fs.writeFile(marker, JSON.stringify({ version: update.version, image, size, modified }));
        log(`marker written: ${marker}`);
      } catch (error2) {
        log(`marker not written: ${error2.message}`);
      }
      try {
        fs.rename(file, image);
      } catch (error2) {
        log(`rename over ${image} failed: ${error2.message}`);
        throw new ImageReplaceError(error2.message);
      }
      log(`renamed over ${image}`);
    }
    async function clear() {
      await fs.removeAsync(workDir);
    }
    async function tidy() {
      try {
        await clear();
      } catch (error2) {
        log(`leftovers kept: ${error2.message}`);
      }
    }
    async function fetchRelease(update, onProgress) {
      const zip = `${workDir}/${update.version}.zip`;
      const download = downloads.enqueue({ url: update.url, destination: zip, sha256: update.sha256, expectedBytes: update.size, rejectHtml: true, unlimited: true });
      const off = download.subscribe(({ written }) => onProgress({ state: "downloading", written: written || 0, total: update.size }));
      try {
        await download.done;
      } finally {
        off();
      }
      log(`v${update.version} downloaded and verified (${update.size} bytes, sha256 ${update.sha256})`);
      onProgress({ state: "installing", written: update.size, total: update.size });
      const extracted = `${workDir}/${update.version}`;
      await archives.extract({ sources: [zip], destination: extracted, maxBytes: 4 * 1024 ** 3 }).done;
      log(`extracted to ${extracted}`);
      return extracted;
    }
    async function install(update, onProgress = () => {
    }) {
      const target = image ?? installDir;
      if (!fs.exists(target)) throw new Error(`The app is not installed at ${target}`);
      await cleaning;
      await tidy();
      fs.mkdir(workDir, { recursive: true });
      let extracted;
      try {
        if (image) ensureRoomForImage(update);
        extracted = await fetchRelease(update, onProgress);
        if (image) replaceImage(extracted, update);
      } catch (error2) {
        log(`v${update.version} failed: ${error2.message}`);
        await tidy();
        throw error2;
      }
      if (image) {
        await tidy();
        return { relaunch: false };
      }
      const staged = contentOf(extracted);
      const pace = pacer(CHANGES_PER_FRAME);
      await openUp(staged, pace);
      await pace.step();
      fs.chmod(installDir, 511);
      await swap(staged, `${workDir}/previous`, pace);
      log(`v${update.version} moved into ${installDir}`);
      await tidy();
      return { relaunch: true };
    }
    let cleaning = Promise.resolve();
    function cleanup() {
      cleaning = cleaning.then(clear).catch((error2) => log(`leftovers kept: ${error2.message}`));
      return cleaning;
    }
    return { check, install, cleanup };
  }

export { ImageReplaceError, createUpdater };
