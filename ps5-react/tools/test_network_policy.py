#!/usr/bin/env python3
"""Check the exact host policy used by the native range scheduler without network access."""
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
SOURCE = r'''
#include "network.cpp"
#include <cassert>
int main() {
  for (const char* host : {"tb-cdn.io", "node.tb-cdn.io", "node.tb-cdn.st", "nexus.latm.tb-cdn.cx", "nexus.erth.tb-cdn.earth", "cdn.torbox.app"}) {
    const std::string url = std::string("https://") + host + "/file";
    assert(network::connection_limit(url, 64) == 16);
    assert(network::connection_limit(url, 2) == 2);
    assert(network::initial_connections(url, 16, true) == 16);
    assert(network::initial_connections(url, 2, true) == 2);
    assert(network::initial_connections(url, 16, false) == 16);
    assert(network::debrid_cdn(url));
  }
  assert(network::connection_limit("https://node.real-debrid.com/file", 64) == 8);
  assert(network::initial_connections("https://github.com/file", 64, true) == 8);
  assert(network::connection_limit("https://node.premiumize.me/file", 64) == 8);
  assert(network::connection_limit("https://edge.fetchio.cc/file", 64) == 16);
  for (const char* host : {"tb-cdn.io.evil.example", "nottb-cdn.io", "github.com"})
    assert(network::connection_limit(std::string("https://") + host + "/file", 64) == 64);
}
'''

with tempfile.TemporaryDirectory(prefix="ps5-react-network-policy-") as tmp:
    source, binary = Path(tmp) / "policy.cpp", Path(tmp) / "policy"
    source.write_text(SOURCE)
    subprocess.run(["clang++", "-std=c++20", "-O2", "-Wall", "-Wextra", "-Werror", "-pthread",
                    "-I", str(ROOT / "native/shared"), str(source),
                    str(ROOT / "tools/tests/network_test_platform.cpp"),
                    "-lcurl", *([] if sys.platform == "darwin" else ["-lcrypto"]), "-o", str(binary)], check=True)
    subprocess.run([str(binary)], check=True)
print("Native connection policy: TorBox starts at sixteen; other host caps and domain boundaries passed.")
