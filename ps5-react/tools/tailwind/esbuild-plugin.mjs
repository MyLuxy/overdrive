// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// esbuild plugin: compiles className/tw in the app's own sources before esbuild sees the JSX.
import {existsSync, readFileSync} from 'node:fs';
import {extname, resolve, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import tailwindPlugin, {TailwindError} from './babel-plugin.mjs';
import {createCompiler} from './compile.mjs';

const LOADERS = {'.js': 'jsx', '.jsx': 'jsx', '.mjs': 'jsx', '.ts': 'ts', '.tsx': 'tsx'};

/** `render` is the {width, height} of the layout being built; an app may be built for several. */
export async function loadCompiler(appDir, render) {
  const configPath = resolve(appDir, 'tailwind.config.js');
  const config = existsSync(configPath)
    ? (await import(`${pathToFileURL(configPath).href}?t=${Date.now()}`)).default ?? {}
    : {};
  return createCompiler({config, renderWidth: render.width, renderHeight: render.height, appDir});
}

/** Babel transform of one source; throws TailwindError with a location on a bad class. */
export function transform(babel, compiler, source, filename) {
  const extension = extname(filename);
  return babel.core.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    sourceType: 'module',
    parserOpts: {plugins: extension.startsWith('.ts') ? ['jsx', 'typescript'] : ['jsx']},
    generatorOpts: {retainLines: true},
    plugins: [babel.syntaxJsx, [tailwindPlugin, {compiler}]],
  }).code;
}

/** `babel` is {core, syntaxJsx}, resolved from the Embedded React toolchain. */
export function tailwindEsbuildPlugin({appDir, render, babel}) {
  const root = resolve(appDir) + sep;
  return {
    name: 'ps5-react-tailwind',
    async setup(build) {
      const compiler = await loadCompiler(appDir, render);
      build.onLoad({filter: /\.(m?jsx?|tsx?)$/}, args => {
        if (!args.path.startsWith(root) || args.path.includes(`${sep}node_modules${sep}`)) return;
        const source = readFileSync(args.path, 'utf8');
        const loader = LOADERS[extname(args.path)];
        if (!/\bclassName\b|\btw`/.test(source)) return {contents: source, loader};
        try {
          return {contents: transform(babel, compiler, source, args.path), loader};
        } catch (error) {
          if (!(error instanceof TailwindError)) throw error;
          const {line, column} = error.loc ?? {};
          return {errors: [{text: `Tailwind: ${error.reason}`, location: line && {
            file: args.path, line, column, lineText: source.split('\n')[line - 1],
          }}]};
        }
      });
    },
  };
}
