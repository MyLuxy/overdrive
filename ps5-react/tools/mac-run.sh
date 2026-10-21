#!/bin/sh
# macOS launcher for the desktop preview.
#
# Uses ps5-react/.venv for Pillow (Homebrew's python3 is externally managed) and
# puts it on PATH so the `python3` calls inside cli.py resolve to the same
# interpreter. LLVM 18 comes from Homebrew, Node from nvm, and the MacPorts
# libraries plus a locally built SDL2 are preferred when present.
#
# /usr/local/bin is left out when MacPorts supplies cmake: the preview's
# CMakeLists asks `brew --prefix`, and mixing Homebrew's OpenSSL/CURL with the
# MacPorts copies breaks the link.
set -eu

root=$(CDPATH= cd "$(dirname "$0")/.." && pwd)
venv=$root/.venv

if [ ! -x "$venv/bin/python" ]; then
    echo "error: $venv is missing. Run 'npm run setup:mac' from the repository root." >&2
    exit 1
fi

llvm=
for dir in /usr/local/opt/llvm@18/bin /opt/homebrew/opt/llvm@18/bin; do
    if [ -x "$dir/clang" ]; then llvm=$dir; break; fi
done
if [ -z "$llvm" ]; then
    echo "error: LLVM 18 not found. Install it with 'brew install llvm@18'." >&2
    exit 1
fi

node=$(command -v node || true)
if [ -z "$node" ]; then
    echo "error: node not found; install Node 18 or newer." >&2
    exit 1
fi
node_dir=$(dirname "$node")

prefixes=
tail=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
if [ -d "$HOME/.local/overdrive-sdl2" ]; then
    prefixes=$HOME/.local/overdrive-sdl2
fi
if [ -x /opt/local/bin/cmake ]; then
    prefixes=${prefixes:+$prefixes:}/opt/local
    tail=/usr/bin:/bin:/usr/sbin:/sbin
fi

PATH="$venv/bin:$llvm:$node_dir:/opt/local/bin:$tail"
export PATH
if [ -n "$prefixes" ]; then
    export CMAKE_PREFIX_PATH="$prefixes${CMAKE_PREFIX_PATH:+:$CMAKE_PREFIX_PATH}"
fi

exec "$venv/bin/python" "$root/tools/cli.py" "$@"
