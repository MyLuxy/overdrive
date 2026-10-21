#!/usr/bin/env bash
# Packages a built PS5 app folder as the exFAT image ShadowMount+ installs, on
# macOS. Local only: CI keeps using make-exfat.sh on Linux, which also writes
# update.zip. This script writes the image alone.
#
# usage: make-exfat-mac.sh <app-folder> <out.exfat> [label] [cluster-size]
set -euo pipefail

app="${1:-}"
out="${2:-}"
label="${3:-OVERDRIVE}"
cluster="${4:-64K}"

if [ -z "$app" ] || [ -z "$out" ]; then
    echo "usage: $0 <app-folder> <out.exfat> [label] [cluster-size]" >&2
    exit 2
fi
[ -d "$app" ] || { echo "error: no such app folder: $app" >&2; exit 1; }
[ -f "$app/eboot.bin" ] || { echo "error: $app has no eboot.bin, it is not a built PS5 app" >&2; exit 1; }
for tool in hdiutil newfs_exfat fsck_exfat; do
    command -v "$tool" >/dev/null || { echo "error: $tool not found; this script is macOS only" >&2; exit 1; }
done

case "$cluster" in
    32K|32k) cluster_bytes=32768 ;;
    64K|64k) cluster_bytes=65536 ;;
    128K|128k) cluster_bytes=131072 ;;
    *) echo "error: cluster size must be 32K, 64K or 128K" >&2; exit 2 ;;
esac

mount_point="/Volumes/$label"
if mount | grep -F " on $mount_point " >/dev/null; then
    echo "error: $mount_point is already mounted; unmount it first" >&2
    exit 1
fi

# Size the image from what exFAT actually consumes: every file takes whole
# clusters, and the app ships thousands of small JSON files, so the payload's
# apparent size underestimates the volume. This is the same formula as
# make-exfat.sh, with macOS's stat instead of GNU find -printf.
slack=$(( ${EXFAT_SLACK_MB:-128} * 1024 * 1024 ))
clusters=$(find "$app" -type f -exec stat -f%z {} + |
    awk -v c="$cluster_bytes" '{ n += int(($1 + c - 1) / c) } END { print n + 0 }')
directories=$(find "$app" -type d | wc -l | tr -d ' ')
payload=$(( (clusters + directories) * cluster_bytes ))
size=$(( (payload + slack + 1048575) / 1048576 * 1048576 ))
printf '→ exFAT: %s MiB, %s clusters, label %s\n' "$((size / 1048576))" "$cluster" "$label"

if [ -e "$out" ]; then
    echo "→ replacing $out"
fi
rm -f "$out"
truncate -s "$size" "$out"

dev=
mounted=0
cleanup() {
    if [ "$mounted" = 1 ]; then
        hdiutil detach "$mount_point" >/dev/null 2>&1 ||
            hdiutil detach -force "$mount_point" >/dev/null 2>&1 || true
    fi
    if [ -n "$dev" ]; then
        hdiutil detach "$dev" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

dev=$(hdiutil attach -imagekey diskimage-class=CRawDiskImage -nomount "$out" |
    awk '/^\/dev\/disk/{print $1; exit}')
[ -n "$dev" ] || { echo "error: hdiutil could not attach $out" >&2; exit 1; }
newfs_exfat -R -v "$label" -b "$cluster_bytes" "$dev" >/dev/null
hdiutil detach "$dev" >/dev/null
dev=

attach=$(hdiutil attach -imagekey diskimage-class=CRawDiskImage -nobrowse "$out")
dev=$(printf '%s\n' "$attach" | awk '$3 ~ /^\/Volumes\// {print $1; exit}')
[ -n "$dev" ] || dev=$(printf '%s\n' "$attach" | awk '/^\/dev\/disk/{print $1; exit}')
for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -d "$mount_point" ] && break
    sleep 1
done
[ -d "$mount_point" ] || { echo "error: $mount_point did not mount" >&2; exit 1; }
mounted=1

cp -R "$app/." "$mount_point/"

# Finder and Spotlight may add their own directories; they are not part of the app.
rm -rf "$mount_point/.Spotlight-V100" "$mount_point/.fseventsd" "$mount_point/.Trashes"
src=$(find "$app" -type f | wc -l | tr -d ' ')
dst=$(find "$mount_point" -type f \
    -not -path "$mount_point/.Spotlight-V100/*" \
    -not -path "$mount_point/.fseventsd/*" \
    -not -path "$mount_point/.Trashes/*" | wc -l | tr -d ' ')
[ "$src" = "$dst" ] || { echo "error: wrote $dst files, the app has $src" >&2; exit 1; }

sync
hdiutil detach "$mount_point" >/dev/null || hdiutil detach -force "$mount_point" >/dev/null
mounted=0
dev=

# Check the finished image itself: its filesystem, and the app's entry point.
dev=$(hdiutil attach -imagekey diskimage-class=CRawDiskImage -nomount "$out" |
    awk '/^\/dev\/disk/{print $1; exit}')
[ -n "$dev" ] || { echo "error: hdiutil could not reattach $out" >&2; exit 1; }
fsck_exfat -n "$dev" >/dev/null
hdiutil detach "$dev" >/dev/null
dev=

echo "wrote $out ($(stat -f%z "$out") bytes, $src files)"
