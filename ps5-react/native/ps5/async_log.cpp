// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "async_log.hpp"
#include "thread_name.hpp"

#include "platform/ps5/system.hpp"
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <pthread.h>

namespace {
// hui::sys::log truncates a line at 384 bytes.
constexpr int capacity = 64, line_size = 384;

pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;
pthread_cond_t wake = PTHREAD_COND_INITIALIZER;
pthread_t writer;
char lines[capacity][line_size];
int head = 0, count = 0;
unsigned dropped = 0;
bool running = false, stopping = false;

void* drain(void*) {
  name_thread("log-writer");
  char line[line_size];
  pthread_mutex_lock(&mutex);
  for (;;) {
    while (!count && !dropped && !stopping) pthread_cond_wait(&wake, &mutex);
    if (!count && !dropped) break;
    const unsigned lost = dropped;
    dropped = 0;
    if (count) {
      std::memcpy(line, lines[head], line_size);
      head = (head + 1) % capacity;
      --count;
    } else {
      line[0] = '\0';
    }
    pthread_mutex_unlock(&mutex);
    if (lost) hui::sys::log("[PS5-REACT] %u log lines dropped", lost);
    if (line[0]) hui::sys::log("%s", line);
    pthread_mutex_lock(&mutex);
  }
  pthread_mutex_unlock(&mutex);
  return nullptr;
}
} // namespace

namespace async_log {
bool start() {
  pthread_mutex_lock(&mutex);
  stopping = false;
  running = pthread_create(&writer, nullptr, drain, nullptr) == 0;
  pthread_mutex_unlock(&mutex);
  return running;
}

void write(const char* format, ...) {
  va_list arguments;
  va_start(arguments, format);
  pthread_mutex_lock(&mutex);
  if (!running) {
    pthread_mutex_unlock(&mutex);
    char line[line_size];
    std::vsnprintf(line, sizeof line, format, arguments);
    hui::sys::log("%s", line);
  } else {
    if (count == capacity) {
      ++dropped;
    } else {
      std::vsnprintf(lines[(head + count) % capacity], line_size, format, arguments);
      ++count;
    }
    pthread_cond_signal(&wake);
    pthread_mutex_unlock(&mutex);
  }
  va_end(arguments);
}

void stop() {
  pthread_mutex_lock(&mutex);
  if (!running) {
    pthread_mutex_unlock(&mutex);
    return;
  }
  stopping = true;
  pthread_cond_signal(&wake);
  pthread_mutex_unlock(&mutex);
  pthread_join(writer, nullptr);
  pthread_mutex_lock(&mutex);
  running = false;
  pthread_mutex_unlock(&mutex);
}
} // namespace async_log
