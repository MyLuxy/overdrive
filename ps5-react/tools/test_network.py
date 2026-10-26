# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Local native networking integration tests; never access a console or catalog."""
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import signal
import socket
import ssl
import struct
import subprocess
import tempfile
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
DATA = bytes(range(256)) * (16 * 1024 * 1024 // 256)
# /paced serves this at about 2 MB/s per connection, MediaFire's pace, so refusal bursts land mid-download.
LARGE = DATA * 8
PIECES = [bytes([19+i]) * size for i, size in enumerate((3*1024*1024+17, 5*1024*1024+31, 7*1024*1024+9))]


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    requests = []
    guard = threading.Lock()
    retried = set()
    # Signatures that now answer 403, like an expired signed CDN link.
    expired = set()
    modified = "Wed, 01 Jan 2025 00:00:00 GMT"
    mutated = False
    # /throttled answers like an archive.org storage node: past a few concurrent ranges it refuses
    # with 500/503/429, and it resets some ranges halfway once.
    busy = 0
    refused = []
    # /hop sends its first request (the probe) to /node-a, whose ranges then fail with HTTP 500, and
    # every later one to /node-b, a healthy node with the same file.
    hops = 0
    # Connections serving /suspend ranges, which the test cuts while the client is stopped, and how many
    # of the ranges asked for next answer 503.
    streams = set()
    suspend_refusals = 0

    def respond(self, head=False):
        if self.path == "/hop":
            with self.guard:
                Handler.hops += 1
                target = "/node-a" if Handler.hops == 1 else "/node-b"
            self.send_response(302)
            self.send_header("Location", target)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/node-a" and self.headers.get("Range") != "bytes=0-0":
            self.send_response(500)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if not self.path.startswith("/throttled") or self.headers.get("Range") in (None, "bytes=0-0"):
            return self.serve(head)
        with self.guard:
            Handler.busy += 1
            busy = Handler.busy
        try:
            with self.guard:
                first = ("refuse", self.headers["Range"]) not in self.retried
                self.retried.add(("refuse", self.headers["Range"]))
            # The first range's first answer is archive.org's HTML error page; it must not read as a web page.
            if busy > 6 or (first and self.headers["Range"].startswith("bytes=0-")):
                status = (500, 503, 429)[len(self.refused) % 3]
                self.refused.append(status)
                body = b"<html><body>Internal Server Error</body></html>" if status == 500 else b""
                self.send_response(status)
                if status == 503: self.send_header("Retry-After", "0")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            self.serve(head)
        finally:
            with self.guard:
                Handler.busy -= 1

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass  # Expected when the client cancels or rejects a response.

    def log_message(self, *_):
        pass

    def do_HEAD(self):
        self.respond(head=True)

    def do_GET(self):
        self.respond()

    def serve(self, head=False):
        path, _, query = self.path.partition("?")
        selected = self.headers.get("Range")
        with self.guard:
            self.requests.append((path, selected, self.headers.get("If-Range")))
        if query in self.expired:
            self.send_response(403)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/file")
            self.send_header("HX-Redirect", "/old-page")
            self.send_header("Set-Cookie", "secret=never-expose")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if path in ("/html", "/html-no-type", "/html-fragmented"):
            body = b"<!DOCTYPE html><html>Verify</html>"
            self.send_response(200)
            if path == "/html": self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head:
                if path == "/html-fragmented":
                    self.wfile.write(body[:1]); self.wfile.flush(); time.sleep(0.03)
                    self.wfile.write(body[1:])
                else: self.wfile.write(body)
            return
        if path in ("/json", "/not-found", "/large-json"):
            body = b'{"value":42}' if path != "/large-json" else b"x" * 4096
            self.send_response(404 if path == "/not-found" else 200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head:
                self.wfile.write(body)
            return
        piece = re.search(r"/piece([0-2])$", path)
        payload = PIECES[int(piece[1])] if piece else LARGE if path == "/paced" else DATA
        if path.endswith("-mutable") and self.mutated:
            payload = bytes(reversed(DATA))
        total = 4*1024**3 + 1024**2 if path == "/large-offset" else len(payload)
        start, end, status = 0, total-1, 200
        if selected and path not in ("/no-range", "/slow-no-range", "/multipart-no-range/piece1"):
            match = re.fullmatch(r"bytes=(\d+)-(\d+)", selected)
            if not match:
                self.send_error(416)
                return
            start, end = map(int, match.groups())
            status = 206
        if (path == "/flaky" and selected != "bytes=0-0") or path == "/flaky-probe":
            with self.guard:
                retry_key = (path, selected)
                first = retry_key not in self.retried
                self.retried.add(retry_key)
            if first:
                self.send_response(503)
                self.send_header("Retry-After", "0")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        # Every range, and every part of a split one, answers 503 twice before it serves.
        if path == "/slow-twice" and selected != "bytes=0-0":
            with self.guard:
                refused = sum(r[:2] == (path, selected) for r in self.requests) <= 2
            if refused:
                self.send_response(503)
                self.send_header("Retry-After", "0")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        if path == "/suspend" and selected != "bytes=0-0":
            with self.guard:
                refuse = Handler.suspend_refusals > 0
                Handler.suspend_refusals -= refuse
            if refuse:
                self.send_response(503)
                self.send_header("Retry-After", "0")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
        if path == "/changed" and selected != "bytes=0-0":
            status = 200
        changed_etag = path == "/changed-etag" and selected != "bytes=0-0"
        self.send_response(status)
        self.send_header("Content-Length", str(end-start+1))
        if "modified" in path:
            self.send_header("Last-Modified", self.modified)
            self.send_header("ETag", 'W/"weak"')
        elif "no-validator" not in path:
            self.send_header("ETag", '"fixture-v2"' if path == "/changed" or changed_etag else '"fixture-v1"')
        if status == 206:
            reported = start+1 if path == "/bad-range" and selected != "bytes=0-0" else start
            self.send_header("Content-Range", f"bytes {reported}-{end}/{total}")
        self.end_headers()
        if head:
            return
        if path == "/suspend" and selected != "bytes=0-0":
            with self.guard:
                Handler.streams.add(self.connection)
        try:
            for offset in range(start, end+1, 65536):
                index = offset % len(payload)
                self.wfile.write(payload[index:index+min(65536, end-offset+1)])
                if path.startswith("/slow") or path.startswith("/multipart-slow"):
                    time.sleep(0.006)
                if path == "/suspend":
                    time.sleep(0.02)
                if path == "/paced":
                    time.sleep(0.03)
                if path == "/truncated" and selected != "bytes=0-0":
                    self.close_connection = True
                    self.connection.shutdown(socket.SHUT_RDWR)
                    return
                if path == "/throttled" and offset == start and start % (3*1024*1024) == 0:
                    with self.guard:
                        first = ("reset", selected) not in self.retried
                        self.retried.add(("reset", selected))
                    if first:
                        self.close_connection = True
                        self.connection.shutdown(socket.SHUT_RDWR)
                        return
                if path == "/throttled":
                    time.sleep(0.004)
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass


class Refusing(http.server.ThreadingHTTPServer):
    """A TLS origin that turns new handshakes away like MediaFire: for eight seconds from 1.5 s after
    `started` while `burst` is set, and every one after the first while `dead`."""

    def __init__(self, context):
        super().__init__(("127.0.0.1", 0), Handler)
        self.context = context
        self.started, self.burst, self.dead = 0.0, False, False
        self.handshakes, self.refused = 0, []

    def refusing(self):
        if self.dead: return self.handshakes > 1
        return self.burst and 1.5 <= time.monotonic()-self.started < 9.5

    def get_request(self):
        connection, address = self.socket.accept()
        with Handler.guard:
            self.handshakes += 1
            refuse = self.refusing()
            if refuse: self.refused.append(time.monotonic())
        if refuse:
            # A reset in the middle of the handshake: curl reports "SSL connect error", as on the console.
            connection.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack("ii", 1, 0))
            connection.close()
            raise OSError("handshake refused")
        return self.context.wrap_socket(connection, server_side=True, do_handshake_on_connect=False), address

    def finish_request(self, request, address):
        try: request.do_handshake()
        except OSError: return
        super().finish_request(request, address)


def compile_client(directory):
    binary = directory / "client"
    subprocess.run(["clang++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror", "-pthread",
                    "-I", str(ROOT / "native/shared"), str(ROOT / "tools/tests/network_client.cpp"),
                    str(ROOT / "native/shared/network.cpp"), str(ROOT / "tools/tests/network_test_platform.cpp"),
                    "-lcurl", "-o", str(binary)], check=True)
    return binary


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    with tempfile.TemporaryDirectory(prefix="ps5-react-network-") as temporary:
        directory = Path(temporary)
        binary = compile_client(directory)

        def run(endpoint, path="-", connections=4, max_bytes=1024*1024, cancel=0, digest="", method="GET", file_limit=0, stop=0, pieces=False, hashes=None, recover=False, reject_html=False, no_redirect=False, mirrors=(), adaptive=False, range_probe=False, range_bytes=0):
            environment = dict(os.environ)
            environment.pop("NETWORK_TEST_RANGE_PROBE", None)
            environment.pop("NETWORK_TEST_RANGE_BYTES", None)
            if range_bytes: environment["NETWORK_TEST_RANGE_BYTES"] = str(range_bytes)
            if range_probe: environment["NETWORK_TEST_RANGE_PROBE"] = "1"
            for name in ("NETWORK_TEST_RECOVER", "NETWORK_TEST_REJECT_HTML", "NETWORK_TEST_NO_REDIRECT", "NETWORK_TEST_ADAPTIVE"):
                environment.pop(name, None)
            if adaptive: environment["NETWORK_TEST_ADAPTIVE"] = "1"
            if reject_html: environment["NETWORK_TEST_REJECT_HTML"] = "1"
            if no_redirect: environment["NETWORK_TEST_NO_REDIRECT"] = "1"
            if recover:
                environment["NETWORK_TEST_RECOVER"] = "1"
            environment.pop("NETWORK_TEST_MIRRORS", None)
            if mirrors:
                environment["NETWORK_TEST_MIRRORS"] = ",".join(origin+m for m in mirrors)
            result = subprocess.run([str(binary), (endpoint if endpoint.startswith("https:") else origin+endpoint), str(path), str(connections), str(max_bytes),
                                     str(cancel), digest, method, str(file_limit), str(stop),
                                     "pieces" if pieces else "single", *(hashes or [])], capture_output=True, text=True, timeout=20, env=environment)
            if not result.stdout.strip():
                raise AssertionError(result.stderr or f"client exited {result.returncode}")
            out = json.loads(result.stdout)
            assert out["peakBuffer"] <= 16*1024*1024, out
            assert out["peakConnections"] <= connections, out
            return out

        assert json.loads(run("/json")["body"]) == {"value": 42}
        assert run("/not-found")["status"] == 404
        assert run("/json", method="HEAD")["body"] == ""
        metadata = run("/redirect", method="HEAD")
        assert metadata["url"] == origin + "/file", metadata
        assert "content-length" in metadata["headers"]
        assert "hx-redirect" not in metadata["headers"] and "set-cookie" not in metadata["headers"]
        probe = run("/modified", max_bytes=8192, range_probe=True)
        assert probe["status"] == 206 and len(probe["body"]) == 1, probe
        assert probe["headers"]["content-range"] == f"bytes 0-0/{len(DATA)}", probe
        assert probe["headers"]["last-modified"] == Handler.modified, probe
        # Custom public Range headers still require the caller to inspect redirects explicitly.
        probe_redirect = run("/redirect", max_bytes=8192, range_probe=True)
        assert probe_redirect["status"] == 302 and probe_redirect["headers"]["location"] == "/file", probe_redirect
        redirect = run("/redirect", method="HEAD", no_redirect=True)
        assert redirect["status"] == 302 and redirect["headers"]["location"] == "/file", redirect
        for endpoint in ("/html", "/html-no-type", "/html-fragmented"):
            html_path = directory / endpoint.removeprefix("/")
            rejected = run(endpoint, html_path, reject_html=True)
            assert rejected["state"] == "failed" and "browser verification required" in rejected["error"], rejected
            assert not html_path.exists()
        missing = run("/not-found", directory / "missing", reject_html=True)
        assert missing["state"] == "failed" and "HTTP 404" in missing["error"], missing
        # A published file can be recovered after queue-state loss without contacting its provider.
        path = directory / "published-recovery"
        assert run("/file", path, recover=True)["state"] == "completed"
        before = len(Handler.requests)
        recovered = run("/file", path, recover=True)
        assert recovered["state"] == "completed" and recovered["written"] == len(DATA), recovered
        assert len(Handler.requests) == before
        # A re-resolved link names the same file; another expected hash is another request.
        assert run("/no-range", path, recover=True)["state"] == "completed"
        assert run("/file", path, recover=True, digest="0"*64)["state"] == "failed"
        # Without an expected hash the receipt is trusted: no read-back of the whole file.
        path = directory / "hashed-recovery"
        digest = hashlib.sha256(DATA).hexdigest()
        assert run("/file", path, recover=True, digest=digest)["state"] == "completed"
        with path.open("r+b") as completed:
            completed.write(b"corrupt")  # An expected hash is checked again: same inode and size are not enough.
        assert "SHA-256 mismatch" in run("/file", path, recover=True, digest=digest)["error"]
        path = directory / "unowned-final"
        path.write_bytes(DATA)
        assert run("/file", path, recover=True)["state"] == "failed"
        assert path.read_bytes() == DATA
        path = directory / "sequential-recovery"
        assert run("/no-range", path, recover=True)["state"] == "completed"
        assert run("/no-range", path, recover=True)["state"] == "completed"
        for endpoint in ("/slow-no-range",):
            path = directory / endpoint.removeprefix("/")
            assert run(endpoint, path, cancel=180, recover=True)["state"] == "cancelled"
            assert run(endpoint, path, recover=True)["state"] == "failed"
            # Explicit app restart discards its owned partial, preserving final-file exclusivity.
            Path(str(path)+".part").unlink()
            assert run(endpoint, path, recover=True)["state"] == "completed"
        assert run("/large-json", max_bytes=256)["state"] == "failed"
        assembled = b"".join(PIECES)
        piece_hashes = [hashlib.sha1(piece).hexdigest() for piece in PIECES]
        for endpoint in ("/multipart", "/multipart-no-range", "/multipart-no-validator"):
            path = directory / endpoint.removeprefix("/")
            out = run(endpoint, path, pieces=True, hashes=piece_hashes, digest=hashlib.sha256(assembled).hexdigest(), recover=True)
            assert out["state"] == "completed", out
            assert path.read_bytes() == assembled
            assert out["written"] == len(assembled), out
            before = len(Handler.requests)
            assert run(endpoint, path, pieces=True, hashes=piece_hashes, digest=hashlib.sha256(assembled).hexdigest(), recover=True)["state"] == "completed"
            assert len(Handler.requests) == before
        path = directory / "multipart-sha1-error"
        out = run("/multipart", path, pieces=True, hashes=["0"*40, *piece_hashes[1:]])
        assert out["state"] == "failed" and "SHA-1 mismatch" in out["error"], out
        assert not path.exists()
        path = directory / "multipart-resume"
        assert run("/multipart-slow", path, pieces=True, hashes=piece_hashes, cancel=180)["state"] == "cancelled"
        before = len(Handler.requests)
        out = run("/multipart-slow", path, pieces=True, hashes=piece_hashes)
        assert out["state"] == "completed", out
        assert path.read_bytes() == assembled
        assert len([r for r in Handler.requests[before:] if r[1] != "bytes=0-0"]) < 18
        # 64 connections run on four lanes; every range lands once, retried ones included.
        for endpoint in ("/slow", "/flaky"):
            path = directory / f"lanes{endpoint.replace('/', '-')}"
            out = run(endpoint, path, connections=64, digest=hashlib.sha256(DATA).hexdigest())
            assert out["state"] == "completed", out
            assert path.read_bytes() == DATA
            path.unlink()
        # With more connections than ranges, idle ones split the ranges still running; every byte lands
        # once, and a split part that fails retries alone.
        for endpoint in ("/slow", "/flaky"):
            before = len(Handler.requests)
            path = directory / f"split{endpoint.replace('/', '-')}"
            out = run(endpoint, path, connections=32, digest=hashlib.sha256(DATA).hexdigest(), range_bytes=4*1024*1024)
            assert out["state"] == "completed", out
            assert path.read_bytes() == DATA
            starts = [int(r[1][6:].split("-")[0]) for r in Handler.requests[before:] if r[1] and r[1] != "bytes=0-0"]
            assert any(start % (4*1024*1024) for start in starts), starts
            path.unlink()
        # Each part of a split range has its own attempts: a range cut into many parts that each fail
        # twice still completes.
        path = directory / "split-twice"
        out = run("/slow-twice", path, connections=32, digest=hashlib.sha256(DATA).hexdigest(), range_bytes=len(DATA))
        assert out["state"] == "completed", out
        assert path.read_bytes() == DATA
        path.unlink()
        # Ranges spread over a mirror with the primary's size and ETag; one with another ETag gets none.
        before = len(Handler.requests)
        path = directory / "mirrored"
        out = run("/file", path, connections=8, mirrors=("/mirror", "/changed"), digest=hashlib.sha256(DATA).hexdigest())
        assert out["state"] == "completed", out
        assert path.read_bytes() == DATA
        ranges = [r for r in Handler.requests[before:] if r[1] and r[1] != "bytes=0-0"]
        assert any(r[0] == "/mirror" for r in ranges) and any(r[0] == "/file" for r in ranges), ranges
        assert not any(r[0] == "/changed" for r in ranges), ranges
        path.unlink()
        # A mirror that passes the probe but fails its ranges is dropped; they go back to the primary.
        out = run("/file", path, connections=8, mirrors=("/truncated",), digest=hashlib.sha256(DATA).hexdigest())
        assert out["state"] == "completed", out
        assert path.read_bytes() == DATA
        path.unlink()
        # /flaky fails each range once per server run; later checks count those retries afresh.
        Handler.retried.clear()
        for endpoint in ("/file", "/redirect", "/no-range", "/no-validator"):
            path = directory / endpoint.removeprefix("/")
            before = len(Handler.requests)
            out = run(endpoint, path)
            if endpoint == "/redirect":
                assert [r[0] for r in Handler.requests[before:]].count("/redirect") == 1, Handler.requests[before:]
            assert out["state"] == "completed", out
            assert hashlib.sha256(path.read_bytes()).digest() == hashlib.sha256(DATA).digest()
            assert out["written"] == len(DATA), out
            assert not Path(str(path)+".part").exists()
            path.unlink()
        # A range answered with the wrong span, or a 200 that ignores Range, is retried a few times
        # and then fails without blaming the file; validators that differ on the probed URL fail at once.
        for endpoint, error in (("/bad-range", "unexpected range response"), ("/changed", "ignored the byte range"),
                                ("/changed-etag", "changed the resource")):
            path = directory / endpoint.removeprefix("/")
            out = run(endpoint, path)
            assert out["state"] == "failed" and error in out["error"], out
            assert endpoint != "/changed-etag" or out["retries"] == 0, out
            assert not path.exists()
        # Refused and reset ranges are a busy server, not a damaged file: the origin's window shrinks
        # and every range lands once, byte-identical, at 64 connections.
        Handler.refused.clear()
        path = directory / "throttled"
        out = run("/throttled", path, connections=64, adaptive=True, reject_html=True, digest=hashlib.sha256(DATA).hexdigest())
        assert out["state"] == "completed", out
        assert path.read_bytes() == DATA
        assert {500, 503, 429} <= set(Handler.refused) and out["retries"] >= 3, (out, Handler.refused)
        path.unlink()
        # A pinned redirect target that keeps failing is resolved again, and the new target is pinned.
        path = directory / "hop"
        out = run("/hop", path, digest=hashlib.sha256(DATA).hexdigest())
        assert out["state"] == "completed", out
        assert path.read_bytes() == DATA
        assert Handler.hops <= 8, Handler.hops
        path.unlink()
        path = directory / "large-offset"
        size = 4*1024**3 + 1024**2
        # Seed completed sparse ranges to exercise the actual downloader beyond 4 GiB
        # without transferring or allocating gigabytes on the development machine.
        with Path(str(path)+".part").open("wb") as partial:
            partial.truncate(4*1024**3)
        identity = hashlib.sha256(f'etag:"fixture-v1"\0\0{size}\0'.encode()).hexdigest().encode()+b"\0"
        meta = struct.pack("<8sQQI65s3x", b"P5RDL001", size, 1024**2, 4097, identity)
        Path(str(path)+".resume").write_bytes(meta + b"\1"*4096 + b"\0")
        assert run("/large-offset", path)["state"] == "completed"
        assert path.stat().st_size == size
        with path.open("rb") as file:
            file.seek(4*1024**3)
            assert file.read() == DATA[:1024**2]
        path.unlink()
        path = directory / "flaky"
        before = len(Handler.requests)
        flaky = run("/flaky", path)
        assert flaky["state"] == "completed", flaky
        assert flaky["retries"] == 16, flaky
        assert path.read_bytes() == DATA
        assert len(Handler.requests[before:]) == 33  # Probe plus two attempts per range.
        path.unlink()
        path = directory / "flaky-probe"
        probe_retry = run("/flaky-probe", path)
        assert probe_retry["state"] == "completed" and probe_retry["retries"] == 17, probe_retry
        path.unlink()
        path = directory / "disk-error"
        failed = run("/file", path, file_limit=512*1024)
        assert failed["state"] == "failed" and "write partial file" in failed["error"], failed
        assert not path.exists()
        # Once space is freed, the partial resumes: ranges completed before the disk filled are kept.
        failed = run("/file", path, file_limit=4*1024*1024)
        assert failed["state"] == "failed" and "write partial file" in failed["error"], failed
        before = len(Handler.requests)
        assert run("/file", path)["state"] == "completed"
        assert path.read_bytes() == DATA
        assert len([r for r in Handler.requests[before:] if r[1] != "bytes=0-0"]) < 16
        path.unlink()
        # A killed process leaves a partial longer than its last checkpoint; unfinished ranges download again.
        path = directory / "killed"
        client = subprocess.Popen([str(binary), origin+"/slow", str(path), "4", str(1024*1024), "0", "", "GET", "0", "0", "single"],
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic()+5
        while not Path(str(path)+".resume").exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        time.sleep(0.1)
        client.kill(); client.wait()
        assert Path(str(path)+".part").exists() and Path(str(path)+".resume").exists()
        assert run("/slow", path)["state"] == "completed"
        assert path.read_bytes() == DATA
        path.unlink()
        # Ranges whose connections died while the process was suspended (rest mode) are retried without
        # counting as a busy server's refusals; a server's HTTP error after it still counts.
        def suspended(refusals):
            path = directory / "suspended"
            Handler.suspend_refusals = 0
            client = subprocess.Popen([str(binary), origin+"/suspend", str(path), "4", str(1024*1024), "0", hashlib.sha256(DATA).hexdigest(),
                                       "GET", "0", "0", "single"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
                                      env={**os.environ, "NETWORK_TEST_ADAPTIVE": "1"})
            try:
                deadline = time.monotonic()+5
                while len(Handler.streams) < 4 and time.monotonic() < deadline:
                    time.sleep(0.01)
                client.send_signal(signal.SIGSTOP)
                with Handler.guard:
                    for stream in Handler.streams:
                        try: stream.shutdown(socket.SHUT_RDWR)
                        except OSError: pass
                    Handler.streams.clear()
                    Handler.suspend_refusals = refusals
                time.sleep(10.5)
                client.send_signal(signal.SIGCONT)
                out = json.loads(client.communicate(timeout=20)[0])
            finally:
                client.kill()
            assert out["state"] == "completed" and out["retries"] == refusals, out
            assert path.read_bytes() == DATA
            path.unlink()
        suspended(0)
        suspended(1)
        path = directory / "shutdown"
        assert run("/slow", path, stop=180)["state"] == "stopped"
        assert run("/slow", path)["state"] == "completed"
        assert path.read_bytes() == DATA
        path.unlink()
        path = directory / "resume"
        cancelled = run("/slow", path, cancel=180)
        assert cancelled["state"] == "cancelled", cancelled
        assert Path(str(path)+".resume").exists()
        before = len(Handler.requests)
        resumed = run("/slow", path)
        assert resumed["state"] == "completed", resumed
        assert path.read_bytes() == DATA
        requests = Handler.requests[before:]
        assert len([item for item in requests if item[1] != "bytes=0-0"]) < 16, requests
        assert all(item[2] == '"fixture-v1"' for item in requests if item[1] != "bytes=0-0")
        path.unlink()
        # A signed link that expires mid-download resumes from a freshly resolved one: the checkpoint
        # names the bytes (validator, size), not the URL.
        path = directory / "signed"
        assert run("/slow-signed?sig=old", path, cancel=180)["state"] == "cancelled"
        Handler.expired.add("sig=old")
        expired = run("/slow-signed?sig=old", path)
        assert expired["state"] == "failed" and "HTTP 403" in expired["error"], expired
        before = len(Handler.requests)
        resumed = run("/slow-signed?sig=new", path)
        assert resumed["state"] == "completed", resumed
        assert path.read_bytes() == DATA
        assert len([r for r in Handler.requests[before:] if r[1] != "bytes=0-0"]) < 16
        path.unlink()
        # Without a strong ETag, Last-Modified guards ranges and resumes; the kept tail is re-read first.
        path = directory / "slow-modified"
        assert run("/slow-modified", path, cancel=180)["state"] == "cancelled"
        before = len(Handler.requests)
        resumed = run("/slow-modified", path)
        assert resumed["state"] == "completed", resumed
        assert path.read_bytes() == DATA
        requests = Handler.requests[before:]
        def span(request):
            first, last = map(int, request[1][6:].split("-"))
            return last-first+1
        ranged = [r for r in requests if r[1] and r[1] != "bytes=0-0"]
        assert any(span(r) == 65536 and r[2] is None for r in ranged), requests  # The tail check.
        assert all(r[2] == Handler.modified for r in ranged if span(r) != 65536), requests
        assert len([r for r in requests if r[1] != "bytes=0-0"]) < 17, requests
        path.unlink()
        assert run("/slow-modified", path, cancel=180)["state"] == "cancelled"
        Handler.modified = "Thu, 02 Jan 2025 00:00:00 GMT"
        # A changed file can never resume its partial: it is discarded and the download starts over
        # (issues #110 and #111), instead of failing until someone deletes it by hand.
        changed = run("/slow-modified", path)
        assert changed["state"] == "completed", changed
        # No validator at all: ranges still resume once the server's tail matches the partial's.
        for endpoint in ("/slow-no-validator", "/slow-no-validator-mutable"):
            path = directory / endpoint.removeprefix("/")
            Handler.mutated = False
            assert run(endpoint, path, cancel=180)["state"] == "cancelled"
            Handler.mutated = endpoint.endswith("mutable")
            out = run(endpoint, path)
            if Handler.mutated:
                assert out["state"] == "failed" and "changed since this partial" in out["error"], out
                assert not path.exists()
            else:
                assert out["state"] == "completed", out
                assert path.read_bytes() == DATA
        Handler.mutated = False
        path = directory / "hash"
        assert run("/file", path, digest="0"*64)["state"] == "failed"
        assert not path.exists()
        # A complete but hash-mismatched partial can be retried with the same expected identity;
        # it must never be silently promoted to a destination file.
        assert run("/file", path, digest="0"*64)["state"] == "failed"
        path = directory / "correct-hash"
        assert run("/file", path, digest=hashlib.sha256(DATA).hexdigest())["state"] == "completed"
        path.unlink()
        certificate, key = directory / "certificate.pem", directory / "key.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
                        "-keyout", str(key), "-out", str(certificate), "-days", "1",
                        "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1"], check=True, capture_output=True)
        tls = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(certificate, key)
        tls.socket = context.wrap_socket(tls.socket, server_side=True)
        threading.Thread(target=tls.serve_forever, daemon=True).start()
        assert run(f"https://127.0.0.1:{tls.server_port}/json")["state"] == "failed"
        tls.shutdown()
        # An origin that refuses new TLS handshakes for eight seconds while idle connections split the tails of
        # its 32 MiB ranges: the download lands byte-identical without a handshake storm, new connections
        # one at a time. One that refuses for good fails cleanly in bounded time.
        refusing = Refusing(context)
        threading.Thread(target=refusing.serve_forever, daemon=True).start()

        def refused_run(path, digest, deadline):
            result = subprocess.run([str(binary), f"https://127.0.0.1:{refusing.server_port}/paced", str(path), "32", str(1024*1024),
                                     "0", digest, "GET", "0", "0", "single"], capture_output=True, text=True, timeout=deadline+10,
                                    env={**os.environ, "NETWORK_TEST_ADAPTIVE": "1", "NETWORK_TEST_CA": str(certificate),
                                         "NETWORK_TEST_RANGE_BYTES": str(32*1024*1024), "NETWORK_TEST_DEADLINE_MS": str(deadline*1000)})
            return json.loads(result.stdout), result.stderr

        path = directory / "refused-burst"
        refusing.started, refusing.burst = time.monotonic(), True
        out, log = refused_run(path, hashlib.sha256(LARGE).hexdigest(), 60)
        refusing.burst = False
        print(f"Refusal burst: {refusing.handshakes} handshakes, {len(refusing.refused)} refused, {out['retries']} retries, "
              f"{out['milliseconds']} ms")
        assert out["state"] == "completed", (out, log[-2000:])
        assert path.read_bytes() == LARGE
        path.unlink()
        # The handshakes in flight when the burst began fail together; after them, one at a time.
        later = [at for at in refusing.refused if at-refusing.refused[0] > 1]
        assert all(b-a > 0.1 for a, b in zip(later, later[1:])), (refusing.refused, log[-2000:])
        assert len(refusing.refused) <= 20 and refusing.handshakes <= 40, (refusing.handshakes, refusing.refused)

        path = directory / "refused-forever"
        refusing.handshakes, refusing.refused, refusing.dead = 0, [], True
        started = time.monotonic()
        out, log = refused_run(path, "", 150)
        elapsed = time.monotonic()-started
        print(f"Refused forever: failed after {elapsed:.1f} s, {refusing.handshakes} handshakes, {out['retries']} retries")
        assert out["state"] == "failed" and "SSL connect error" in out["error"], out
        assert elapsed < 120 and refusing.handshakes <= 200, (elapsed, refusing.handshakes, out)
        assert not path.exists()
        refusing.shutdown()
        existing = directory / "existing"
        existing.write_bytes(b"preserve")
        assert run("/file", existing)["state"] == "failed"
        assert existing.read_bytes() == b"preserve"
        print("Native networking: HTTP methods/status/limits, exact ranges, bounded buffering, redirects, "
              "sequential fallbacks, truncation, 64-bit offsets, retries, cancellation/resume, re-resolved and expired "
              "links, Last-Modified and validator-less resume, full-disk and killed-process resume, hashes, "
              "TLS verification and destination preservation passed.")
    server.shutdown()


if __name__ == "__main__":
    main()
