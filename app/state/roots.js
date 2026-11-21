// ../pub-game-store/native/state/roots.js
// reconstructed from the esbuild bundle in eboot.bin


  function consoleRoots(mounts) {
    const roots = ["/data"];
    let listed2;
    try {
      listed2 = mounts();
    } catch (error2) {
      console.log(`[downloads] drives not listed: ${error2.message}`);
      return roots;
    }
    for (const mount of listed2) {
      if (/^\/mnt\/(?:usb|ext)\d+$/.test(mount.path) && !roots.includes(mount.path)) roots.push(mount.path);
    }
    return roots;
  }

export { consoleRoots };
