# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Bencode, .torrent and magnet parsing against real bytes; no network and no console."""
import base64
import hashlib
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def bencode(value):
    if isinstance(value, int):
        return b"i%de" % value
    if isinstance(value, str):
        value = value.encode()
    if isinstance(value, bytes):
        return str(len(value)).encode() + b":" + value
    if isinstance(value, list):
        return b"l" + b"".join(bencode(item) for item in value) + b"e"
    if isinstance(value, dict):
        return b"d" + b"".join(bencode(key) + bencode(item) for key, item in sorted(value.items())) + b"e"
    raise TypeError(type(value))


def pieces_of(data, size):
    return b"".join(hashlib.sha1(data[at:at + size]).digest() for at in range(0, len(data), size))


def torrent(info, **outer):
    raw = bencode(info)
    return bencode({"info": info, **outer}), raw, hashlib.sha1(raw).hexdigest()


def compile_client(directory):
    binary = directory / "client"
    subprocess.run(["clang++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror", "-pthread",
                    "-I", str(ROOT / "native/shared"), str(ROOT / "tools/tests/torrent_meta_client.cpp"),
                    str(ROOT / "native/shared/torrent_bencode.cpp"), str(ROOT / "native/shared/torrent_meta.cpp"),
                    "-lcrypto", "-o", str(binary)], check=True)
    return binary


def main():
    with tempfile.TemporaryDirectory(prefix="ps5-react-torrent-meta-") as temporary:
        directory = Path(temporary)
        client = compile_client(directory)

        def parse(output):
            facts = {}
            for line in output.splitlines():
                key, _, value = line.partition("=")
                facts.setdefault(key, []).append(value)
            return facts

        def run(*arguments):
            result = subprocess.run([str(client), *map(str, arguments)], capture_output=True, text=True,
                                    encoding="utf-8")
            return parse(result.stdout), result.returncode

        def metainfo(name, payload):
            path = directory / name
            path.write_bytes(payload)
            return run("metainfo", path)[0]

        def rejected(name, payload, message, command="metainfo"):
            path = directory / name
            path.write_bytes(payload)
            facts, code = run(command, path)
            assert code == 1 and message in facts["error"][0], (name, facts, code)

        data = b"abcdefghij"
        info = {"name": "single.bin", "piece length": 4, "pieces": pieces_of(data, 4), "length": len(data)}
        raw, info_hash = torrent(info)[1:]
        facts = metainfo("single.torrent", torrent(
            info, **{"announce": "udp://t3:6969",
                     "announce-list": [["http://t1/announce", "wss://ignored"], ["udp://t2:80", "http://t1/announce"]],
                     "url-list": ["https://seed.example/file", "ftp://ignored"],
                     "comment": "hello", "created by": "builder"})[0])
        assert facts["name"] == ["single.bin"], facts
        assert facts["hash"] == [info_hash], facts
        assert facts["pieceLength"] == ["4"] and facts["pieces"] == ["3"] and facts["total"] == ["10"], facts
        assert facts["multi"] == ["0"], facts
        assert facts["file"] == ["single.bin|10|0|0|2|0"], facts
        assert facts["tracker"] == ["http://t1/announce", "udp://t2:80", "udp://t3:6969"], facts
        assert facts["seed"] == ["https://seed.example/file"], facts
        assert facts["comment"] == ["hello"] and facts["createdBy"] == ["builder"], facts
        assert facts["largest"] == ["single.bin|10"], facts

        # A long comment is display-only and is not copied into the snapshot.
        facts = metainfo("long-comment.torrent",
                         torrent(info, comment="x" * 5000)[0])
        assert "comment" not in facts, facts

        data = bytes(range(28))
        files = [
            {"length": 20, "path": ["Game", "data.bin"]},
            {"length": 3, "path": ["Game", "readme.txt"]},
            {"length": 5, "attr": "p", "path": [".pad", "10"]},
            {"length": 0, "path": ["Game", "empty.txt"]},
        ]
        info = {"name": "Game", "piece length": 16, "pieces": pieces_of(data, 16), "files": files}
        raw, info_hash = torrent(info)[1:]
        facts = metainfo("multi.torrent", torrent(info, announce="http://tracker/announce")[0])
        assert facts["multi"] == ["1"] and facts["total"] == ["28"] and facts["pieces"] == ["2"], facts
        assert facts["file"] == [
            "Game/data.bin|20|0|0|1|0",
            "Game/readme.txt|3|20|1|1|0",
            ".pad/10|5|23|1|1|1",
            "Game/empty.txt|0|28|1|1|0",
        ], facts
        assert facts["largest"] == ["Game/data.bin|20"], facts

        # BEP 9 hands the info dictionary alone to the engine; the hash must match the .torrent's.
        (directory / "info.bin").write_bytes(raw)
        alone = run("info", directory / "info.bin")[0]
        assert alone["hash"] == [info_hash] and alone["file"] == facts["file"], alone
        assert "tracker" not in alone, alone

        # UTF-8 variants win when present.
        facts = metainfo("utf8.torrent", torrent(
            {"name": "fallback", "name.utf-8": "Juego ñ", "piece length": 4,
             "pieces": pieces_of(data[:4], 4), "length": 4})[0])
        assert facts["name"] == ["Juego ñ"] and facts["file"] == ["Juego ñ|4|0|0|0|0"], facts

        # Things the engine must refuse rather than act on.
        good = {"name": "a", "piece length": 4, "pieces": pieces_of(b"abcd", 4), "length": 4}
        rejected("leading-zero.torrent", b"i03e", "leading zero")
        rejected("truncated.torrent", b"d4:infod4:name1:a", "unterminated")
        rejected("trailing.torrent", b"i1ei2e", "trailing bytes")
        rejected("deep.torrent", b"l" * 40 + b"e" * 40, "nesting")
        rejected("key.torrent", b"di1ei2ee", "key is not a string")
        rejected("shallow.torrent", b"i1e", "not a dictionary")
        rejected("no-info.torrent", b"d4:name1:ae", "no info dictionary")
        rejected("empty.torrent", torrent({**good, "length": 0})[0], "no usable length")
        rejected("empty-multi.torrent", torrent({**good, "files": [{"length": 0, "path": ["a"]}]})[0], "no data")
        rejected("mismatch.torrent", torrent({**good, "pieces": pieces_of(b"abcd", 4) * 2})[0],
                 "do not match the file sizes")
        rejected("big-piece.torrent", torrent({**good, "piece length": 1 << 27})[0], "64 MiB")
        rejected("unsafe.torrent", torrent({**good, "files": [{"length": 4, "path": ["..", "x"]}]})[0],
                 "unsafe component")
        rejected("slash.torrent", torrent({**good, "name": "a/b"})[0], "plain file name")
        rejected("negative.torrent", torrent({**good, "length": -4})[0], "no usable length")

        # Magnet links: hex and base32 hashes, decoded fields, deduplicated and filtered trackers.
        hashed = "7ACF8FB590B2060DD9C3146EF770169D593433B0"
        lower = hashed.lower()
        magnet = ("magnet:?xt=urn:btih:" + hashed + "&dn=Debian%20ISO%2Bmore.iso"
                  "&tr=udp%3A%2F%2Ftracker.example%3A6969%2Fannounce&tr=http%3A%2F%2Ftracker.example%2Fannounce"
                  "&tr=wss%3A%2F%2Fignored&ws=https%3A%2F%2Fseed.example%2Ffile"
                  "&x.pe=1.2.3.4%3A6881&x.pe=nope&x.pe=%5B2001%3Adb8%3A%3A1%5D%3A51413&xl=12345")
        facts = run("magnet", magnet)[0]
        assert facts["hash"] == [lower] and facts["name"] == ["Debian ISO+more.iso"], facts
        assert facts["tracker"] == ["udp://tracker.example:6969/announce", "http://tracker.example/announce"], facts
        assert facts["seed"] == ["https://seed.example/file"], facts
        assert facts["peer"] == ["1.2.3.4:6881", "[2001:db8::1]:51413"], facts
        assert facts["exactLength"] == ["12345"], facts

        base32 = base64.b32encode(bytes.fromhex(lower)).decode()
        facts = run("magnet", "magnet:?xt=urn:btih:" + base32.lower())[0]
        assert facts["hash"] == [lower], facts

        for link, message in [
            ("magnet:?dn=x", "urn:btih"),
            ("magnet:?xt=urn:btih:zzzz", "urn:btih"),
            ("magnet:?xt=urn:btih:" + hashed + "&dn=bad%2", "percent escape"),
            ("https://example/game.torrent", "magnet:?"),
        ]:
            facts, code = run("magnet", link)
            assert code == 1 and message in facts["error"][0], (link, facts, code)

        print("PASS: bencode limits, .torrent info hashes, multi-file offsets/padding, UTF-8 names, "
              "tracker/web-seed filtering, BEP 9 info dictionaries and hex/base32 magnet links")


if __name__ == "__main__":
    main()
