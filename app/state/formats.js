// The package formats a game's sources offer, grouped the way Browse's filter drawer shows them.
// The format itself lives in data/releases/<id>.json, which the app reads only when a game opens, and
// the drawer counts every game at once: tools/formats-index.mjs copies these groups into
// data/formats.json, and a game it leaves out is "unknown".
//

  // In the drawer's order: the two the console installs straight away, then the folder image, then
  // the archives. "ffpkg" is one game's PS5 package; it installs like the rest.
  var GROUPS = [
    { value: "pkg", formats: ["pkg", "ffpkg"] },
    { value: "exfat", formats: ["exfat"] },
    { value: "ffpfs", formats: ["ffpfs", "ffpfsc"] },
    { value: "archive", formats: ["rar", "zip", "7z"] }
  ];
  var UNKNOWN = "unknown";
  var groupOf = (format) => {
    const kind = String(format || "").toLowerCase();
    return GROUPS.find((group) => group.formats.includes(kind))?.value ?? "";
  };
  // A source the catalog only calls "binary" (FileKeeper's, mostly) has no known format: the queue
  // reads the real one from the file's first bytes once it downloads it (downloads/DownloadRow.jsx).
  function formatsOf(releases) {
    const found = /* @__PURE__ */ new Set();
    for (const release of releases ?? []) {
      const group = groupOf(release.format);
      if (group) found.add(group);
    }
    if (!found.size) return [UNKNOWN];
    return GROUPS.map((group) => group.value).filter((value) => found.has(value));
  }

export { GROUPS, UNKNOWN, formatsOf, groupOf };
