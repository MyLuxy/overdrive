#!/usr/bin/env bash
# Installs everything a fresh clone needs to preview, test and build Overdrive.
# Run it once, from the repository root (never on its own through npm install):
#
#   npm run setup
#
# Linux (apt): asks for sudo once to install the packages for the desktop
# preview (SDL2, OpenGL, curl, libarchive, OpenSSL, clang), the PS5 build
# (LLVM 18, ninja, nasm, exfatprogs) and the tests (bsdtar), then Pillow for
# the asset baking and the framework's npm packages.
# macOS (Homebrew): the same through brew, plus a ps5-react/.venv for Pillow
# (Homebrew's python3 refuses a global pip install).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

case "$(uname -s)" in
Linux)
    command -v apt-get >/dev/null || { echo "error: only apt-based Linux is scripted; see README 'Build it yourself' for the package list" >&2; exit 1; }
    echo "→ apt packages (sudo)"
    sudo apt-get update
    sudo apt-get install -y \
        build-essential cmake clang ninja-build nasm pkg-config git curl unzip zip zstd \
        libsdl2-dev libgl-dev libcurl4-openssl-dev libarchive-dev libarchive-tools liblzma-dev libssl-dev zlib1g-dev \
        clang-18 llvm-18 llvm-18-dev exfatprogs \
        nodejs npm python3 python3-pil
    ;;
Darwin)
    command -v brew >/dev/null || { echo "error: Homebrew is needed: https://brew.sh" >&2; exit 1; }
    echo "→ Homebrew formulae"
    brew install cmake sdl2 llvm@18 nasm ninja curl libarchive xz openssl@3 python node
    echo "→ Python environment"
    [ -x "$root/ps5-react/.venv/bin/python" ] || python3 -m venv "$root/ps5-react/.venv"
    "$root/ps5-react/.venv/bin/pip" install --disable-pip-version-check \
        -r "$root/ps5-react/requirements.txt"
    ;;
*)
    echo "error: unsupported OS $(uname -s)" >&2
    exit 1
    ;;
esac

echo "→ framework npm packages"
(cd "$root/ps5-react" && npm ci)

echo "→ checking"
case "$(uname -s)" in
Darwin)
    "$root/ps5-react/.venv/bin/python" -c "import PIL; print('Pillow', PIL.__version__)"
    tools="cmake clang ninja nasm node newfs_exfat hdiutil"
    ;;
*)
    python3 -c "import PIL; print('Pillow', PIL.__version__)"
    tools="cmake clang ninja nasm node mkfs.exfat"
    ;;
esac
for tool in $tools; do
    printf '%-10s %s\n' "$tool" "$(command -v "$tool" || echo MISSING)"
done
echo
echo "Ready. Next: npm run preview (desktop window), npm run build (Overdrive.exfat)."
echo "On macOS the :mac variants (preview:mac, dev:mac, build:mac) use ps5-react/.venv."
echo "The first preview and the first build download and compile the pinned dependencies; that takes a while."
