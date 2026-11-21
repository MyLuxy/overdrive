// ../pub-game-store/native/files/scan.js
// reconstructed from the esbuild bundle in eboot.bin


  var KINDS = [
    { key: "packages", icon: "package", folders: ["downloads/packages"] },
    { key: "images", icon: "disc", folders: ["homebrew"] },
    { key: "archives", icon: "archive", folders: ["downloads/archives", "downloads/sets"] },
    { key: "extracted", icon: "folder", folders: ["downloads/extracted"] },
    { key: "other", icon: "file", folders: ["downloads/files"] }
  ];
  var SIDECAR = /\.(?:complete|part|resume|tmp)$|^\.ps5-react-/;
  var TITLE_ID = /\b(CUSA|PPSA)\d{5}\b/;
  var DEPTH = 4;
  var ENTRIES = 4e3;
  var isPackage = (name) => /\.f?pkg$/i.test(name);
  function folderSize(fs, path, depth, budget) {
    let total = 0;
    let entries2;
    try {
      entries2 = fs.readDir(path);
    } catch {
      return 0;
    }
    for (const entry2 of entries2) {
      if (--budget.left < 0) return total;
      if (entry2.isDirectory) {
        if (depth > 0) total += folderSize(fs, `${path}/${entry2.name}`, depth - 1, budget);
      } else total += entry2.size || 0;
    }
    return total;
  }
  function scanDrive(fs, root2) {
    const files = [];
    for (const kind of KINDS) {
      for (const folder of kind.folders) {
        let entries2;
        try {
          entries2 = fs.readDir(`${root2}/${folder}`);
        } catch {
          continue;
        }
        for (const entry2 of entries2) {
          if (SIDECAR.test(entry2.name)) continue;
          const path = `${root2}/${folder}/${entry2.name}`;
          const titleId = TITLE_ID.exec(entry2.name)?.[0] ?? null;
          files.push({
            kind: kind.key,
            path,
            name: entry2.name,
            isDirectory: entry2.isDirectory,
            modified: entry2.modified,
            size: entry2.isDirectory ? folderSize(fs, path, DEPTH, { left: ENTRIES }) : entry2.size || 0,
            titleId,
            platform: titleId ? titleId.startsWith("CUSA") ? "ps4" : "ps5" : null
          });
        }
      }
    }
    return files.sort((a, b) => b.size - a.size || a.name.localeCompare(b.name));
  }
  function totals(files) {
    const out = Object.fromEntries([["all", { count: 0, size: 0 }], ...KINDS.map((kind) => [kind.key, { count: 0, size: 0 }])]);
    for (const file of files) for (const key of ["all", file.kind]) {
      out[key].count++;
      out[key].size += file.size;
    }
    return out;
  }
  var deletionTargets = (file) => file.isDirectory ? [file.path] : [file.path, ...[".complete", ".resume", ".part"].map((suffix) => file.path + suffix)];

export { KINDS, deletionTargets, isPackage, scanDrive, totals };
