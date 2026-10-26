# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Peer wire unit tests, plus one real HTTP announce and one real UDP announce against local servers."""
import http.server
import socket
import struct
import subprocess
import tempfile
import threading
from pathlib import Path
from urllib.parse import parse_qsl

ROOT = Path(__file__).resolve().parents[1]
HASH = bytes(range(20))
HASH_HEX = HASH.hex()
PEER_ID = b"-OV0001-0123456789AB"


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


def compile_all(directory):
    common = ["clang++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror", "-pthread",
              "-I", str(ROOT / "native/shared")]
    wire = directory / "wire-test"
    subprocess.run(common + [str(ROOT / "tools/tests/torrent_wire_test.cpp"),
                             str(ROOT / "native/shared/torrent_bencode.cpp"),
                             str(ROOT / "native/shared/torrent_peer.cpp"),
                             str(ROOT / "native/shared/torrent_tracker.cpp"),
                             str(ROOT / "native/shared/network.cpp"),
                             str(ROOT / "tools/tests/network_test_platform.cpp"),
                             "-lcurl", "-lcrypto", "-o", str(wire)], check=True)
    client = directory / "tracker-client"
    subprocess.run(common + [str(ROOT / "tools/tests/torrent_tracker_client.cpp"),
                             str(ROOT / "native/shared/torrent_bencode.cpp"),
                             str(ROOT / "native/shared/torrent_tracker.cpp"),
                             str(ROOT / "native/shared/network.cpp"),
                             str(ROOT / "tools/tests/network_test_platform.cpp"),
                             "-lcurl", "-lcrypto", "-o", str(client)], check=True)
    return wire, client


def parse(output):
    facts = {}
    for line in output.splitlines():
        key, _, value = line.partition("=")
        facts.setdefault(key, []).append(value)
    return facts


def main():
    with tempfile.TemporaryDirectory(prefix="ps5-react-torrent-tracker-") as temporary:
        directory = Path(temporary)
        wire, client = compile_all(directory)
        result = subprocess.run([str(wire)], capture_output=True, text=True)
        assert result.returncode == 0 and result.stdout.startswith("PASS:"), (result.stdout, result.stderr)

        queries = []

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                queries.append(self.path)
                if self.path.startswith("/refuse"):
                    body, status = bencode({"failure reason": "unregistered torrent"}), 200
                elif self.path.startswith("/broken"):
                    body, status = b"not bencode", 500
                else:
                    body, status = bencode({
                        "interval": 120, "min interval": 60, "complete": 4, "incomplete": 9,
                        "peers": bytes([127, 0, 0, 1, 0x17, 0x70]),
                    }), 200
                self.send_response(status)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *arguments):
                pass

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f"http://127.0.0.1:{server.server_port}"

        def announce(url, event="started", port=6881, left=1234):
            result = subprocess.run([str(client), url, HASH_HEX, event, str(port), str(left)],
                                    capture_output=True, text=True)
            return parse(result.stdout), result.returncode

        facts, code = announce(origin + "/announce?passkey=abc")
        assert code == 0 and facts["ok"] == ["1"], facts
        assert facts["interval"] == ["120"] and facts["minInterval"] == ["60"], facts
        assert facts["seeds"] == ["4"] and facts["leechers"] == ["9"], facts
        assert facts["peer"] == ["127.0.0.1:6000"], facts
        query = dict(parse_qsl(queries[-1].split("?", 1)[1], keep_blank_values=True, encoding="latin-1"))
        assert query["passkey"] == "abc"
        assert query["info_hash"].encode("latin-1") == HASH, query
        assert query["peer_id"].encode("latin-1") == PEER_ID, query
        assert query["port"] == "6881" and query["uploaded"] == "7" and query["downloaded"] == "100", query
        assert query["left"] == "1234" and query["compact"] == "1" and query["numwant"] == "80", query
        assert query["event"] == "started", query

        facts, code = announce(origin + "/complete", event="completed", port=6969, left=0)
        assert code == 0 and facts["ok"] == ["1"], facts
        query = dict(parse_qsl(queries[-1].split("?", 1)[1], encoding="latin-1"))
        assert query["event"] == "completed" and query["left"] == "0" and query["port"] == "6969", query

        facts, code = announce(origin + "/refuse")
        assert code == 1 and facts["ok"] == ["0"] and facts["error"] == ["unregistered torrent"], facts

        facts, code = announce(origin + "/broken")
        assert code == 1 and "HTTP 500" in facts["error"][0], facts

        # A UDP tracker (BEP 15): connect, then announce; the same bytes a real one exchanges.
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        udp.bind(("127.0.0.1", 0))
        udp.settimeout(5)
        seen = []
        refuse = [False]

        def udp_server():
            while True:
                try:
                    data, address = udp.recvfrom(2048)
                except OSError:
                    return
                if len(data) == 16 and data[8:12] == b"\0\0\0\0":
                    udp.sendto(struct.pack(">IIQ", 0, struct.unpack(">I", data[12:16])[0],
                                           0x1122334455667788), address)
                elif len(data) >= 98 and data[8:12] == b"\0\0\0\1":
                    seen.append(data)
                    if refuse[0]:
                        udp.sendto(struct.pack(">II", 3, struct.unpack(">I", data[12:16])[0])
                                   + b"unregistered torrent", address)
                    else:
                        udp.sendto(struct.pack(">IIIII", 1, struct.unpack(">I", data[12:16])[0], 300, 6, 8)
                                   + bytes([127, 0, 0, 1, 0x17, 0x70]), address)

        threading.Thread(target=udp_server, daemon=True).start()
        endpoint = f"udp://127.0.0.1:{udp.getsockname()[1]}"
        facts, code = announce(endpoint + "/announce", event="started", port=6881, left=4321)
        assert code == 0 and facts["ok"] == ["1"], facts
        assert facts["interval"] == ["300"] and facts["seeds"] == ["8"] and facts["leechers"] == ["6"], facts
        assert facts["peer"] == ["127.0.0.1:6000"], facts
        request = seen[-1]
        assert request[16:36] == HASH and request[36:56] == PEER_ID, request.hex()
        assert struct.unpack(">QQQ", request[56:80]) == (100, 4321, 7), request.hex()
        assert struct.unpack(">I", request[80:84])[0] == 2, request.hex()  # started
        assert struct.unpack(">i", request[92:96])[0] == -1, request.hex()
        assert struct.unpack(">H", request[96:98])[0] == 6881, request.hex()

        refuse[0] = True
        facts, code = announce("udp://127.0.0.1:" + str(udp.getsockname()[1]) + "/fail")
        assert code == 1 and facts["error"] == ["unregistered torrent"], facts
        refuse[0] = False

        facts, code = announce("udp://localhost:6969/announce")
        assert code == 1 and "IPv4" in facts["error"][0], facts

        server.shutdown()
        udp.close()
        print("PASS: peer wire framing and trackers (HTTP compact/list/failure, BEP 15 UDP announce)")


if __name__ == "__main__":
    main()
