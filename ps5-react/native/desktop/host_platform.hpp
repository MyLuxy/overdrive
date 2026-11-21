// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <SDL2/SDL.h>

// The Host owns the controller; the native API borrows it for light bar and rumble.
void desktop_set_controller(SDL_GameController* controller);
// Whether the app asked to open again once closed (host::arrange_relaunch); main runs itself again.
bool desktop_relaunch_requested();
