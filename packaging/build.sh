#!/usr/bin/env bash
# Builds the PS5 app and packages it as Overdrive.exfat, the same steps as
# .github/workflows/build.yml, on this machine. Run it through npm from the
# repository root:
#
#   npm run build         build the app and package the image
#   npm run build:app     build the app only (ps5-react/dist/PPSA99058)
#
# The build is pinned to LLVM 18. It is looked for where apt and Homebrew put
# it; set LLVM=<its bin directory> to point elsewhere. Packaging needs root
# (make-exfat.sh mounts the image to fill it), so it asks through sudo.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
package=1
[ "${1:-}" = "--no-package" ] && package=0

llvm="${LLVM:-}"
if [ -z "$llvm" ]; then
    for candidate in /usr/lib/llvm-18/bin /opt/homebrew/opt/llvm@18/bin /usr/local/opt/llvm@18/bin; do
        if [ -x "$candidate/clang" ]; then llvm="$candidate"; break; fi
    done
fi
if [ -z "$llvm" ] || [ ! -x "$llvm/clang" ]; then
    echo "error: LLVM 18 not found. Install it (apt: clang-18 llvm-18 llvm-18-dev lld-18; brew: llvm@18)" >&2
    echo "       or set LLVM=<directory holding its clang and llvm-config>" >&2
    exit 1
fi

missing=()
for tool in cmake ninja nasm curl unzip zip; do
    command -v "$tool" >/dev/null || missing+=("$tool")
done
if [ "$package" = 1 ] && ! command -v mkfs.exfat >/dev/null; then missing+=("mkfs.exfat (exfatprogs)"); fi
if [ "${#missing[@]}" -gt 0 ]; then
    echo "error: missing tools: ${missing[*]}" >&2
    echo "       apt: cmake ninja-build nasm curl unzip zip exfatprogs" >&2
    exit 1
fi

# The PS5 link goes through prospero-lld, which calls ld.lld next to this clang. Report it here,
# where the fix is one apt command, instead of from inside a dependency build. Homebrew's lld can
# serve a macOS LLVM whose own bindir lacks it, so only Linux is checked.
if [ "$(uname -s)" = Linux ] && [ ! -x "$llvm/ld.lld" ]; then
    echo "error: the LLVM 18 linker is missing: $llvm/ld.lld" >&2
    echo "       apt: lld-18    (or set LLVM=<a directory holding clang and ld.lld>)" >&2
    exit 1
fi

echo "→ building the PS5 app with LLVM at $llvm"
(cd "$root/ps5-react" && python3 tools/build_ps5.py --app-dir "$root/app" --llvm "$llvm")
[ "$package" = 1 ] || exit 0

echo "→ packaging Overdrive.exfat (sudo: the image is mounted to fill it)"
sudo bash "$root/packaging/make-exfat.sh" "$root/ps5-react/dist/PPSA99058" "$root/Overdrive.exfat" OVERDRIVE
sudo chown "$(id -u):$(id -g)" "$root/Overdrive.exfat"
# The in-app updater fetches one name, for an image install: the image alone at the root of update.zip.
rm -f "$root/update.zip"
zip -q -X -j "$root/update.zip" "$root/Overdrive.exfat"
ls -l "$root/Overdrive.exfat" "$root/update.zip"
