# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Video playback (native/shared/video_player.cpp) in real time: open, frame order and timing against
the audio clock, end, seek, pause, subtitles from the file and from a separate one, audio that ends
before the picture, AC-3 and E-AC-3 passed through to a stand-in HDMI output, and a missing file,
on a two-second H.264/AAC clip (a test pattern and a tone, generated with FFmpeg's lavfi sources)."""
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cli import desktop  # noqa: E402
from common import ROOT  # noqa: E402

_, build = desktop(ROOT / "apps/starter", target="ps5-react-video-test")
media = ROOT / "tools/tests/media"
result = subprocess.run([build / "ps5-react-video-test", media / "clip-320x180-h264-aac.mp4",
                         media / "clip-320x180-subtitled.mkv", media / "clip-subtitles.srt",
                         media / "clip-short-audio.mp4", media / "clip-320x180-h264-ac3-eac3.mkv"],
                        capture_output=True, text=True, timeout=120)
print(result.stdout, end="")
if result.returncode:
    print(result.stderr, end="")
    sys.exit(1)
