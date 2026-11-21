# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
"""Controlled localhost range benchmark, not a PS5 or internet speed measurement."""
import hashlib
import http.server
import json
from pathlib import Path
import statistics
import subprocess
import tempfile
import threading
from test_network import DATA, Handler, compile_client


def main():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    results = []
    try:
        with tempfile.TemporaryDirectory(prefix="ps5-react-network-bench-") as temporary:
            directory = Path(temporary)
            binary = compile_client(directory)
            for connections in (1, 2, 4, 8, 16):
                samples = []
                for repeat in range(3):
                    path = directory / f"download-{connections}-{repeat}"
                    result = subprocess.run([str(binary), f"http://127.0.0.1:{server.server_port}/slow",
                                             str(path), str(connections)], check=True,
                                            capture_output=True, text=True, timeout=20)
                    sample = json.loads(result.stdout)
                    assert sample["state"] == "completed", sample
                    assert hashlib.sha256(path.read_bytes()).digest() == hashlib.sha256(DATA).digest()
                    assert sample["peakBuffer"] <= 16*1024*1024, sample
                    samples.append(sample["milliseconds"])
                    path.unlink()
                milliseconds = statistics.median(samples)
                results.append({"connections": connections, "medianMilliseconds": milliseconds,
                                "MiBPerSecond": round(len(DATA)/1024**2/(milliseconds/1000), 2)})
    finally:
        server.shutdown()
    print(json.dumps({"environment": "macOS localhost; 16 MiB; 1 MiB ranges; 64 KiB/6 ms per connection; "
                     "adaptive disabled; three runs; includes startup, transfer and fsync", "results": results}, indent=2))


if __name__ == "__main__":
    main()
