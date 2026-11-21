// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <pthread.h>
#ifdef PROSPERO
#include <pthread_np.h>
#endif

// Names the calling thread, so a PS5 crash report says which thread faulted.
inline void name_thread(const char* name) {
#ifdef PROSPERO
  pthread_set_name_np(pthread_self(), name);
#elif defined(__APPLE__)
  pthread_setname_np(name);
#else
  (void)name;
#endif
}
