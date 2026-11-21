// ../pub-game-store/native/state/read-json.js
// reconstructed from the esbuild bundle in eboot.bin


  function readJSON(fs, path, fallback, valid = () => true, log2 = console.log) {
    let text;
    try {
      if (!fs.exists(path)) return fallback;
      text = fs.readFile(path);
    } catch (error2) {
      log2(`[saved] ${path} not read: ${error2.message}`);
      return fallback;
    }
    try {
      const value = JSON.parse(text);
      if (!valid(value)) throw new Error("unexpected contents");
      return value;
    } catch (error2) {
      const aside = `${path}.unreadable-${Date.now()}`;
      log2(`[saved] ${path} unreadable (${error2.message}); kept as ${aside}`);
      try {
        fs.rename(path, aside);
      } catch (failure) {
        log2(`[saved] ${path} not moved aside: ${failure.message}`);
      }
      return fallback;
    }
  }
  var isStringList = (value) => Array.isArray(value) && value.every((item) => typeof item === "string");
  var isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  var SAVED_FILES = {
    "settings.json": isRecord,
    "wishlist.json": isStringList,
    "recent.json": isStringList,
    "searches.json": isStringList
  };

export { SAVED_FILES, isRecord, isStringList, readJSON };
