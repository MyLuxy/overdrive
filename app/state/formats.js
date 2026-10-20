// The package formats a game's sources come in, for the library's "Package format" filter.
// tools/sync-formats.py writes each game's `formats` into data/catalog.js, so the filter never
// has to open the per-game release files.

  // One option per kind of file the player handles differently. `members` are the formats in the
  // catalog; the image formats stay apart because ShadowMount+ installs an .exfat image but a
  // compressed .ffpfsc one needs the other route. PKG, exFAT and FFPFS are file types, not words, so
  // only Archive (and Unknown below) carries a translation key.
  var FORMAT_GROUPS = [
    { value: "pkg", name: "PKG", members: ["pkg"] },
    { value: "exfat", name: "exFAT", members: ["exfat"] },
    { value: "ffpfs", name: "FFPFS", members: ["ffpfsc", "ffpfs"] },
    { value: "archive", name: "Archive", label: "filters.format.archive", members: ["rar", "zip", "7z"] }
  ];
  // A format only a handful of games offer would be a button that hides nearly everything.
  var MIN_FORMAT_GAMES = 10;
  // The sources that don't say what they are ("binary" in the release files: the app only learns it
  // from the bytes, after the download) leave a game with no `formats`. Unknown is that game, so the
  // filter never hides one without a button for it. It stays last, after the formats ranked by games.
  var UNKNOWN = { value: "unknown", name: "Unknown", label: "filters.format.unknown" };
  var hasFormat = (game, value) => {
    if (value === UNKNOWN.value) return !game.formats?.length;
    const group = FORMAT_GROUPS.find((candidate) => candidate.value === value);
    return Boolean(group && game.formats?.some((format) => group.members.includes(format)));
  };
  var countOf = (games, value) => games.filter((game) => hasFormat(game, value)).length;
  function formatOptions(games) {
    const known = FORMAT_GROUPS.map((group) => ({ group, count: countOf(games, group.value) })).filter(({ count }) => count >= MIN_FORMAT_GAMES).sort((a, b) => b.count - a.count).map(({ group: { value, name, label } }) => label ? { value, name, label } : { value, name });
    return countOf(games, UNKNOWN.value) >= MIN_FORMAT_GAMES ? [...known, UNKNOWN] : known;
  }

export { FORMAT_GROUPS, MIN_FORMAT_GAMES, formatOptions, hasFormat };
