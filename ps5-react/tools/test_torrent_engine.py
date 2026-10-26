# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Downloads a torrent end to end: a local HTTP tracker, a fake peer that speaks the wire protocol,
BEP 9 metadata from a magnet, resume after a cancel, and seeding to a local leecher."""
import hashlib
import http.server
import socket
import struct
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import quote, parse_qsl

ROOT = Path(__file__).resolve().parents[1]
PIECE_LENGTH = 16 * 1024
DATA = bytes(((index * 37 + 11) % 251) for index in range(8 * PIECE_LENGTH))
PIECE_HASHES = b"".join(hashlib.sha1(DATA[at:at + PIECE_LENGTH]).digest()
                        for at in range(0, len(DATA), PIECE_LENGTH))


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
        return b"d" + b"".join(bencode(key) + bencode(value[key]) for key in sorted(value)) + b"e"
    raise TypeError(type(value))


def bdecode(data, at=0):
    tag = data[at:at + 1]
    if tag == b"i":
        end = data.index(b"e", at)
        return int(data[at + 1:end]), end + 1
    if tag == b"l":
        at += 1
        out = []
        while data[at:at + 1] != b"e":
            item, at = bdecode(data, at)
            out.append(item)
        return out, at + 1
    if tag == b"d":
        at += 1
        out = {}
        while data[at:at + 1] != b"e":
            key, at = bdecode(data, at)
            out[key], at = bdecode(data, at)
        return out, at + 1
    colon = data.index(b":", at)
    size = int(data[at:colon])
    return data[colon + 1:colon + 1 + size], colon + 1 + size


def info_dict(name="Overdrive-Test.bin"):
    return {"name": name, "piece length": PIECE_LENGTH, "pieces": PIECE_HASHES, "length": len(DATA)}


def torrent_file(tracker_url, name="Overdrive-Test.bin"):
    return bencode({"announce": tracker_url, "comment": "Overdrive test", "info": info_dict(name)})


def frame(identifier, payload=b""):
    return struct.pack(">IB", 1 + len(payload), identifier) + payload


def handshake(info_hash, peer_id):
    return bytes([19]) + b"BitTorrent protocol" + b"\0\0\0\0\0\x10\0\0" + info_hash + peer_id


def recv_exact(connection, size):
    received = b""
    while len(received) < size:
        chunk = connection.recv(size - len(received))
        if not chunk:
            raise EOFError("the peer closed the connection")
        received += chunk
    return received


def read_message(connection):
    length = struct.unpack(">I", recv_exact(connection, 4))[0]
    if length == 0:
        return 255, b""
    body = recv_exact(connection, length)
    return body[0], body[1:]


class Tracker:
    def __init__(self):
        self.peers = []
        self.events = []
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                query = dict(parse_qsl(self.path.split("?", 1)[-1], keep_blank_values=True,
                                       encoding="latin-1"))
                outer.events.append(query.get("event", ""))
                compact = b"".join(bytes(int(part) for part in host.split(".")) + struct.pack(">H", port)
                                   for host, port in outer.peers)
                body = bencode({"interval": 60, "complete": 1, "incomplete": 1, "peers": compact})
                self.send_response(200)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *arguments):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def origin(self):
        return f"http://127.0.0.1:{self.server.server_port}"

    def close(self):
        self.server.shutdown()


class PeerServer:
    """One fake BitTorrent peer that has every piece, and optionally the torrent's metadata."""

    def __init__(self, info_hash, metadata=b"", delay=0.0):
        self.info_hash = info_hash
        self.metadata = metadata
        self.delay = delay
        self.served = []
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(8)
        threading.Thread(target=self.accept_loop, daemon=True).start()

    @property
    def port(self):
        return self.sock.getsockname()[1]

    def accept_loop(self):
        while True:
            try:
                connection, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self.handle, args=(connection,), daemon=True).start()

    def handle(self, connection):
        try:
            header = recv_exact(connection, 68)
            assert header[1:20] == b"BitTorrent protocol"
            assert header[28:48] == self.info_hash
            connection.sendall(handshake(self.info_hash, b"-PY0001-0123456789AB"))
            extensions = {"m": {"ut_metadata": 3, "ut_pex": 4}}
            if self.metadata:
                extensions["metadata_size"] = len(self.metadata)
            connection.sendall(frame(20, b"\0" + bencode(extensions)))
            pieces = (len(DATA) + PIECE_LENGTH - 1) // PIECE_LENGTH
            field = bytearray((pieces + 7) // 8)
            for index in range(pieces):
                field[index // 8] |= 0x80 >> (index % 8)
            connection.sendall(frame(5, bytes(field)))
            while True:
                identifier, payload = read_message(connection)
                if identifier == 2:
                    connection.sendall(frame(1))
                elif identifier == 6:
                    index, begin, length = struct.unpack(">III", payload)
                    if self.delay:
                        time.sleep(self.delay)
                    block = DATA[index * PIECE_LENGTH + begin:index * PIECE_LENGTH + begin + length]
                    connection.sendall(frame(7, struct.pack(">II", index, begin) + block))
                    self.served.append((index, begin, length))
                elif identifier == 20 and payload[:1] == b"\x03":
                    request, _ = bdecode(payload[1:])
                    if request.get(b"msg_type") == 0:
                        piece = request[b"piece"]
                        start = piece * 16384
                        header = bencode({"msg_type": 1, "piece": piece, "total_size": len(self.metadata)})
                        connection.sendall(frame(20, b"\x01" + header + self.metadata[start:start + 16384]))
        except (OSError, EOFError, AssertionError, KeyError):
            pass
        finally:
            connection.close()

    def close(self):
        self.sock.close()


def compile_engine(directory):
    common = ["clang++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror", "-fno-exceptions",
              "-fno-rtti", "-pthread", "-I", str(ROOT / "native/shared")]
    output = directory / "engine-client"
    subprocess.run(common + [
        str(ROOT / "tools/tests/torrent_engine_client.cpp"),
        str(ROOT / "native/shared/torrent_engine.cpp"),
        str(ROOT / "native/shared/torrent_meta.cpp"),
        str(ROOT / "native/shared/torrent_bencode.cpp"),
        str(ROOT / "native/shared/torrent_peer.cpp"),
        str(ROOT / "native/shared/torrent_tracker.cpp"),
        str(ROOT / "native/shared/network.cpp"),
        str(ROOT / "tools/tests/network_test_platform.cpp"),
        "-lcurl", "-lcrypto", "-o", str(output)], check=True)
    return output


def parse_tasks(output):
    tasks = []
    for line in output.splitlines():
        if not line.startswith("task "):
            continue
        task = {}
        for token in line[len("task "):].split():
            key, _, value = token.partition("=")
            task[key] = value
        tasks.append(task)
    return tasks


def run(engine, arguments, timeout=60):
    result = subprocess.run([str(engine)] + arguments, capture_output=True, text=True, timeout=timeout)
    return result.returncode, parse_tasks(result.stdout), result.stdout, result.stderr


def check_download(engine, directory, kind, source, wanted):
    destination = directory / "out.bin"
    code, tasks, stdout, stderr = run(engine, [kind, str(source), str(destination), wanted, "0"])
    assert code == 0, (code, stdout, stderr)
    assert destination.read_bytes() == DATA, "the downloaded bytes differ"
    assert tasks, stdout
    final = tasks[-1]
    assert final["state"] == "completed", final
    assert final["verified"] == str(len(DATA)), final
    assert final["infoHash"] == hashlib.sha1(bencode(info_dict())).hexdigest(), final
    assert final["piecesDone"] == final["pieces"], final
    return tasks


def download_torrent(engine, directory):
    tracker = Tracker()
    peer = PeerServer(bytes.fromhex(hashlib.sha1(bencode(info_dict())).hexdigest()))
    tracker.peers = [("127.0.0.1", peer.port)]
    path = directory / "test.torrent"
    path.write_bytes(torrent_file(tracker.origin + "/announce"))
    tasks = check_download(engine, directory, "torrent", path, "Overdrive-Test.bin")
    assert "started" in tracker.events and "stopped" in tracker.events, tracker.events
    assert tasks[0]["metadata"] in ("0", "1")
    peer.close()
    tracker.close()


def download_magnet(engine, directory):
    digest = hashlib.sha1(bencode(info_dict())).hexdigest()
    peer = PeerServer(bytes.fromhex(digest), metadata=bencode(info_dict()))
    tracker = Tracker()
    tracker.peers = [("127.0.0.1", peer.port)]
    magnet = (f"magnet:?xt=urn:btih:{digest}&dn=Overdrive-Test.bin&tr="
              + quote(tracker.origin + "/announce", safe=""))
    tasks = check_download(engine, directory, "magnet", magnet, "")
    assert any(task["state"] == "metadata" for task in tasks), tasks
    assert any(task["swarmSeeds"] == "1" for task in tasks), tasks
    peer.close()
    tracker.close()


def cancel_and_resume(engine, directory):
    digest = hashlib.sha1(bencode(info_dict())).hexdigest()
    destination = directory / "resume.bin"
    slow = PeerServer(bytes.fromhex(digest), delay=0.05)
    tracker = Tracker()
    tracker.peers = [("127.0.0.1", slow.port)]
    path = directory / "resume.torrent"
    path.write_bytes(torrent_file(tracker.origin + "/announce"))
    code, tasks, stdout, stderr = run(
        engine, ["torrent", str(path), str(destination), "", "0", str(PIECE_LENGTH)])
    assert code == 0, (code, stdout, stderr)
    assert tasks[-1]["state"] == "cancelled", tasks[-1]
    assert 0 < int(tasks[-1]["verified"]) < len(DATA), tasks[-1]
    parts = Path(str(destination) + ".torrent-parts")
    assert parts.exists(), "cancel must keep resume data"
    lines = parts.read_text().splitlines()
    assert lines[0] == "OVDP1" and len(lines) == 11, lines
    assert any(bytes.fromhex(lines[9])), "no piece was recorded as done"
    slow.close()
    tracker.close()

    fast = PeerServer(bytes.fromhex(digest))
    tracker = Tracker()
    tracker.peers = [("127.0.0.1", fast.port)]
    path.write_bytes(torrent_file(tracker.origin + "/announce"))
    code, tasks, stdout, stderr = run(engine, ["torrent", str(path), str(destination), "", "0"])
    assert code == 0, (code, stdout, stderr)
    assert destination.read_bytes() == DATA, "resumed bytes differ"
    assert tasks[-1]["state"] == "completed", tasks[-1]
    assert int(tasks[-1]["downloaded"]) < len(DATA), "resume fetched every piece again"
    assert not parts.exists(), "completion must drop the resume data"
    fast.close()
    tracker.close()


def leech_from(port, digest, expected):
    with socket.create_connection(("127.0.0.1", port), timeout=10) as connection:
        connection.settimeout(10)
        connection.sendall(handshake(digest, b"-PY0002-0123456789AB"))
        answer = recv_exact(connection, 68)
        assert answer[1:20] == b"BitTorrent protocol"
        assert answer[28:48] == digest
        connection.sendall(frame(2))
        while True:
            identifier, payload = read_message(connection)
            if identifier == 1:
                break
        connection.sendall(frame(6, struct.pack(">III", 0, 0, len(expected))))
        while True:
            identifier, payload = read_message(connection)
            if identifier != 7:
                continue
            index, begin = struct.unpack(">II", payload[:8])
            assert (index, begin) == (0, 0)
            assert payload[8:] == expected, "the seeded block differs"
            return


def seeds(engine, directory):
    digest = hashlib.sha1(bencode(info_dict())).hexdigest()
    destination = directory / "seed.bin"
    peer = PeerServer(bytes.fromhex(digest))
    tracker = Tracker()
    tracker.peers = [("127.0.0.1", peer.port)]
    path = directory / "seed.torrent"
    path.write_bytes(torrent_file(tracker.origin + "/announce"))
    process = subprocess.Popen(
        [str(engine), "torrent", str(path), str(destination), "", "1", "-1", "5000"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    uploaded = 0
    seeded = False
    try:
        while True:
            line = process.stdout.readline()
            if not line:
                break
            if not line.startswith("task "):
                continue
            task = parse_tasks(line)[0]
            uploaded = max(uploaded, int(task["uploaded"]))
            if not seeded and task["state"] == "completed" and task["listenPort"] != "0":
                leech_from(int(task["listenPort"]), bytes.fromhex(digest), DATA[:PIECE_LENGTH])
                seeded = True
    finally:
        process.wait(timeout=30)
        process.stdout.close()
        peer.close()
        tracker.close()
    assert process.returncode == 0, process.stderr.read()
    assert seeded, "the seeder never reported its listening port"
    assert destination.read_bytes() == DATA
    assert uploaded >= PIECE_LENGTH, uploaded


def main():
    with tempfile.TemporaryDirectory(prefix="ps5-react-torrent-engine-") as temporary:
        directory = Path(temporary)
        engine = compile_engine(directory)
        download_torrent(engine, directory)
        download_magnet(engine, directory)
        cancel_and_resume(engine, directory)
        seeds(engine, directory)
        print("PASS: torrent engine downloads over the wire, fetches magnet metadata, resumes and seeds")


if __name__ == "__main__":
    main()
