// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// QuickJS expects POSIX _r variants; the native libc exposes the C variants.
#include <pthread.h>
#include "app_config.hpp"
#include <time.h>

static pthread_mutex_t date_mutex = PTHREAD_MUTEX_INITIALIZER;

struct tm *localtime_r(const time_t *time, struct tm *output) {
    pthread_mutex_lock(&date_mutex);
    const struct tm *result = localtime(time);
    if (result) *output = *result;
    pthread_mutex_unlock(&date_mutex);
    return result ? output : 0;
}
