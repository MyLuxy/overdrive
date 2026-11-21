// ../pub-game-store/native/state/update.js
// reconstructed from the esbuild bundle in eboot.bin

import { useEffect, useState } from 'react';
import { downloadQueue, storageRoots } from './downloads.js';
import { locateInstall } from './install-location.js';
import { createUpdater } from './updater.js';
import { VERSION } from '../version.js';
import { Archives, Downloads, FileSystem, Http, Platform } from '@ps5-react/core';

  var TITLE = "PPSA99058";
  // Not overridable by a file: an older Overdrive leaves `overdrive/update-feed` in the data
  // directory naming its own releases repository, which no longer exists — every install upgraded
  // in place then asked a dead feed for updates instead of this one (issue #122).
  //
  // Two feeds, both asked at once: this fork's own releases on GitHub, and the upstream project's
  // feed on GitLab, which carries the same shape (the release, its notes, and the asset's size
  // and sha256). The newest release of the two wins, so one host going quiet never leaves an
  // installed Overdrive without a way to update.
  //
  // The upstream MyLuxy GitHub account is gone, so its release API is not asked any more: GitLab
  // (gitlab.com/myluxy/overdrive) is the source of truth for the catalog and for the releases.
  var FEEDS = [
    { name: "gitlab", url: "https://gitlab.com/myluxy/overdrive/-/raw/main/update-feed.json" },
    { name: "github", url: "https://api.github.com/repos/Stintik-123/Overdrive/releases/latest" }
  ];
  function location() {
    if (Platform.OS !== "ps5") return { installDir: `${FileSystem.dataDir}/homebrew/${TITLE}`, workDir: `${FileSystem.dataDir}/overdrive-update` };
    return locateInstall({ http: Http, fs: FileSystem, title: TITLE, roots: storageRoots });
  }
  // One package carries an update: the image alone, for an image install. A folder install is
  // offered nothing, because replacing it would hand `replaceImage` a folder holding an image.
  function assetFor({ image }) {
    if (Platform.OS !== "ps5") return "Overdrive-desktop.zip";
    return image ? "update.zip" : null;
  }
  var foundInstall;
  var located = new Promise((resolve2) => {
    foundInstall = resolve2;
  });
  var updater;
  async function instance2() {
    if (updater) return updater;
    const install = await location();
    foundInstall(install);
    return updater = createUpdater({
      http: Http,
      downloads: Downloads,
      archives: Archives,
      fs: FileSystem,
      version: VERSION,
      feeds: FEEDS,
      asset: assetFor(install),
      marker: `${FileSystem.dataDir}/overdrive/pending-image.json`,
      ...install
    });
  }
  var CHECK_DELAY_MS = 4e3;
  function useAvailableUpdate() {
    const [update, setUpdate] = (0, useState)(null);
    (0, useEffect)(() => {
      const id = setTimeout(async () => {
        try {
          const current = await instance2();
          void current.cleanup();
          setUpdate(await current.check());
        } catch (error2) {
          console.log(`overdrive: update check failed: ${error2.message}`);
        }
      }, CHECK_DELAY_MS);
      return () => clearTimeout(id);
    }, []);
    return update;
  }
  async function installUpdate(update, onProgress) {
    try {
      await downloadQueue().yieldArchives?.();
    } catch (error2) {
      console.log(`[update] queue not yielded: ${error2.message}`);
    }
    return (await instance2()).install(update, onProgress);
  }
  function useFolderInstall() {
    const [folder, setFolder] = (0, useState)(false);
    (0, useEffect)(() => {
      if (Platform.OS === "ps5") located.then((install) => setFolder(Boolean(install.installDir)));
    }, []);
    return folder;
  }

export { installUpdate, useAvailableUpdate, useFolderInstall };
