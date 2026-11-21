// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

// The console's log keeps only its latest few kilobytes, so a crash's lines are gone before anyone
// reads them. Every line the title sends there is also appended to <directory>/app.log, which holds
// the last five sessions (each opened by a "session" line with its local time) before it becomes
// app.prev.log, and a fatal signal adds its number and addresses before the title dies. Read them
// over FTP or a file manager after a crash.
namespace crash_log {
void start(const char* directory);
}
