# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""The pinned FFmpeg release (LGPL-3.0-or-later as configured), built static for each host.

Both hosts build the same source with the same components, so the preview decodes what the PS5 does.
The lock's patches (backported upstream fixes) are applied in order to the extracted release. A
build is reused while its configure line and patches are unchanged."""
import hashlib
import os
from pathlib import Path
import shutil
import sys
import tarfile

from common import DEPS, LOCK, ROOT, fetch, run

COMPONENTS = [
    "--disable-everything", "--disable-autodetect", "--disable-programs", "--disable-doc", "--disable-debug",
    "--disable-avdevice", "--disable-avfilter", "--disable-postproc",
    "--enable-avcodec", "--enable-avformat", "--enable-avutil", "--enable-swresample", "--enable-swscale",
    "--enable-network", "--enable-pthreads", "--enable-version3",
    "--enable-demuxer=mov,matroska,mpegts,mpegps,hls,avi,flv,flac,mp3,aac,ac3,eac3,dts,truehd,ogg,wav,ivf,webvtt,srt,ass",
    "--enable-protocol=file,pipe,http,tcp,crypto,https,tls",
    "--enable-decoder=h264,hevc,vp8,vp9,mpeg4,mpeg2video,mpeg1video,msmpeg4v3,vc1,mjpeg",
    "--enable-decoder=aac,aac_latm,ac3,eac3,mp3,mp2,opus,vorbis,flac,alac,truehd,mlp,dca",
    "--enable-decoder=pcm_s16le,pcm_s16be,pcm_s24le,pcm_s24be,pcm_s32le,pcm_f32le,pcm_u8,pcm_bluray,pcm_dvd",
    "--enable-decoder=subrip,ass,ssa,movtext,webvtt",
    "--enable-parser=h264,hevc,vp8,vp9,av1,mpeg4video,mpegvideo,vc1,mjpeg,aac,aac_latm,ac3,mpegaudio,opus,vorbis,flac,mlp,dca",
    "--enable-bsf=h264_mp4toannexb,hevc_mp4toannexb,extract_extradata,aac_adtstoasc,vp9_superframe_split",
]
LIBRARIES = ["libavformat.a", "libavcodec.a", "libswscale.a", "libswresample.a", "libavutil.a"]


def patches_digest():
    """What the lock's patches say, so a source tree or build with other patches is redone."""
    digest = hashlib.sha256()
    for patch in LOCK["ffmpeg"].get("patches", ()):
        digest.update(patch.encode() + b"\0" + (ROOT / patch).read_bytes())
    return digest.hexdigest() if LOCK["ffmpeg"].get("patches") else ""


def source():
    """Source directory of the pinned release with the lock's patches applied."""
    pinned = LOCK["ffmpeg"]
    directory = DEPS / f"ffmpeg-{pinned['version']}"
    marker = directory / ".ps5-react-patches"
    applied = marker.read_text() if marker.exists() else ""
    if (directory / "configure").exists() and applied != patches_digest():
        shutil.rmtree(directory)
    if not (directory / "configure").exists():
        archive = fetch(pinned["url"], DEPS / f"ffmpeg-{pinned['version']}.tar.xz", pinned["sha256"])
        with tarfile.open(archive) as package:
            package.extractall(DEPS, filter="data")
        patch_env = {**os.environ, "GIT_CEILING_DIRECTORIES": str(DEPS)}
        for patch in pinned.get("patches", ()):
            run(["git", "apply", "--whitespace=nowarn", ROOT / patch], cwd=directory, env=patch_env)
        marker.write_text(patches_digest())
    return directory


def _build(name, arguments, env=None):
    """Configures and builds into .deps/ffmpeg-<version>-<name>; returns the install prefix."""
    src = source()
    root = DEPS / f"{src.name}-{name}"
    if any(character.isspace() for character in str(root)):
        key = hashlib.sha256((str(src) + patches_digest()).encode()).hexdigest()[:16]
        cache = Path.home() / ".cache" / "ps5-react" / "ffmpeg" / key
        if not (cache / "ready").exists():
            shutil.rmtree(cache, ignore_errors=True)
            cache.mkdir(parents=True, exist_ok=True)
            shutil.copytree(src, cache / "source")
            (cache / "ready").touch()
        src = cache / "source"
        root = cache / name
    prefix, build = root / "prefix", root / "build"
    stamp = hashlib.sha256("\n".join([*arguments, patches_digest()]).encode()).hexdigest()
    if (root / "stamp").exists() and (root / "stamp").read_text() == stamp and \
            all((prefix / "lib" / library).exists() for library in LIBRARIES):
        return prefix
    shutil.rmtree(root, ignore_errors=True)
    build.mkdir(parents=True)
    run([src / "configure", f"--prefix={prefix}", *arguments], env=env, cwd=build, log=root / "configure.log")
    run(["make", f"-j{os.cpu_count() or 4}"], env=env, cwd=build, log=root / "make.log")
    run(["make", "install"], env=env, cwd=build, log=root / "install.log")
    (root / "stamp").write_text(stamp)
    return prefix


def desktop():
    """macOS: TLS through SecureTransport, h264/hevc through VideoToolbox when the decoder asks.
    Linux: TLS through the system OpenSSL, software decoding only."""
    platform = (["--enable-securetransport", "--enable-videotoolbox", "--enable-hwaccel=h264_videotoolbox,hevc_videotoolbox"]
                if sys.platform == "darwin" else ["--enable-openssl"])
    return _build("desktop", ["--cc=clang", "--enable-static", "--disable-shared", "--pkg-config=false",
                              *COMPONENTS, *platform])


def ps5(sdk, network_ports, env):
    """The PS5: the payload SDK's compiler as a FreeBSD x86-64 cross build, TLS from the pinned OpenSSL."""
    if not shutil.which("nasm"):
        raise RuntimeError("FFmpeg's x86 assembly needs nasm: brew install nasm")
    bin = Path(sdk) / "bin"
    return _build("ps5", [
        "--enable-cross-compile", "--arch=x86_64", "--cpu=znver2", "--target-os=freebsd",
        f"--cc={bin / 'prospero-clang'}", f"--cxx={bin / 'prospero-clang++'}", f"--ar={bin / 'prospero-ar'}",
        f"--nm={bin / 'prospero-nm'}", f"--ranlib={bin / 'prospero-ranlib'}", f"--strip={bin / 'prospero-strip'}",
        "--pkg-config=false", "--x86asmexe=nasm", "--enable-static", "--disable-shared", "--enable-pic",
        "--enable-openssl", f"--extra-cflags=-I{Path(network_ports) / 'include'}",
        f"--extra-ldflags=-L{Path(network_ports) / 'lib'}", *COMPONENTS], env=env)
