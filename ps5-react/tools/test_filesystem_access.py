# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Run the pinned community client's mocked protocol tests without a console."""
from pathlib import Path
import json
import sys

from common import ROOT, run


def main():
    client, build = map(Path, sys.argv[1:])
    build.mkdir(parents=True, exist_ok=True)
    source = (client / "tests/test_elevation.cpp").read_text()
    implementation = client / "examples/sandbox-elevation/src/elevation.cpp"
    source = source.replace('"../examples/sandbox-elevation/src/elevation.cpp"',
                            json.dumps(str(implementation.resolve())))
    if sys.platform == "darwin":
        # macOS POSIX headers omit noexcept on functions mocked by the Linux
        # fixture. Adapt only the generated test copy, never the pinned client.
        source = source.replace(" noexcept", "")
    fixture = build / "test-elevation.cpp"
    fixture.write_text(source)
    executable = build / "test-elevation"
    run(["clang++", "-std=c++20", "-Wall", "-Wextra", "-Werror", fixture, "-o", executable])
    run([executable])
    print("PASS: resident/helper selection, partial transfers, rejection and data proof")
    headers = build / "root-test-headers"
    (headers / "platform/ps5").mkdir(parents=True, exist_ok=True)
    (headers / "app_config.hpp").write_text('#define PS5_REACT_CONSOLE_FILESYSTEM 1\n#define PS5_REACT_TITLE "PPSA99058"\n')
    (headers / "platform/ps5/system.hpp").write_text(
        '#pragma once\nnamespace hui::sys { template<class... T> void log(const char*, T...) {} }\n')
    root_test = build / "test-filesystem-roots"
    run(["clang++", "-std=c++20", "-Wall", "-Wextra", "-Werror", "-I", headers,
         "-I", client / "examples/sandbox-elevation", ROOT / "tools/test_filesystem_roots.cpp", "-o", root_test])
    run([root_test])


if __name__ == "__main__":
    main()
