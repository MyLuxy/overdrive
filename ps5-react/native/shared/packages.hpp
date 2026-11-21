// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <cstdint>
#include <string>
#include <vector>
// PKG installation through the console's app-install service, one package at a time.
namespace packages {
// `status`: the console's install stage ("transferring", "promoting", "playable").
struct Snapshot { std::uint32_t id = 0; std::string state = "queued", error, content_id, status; std::uint64_t written = 0, total = 0; };
// `path`: a package on a drive, or an http(s) link the console downloads itself; `content_id` names a
// link's PS4 package (empty otherwise).
std::uint32_t install(std::string path, std::string name, std::string content_id, std::string& error);
// Stops reporting; an install the console already accepted carries on.
void cancel(std::uint32_t id);
std::vector<Snapshot> poll();
void stop();
// The package server's helper payload (native/ps5/payloads/pkg_helper.cpp), started off the render
// thread: its snapshot ends "ready" with the port it listens on, or "failed" with the reason.
struct HelperSnapshot { std::uint32_t id = 0; std::string state = "starting", error; std::uint32_t port = 0; };
std::uint32_t start_helper(std::uint32_t port, std::string secret, std::string log, std::string& error);
std::vector<HelperSnapshot> poll_helper();
}
