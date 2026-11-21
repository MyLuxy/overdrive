// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <string>

// Programs an app may not run itself (the console's install and launch services) go to the payload
// loader on 127.0.0.1:9021, which runs each with the rest of the connection as its standard input and
// output.
namespace payload_loader {
// Sends `program` from the app folder, then `request`. The connected socket, its sends and receives
// timing out after `timeout_us`; -1 with `error` (prefixed with `what`) when the loader is not there.
int send(const char* program, const std::string& request, int timeout_us, const char* what, std::string& error);
int receive(int socket, char* data, std::size_t size);
bool write(int socket, const char* data, std::size_t size);
// Later receives wait at most `timeout_us`.
void receive_timeout(int socket, int timeout_us);
void close(int socket);
}
