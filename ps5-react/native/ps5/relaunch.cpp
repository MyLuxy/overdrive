// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "app_config.hpp"
#include "host_api.hpp"
#include "payload_loader.hpp"
#include <cstdio>
#include <cstring>
#include <string>

// relauncher.elf (native/ps5/payloads/relauncher.c) waits for this title to close and opens it again.
// It answers "ready" once it has the request, which is the proof the app needs before it closes.
bool host::arrange_relaunch(char* error, std::size_t size) {
  std::string reason;
  const int socket = payload_loader::send("relauncher.elf", std::string("RLA1\n") + PS5_REACT_TITLE + "\n", 3'000'000, "relaunch", reason);
  if (socket >= 0) {
    char answer[16] = {};
    const int count = payload_loader::receive(socket, answer, sizeof answer - 1);
    payload_loader::close(socket);
    if (count > 0 && !std::strncmp(answer, "ready\n", 6)) return true;
    reason = "relaunch: relauncher.elf did not answer";
  }
  std::snprintf(error, size, "%s", reason.c_str());
  return false;
}
