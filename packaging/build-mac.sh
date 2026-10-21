#!/usr/bin/env bash
# Builds the PS5 app on macOS.
#
# Uses ps5-react/.venv for Pillow (verify.py imports it and Homebrew's python3
# is externally managed), LLVM 18 from Homebrew, and ninja from Homebrew. The
# desktop preview's MacPorts/SDL2 environment does not apply here.
#
# Packaging is a separate, local-only step: packaging/make-exfat-mac.sh.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
venv="$root/ps5-react/.venv"
if [ ! -x "$venv/bin/python" ]; then
    echo "error: $venv is missing; run 'npm run setup:mac' from the repository root." >&2
    exit 1
fi

llvm="${LLVM:-}"
if [ -z "$llvm" ]; then
    for candidate in /usr/local/opt/llvm@18/bin /opt/homebrew/opt/llvm@18/bin; do
        if [ -x "$candidate/clang" ]; then llvm=$candidate; break; fi
    done
fi
if [ -z "$llvm" ] || [ ! -x "$llvm/clang" ]; then
    echo "error: LLVM 18 not found. Install it with 'brew install llvm@18' or set LLVM=<its bin directory>." >&2
    exit 1
fi

PATH="$venv/bin:$llvm:/opt/local/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export PATH

# The PS5 build does not link the desktop's libraries, but a MacPorts setup keeps
# CMake away from a mixed Homebrew/MacPorts prefix when one is present.
prefixes=
if [ -d "$HOME/.local/overdrive-sdl2" ]; then
    prefixes=$HOME/.local/overdrive-sdl2
fi
if [ -x /opt/local/bin/cmake ]; then
    prefixes=${prefixes:+$prefixes:}/opt/local
fi
if [ -n "$prefixes" ]; then
    export CMAKE_PREFIX_PATH="$prefixes${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"
fi

exec bash "$root/packaging/build.sh" --no-package
