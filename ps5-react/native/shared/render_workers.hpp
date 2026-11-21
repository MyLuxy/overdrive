// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

// Threads the engine forks a commit's repaint across (EmbeddedRenderWorkers). The render thread is
// worker 0; the others sleep on a condition variable until dispatched and never touch QuickJS.
// Start after the backend is installed and before the first commit; stop before the backend goes.
namespace render_workers {

// Total workers including the render thread, clamped to the engine's ERUI_RENDER_WORKERS cap.
// Returns the count actually installed: 1 means single-core rendering.
int start(int count);
void stop();
// The calling thread's worker index: 0 on the render thread and any thread that is not a worker.
int current();
// Hardware threads this process may run on, or 0 when the platform does not say.
int available_cpus();
// The engine's build cap (ERUI_RENDER_WORKERS).
int max_workers();
// Commits the engine has rendered across the workers so far.
unsigned forked_commits();

} // namespace render_workers
