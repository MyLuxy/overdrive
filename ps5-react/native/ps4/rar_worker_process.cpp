// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// The desktop rar-extract runs as a child process with one socket-pair pipe; the Open Orbis
// process model has neither posix_spawn nor fork, so RAR requests fail gracefully here until
// an in-process worker replaces them (native/ps4/README.md).
#include "archives.hpp"
#include <cerrno>
#include <string>

namespace archives {
int start_rar_worker(const std::string&, std::string& error) {
  error = "RAR extraction needs a worker process, which this PS4 build does not provide yet";
  return -1;
}

long read_rar_worker(int, char*, std::size_t) { return -1; }

void cancel_rar_worker(int) {}

void close_rar_worker(int) {}
} // namespace archives
