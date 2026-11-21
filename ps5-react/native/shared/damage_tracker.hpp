// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include "er_scene.h"
#include <span>

// Records every rect the engine writes into the software framebuffer, so the
// presenter can upload only what changed since the last frame.
//
// er_get_dirty_rects() is not enough: it reports only the last commit that
// painted, while one host frame can run several (a controller dispatch commits
// outside the pump's batch, and layout handlers can commit inside er_commit).
// Wrapping the backend's blits observes all of them.

// Call right after er_software_backend_init(), before any asset or runtime setup:
// re-registering the backend resets the engine's font and image registries.
bool damage_tracker_install(int width, int height);
// A framebuffer move (backend move_rect): the src rect's pixels went to src + (dx, dy).
struct DamageMove { ERRect src; int dx, dy; };

// Rects painted since the last clear; they may overlap. When moves() is not empty, apply those first,
// in order, to the previous frame's pixels: the rects then hold exactly what still differs.
std::span<const ERRect> damage_tracker_rects();
std::span<const DamageMove> damage_tracker_moves();
void damage_tracker_clear();
// Pixels the rects and the moved copies cover, counting overlaps more than once.
std::size_t damage_tracker_area();
