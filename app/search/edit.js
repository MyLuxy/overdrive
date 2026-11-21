// ../pub-game-store/native/search/edit.js
// reconstructed from the esbuild bundle in eboot.bin


  function edit(query, value, maximum = 40) {
    if (value === "delete") return query.slice(0, -1);
    if (value === "clear") return "";
    if (query.length >= maximum || value === " " && !query) return query;
    return (query + value).slice(0, maximum);
  }

export { edit };
