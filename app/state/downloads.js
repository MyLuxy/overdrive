// ../pub-game-store/native/state/downloads.js
// reconstructed from the esbuild bundle in eboot.bin

import { getGame } from './catalog.js';
import { driveName, driveShortName } from './drive-names.js';
import { createDownloadQueue } from './download-queue.js';
import { createSourceResolver } from './download-sources.js';
import { createMockDownloadQueue } from './mock-download-queue.js';
import { consoleRoots } from './roots.js';
import { createShadowMountProbe } from './shadowmount.js';
import { createPkgHelper } from './pkg-helper.js';
import { autoRetries } from './retries.js';
import { Archives, BrowserCapture, DownloadFormats, Downloads, FileSystem, Http, Linking, Notifications, Packages, Platform, Power } from '@ps5-react/core';

  var instance;
  var mocked = () => Platform.OS !== "ps5" && FileSystem.exists(`${FileSystem.dataDir}/overdrive/mock-downloads`);
  var stateDir = Platform.OS === "ps5" ? "/data/ps5-react/PPSA99058/queue" : void 0;
  var downloadQueue = () => instance ?? (instance = mocked() ? createMockDownloadQueue() : createDownloadQueue({
    fs: FileSystem,
    archives: Archives,
    downloads: Downloads,
    http: Http,
    formats: DownloadFormats,
    dataDir: FileSystem.dataDir,
    stateDir,
    platform: Platform.OS,
    notifications: Notifications,
    power: Power,
    linking: Linking,
    sources: createSourceResolver({ http: Http }),
    packages: Packages,
    // On the PS5 the console's Downloads take a package from the helper payload, which outlives the app.
    helper: Platform.OS === "ps5" && typeof Packages.startHelper === "function" ? createPkgHelper({ packages: Packages, http: Http, fs: FileSystem, dir: "/data/ps5-react/PPSA99058/queue", log: "/data/ps5-react/PPSA99058/pkg-helper.log" }) : null,
    browserCapture: BrowserCapture,
    retries: autoRetries,
    releasesOf: (id) => getGame(id)?.releases || []
  }));
  var shadowMountUp = Platform.OS === "ps5" ? createShadowMountProbe({ http: Http, now: Date.now }) : async () => true;
  function freeBytes(root2) {
    try {
      return FileSystem.diskUsage(root2).free;
    } catch {
      return null;
    }
  }
  function storageRoots() {
    if (Platform.OS !== "ps5") return [FileSystem.dataDir];
    return consoleRoots(() => FileSystem.mounts());
  }

export { downloadQueue, driveName, driveShortName, freeBytes, shadowMountUp, storageRoots };
