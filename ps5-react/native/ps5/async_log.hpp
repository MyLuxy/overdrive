// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

// Klog lines written from the render thread go through a queue to a writer thread:
// sceKernelDebugOutText usually takes 0.1-1 ms, but on the PS5 it has held the caller
// for 10 ms, and once for 1.45 s. A full queue drops lines and reports how many.
// Outside start()/stop() a line is written synchronously.
namespace async_log {
bool start();
void write(const char* format, ...) __attribute__((format(printf, 1, 2)));
// Writes the queued lines and joins the writer thread.
void stop();
} // namespace async_log
