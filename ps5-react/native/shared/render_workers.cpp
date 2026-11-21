// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "render_workers.hpp"

#include "thread_name.hpp"
#include "worker_thread.hpp"

#include <algorithm>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <mutex>
#include <unistd.h>

#ifdef PROSPERO
#include <sys/param.h>
#include <sys/cpuset.h>
#endif

extern "C" {
#include "native_renderer.h"
std::uint32_t er_parallel_frames(void);
}

namespace render_workers {
namespace {

#ifndef ERUI_RENDER_WORKERS
#define ERUI_RENDER_WORKERS 1
#endif
constexpr int cap = ERUI_RENDER_WORKERS;

struct Worker {
  WorkerThread thread;
  std::mutex mutex;
  std::condition_variable wake;
  bool go = false, quit = false;
};

// Render code runs deep (nested opacity, transform captures, recursive tree walks): the same budget
// as a network worker rather than the console's small default.
constexpr std::size_t stack_bytes = 1024 * 1024;

Worker workers[cap > 1 ? cap : 1];
int count = 1;
pthread_key_t id_key;
bool key_made = false;
std::mutex done_mutex;
std::condition_variable done;
int outstanding = 0;
// Serializes the render code the engine cannot run concurrently (vector rasterization).
std::mutex serial;

void run(int k) {
  pthread_setspecific(id_key, reinterpret_cast<void*>(static_cast<std::intptr_t>(k)));
  char name[16];
  std::snprintf(name, sizeof name, "render-%d", k);
  name_thread(name);
  Worker& self = workers[k];
  for (;;) {
    {
      std::unique_lock lock(self.mutex);
      self.wake.wait(lock, [&] { return self.go || self.quit; });
      if (self.quit) return;
      self.go = false;
    }
    er_render_worker_exec(k);
    std::lock_guard lock(done_mutex);
    if (--outstanding == 0) done.notify_one();
  }
}

void dispatch(int k, void*) {
  {
    std::lock_guard lock(done_mutex);
    ++outstanding;
  }
  {
    std::lock_guard lock(workers[k].mutex);
    workers[k].go = true;
  }
  workers[k].wake.notify_one();
}

void sync(void*) {
  std::unique_lock lock(done_mutex);
  done.wait(lock, [] { return outstanding == 0; });
}

void lock_serial(void*) { serial.lock(); }
void unlock_serial(void*) { serial.unlock(); }

int worker_id() { return static_cast<int>(reinterpret_cast<std::intptr_t>(pthread_getspecific(id_key))); }

void join(int started) {
  for (int k = 1; k < started; ++k) {
    {
      std::lock_guard lock(workers[k].mutex);
      workers[k].quit = true;
    }
    workers[k].wake.notify_one();
    workers[k].thread.join();
    workers[k].go = workers[k].quit = false;
  }
}

} // namespace

int max_workers() { return cap; }

unsigned forked_commits() { return er_parallel_frames(); }

int current() { return key_made ? worker_id() : 0; }

int available_cpus() {
#ifdef PROSPERO
  cpuset_t set;
  CPU_ZERO(&set);
  if (cpuset_getaffinity(CPU_LEVEL_WHICH, CPU_WHICH_PID, -1, sizeof set, &set) == 0) return CPU_COUNT(&set);
#endif
  const long online = sysconf(_SC_NPROCESSORS_ONLN);
  return online > 0 ? static_cast<int>(online) : 0;
}

int start(int wanted) {
  stop();
  wanted = std::clamp(wanted, 1, cap);
  if (wanted == 1) return 1;
  if (!key_made && pthread_key_create(&id_key, nullptr) != 0) return 1;
  key_made = true;
  int started = 1;
  while (started < wanted) {
    const int k = started;
    if (!workers[k].thread.start([k] { run(k); }, stack_bytes)) break;
    ++started;
  }
  if (started == 1) return 1;
  count = started;
  const EmbeddedRenderWorkers hooks = {count, dispatch, sync, worker_id, nullptr, lock_serial, unlock_serial};
  embedded_renderer_set_workers(&hooks);
  return count;
}

void stop() {
  if (count == 1) return;
  embedded_renderer_set_workers(nullptr);
  join(count);
  count = 1;
}

} // namespace render_workers
