# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Local remote-image loader tests: fetch, decode, fit, cache and cancellation; no console or internet."""
import http.server
import io
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
import threading
import time

from PIL import Image, ImageChops, ImageDraw, ImageStat

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import ROOT, stb_image  # noqa: E402

COVER, CONTAIN, STRETCH, NONE = range(4)


def encoded(image, kind, **options):
    buffer = io.BytesIO()
    image.save(buffer, kind, **options)
    return buffer.getvalue()


def photo(width, height):
    image = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(image)
    for x in range(0, width, 8):
        draw.rectangle((x, 0, x + 7, height), fill=(x * 255 // width, 90, 255 - x * 255 // width))
    draw.ellipse((width // 4, height // 4, width * 3 // 4, height * 3 // 4), fill=(240, 200, 40))
    return image


def logo():
    image = Image.new("RGBA", (400, 200), (0, 0, 0, 0))
    ImageDraw.Draw(image).rounded_rectangle((40, 40, 360, 160), 30, fill=(250, 250, 250, 255))
    return image


BODIES = {
    "/photo.png": ("image/png", encoded(photo(1600, 1200), "PNG")),
    "/photo.jpg": ("image/jpeg", encoded(photo(1600, 1200), "JPEG", quality=95)),
    "/logo.png": ("image/png", encoded(logo(), "PNG")),
    "/huge.png": ("image/png", encoded(Image.new("RGB", (3000, 2000)), "PNG")),
    "/red.png": ("image/png", encoded(Image.new("RGB", (60, 90), (160, 20, 30)), "PNG")),
    "/grey.png": ("image/png", encoded(Image.new("RGB", (60, 90), (120, 120, 124)), "PNG")),
    "/text": ("text/plain", b"not an image"),
    # Noise does not compress: a body over the 128 KiB the allocation-failure runs refuse.
    "/noise.jpg": ("image/jpeg", encoded(Image.effect_noise((800, 600), 80).convert("RGB"), "JPEG", quality=95)),
}


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    requests = []

    def handle(self):
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError):
            pass  # The client cancelled.

    def log_message(self, *_):
        pass

    def do_GET(self):
        path = self.path.split("?")[0]
        Handler.requests.append(self.path)
        if path == "/slow.jpg":
            time.sleep(3)
            path = "/photo.jpg"
        if path == "/large":
            body = b"\0" * (9 * 1024 * 1024)
            kind = "application/octet-stream"
        elif path in BODIES:
            kind, body = BODIES[path]
        else:
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self.send_response(200)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # The client cancelled.


def compile_client(directory):
    binary = directory / "client"
    subprocess.run(["clang++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror", "-pthread",
                    "-I", str(ROOT / "native/shared"), "-I", str(stb_image()),
                    str(ROOT / "tools/tests/image_client.cpp"), str(ROOT / "native/shared/image_loader.cpp"),
                    str(ROOT / "native/shared/network.cpp"), str(ROOT / "native/desktop/network_platform.cpp"),
                    "-lcurl", "-o", str(binary)], check=True)
    return binary


def argb(path, width, height):
    """Premultiplied ARGB8888 words to an RGBA image."""
    pixels = struct.unpack(f"<{width * height}I", path.read_bytes())
    rgba = bytearray()
    for p in pixels:
        a = p >> 24
        rgba += bytes(((p >> 16 & 255) * 255 // a if a else 0, (p >> 8 & 255) * 255 // a if a else 0,
                       (p & 255) * 255 // a if a else 0, a))
    return Image.frombytes("RGBA", (width, height), bytes(rgba))


def difference(a, b):
    return max(ImageStat.Stat(ImageChops.difference(a.convert("RGB"), b.convert("RGB"))).mean)


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    with tempfile.TemporaryDirectory(prefix="ps5-react-images-") as temporary:
        directory = Path(temporary)
        binary = compile_client(directory)

        def run(*arguments, cache="", fail_large_ms=0):
            result = subprocess.run([str(binary), *map(str, arguments)], capture_output=True, text=True, timeout=30,
                                    env={**os.environ, "IMAGE_CACHE": cache, "IMAGE_FAIL_LARGE_MS": str(fail_large_ms)})
            if result.returncode or not result.stdout.strip():
                raise AssertionError(result.stderr or f"client exited {result.returncode}")
            return json.loads(result.stdout)

        def load(path, width, height, fit, fail_large_ms=0):
            out = directory / "pixels"
            result = run("load", origin + path, width, height, fit, out, fail_large_ms=fail_large_ms)
            return result, (argb(out, result["width"], result["height"]) if result["ready"] else None)

        source = photo(1600, 1200)
        # Cover crops to the box's aspect ratio, then shrinks to the box with a box filter.
        result, image = load("/photo.png", 300, 300, COVER)
        assert (result["width"], result["height"], result["opaque"]) == (300, 300, True), result
        expected = source.crop((200, 0, 1400, 1200)).resize((300, 300), Image.BOX)
        assert difference(image, expected) < 1.5, difference(image, expected)
        result, image = load("/photo.jpg", 320, 120, COVER)
        assert (result["width"], result["height"]) == (320, 120), result
        assert difference(image, source.crop((0, 300, 1600, 900)).resize((320, 120), Image.BOX)) < 3
        # Contain keeps the whole image inside the box; nothing is enlarged.
        result, _ = load("/photo.png", 400, 400, CONTAIN)
        assert (result["width"], result["height"]) == (400, 300), result
        result, _ = load("/photo.png", 3200, 3200, CONTAIN)
        assert (result["width"], result["height"]) == (1600, 1200), result
        result, _ = load("/photo.png", 3200, 600, COVER)
        assert (result["width"], result["height"]) == (1600, 300), result
        result, _ = load("/photo.png", 100, 50, STRETCH)
        assert (result["width"], result["height"]) == (100, 50), result
        result, _ = load("/photo.png", 10, 10, NONE)
        assert (result["width"], result["height"]) == (1600, 1200), result
        # Alpha is premultiplied and reported, so the engine blends only images that need it.
        result, image = load("/logo.png", 200, 100, CONTAIN)
        assert (result["width"], result["height"], result["opaque"]) == (200, 100, False), result
        assert image.getpixel((0, 0))[3] == 0 and image.getpixel((100, 50)) == (250, 250, 250, 255)
        # The vivid colour is the dominant saturated hue at full brightness; grey art has none.
        result, _ = load("/red.png", 48, 72, COVER)
        assert result["color"] == 0xFF2030, hex(result["color"])
        result, _ = load("/grey.png", 48, 72, COVER)
        assert result["color"] == -1, result
        # Errors name the call and the URL.
        for path, reason in (("/missing.jpg", "HTTP 404"), ("/text", "not a decodable JPEG or PNG"),
                             ("/huge.png", "5-megapixel"), ("/large", "exceeds 4 MiB")):
            result, _ = load(path, 64, 64, COVER)
            assert result["failed"] and result["error"].startswith(f"Image.load {origin}{path}") and reason in result["error"], result
        # An exhausted heap fails the load after its retries instead of aborting: first the response
        # body cannot be held, then (with a small body) stb_image cannot decode.
        for path, reason in (("/noise.jpg?oom", "out of memory for the response"), ("/photo.png?oom", "out of memory to decode")):
            result, _ = load(path, 64, 64, COVER, fail_large_ms=-1)
            assert result["failed"] and reason in result["error"], result
        # Memory that frees up within the retries lets the same load finish.
        result, _ = load("/noise.jpg?recovers", 64, 64, COVER, fail_large_ms=800)
        assert result["ready"], result
        before = len(Handler.requests)
        assert run("shared", origin + "/photo.jpg") == {"same": True, "immediate": True}
        assert len(Handler.requests) == before + 1
        started = time.monotonic()
        assert run("cancel", origin + "/slow.jpg") == {"reported": 0}
        assert time.monotonic() - started < 2.5
        before = len(Handler.requests)
        assert run("flyby", origin + "/photo.jpg?flyby") == {"reported": 0}
        assert len(Handler.requests) == before, Handler.requests[before:]
        # 12 images of 4 MiB against a 24 MiB budget: the 6 oldest unused go, the one in use stays.
        evicted = run("evict", origin + "/photo.jpg", 12)
        assert evicted == {"loaded": 12, "evicted": 6, "first": 2, "kept": True}, evicted
        # An extraction's memory hold and heap pressure keep unused images to 16 MiB (the one in use and the
        # three newest), the normal 64 MiB returns after, and a decode that would fill the heap is refused.
        squeezed = run("squeeze", origin + "/photo.jpg")
        assert squeezed == {"loaded": 12, "calm": 0, "held": 8, "held_mib": 16, "reloaded": 8, "restored": 0,
                            "pressed": 8, "relieved": True,
                            "full": "Image.load " + origin + "/photo.jpg?n=full: out of memory to decode (heap near full)"}, squeezed
        # A second launch serves the encoded bytes from the disk cache without a request.
        cache = directory / "cache"
        before = len(Handler.requests)
        first = run("load", origin + "/photo.jpg?disk", 64, 64, COVER, directory / "pixels", cache=cache)
        again = run("load", origin + "/photo.jpg?disk", 32, 32, COVER, directory / "pixels", cache=cache)
        assert first["ready"] and again["ready"] and len(Handler.requests) == before + 1, (first, again)
        print("Remote images: cover/contain/stretch fitting without enlargement, box-filter quality, premultiplied "
              "alpha, error messages, allocation failure and recovery, shared fetches, cancellation, LRU eviction, memory holds, heap pressure and the disk cache passed.")
    server.shutdown()


if __name__ == "__main__":
    main()
