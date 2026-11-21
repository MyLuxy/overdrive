#!/usr/bin/env bash
# Packages a built PS5 app folder as the exFAT image ShadowMount+ installs.
#
# The app's files sit at the root of the image (/eboot.bin, /sce_module/,
# /sce_sys/, /data/...), which is how the released Overdrive image is laid out.
# Needs root: it mounts the image to copy into it. --size-only prints the size
# the image would get and needs neither root nor mkfs.exfat.
#
# The cluster size decides the image's size. This app ships about eight thousand
# files of a few KB each (the catalog's JSON) and every file takes a whole
# cluster, so 64K clusters cost ~530 MB where 8K clusters cost ~90 MB. ShadowMount+
# refuses only a cluster smaller than the device's sector (512 bytes) and mounts
# 4K through 128K alike; its recommendation of 64K is for images of big files,
# which this one is not. 8K is the default since v1.1.0.
#
# usage: make-exfat.sh <app-folder> <out.exfat> [label] [cluster-size] [--size-only]
#        EXFAT_SLACK_MB overrides the slack (default 32).
set -euo pipefail

size_only=0
args=()
for arg in "$@"; do
    case "$arg" in
        --size-only) size_only=1 ;;
        *) args+=("$arg") ;;
    esac
done
if [ "${#args[@]}" -gt 0 ]; then set -- "${args[@]}"; else set --; fi

app="${1:-}"
out="${2:-}"
label="${3:-OVERDRIVE}"
cluster="${4:-8K}"
slack_mb="${EXFAT_SLACK_MB:-32}"

if [ -z "$app" ] || [ -z "$out" ]; then
    echo "usage: $0 <app-folder> <out.exfat> [label] [cluster-size] [--size-only]" >&2
    exit 2
fi
[ -d "$app" ] || { echo "error: no such app folder: $app" >&2; exit 1; }
[ -f "$app/eboot.bin" ] || { echo "error: $app has no eboot.bin, it is not a built PS5 app" >&2; exit 1; }

# A cluster size this script does not know is an error: the old fallback formatted with
# mkfs's default instead, which quietly made the image four to eight times bigger.
case "$cluster" in
    4K|4k) cluster_bytes=4096 ;;
    8K|8k) cluster_bytes=8192 ;;
    16K|16k) cluster_bytes=16384 ;;
    32K|32k) cluster_bytes=32768 ;;
    64K|64k) cluster_bytes=65536 ;;
    128K|128k) cluster_bytes=131072 ;;
    *) echo "error: cluster size must be 4K, 8K, 16K, 32K, 64K or 128K, not $cluster" >&2; exit 2 ;;
esac

# Size the image from what exFAT actually consumes. Every file takes whole
# clusters, and this app ships thousands of small JSON files, so the payload's
# apparent size underestimates the volume: 42 MB of app files need ~90 MB of
# 8 KiB clusters. Asking `du` for a block size does not emulate that (it scales
# the host filesystem's own usage), hence the count here. The slack covers the
# FAT, the upcase table and the directories, and is what the console will have
# free inside the image.
read -r files bytes clusters < <(find "$app" -type f -printf '%s\n' |
    awk -v c="$cluster_bytes" '{ n++; b += $1; k += int(($1 + c - 1) / c) } END { print n + 0, b + 0, k + 0 }')
directories=$(find "$app" -type d | wc -l)
payload=$(( (clusters + directories) * cluster_bytes ))
slack=$(( slack_mb * 1024 * 1024 ))
size=$(( (payload + slack + 1048575) / 1048576 * 1048576 ))

mib() { awk -v b="$1" 'BEGIN { printf "%.1f MiB", b / 1048576 }'; }

echo "make-exfat: $app"
echo "make-exfat: $files files, $directories directories, $(mib "$bytes") of data, cluster $cluster ($cluster_bytes bytes), slack ${slack_mb} MiB"
echo "make-exfat: $clusters clusters of data (+ $directories directory clusters) = $(mib "$payload") of clusters"
echo "make-exfat: image $out: $size bytes ($(mib "$size")), allocation $(awk -v u="$bytes" -v s="$size" 'BEGIN { printf "%.1f%%", 100 * u / s }') of it"

if [ "$size_only" = 1 ]; then
    echo "make-exfat: --size-only, nothing written"
    exit 0
fi

[ "$(id -u)" = 0 ] || { echo "error: needs root to mount the image, run it with sudo" >&2; exit 1; }
command -v mkfs.exfat >/dev/null || { echo "error: mkfs.exfat not found, install exfatprogs" >&2; exit 1; }

mkdir -p "$(dirname "$out")"
rm -f "$out"
truncate -s "$size" "$out"

mkfs_out=$(mkfs.exfat -L "$label" -c "$cluster" "$out" 2>&1) || {
    echo "error: mkfs.exfat refused -c $cluster:" >&2
    printf '%s\n' "$mkfs_out" | sed 's/^/  /' >&2
    rm -f "$out"
    echo "error: the image was deleted rather than formatted with a cluster size of mkfs's own choosing" >&2
    exit 1
}
printf '%s\n' "$mkfs_out" | sed 's/^/mkfs.exfat: /'

# The image's own answer rather than the argument's, from the boot sector: byte 108 is
# log2(bytes per sector), 109 log2(sectors per cluster), 110 the number of FATs, and bytes
# 92-95 the volume's cluster count (little-endian). The label is not in the boot sector:
# exFAT keeps it as an entry in the root directory.
read -r shift_sector shift_cluster fats < <(od -An -tu1 -j 108 -N 3 "$out")
read -r volume_clusters < <(od -An -tu4 -j 92 -N 4 "$out")
actual_sector=$(( 1 << shift_sector ))
actual_cluster=$(( actual_sector << shift_cluster ))
echo "make-exfat: boot sector: $actual_sector-byte sectors, $actual_cluster-byte clusters ($shift_cluster sectors each), $fats FAT(s), $volume_clusters clusters in the volume"
if [ "$actual_cluster" != "$cluster_bytes" ]; then
    echo "error: the image came out with $actual_cluster-byte clusters, not $cluster_bytes" >&2
    exit 1
fi
if [ "$volume_clusters" -lt "$((clusters + directories))" ]; then
    echo "error: the volume has $volume_clusters clusters, the app alone needs $((clusters + directories))" >&2
    exit 1
fi

mnt=$(mktemp -d)
mounted=0
cleanup() {
    if [ "$mounted" = 1 ]; then
        umount "$mnt" 2>/dev/null || fusermount -u "$mnt" 2>/dev/null || true
    fi
    rmdir "$mnt" 2>/dev/null || true
}
trap cleanup EXIT

# Hosted runners ship kernels without the exfat module, so fall back to the
# FUSE driver, which can read the image either directly or through a loop
# device.
mount_image() {
    modprobe exfat 2>/dev/null || true
    if mount -o loop -t exfat "$out" "$mnt" 2>/dev/null; then
        echo "mounted: kernel exfat driver"
        return 0
    fi
    if command -v mount.exfat-fuse >/dev/null; then
        if mount.exfat-fuse "$out" "$mnt" 2>/dev/null; then
            echo "mounted: exfat-fuse"
            return 0
        fi
        local loop
        if loop=$(losetup -f --show "$out" 2>/dev/null); then
            if mount.exfat-fuse "$loop" "$mnt" 2>/dev/null; then
                echo "mounted: exfat-fuse on $loop"
                return 0
            fi
            losetup -d "$loop" 2>/dev/null || true
        fi
    fi
    return 1
}

# What the volume reports of itself while it is mounted: the figure the console will
# show inside the image, before and after the copy.
report_volume() {
    local name="$1" line total used free
    line=$(df -B1 -P "$mnt" 2>/dev/null | tail -n 1 || true)
    if [ -z "$line" ]; then
        echo "make-exfat: $name: df reported nothing"
        return 0
    fi
    read -r _ total used free _ <<<"$line"
    echo "make-exfat: $name: $total bytes total, $used used, $free free ($(mib "$free") free)"
}

mount_image || { echo "error: could not mount $out, install exfat-fuse or a kernel with exfat" >&2; exit 1; }
mounted=1
report_volume "mounted, empty"

cp -r "$app/." "$mnt/"
sync
report_volume "mounted, after the copy"

src=$(find "$app" -type f | wc -l)
dst=$(find "$mnt" -type f | wc -l)
[ "$src" = "$dst" ] || { echo "error: wrote $dst files, the app has $src" >&2; exit 1; }
echo "make-exfat: $dst files copied, the app has $src"
umount "$mnt" || fusermount -u "$mnt"
mounted=0

# The finished image, read as a filesystem by itself: the mount above proves it can hold
# the files, this proves the tables it wrote are consistent.
if command -v fsck.exfat >/dev/null; then
    if fsck_out=$(fsck.exfat -n "$out" 2>&1); then
        echo "fsck.exfat: clean"
    else
        echo "error: fsck.exfat found problems in $out:" >&2
        printf '%s\n' "$fsck_out" | sed 's/^/  /' >&2
        exit 1
    fi
else
    echo "fsck.exfat: not installed, the finished image was not checked"
fi

echo "wrote $out ($(stat -c%s "$out") bytes, $dst files)"
