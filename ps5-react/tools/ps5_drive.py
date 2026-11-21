# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Drive a running desktop preview, as a browser automation tool drives a page.

  ps5_drive.py start --app-dir <dir> [1080p|2160p]
                                        build and launch the preview with its control channel; an
                                        auto-resolution app previews the given layout (default 2160p)
  ps5_drive.py press down               up/down/left/right/confirm/back/triangle/square/l1/r1/l2/r2/options
  ps5_drive.py hold touchpad [ms]       holds a controller button (kButtonNames: cross, l3, touchpad, ...) in
                                        Controller.getState(), for ms or until released; a button with an
                                        action (cross: confirm) dispatches it as it goes down; held l2/r2 is
                                        full travel
  ps5_drive.py release touchpad         lets it go
  ps5_drive.py trigger r2 0.6 [ms]      R2 (or L2) at 0.6 of its travel, for ms or until changed; past half
                                        travel it is pressed (button and action), 0 lets go. Commands return
                                        at once: script a hold as trigger r2 1, wait 800, trigger r2 0
  ps5_drive.py focus <focusKey>         move focus to an element by key
  ps5_drive.py shot <path.bmp> [full]  save the screen; `full` keeps the framebuffer's 2× resolution
  ps5_drive.py snapshot [--all|--json]  the focusable elements on screen, one line each with a ref:
                                        @e3 > "Hi-Fi RUSH · View game" key=trio:PPSA17168 [72,812 400x420]
                                        (> marks focus; rects in logical px). --all adds off-screen and
                                        hidden-layer elements; --json prints the raw records
  ps5_drive.py diff                     what changed on screen since the last snapshot or diff
  ps5_drive.py focus <key|@ref>         move focus by focusKey or by a ref from the last snapshot
  ps5_drive.py click <x> <y>            a left mouse click at logical pixels: focuses the element
                                        there and confirms it
  ps5_drive.py shot <path.bmp>          the frame on screen, 960×540
  ps5_drive.py script "<steps>"         input-script steps from now on (docs/ANIMATION.md), e.g.
                                        "swipe:right:0.3" for a touchpad swipe
  ps5_drive.py logs                     output printed since the last call
  ps5_drive.py wait <ms>                return after that many milliseconds of frames
  ps5_drive.py stop
"""
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cli import desktop, preview_env  # noqa: E402
from common import ROOT, app_config  # noqa: E402

SOCKET = os.environ.get("PS5_DRIVE_SOCKET", "/tmp/ps5-drive.sock")
PID = Path(SOCKET + ".pid")
LOG = Path(SOCKET + ".log")


def send(line, timeout=30):
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(timeout)
        client.connect(SOCKET)
        client.sendall((line + "\n").encode())
        chunks = []
        while chunk := client.recv(65536):
            chunks.append(chunk)
    return b"".join(chunks).decode(errors="replace").rstrip("\n")


def start(app, resolution=None):
    stop()
    app_config(app)
    with open(ROOT / ".build/build.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        command, directory = desktop(app, resolution=resolution)
    env = {**preview_env(app), "PS5_REACT_CONTROL": SOCKET}
    with open(LOG, "w") as log:
        process = subprocess.Popen([str(part) for part in command], cwd=directory, env=env, stdout=log,
                                   stderr=subprocess.STDOUT, start_new_session=True)
    PID.write_text(str(process.pid))
    # The app's bundle loads after the window opens; the channel answers once frames run.
    for _ in range(600):
        if process.poll() is not None:
            raise SystemExit(f"Preview exited ({process.returncode}); see {LOG}")
        try:
            send("wait 0", timeout=2)
            return print(f"ready: {SOCKET} (pid {process.pid}, output in {LOG})")
        except OSError:
            time.sleep(0.2)
    raise SystemExit("Preview did not answer within 120 s")


def stop():
    if PID.exists():
        try:
            os.kill(int(PID.read_text()), signal.SIGTERM)
        except (ProcessLookupError, ValueError):
            pass
        PID.unlink()


STATE = Path(SOCKET + ".snapshot.json")
SCALE = 1.5  # render px per logical px
TEXT = 60


def records():
    return json.loads(send("snapshot"))


def on_screen(record):
    return record["visible"] and not record.get("inert")


def lines(nodes):
    """One line per element, like agent-browser's accessibility snapshot: ref, focus mark, text, key, rect."""
    out = []
    for index, node in enumerate(nodes, 1):
        text = node["text"] if len(node["text"]) <= TEXT else node["text"][:TEXT - 1] + "…"
        rect = "[{},{} {}x{}]".format(*(round(node[k] / SCALE) for k in ("x", "y", "width", "height")))
        key = f' key={node["focusKey"]}' if node["focusKey"] else ""
        out.append(f'@e{index} {">" if node["focused"] else " "} "{text}"{key} {rect}')
    return out


def snapshot(flags):
    nodes = records()
    if "--json" in flags:
        return print(json.dumps(nodes))
    shown = nodes if "--all" in flags else [node for node in nodes if on_screen(node)]
    STATE.write_text(json.dumps(shown))
    print("\n".join(lines(shown)) or "(nothing focusable on screen)")


def diff():
    """By element, not by line: a scroll moves every rect, which is one fact, not a changed screen."""
    before = json.loads(STATE.read_text()) if STATE.exists() else []
    after = [node for node in records() if on_screen(node)]
    STATE.write_text(json.dumps(after))
    key = lambda node: node["focusKey"] or f'{node["text"]}@{node["x"]},{node["y"]}'
    old, new = {key(node): node for node in before}, {key(node): node for node in after}
    listed = dict(zip(map(key, after), lines(after)))
    out = []
    was = next((node for node in before if node["focused"]), None)
    now = next((node for node in after if node["focused"]), None)
    if was is not now and (was and key(was)) != (now and key(now)):
        out.append(f'focus: {was and key(was)} -> {listed.get(key(now)) if now else None}')
    out += [f"+ {listed[name]}" for name in new if name not in old]
    out += [f'- "{old[name]["text"][:TEXT]}" key={name}' for name in old if name not in new]
    changed = [listed[name] for name in new if name in old and new[name]["text"] != old[name]["text"]]
    out += [f"~ {line}" for line in changed]
    moved = sum(1 for name in new if name in old and (new[name]["x"], new[name]["y"]) != (old[name]["x"], old[name]["y"]))
    if moved:
        out.append(f"({moved} moved, e.g. by a scroll)")
    print("\n".join(out) or "(no change)")


def resolve(target):
    if not target.startswith("@e"):
        return target
    nodes = json.loads(STATE.read_text()) if STATE.exists() else []
    index = int(target[2:]) - 1
    if not 0 <= index < len(nodes) or not nodes[index]["focusKey"]:
        raise SystemExit(f"{target}: no such ref with a focusKey in the last snapshot")
    return nodes[index]["focusKey"]


def main():
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        return print(__doc__)
    if args[0] == "start":
        if len(args) not in (3, 4) or args[1] != "--app-dir" or args[3:] not in ([], ["1080p"], ["2160p"]):
            raise SystemExit("Usage: ps5_drive.py start --app-dir <dir> [1080p|2160p]")
        return start(Path(args[2]).expanduser().resolve(), *args[3:])
    if args[0] == "stop":
        return stop()
    try:
        if args[0] == "snapshot":
            return snapshot(args[1:])
        if args[0] == "diff":
            return diff()
        if args[0] == "focus" and len(args) == 2:
            return print(send(f"focus {resolve(args[1])}"))
        if args[0] == "click" and len(args) == 3:  # logical px, as snapshot prints them; the host takes render px
            return print(send(f"click {round(float(args[1]) * SCALE)} {round(float(args[2]) * SCALE)}"))
        print(send(" ".join(args)))
    except OSError as error:
        raise SystemExit(f"No preview on {SOCKET} ({error}); run: ps5_drive.py start --app-dir <dir>")


if __name__ == "__main__":
    main()
