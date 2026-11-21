// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <cstdint>
#include <string>
#include <vector>
// Removals on a worker thread, one at a time in the order asked: unlinking a file of tens of GB, or a
// game's thousands of files, holds the calling thread for seconds.
namespace removals {
struct Snapshot { std::uint32_t id = 0; std::string state = "queued", error; };
// A file, or a directory and everything in it; a symbolic link is unlinked, never entered, so nothing
// outside the tree is reached. With `missing_ok`, what is already gone counts as removed. False with
// errno set.
bool remove_tree(const std::string& path, bool missing_ok);
// Queues `path` (a real path); 0 with `error` when the worker cannot start.
std::uint32_t start(std::string path, std::string& error);
// Every removal's state; terminal ones ("completed", "failed", "cancelled") are reported once.
std::vector<Snapshot> poll();
// Stops between two entries; the removal under way and those queued end "cancelled".
void stop();
}
