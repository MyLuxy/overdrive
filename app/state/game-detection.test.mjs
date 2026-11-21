import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// findGame and the helpers it calls, taken from the queue's source: they use only fs and titleIn.
const source = readFileSync(new URL("./download-queue.js", import.meta.url), "utf8");
const start = source.indexOf("    var PATCH_FOLDER =");
const end = source.indexOf("    // The extractor writes files", start);
assert.ok(start !== -1 && end > start);
const selectGame = new Function("fs", "titleIn", "console", `${source.slice(start, end)}
return findGame;`);

function fixture(paths, titles = {}, otherDirectories = []) {
  const root = "/data/downloads/extracted/release";
  const directories = new Set([root]);
  const entries = new Set();
  const addDirectories = (relative) => {
    let parent = root;
    for (const segment of relative.split("/")) {
      parent += `/${segment}`;
      directories.add(parent);
    }
    return parent;
  };
  for (const relative of paths) {
    const parent = addDirectories(relative);
    entries.add(`${parent}/eboot.bin`);
    entries.add(`${parent}/sce_sys/param.json`);
  }
  for (const relative of otherDirectories) addDirectories(relative);
  const fs = {
    exists: (path) => entries.has(path),
    readDir: (path) => {
      if (!directories.has(path)) throw new Error("Directory does not exist");
      return [...directories].filter((child) => child.startsWith(`${path}/`) && !child.slice(path.length + 1).includes("/")).map((child) => ({
        name: child.slice(path.length + 1),
        isDirectory: true
      }));
    }
  };
  const titleIn = (path) => titles[path.slice(root.length + 1)] ?? "PPSA28000";
  const findGame = selectGame(fs, titleIn, { log() {} });
  const result = findGame({ titleId: "PPSA28000" }, root);
  return { folder: result.folder?.slice(root.length + 1) ?? null, beside: result.beside };
}

test("base game next to the reported optional backport", () => {
  assert.deepEqual(fixture(["PPSA28000-app", "backport (backport 4.xx to 11.xx)"]), {
    folder: "PPSA28000-app", beside: true
  });
});

test("nested backport is not selected as a game", () => {
  assert.deepEqual(fixture(["PPSA28000-app", "backport (4.xx to 11.xx)/content/game"]), {
    folder: "PPSA28000-app", beside: true
  });
});

test("a lone game folder is taken whatever its name, as before", () => {
  for (const lone of ["PPSA28000 Backport 4.xx", "Ghost of Yotei v1.010 (Base + Update)", "backport (4.xx to 11.xx)"]) {
    assert.deepEqual(fixture([lone]), { folder: lone, beside: false });
  }
});

test("a lone game folder inside a wrapper named a backport is taken", () => {
  assert.deepEqual(fixture(["Dawnwalker 4.xx Backport/PPSA28000-app"]), {
    folder: "Dawnwalker 4.xx Backport/PPSA28000-app", beside: false
  });
});

test("a wrapper named a backport does not hide the game from its update", () => {
  assert.deepEqual(fixture(["Dawnwalker 4.xx Backport/PPSA28000-app", "Dawnwalker 4.xx Backport/update 01.005"]), {
    folder: "Dawnwalker 4.xx Backport/PPSA28000-app", beside: true
  });
});

test("existing patch filtering continues to select the base game", () => {
  assert.deepEqual(fixture(["PPSA28000-app", "patch v01.005"]), {
    folder: "PPSA28000-app", beside: true
  });
});

test("single unambiguous base game follows the fast path", () => {
  assert.deepEqual(fixture(["PPSA28000-app"]), { folder: "PPSA28000-app", beside: false });
});

test("two unclassified game folders stay untouched", () => {
  assert.deepEqual(fixture(["PPSA28000-app", "PPSA28000-other"]), { folder: null, beside: false });
});

test("matching title ID wins when two normal games exist", () => {
  assert.deepEqual(fixture(["PPSA28000-app", "PPSA99999-app"], {
    "PPSA99999-app": "PPSA99999"
  }), { folder: "PPSA28000-app", beside: true });
});

test("unrelated names containing the substring backport are not filtered", () => {
  assert.deepEqual(fixture(["PPSA28000-backporter", "PPSA99999-app"], {
    "PPSA99999-app": "PPSA99999"
  }), { folder: "PPSA28000-backporter", beside: true });
});

test("case-insensitive backport variants are ignored", () => {
  for (const extra of ["BACKPORT_4.xx", "(backport 5.05)", "11.xx-backport", "Backport4.00"]) {
    assert.deepEqual(fixture(["PPSA28000-app", extra]), {
      folder: "PPSA28000-app", beside: true
    });
  }
});

test("more than one potential base game remains ambiguous even with backport", () => {
  assert.deepEqual(fixture(["PPSA28000-app", "PPSA28000-alternate", "backport"]), {
    folder: null, beside: false
  });
});

test("a game inside a backport folder beside the base game is left out", () => {
  assert.deepEqual(fixture(["PPSA28000-app", "extras/backport 4.xx/PPSA28000-app"]), {
    folder: "PPSA28000-app", beside: true
  });
});

test("single base game next to nested patch and backport", () => {
  assert.deepEqual(fixture(["collection/PPSA28000-app", "collection/update/version", "collection/backport/version"]), {
    folder: "collection/PPSA28000-app", beside: true
  });
});

test("DLC-only extraction without game markers is not selected as a base game", () => {
  assert.deepEqual(fixture([], {}, ["DLC/content"]), { folder: null, beside: false });
});

test("base game next to DLC content and backport is selected", () => {
  assert.deepEqual(fixture(["PPSA28000-app", "backport (4.xx to 11.xx)"], {}, ["DLC/content"]), {
    folder: "PPSA28000-app", beside: true
  });
});

test("game-like DLC with the same title ID stays ambiguous beside base and backport", () => {
  assert.deepEqual(fixture(["PPSA28000-app", "DLC/extra-game", "backport (4.xx to 11.xx)"]), {
    folder: null, beside: false
  });
});
