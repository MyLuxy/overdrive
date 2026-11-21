// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace browser_capture {
struct Snapshot { std::uint32_t id = 0; std::string state = "queued", error, url; };
// `rejected` holds up to six links the app already refused; the payload scans past them. `resume`
// restarts after such a refusal with the links the last fresh capture found already in memory.
std::uint32_t capture(std::string prefix, std::string suffix, int timeout, std::vector<std::string> rejected,
                      bool resume, std::string& error);
void cancel(std::uint32_t id);
std::vector<Snapshot> poll();
void stop();
}
