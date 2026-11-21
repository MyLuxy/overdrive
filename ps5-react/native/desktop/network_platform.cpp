// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "network.hpp"
namespace network {
bool platform_start(std::string&) { return true; }
void platform_stop() {}
const char* ca_path() { return nullptr; }
void platform_log(const char*) {}
}
