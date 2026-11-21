// For Node, load app state modules but don't actually spin up the PS5 host.
// Just stub out native APIs.
// For the queue itself we'll get dependencies via createDownloadQueue.
import {dirname, resolve as resolvePath} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const react = pathToFileURL(resolvePath(here, '../../ps5-react/node_modules/react/index.js')).href;
const core = 'data:text/javascript,export const FileSystem = {dataDir:"/data",exists:()=>false,readFile:()=>""};export const Http = {};export const Image = {warm:()=>{}};export const DeviceInfo = {get:()=>({})};';

export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@ps5-react/core') return {url: core, shortCircuit: true};
  if (specifier === 'react') return {url: react, shortCircuit: true};
  return nextResolve(specifier, context);
}
