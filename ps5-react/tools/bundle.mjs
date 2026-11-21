/*
 * Copyright 2026 Cory Lamming
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// Bundles a demo (React app + reconciler + host config) into a single classic (IIFE) script that
// QuickJS can run with a plain JS_Eval, and bakes the images/fonts the demo imports into a generated
// C translation unit (dist/assets.generated.c) exposing er_register_assets(). Globals the bundle
// expects at runtime (NativeUI, screen, console, timer shims) are provided by the C host (e.g.,
// examples/linux/main_js.c); the example firmware compiles the generated assets and calls
// er_register_assets() at boot.
//
// Demos live in the top-level demos/ folder, one folder per demo. Pick one with:
//   npm run build                 # default demo (thermostat)
//   npm run build -- marine-dash  # a specific demo by folder name
// Outputs are always dist/app.bundle.js + dist/assets.generated.{c,h} — the single "active" app the
// example hosts pick up.
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {dirname, resolve, basename} from 'node:path';
import {existsSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
const here = resolve(process.argv[2], 'bridges/quickjs/js');
const require = createRequire(resolve(here, 'package.json'));
const {build} = require('esbuild');
const {bakeAssets} = await import(pathToFileURL(resolve(here, 'assets/index.mjs')).href);
const {resolveFontJobs} = await import(pathToFileURL(resolve(here, 'assets/font-config.mjs')).href);
const {analyzeFontSizes} = await import(pathToFileURL(resolve(here, 'assets/font-sizes.mjs')).href);
const {registerSvgVectorLoader} = await import(pathToFileURL(resolve(here, 'assets/svg-loader.mjs')).href);
const {tailwindEsbuildPlugin} = await import('./tailwind/esbuild-plugin.mjs');
const {readWav} = await import('./wav.mjs');

// Adapted for per-app outputs by PS5 React; asset baking remains upstream.
const repoRoot = resolve(here, '../../..');
const demosDir = resolve(repoRoot, 'demos');
const libEntry = resolve(here, 'src/embedded-react/index.js');
const nodeModules = resolve(here, 'node_modules');
const distDir = resolve(process.argv[4]);
// Added by PS5 React: Tailwind classes compile for this render size.
const render = {width: Number(process.argv[5]), height: Number(process.argv[6])};

const DEFAULT_DEMO = 'thermostat';
const demoDir = resolve(process.argv[3]);
const demo = basename(demoDir);
const entry = resolve(demoDir, 'index.jsx');

if (!existsSync(entry)) {
  const available = existsSync(demosDir)
    ? readdirSync(demosDir, {withFileTypes: true})
        .filter(d => d.isDirectory())
        .map(d => d.name)
    : [];
  console.error(`Demo "${demo}" not found (expected ${entry}).`);
  console.error(`Available demos: ${available.join(', ') || '(none)'}`);
  process.exit(1);
}

// Asset discovery is import-driven: an `import x from './x.png'` (image) or `import F from './F.ttf'`
// (font) is intercepted here. The import resolves to the asset's NAME (its file basename) — the
// string an <Image source>/imageName looks up, or the family a fontFamily uses — and the path is
// recorded, so it gets baked below. Only what the app imports is baked.
const images = new Map(); // name -> path
const fonts = new Map(); // family -> path
const sounds = new Map(); // name -> {rate, channels, samples} (added by PS5 React)

// 16-bit PCM WAV, mono or stereo: decoded here so the hosts only copy samples (added by PS5 React).
function decodeWav(path) {
  const {rate, channels, bits, samples} = readWav(path);
  if (bits !== 16 || channels > 2 || rate < 8000 || rate > 96000) {
    throw new Error(`expected 16-bit PCM, mono or stereo, 8-96 kHz; got ${bits}-bit, ${channels} channels, ${rate} Hz`);
  }
  if (samples.length < channels * 2 || samples.length > 10 * rate * channels) {
    throw new Error('expected between 2 frames and 10 seconds of audio');
  }
  return {rate, channels, samples};
}

const assetPlugin = {
  name: 'embedded-react-assets',
  setup(build) {
    build.onLoad({filter: /\.(png|jpe?g|webp|gif|bmp)$/i}, args => {
      const name = basename(args.path).replace(/\.[^.]+$/, '');
      images.set(name, args.path);
      return {
        contents: `module.exports = ${JSON.stringify(name)};`,
        loader: 'js',
      };
    });
    build.onLoad({filter: /\.(ttf|otf)$/i}, args => {
      const family = basename(args.path).replace(/\.[^.]+$/, '');
      fonts.set(family, args.path);
      return {
        contents: `module.exports = ${JSON.stringify(family)};`,
        loader: 'js',
      };
    });
    build.onLoad({filter: /\.wav$/i}, args => {
      const name = basename(args.path).replace(/\.[^.]+$/, '');
      try {
        sounds.set(name, decodeWav(args.path));
      } catch (error) {
        return {errors: [{text: `${args.path}: ${error.message}`}]};
      }
      return {
        contents: `module.exports = ${JSON.stringify(name)};`,
        loader: 'js',
      };
    });
    registerSvgVectorLoader(build, (name, p) => images.set(name, p));
  },
};

const bundlePath = resolve(distDir, 'app.bundle.js');
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'iife',
  outfile: bundlePath,
  platform: 'neutral',
  target: 'es2020',
  jsx: 'automatic',
  // Demos live outside the embedded-react package, so the package self-reference doesn't resolve for
  // them: map the bare `embedded-react` import to the library source and let the demo's bare deps
  // (react, react-reconciler) resolve from this package's node_modules. (The library's own internal
  // imports still resolve relatively / from node_modules as before.)
  // Pin React to THIS package's copy: a demo/consumer project may carry its own node_modules
  // (e.g., after `npm install` for device-dev deps), and esbuild resolving `react` from there while
  // the library resolves its copy from here yields two React instances — the hook dispatcher is
  // null and every component throws. One copy, always.
  alias: {
    'embedded-react': libEntry,
    '@ps5-react/core': resolve(dirname(fileURLToPath(import.meta.url)), '../runtime/js/index.js'),
    react: resolve(nodeModules, 'react'),
    'react-reconciler': resolve(nodeModules, 'react-reconciler'),
    scheduler: resolve(nodeModules, 'scheduler'),
  },
  nodePaths: [nodeModules],
  plugins: [
    // Added by PS5 React: build-time className/tw compilation for the app's sources.
    tailwindEsbuildPlugin({appDir: demoDir, render, babel: {
      core: require('@babel/core'),
      syntaxJsx: require('@babel/plugin-syntax-jsx').default,
    }}),
    assetPlugin,
  ],
  // Production React: smaller and avoids dev-only warning machinery that needs more shims.
  define: {'process.env.NODE_ENV': '"production"'},
  legalComments: 'none',
  logLevel: 'info',
  // esbuild has already printed each error with its source location; skip Node's stack trace.
}).catch(() => process.exit(1));

console.log(`Bundled demo "${demo}" -> dist/app.bundle.js`);

// --- Bake imported assets ---------------------------------------------------------------------
// Fonts are pre-rasterized at fixed sizes (the engine has no runtime rasterizer), so bake exactly the
// fontSize values the bundle uses — constants and token scales folded, not just literals. A size that
// only exists at runtime can't be discovered; the bake reports those rather than snapping silently.
const bundleSrc = readFileSync(bundlePath, 'utf8');
const usedSizes = analyzeFontSizes(bundleSrc);

// Optional per-demo overrides: demos/<demo>/assets.config.js
//   export default { fonts: { 'Family': { sizes: [..], bpp: 4, glyphs: 'ascii'|'common'|[cps],
//                                         extraGlyphs: '°±' } } }
let config = {};
const configPath = resolve(demoDir, 'assets.config.js');
if (existsSync(configPath)) {
  config = (await import(pathToFileURL(configPath).href)).default || {};
}
const fontConfig = config.fonts || {};
const imageConfig = config.images || {};

const fontJobs = resolveFontJobs(fonts, fontConfig, usedSizes.sizes);
const imageJobs = [...images.entries()].map(([name, path]) => ({
  path,
  name,
  format: imageConfig[name]?.format,
}));

const summary = bakeAssets({
  images: imageJobs,
  fonts: fontJobs,
  outDir: distDir,
  source: bundleSrc,
  usedSizes,
});
const fontDesc = fontJobs.length
  ? fontJobs
      .map(f => `${f.family}@[${f.sizes.join(',')}]x${f.bpp}bpp`)
      .join(', ')
  : 'none';
console.log(
  `Baked ${summary.images} image(s), ${summary.fonts} font size(s) -> dist/assets.generated.c\n` +
    `  fonts: ${fontDesc}`,
);

// Added by PS5 React: imported WAVs -> sounds.generated.c (native/shared/baked_sounds.h), always written.
const entries = [...sounds.entries()];
writeFileSync(resolve(distDir, 'sounds.generated.c'), [
  '#include "baked_sounds.h"',
  ...entries.map(([, {samples}], i) => `static const int16_t sound_${i}[] = {${samples.join(',')}};`),
  `const BakedSound ps5_react_sounds[] = {${entries.length ? entries.map(([name, {rate, channels, samples}], i) =>
    `{${JSON.stringify(name)}, sound_${i}, ${Math.floor(samples.length / channels)}, ${rate}, ${channels}}`).join(',\n  ') : '{0}'}};`,
  `const uint32_t ps5_react_sound_count = ${entries.length};`,
  '',
].join('\n'));
console.log(`Baked ${entries.length} sound(s)${entries.length ? `: ${entries.map(([name]) => name).join(', ')}` : ''}`);
