# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""HDMI passthrough: the IEC 61937 packer (native/shared/iec61937.hpp) against FFmpeg's spdif muxer, and the
EDID audio parser (native/shared/audio_sink.cpp).

The fixtures in tools/tests/media are a quarter second of six sine tones joined as 5.1 at 48 kHz, which
FFmpeg 9.0.1 encoded with `-c:a ac3 -b:a 448k`, `-c:a eac3 -b:a 384k` and `-c:a dca -strict -2 -b:a 768k`;
the hashes are what `ffmpeg -i <fixture> -c copy -f spdif` wrote for them. With an `ffmpeg` on PATH the test
also runs the muxer itself and compares byte for byte, so a mismatch names the first byte that differs."""
from pathlib import Path
import hashlib
import json
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cli import desktop  # noqa: E402
from common import ROOT  # noqa: E402

MEDIA = ROOT / "tools/tests/media"
# FFmpeg 9.0.1, `-c copy -f spdif`.
SPDIF = {
    "ac3": ("passthrough-ac3.ac3", 49152, "d179548f37184393ec95d37a0e4125f2c6e0abe11d18694855c9af8e3b338cd3"),
    "eac3": ("passthrough-eac3.eac3", 196608, "6168b4b6a724107a9c920268ba78e5ae3e94188e97ed877c3aecaa4b75cc22ec"),
    "dts": ("passthrough-dts.dts", 49152, "eb3d9d388d48324dc75623c54710a667aec4ace9a1cff7ff7fb81c368203af28"),
}
# Packets split anywhere: one byte at a time, odd sizes, a TS payload, whole files.
PIECES = (1, 7, 184, 4096, 1 << 20)


def burst(data_type, payload, period, length):
    """One burst as libavformat/spdifenc.c writes it: little-endian words, the payload byte-swapped."""
    padded = payload + b"\0" * (len(payload) & 1)
    swapped = b"".join(padded[i + 1:i + 2] + padded[i:i + 1] for i in range(0, len(padded), 2))
    out = struct.pack("<4H", 0xF872, 0x4E1F, data_type, length) + swapped
    return out + b"\0" * (period - len(out))


def eac3_frame(size, blocks_code, dependent=False, fill=0x33):
    """A syncframe header with frmsiz, fscod 48 kHz, numblkscod and bsid 16; the body is filler."""
    words = size // 2 - 1
    head = bytes([0x0B, 0x77, (0x40 if dependent else 0) | (words >> 8), words & 0xFF, (blocks_code << 4) | 0x0F, 16 << 3])
    return head + bytes([fill]) * (size - len(head))


def edid(name, blocks, basic_audio=True):
    """A base block named `name` and one CTA-861 extension holding `blocks` (tag, payload) data blocks."""
    base = bytearray(128)
    base[0:8] = b"\x00\xff\xff\xff\xff\xff\xff\x00"
    base[72:77] = b"\x00\x00\x00\xfc\x00"
    base[77:90] = (name.encode() + b"\n").ljust(13, b" ")
    base[126] = 1
    data = b"".join(bytes([(tag << 5) | len(payload)]) + payload for tag, payload in blocks)
    cta = bytearray(128)
    cta[0:4] = bytes([0x02, 0x03, 4 + len(data), 0x40 if basic_audio else 0])
    cta[4:4 + len(data)] = data
    return bytes(base + cta)


class Passthrough(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, build = desktop(ROOT / "apps/starter", target="ps5-react-passthrough-test")
        cls.binary = build / "ps5-react-passthrough-test"
        cls.work = Path(tempfile.mkdtemp(prefix="passthrough-"))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.work, ignore_errors=True)

    def pack(self, codec, stream, piece=1 << 20):
        source = self.work / f"in.{codec}"
        if isinstance(stream, bytes):
            source.write_bytes(stream)
        else:
            source = stream
        out = self.work / "out.spdif"
        subprocess.run([self.binary, "pack", codec, source, out, str(piece)], check=True, timeout=60)
        return out.read_bytes()

    def caps(self, data):
        path = self.work / "edid.bin"
        path.write_bytes(data)
        return json.loads(subprocess.run([self.binary, "edid", path], check=True, capture_output=True, text=True).stdout)

    def assertSameBytes(self, actual, expected, what):
        if actual == expected: return
        at = next((i for i, (a, b) in enumerate(zip(actual, expected)) if a != b), min(len(actual), len(expected)))
        self.fail(f"{what}: {len(actual)} bytes against {len(expected)}, first difference at byte {at}")

    def test_matches_ffmpeg_spdif(self):
        ffmpeg = shutil.which("ffmpeg")
        for codec, (name, size, sha256) in SPDIF.items():
            with self.subTest(codec=codec):
                packed = [self.pack(codec, MEDIA / name, piece) for piece in PIECES]
                for piece, out in zip(PIECES, packed):
                    self.assertSameBytes(out, packed[-1], f"{codec} in {piece}-byte pieces")
                if ffmpeg:
                    reference = self.work / f"ffmpeg-{codec}.spdif"
                    subprocess.run([ffmpeg, "-v", "error", "-y", "-i", MEDIA / name, "-c", "copy", "-f", "spdif", reference],
                                   check=True, timeout=60)
                    self.assertSameBytes(packed[-1], reference.read_bytes(), f"{codec} against {ffmpeg}")
                self.assertEqual((len(packed[-1]), hashlib.sha256(packed[-1]).hexdigest()), (size, sha256),
                                 f"{codec}: not what FFmpeg 9.0.1's spdif muxer wrote")
        if not ffmpeg: print("no ffmpeg on PATH: compared against the recorded FFmpeg 9.0.1 hashes only")

    def test_ac3_burst_layout(self):
        # Type 1 with bsmod in bits 8-10, the length in bits, 6144-byte period; junk between frames is skipped.
        ac3 = (MEDIA / "passthrough-ac3.ac3").read_bytes()
        frame = ac3[:1792]
        self.assertEqual(frame[:2], b"\x0b\x77")
        bsmod = frame[5] & 7
        out = self.pack("ac3", frame + b"\x00\x11\x22" + frame)
        self.assertSameBytes(out, burst(1 | bsmod << 8, frame, 6144, 1792 * 8) * 2, "ac3 with junk between frames")

    def test_eac3_gathers_six_blocks(self):
        # Two-block frames (numblkscod 1): three independent frames, each with its dependent substream,
        # make one 24576-byte burst whose length is in bytes.
        frames = [eac3_frame(512, 1, fill=i) + eac3_frame(256, 1, dependent=True, fill=0x80 + i) for i in range(6)]
        out = self.pack("eac3", b"".join(frames), 100)
        first, second = b"".join(frames[:3]), b"".join(frames[3:])
        self.assertSameBytes(out, burst(0x15, first, 24576, len(first)) + burst(0x15, second, 24576, len(second)),
                             "eac3 two-block frames")
        # A dependent substream with no independent frame before it is dropped.
        self.assertSameBytes(self.pack("eac3", eac3_frame(256, 3, dependent=True) + frames[0][:512]),
                             burst(0x15, frames[0][:512], 24576, 512), "eac3 orphan dependent frame")

    def test_dts_sends_the_core_of_dts_hd(self):
        # A DTS-HD extension substream after each core (sync 64 58 20 25, 8 + 16-bit sizes) is stepped over:
        # the sink gets what a core-only stream gives, as FFmpeg's muxer does without dtshd_rate.
        dts = (MEDIA / "passthrough-dts.dts").read_bytes()
        core = ((dts[5] << 16 | dts[6] << 8 | dts[7]) >> 4 & 0x3FFF) + 1
        frames = [dts[i:i + core] for i in range(0, len(dts), core)]
        extension_size = 300
        bits = (0 << 48) | (0 << 46) | (0 << 45) | (15 << 37) | ((extension_size - 1) << 21)
        extension = b"\x64\x58\x20\x25" + bits.to_bytes(7, "big") + b"\x55" * (extension_size - 11)
        with_extension = b"".join(frame + extension for frame in frames)
        self.assertSameBytes(self.pack("dts", with_extension, 184), self.pack("dts", dts), "dts with DTS-HD extensions")

    def test_receiver_edid(self):
        sads = bytes([0x0F, 0x7F, 0x07,   # PCM 8 ch, 32-192 kHz, 16/20/24-bit
                      0x09, 0x07, 0x07,   # PCM 2 ch again: merged
                      0x15, 0x07, 0x50,   # AC-3 6 ch, up to 640 kb/s
                      0x57, 0x06, 0x01,   # E-AC-3 8 ch
                      0x3D, 0x06, 0xC0,   # DTS 6 ch, up to 1536 kb/s
                      0x5F, 0x7E, 0x01,   # DTS-HD 8 ch
                      0x67, 0x54, 0x00])  # TrueHD (MAT) 8 ch at 48, 96 and 192 kHz
        caps = self.caps(edid("AVR-X1700H", [(2, b"\x10"), (1, sads), (4, b"\x5f\x00\x00")]))
        self.assertEqual((caps["known"], caps["name"], caps["ac3"], caps["eac3"], caps["dts"], caps["pcmChannels"]),
                         (True, "AVR-X1700H", True, True, True, 8))
        formats = {f["codec"]: f for f in caps["formats"]}
        self.assertEqual(list(formats), ["pcm", "ac3", "eac3", "dts", "dtshd", "truehd"])
        self.assertEqual(formats["pcm"], {"codec": "pcm", "channels": 8, "sampleRates": [32000, 44100, 48000, 88200, 96000, 176400, 192000],
                                          "bitDepths": [16, 20, 24], "maxBitrate": 0})
        self.assertEqual((formats["ac3"]["channels"], formats["ac3"]["maxBitrate"]), (6, 640000))
        self.assertEqual((formats["dts"]["maxBitrate"], formats["truehd"]["sampleRates"]), (1536000, [48000, 96000, 192000]))

    def test_implied_codecs(self):
        # An E-AC-3 decoder decodes AC-3, a DTS-HD one the DTS core; a sink listing nothing but basic audio
        # takes two-channel PCM.
        eac3 = self.caps(edid("TV", [(1, bytes([0x57, 0x06, 0x01]))], basic_audio=False))
        self.assertEqual((eac3["ac3"], eac3["eac3"], eac3["dts"], eac3["pcmChannels"]), (True, True, False, 2))
        dtshd = self.caps(edid("TV", [(1, bytes([0x5F, 0x06, 0x01]))], basic_audio=False))
        self.assertEqual((dtshd["ac3"], dtshd["dts"]), (False, True))
        basic = self.caps(edid("TV", []))
        self.assertEqual(basic["formats"], [{"codec": "pcm", "channels": 2, "sampleRates": [32000, 44100, 48000],
                                             "bitDepths": [16], "maxBitrate": 0}])
        # A 44.1 kHz-only AC-3 entry is not one this output can carry (its carrier runs at 48 kHz).
        self.assertFalse(self.caps(edid("TV", [(1, bytes([0x15, 0x02, 0x50]))]))["ac3"])

    def test_monitor_without_audio(self):
        # A monitor's EDID as the PS5 read it (serial numbers blanked): a CTA block with no audio at all.
        caps = self.caps((MEDIA / "edid-monitor-no-audio.bin").read_bytes())
        self.assertEqual((caps["known"], caps["name"], caps["formats"], caps["ac3"], caps["dts"], caps["pcmChannels"]),
                         (True, "AW3225QF", [], False, False, 2))
        self.assertFalse(self.caps(b"")["known"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
