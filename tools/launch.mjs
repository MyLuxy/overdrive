#!/usr/bin/env node
// Entry point for the npm scripts that build and preview the app.
//
// Linux and macOS run exactly the shell commands they ran before. Windows has neither the POSIX
// shell those scripts use nor a clang that can build the desktop preview, so the same commands run
// inside WSL 2, with this checkout seen as /mnt/<drive>/<path>. The distro is the first one WSL
// lists, or OVERDRIVE_WSL_DISTRO. `node tools/launch.mjs <target> --print` shows the command
// without running it.

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const COMMANDS = {
  setup: 'bash packaging/setup.sh',
  build: 'bash packaging/build.sh',
  'build:app': 'bash packaging/build.sh --no-package',
  preview: 'cd ps5-react && CC=clang CXX=clang++ python3 tools/cli.py preview --app-dir ../app',
  dev: 'cd ps5-react && CC=clang CXX=clang++ python3 tools/cli.py preview --app-dir ../app --watch',
  // The framework's tests do not know about this app, so the app's own state tests run after them.
  test: 'cd ps5-react && CC=clang CXX=clang++ npm test && cd .. && node --test app/state/*.test.mjs',
  doctor: 'cd ps5-react && python3 tools/cli.py doctor'
};

// What a target needs inside the distro before it can start. `setup` installs it all, so it is
// never checked.
const NEEDS = {
  preview: ['python3', 'node', 'npm', 'cmake', 'clang', 'ninja'],
  dev: ['python3', 'node', 'npm', 'cmake', 'clang', 'ninja'],
  test: ['python3', 'node', 'npm', 'cmake', 'clang', 'ninja'],
  build: ['python3', 'node', 'npm', 'cmake', 'clang', 'ninja', 'nasm', 'curl', 'unzip', 'zip', 'mkfs.exfat'],
  'build:app': ['python3', 'node', 'npm', 'cmake', 'clang', 'ninja', 'nasm', 'curl', 'unzip', 'zip']
};

const LLVM18 = '/usr/lib/llvm-18/bin/clang';

const DOCTOR = String.raw`
. /etc/os-release
printf 'distro   %s\n' "$PRETTY_NAME"
printf 'path     %s\n' "$PWD"
if [ -d /mnt/wslg ] && [ -n "$DISPLAY" ]; then
  printf 'display  WSLg (%s)\n' "$DISPLAY"
else
  printf 'display  MISSING (WSLg or an X server is needed for the preview)\n'
fi
preview_missing=0
build_missing=0
for tool in python3 node npm cmake clang ninja nasm bsdtar curl unzip zip git sudo mkfs.exfat; do
  found=$(command -v "$tool" 2>/dev/null)
  if [ -n "$found" ]; then
    printf '%-10s %s\n' "$tool" "$found"
  else
    printf '%-10s MISSING\n' "$tool"
    case "$tool" in
      python3|node|npm|cmake|clang|ninja) preview_missing=1 ;;
      nasm|curl|unzip|zip|mkfs.exfat) build_missing=1 ;;
    esac
  fi
done
if [ -x ` + LLVM18 + String.raw` ]; then
  printf '%-10s %s\n' llvm-18 /usr/lib/llvm-18/bin
else
  printf '%-10s MISSING\n' llvm-18
  preview_missing=1
fi
# Both groups are required by the preflight, so a green doctor must not promise the build
# while a build-only tool is absent.
if [ "$preview_missing" = 0 ] && [ "$build_missing" = 0 ]; then
  printf 'ready: npm run preview:windows, npm run build:windows\n'
  exit 0
fi
if [ "$preview_missing" = 0 ]; then
  printf 'ready: npm run preview:windows (npm run build:windows also needs npm run setup:windows)\n'
else
  printf 'next: npm run setup:windows\n'
fi
exit 1
`;

function usage() {
  console.log(`Usage: node tools/launch.mjs <${Object.keys(COMMANDS).join('|')}> [--print] [-- args]`);
}

function quote(argument) {
  return `'${String(argument).replace(/'/g, `'\\''`)}'`;
}

function pickDistro() {
  const listed = spawnSync('wsl.exe', ['-l', '-q'], { encoding: 'buffer' });
  if (listed.error?.code === 'ENOENT')
    throw new Error('WSL is not installed. Install WSL 2 ("wsl --install") and an Ubuntu distro, then run npm run setup:windows.');
  // `wsl -l -q` writes UTF-16LE; older builds write UTF-8 when the output is piped.
  const bytes = listed.error || listed.status !== 0 || !listed.stdout ? Buffer.alloc(0) : listed.stdout;
  const text = bytes.includes(0) ? bytes.toString('utf16le') : bytes.toString('utf8');
  const available = text.replace(/^\uFEFF/, '').split(/\r?\n/).map((name) => name.trim()).filter(Boolean);
  const wanted = process.env.OVERDRIVE_WSL_DISTRO;
  if (wanted && available.length && !available.includes(wanted))
    throw new Error(`WSL has no distro named "${wanted}". Installed: ${available.join(', ') || 'none'}.`);
  if (wanted) return wanted;
  if (available.includes('Ubuntu')) return 'Ubuntu';
  if (available.length) return available[0];
  throw new Error('No WSL 2 distro found. Install one with "wsl --install -d Ubuntu" and run npm run setup:windows.');
}

function wsl(distro, script, { capture = false } = {}) {
  // A file, not a command line: wsl.exe evaluates the command line once more on its way in, which
  // empties shell variables and breaks quoting. A file reaches bash untouched and leaves the
  // terminal (sudo's password prompt) in place.
  const file = join(ROOT, '.build', `launch-${process.pid}.sh`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, script.endsWith('\n') ? script : script + '\n');
  const child = spawn('wsl.exe',
    ['-d', distro, '--cd', ROOT, '--', 'bash', `.build/launch-${process.pid}.sh`],
    { cwd: ROOT, stdio: ['inherit', capture ? 'pipe' : 'inherit', 'inherit'] });
  const clean = () => rmSync(file, { force: true });
  child.on('close', clean);
  child.on('error', clean);
  return child;
}

function wait(child) {
  return new Promise((resolve) => {
    child.on('error', (error) => {
      console.error(`error: ${error.message}`);
      resolve(1);
    });
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function main() {
  const [target, ...rest] = process.argv.slice(2);
  if (!target || target === '--help' || target === '-h') {
    usage();
    return 0;
  }
  if (!(target in COMMANDS)) {
    usage();
    return 2;
  }
  const print = rest.includes('--print') || process.env.OVERDRIVE_LAUNCH_PRINT === '1';
  // `npm run <target> -- args` drops the separator, but `node tools/launch.mjs <target> -- args`
  // keeps it, and the build scripts must not receive a bare `--` as an argument.
  const extra = rest.filter((argument) => argument !== '--print');
  if (extra[0] === '--') extra.shift();
  const command = [COMMANDS[target], ...extra.map(quote)].join(' ');

  if (process.platform !== 'win32') {
    if (print) {
      console.log(command);
      return 0;
    }
    return wait(spawn(command, { cwd: ROOT, stdio: 'inherit', shell: true }));
  }

  const distro = pickDistro();
  if (print) {
    // The real run hands bash a file, so show that invocation and its contents: the inline
    // `bash -c` form would be a different command, and a shell-local `$name` would vanish.
    console.log(`wsl.exe -d ${distro} --cd ${ROOT} -- bash .build/launch-<pid>.sh`);
    console.log('--- .build/launch-<pid>.sh');
    console.log((target === 'doctor' ? DOCTOR : command).trimEnd());
    return 0;
  }

  if (target === 'doctor') {
    console.log('Overdrive — Windows, through WSL 2');
    return wait(wsl(distro, DOCTOR));
  }

  // Fail with what is missing, not with the wall of build errors it would cause.
  const needs = NEEDS[target];
  if (needs?.length) {
    const probe = `for tool in ${needs.join(' ')}; do command -v "$tool" >/dev/null 2>&1 || echo "$tool"; done\n`
      + `[ -x ${quote(LLVM18)} ] || echo llvm-18`;
    const missing = await new Promise((resolve) => {
      const child = wsl(distro, probe, { capture: true });
      let output = '';
      child.stdout?.on('data', (chunk) => (output += chunk));
      child.on('error', (error) => resolve([error.message]));
      child.on('exit', () => resolve(output.split('\n').map((line) => line.trim()).filter(Boolean)));
    });
    if (missing.length) {
      console.error(`error: ${distro} is missing ${missing.join(', ')}.`);
      console.error('       npm run setup:windows installs the whole toolchain once, inside WSL (it asks for sudo).');
      return 1;
    }
  }

  if ((target === 'preview' || target === 'dev') && !(await new Promise((resolve) => {
    const child = wsl(distro, '[ -d /mnt/wslg ] && [ -n "$DISPLAY" ]', { capture: true });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  }))) {
    console.error('warning: WSL has no display (WSLg or an X server); the window may not open.');
  }

  return wait(wsl(distro, command));
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
