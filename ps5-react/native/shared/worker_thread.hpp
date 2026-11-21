// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <functional>
#include <pthread.h>

// A joinable thread with an explicit stack. The console's default pthread stack is small: an archive
// extraction (the preflight parsers, the xz and zstd decoders, libarchive) overflowed it and the title
// died with a fault at address 0 when a download finished. std::thread takes no stack size.
class WorkerThread {
public:
  bool start(std::function<void()> body, std::size_t stack_bytes = 8 * 1024 * 1024) {
    body_ = std::move(body);
    pthread_attr_t attributes;
    if (pthread_attr_init(&attributes) != 0) return false;
    const int sized = pthread_attr_setstacksize(&attributes, stack_bytes);
    started_ = !sized && pthread_create(&thread_, &attributes, entry, this) == 0;
    pthread_attr_destroy(&attributes);
    return started_;
  }
  // Also drops the body, which may hold the object that owns this thread.
  void join() {
    if (started_) pthread_join(thread_, nullptr);
    started_ = false;
    body_ = nullptr;
  }

private:
  static void* entry(void* self) {
    static_cast<WorkerThread*>(self)->body_();
    return nullptr;
  }
  std::function<void()> body_;
  pthread_t thread_{};
  bool started_ = false;
};
