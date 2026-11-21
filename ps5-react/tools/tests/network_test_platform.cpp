// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// The desktop platform, plus a trusted test CA and the download log on stderr for the tests to read.
#include "network.hpp"
#include <cstdio>
#include <cstdlib>
namespace network {
bool platform_start(std::string&) { return true; }
void platform_stop() {}
const char* ca_path() { return std::getenv("NETWORK_TEST_CA"); }
void platform_log(const char* line) { std::fprintf(stderr, "%s\n", line); }
}
