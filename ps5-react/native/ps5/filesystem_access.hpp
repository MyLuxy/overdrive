// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <cstddef>

// One startup request, before creating the render thread. Failure keeps the
// original sandbox. The upstream helper owns credential/layout handling.
void initialize_filesystem_access();
bool resolve_filesystem_path(const char* path, char* out, std::size_t size);

// True only after the startup access proof succeeds.
bool console_filesystem_accessible();
