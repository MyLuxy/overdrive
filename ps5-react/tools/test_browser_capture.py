#!/usr/bin/env python3
"""Exercise the actual payload matcher/scanner on bounded in-memory fixtures."""
from pathlib import Path
import subprocess
import tempfile
ROOT = Path(__file__).resolve().parents[1]
browser = ROOT / "native/ps5/payloads/browser"
with tempfile.TemporaryDirectory(prefix="browser-capture-test-") as directory:
    executable = Path(directory) / "capture-test"
    subprocess.run(["cc", "-std=c11", "-Wall", "-Wextra", "-Werror", "-fsanitize=undefined,bounds",
        "-I", str(browser), str(ROOT / "tools/tests/browser_capture_test.c"),
        *[str(browser / name) for name in ("browser_match.c", "browser_scan.c", "browser_url.c")],
        "-o", str(executable)], check=True)
    subprocess.run([str(executable)], check=True, timeout=15)
