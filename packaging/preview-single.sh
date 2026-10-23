#!/usr/bin/env bash
# Single-instance preview launcher for Overdrive.
# Invoked by both npm run preview and npm run dev. Keep all source/UI changes
# intact, only terminate stale Overdrive GUI instances and old live watchers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

python3 - "$ROOT" <<'PY'
from pathlib import Path
import os
import signal
import sys
import time

root = Path(sys.argv[1]).resolve()
preview_binary = root / 'ps5-react/.build/app/desktop/ps5-react-preview'
ps5_dir = root / 'ps5-react'
own = os.getpid()
found = []

for entry in Path('/proc').iterdir():
    if not entry.name.isdigit():
        continue
    pid = int(entry.name)
    if pid == own:
        continue
    try:
        args = (entry / 'cmdline').read_bytes().split(b'\0')
        args = [a.decode(errors='replace') for a in args if a]
        if not args:
            continue
        name = Path(args[0]).name
        # Only touch this Overdrive checkout's own GUI preview executable.
        own_preview = (name == 'ps5-react-preview' and
                       Path(args[0]).resolve() == preview_binary)
        # A leftover --watch process would launch a second window when a
        # source file changes, so it must be closed as well.
        old_watcher = ('cli.py' in ' '.join(args) and
                       'preview' in args and '--watch' in args and
                       (entry / 'cwd').resolve() == ps5_dir)
        if own_preview or old_watcher:
            found.append((pid, 'preview' if own_preview else 'watcher'))
    except (FileNotFoundError, ProcessLookupError, PermissionError, OSError):
        pass

for pid, kind in found:
    try:
        os.kill(pid, signal.SIGTERM)
        print(f'Closing old Overdrive {kind}: PID {pid}', flush=True)
    except ProcessLookupError:
        pass

def alive(pid):
    try:
        stat = Path(f'/proc/{pid}/stat').read_text()
        return stat.rsplit(')', 1)[1].strip().split()[0] not in ('Z', 'X')
    except (FileNotFoundError, ProcessLookupError):
        return False

for _ in range(40):
    if not any(alive(pid) for pid, _ in found):
        break
    time.sleep(0.1)
for pid, kind in found:
    if alive(pid):
        try:
            os.kill(pid, signal.SIGKILL)
            print(f'Closed unresponsive old {kind}: PID {pid}', flush=True)
        except ProcessLookupError:
            pass
print(f'Previous Overdrive previews closed: {len(found)}', flush=True)
PY

cd "$ROOT/ps5-react"
exec env CC=clang CXX=clang++ python3 tools/cli.py preview --app-dir ../app "$@"
