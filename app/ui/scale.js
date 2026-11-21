// ../pub-game-store/native/ui/scale.js
// reconstructed from the esbuild bundle in eboot.bin


  var SCALE = screen.width / 1280;
  var TRANSFORM_PX = 512;
  var px = (n) => Math.round(n * SCALE);
  var logical = (n) => n / SCALE;
  var canScale = (width, height) => px(width) <= TRANSFORM_PX && px(height) <= TRANSFORM_PX;

export { canScale, logical, px };
