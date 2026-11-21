// ../pub-game-store/native/state/page-cache.js
// reconstructed from the esbuild bundle in eboot.bin


  var KEPT = 8;
  function createPageCache(read) {
    const pages = /* @__PURE__ */ new Map();
    return (file) => {
      if (!/^data\/pages\/[a-z0-9%_-]+\.json$/i.test(file)) throw new Error("Invalid page data path.");
      let page2 = pages.get(file);
      if (!page2) {
        page2 = JSON.parse(read(file));
        if (!Array.isArray(page2.about) || !Array.isArray(page2.shots)) throw new Error("Invalid page data; rebuild the catalog.");
        if (pages.size === KEPT) pages.delete(pages.keys().next().value);
      }
      pages.delete(file);
      pages.set(file, page2);
      return page2;
    };
  }

export { createPageCache };
