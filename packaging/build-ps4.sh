#!/usr/bin/env bash
# Builds the PS4 staging tree (eboot.elf and the app data) with the Open Orbis toolchain.
# The console-facing packaging and testing steps are described in docs/PS4.md. Run it
# through npm from the repository root:
#
#   npm run build:ps4            build the staging tree (dist/<title>-ps4)
#
# The toolchain root comes from OO_PS4_TOOLCHAIN; --toolchain overrides it. All other
# arguments pass through to ps5-react/tools/build_ps4.py.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"

for tool in cmake ninja node python3; do
    command -v "$tool" >/dev/null || { echo "error: missing tool: $tool" >&2; exit 1; }
done
if [ -z "${OO_PS4_TOOLCHAIN:-}" ]; then
    echo "error: set OO_PS4_TOOLCHAIN to the Open Orbis-PS4-Toolchain root (see docs/PS4.md)" >&2
    exit 1
fi

cd "$root/ps5-react"
exec python3 tools/build_ps4.py --app-dir "$root/app" "$@"
