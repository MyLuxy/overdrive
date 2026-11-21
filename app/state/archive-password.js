// ../pub-game-store/native/state/archive-password.js
// reconstructed from the esbuild bundle in eboot.bin


  function archivePassword(release) {
    const sources = [release, ...(release.parts || []).flatMap((part) => part.sources)];
    const passwords = /* @__PURE__ */ new Set();
    for (const source2 of sources) {
      const value = source2.archivePassword;
      if (value == null || value === "") continue;
      if (typeof value !== "string" || value.length > 1024 || value.includes("\0"))
        throw new Error("Invalid archive password metadata.");
      passwords.add(value);
    }
    if (passwords.size > 1) throw new Error("Archive volumes have conflicting passwords. Choose another complete source.");
    return passwords.values().next().value;
  }

export { archivePassword };
