// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "removals.hpp"
#include "host_api.hpp"
#include "thread_name.hpp"
#include "worker_thread.hpp"
#include <sys/stat.h>
#include <unistd.h>
#include <algorithm>
#include <atomic>
#include <cerrno>
#include <condition_variable>
#include <cstring>
#include <mutex>

namespace removals {
namespace {
struct Job { Snapshot snapshot; std::string path; };
std::mutex guard;
std::condition_variable wake;
std::vector<Job> jobs;
std::uint32_t next_id = 1;
WorkerThread worker;
bool started = false;
std::atomic<bool> stopping{false};

bool terminal(const std::string& state) { return state == "completed" || state == "failed" || state == "cancelled"; }

bool tree(const std::string& path, bool missing_ok, unsigned depth) {
  if (stopping) { errno = ECANCELED; return false; }
  const auto gone = [missing_ok] { return missing_ok && errno == ENOENT; };
  struct stat st;
  if (lstat(path.c_str(), &st) != 0) return gone();
  if (!S_ISDIR(st.st_mode)) return unlink(path.c_str()) == 0 || gone();
  if (depth == 64) { errno = ELOOP; return false; }
  std::vector<std::string> names;
  const auto collect = [](const char* name, void* user) { static_cast<std::vector<std::string>*>(user)->emplace_back(name); };
  if (!host::read_dir(path.c_str(), collect, &names)) return gone();
  for (const auto& name : names) if (!tree(path + "/" + name, missing_ok, depth + 1)) return false;
  return rmdir(path.c_str()) == 0 || gone();
}

Job* find(std::uint32_t id) {
  const auto job = std::find_if(jobs.begin(), jobs.end(), [id](const Job& item) { return item.snapshot.id == id; });
  return job == jobs.end() ? nullptr : &*job;
}

void run() {
  name_thread("fs-remove");
  std::unique_lock lock(guard);
  for (;;) {
    const auto queued = [] { return std::find_if(jobs.begin(), jobs.end(), [](const Job& job) { return job.snapshot.state == "queued"; }); };
    wake.wait(lock, [&] { return stopping || queued() != jobs.end(); });
    if (stopping) return;
    const auto job = queued();
    job->snapshot.state = "removing";
    const auto id = job->snapshot.id;
    const auto path = job->path;
    lock.unlock();
    const bool ok = tree(path, true, 0);
    const int error = errno;
    lock.lock();
    Snapshot& snapshot = find(id)->snapshot;
    snapshot.state = ok ? "completed" : error == ECANCELED ? "cancelled" : "failed";
    if (!ok) snapshot.error = std::strerror(error);
  }
}
}

bool remove_tree(const std::string& path, bool missing_ok) { return tree(path, missing_ok, 0); }

std::uint32_t start(std::string path, std::string& error) {
  std::lock_guard lock(guard);
  if (!started && !(started = worker.start(run, 256 * 1024))) {
    error = "Cannot start the removal thread.";
    return 0;
  }
  Job& job = jobs.emplace_back();
  job.snapshot.id = next_id++;
  job.path = std::move(path);
  wake.notify_one();
  return job.snapshot.id;
}

std::vector<Snapshot> poll() {
  std::lock_guard lock(guard);
  std::vector<Snapshot> out;
  for (const auto& job : jobs) out.push_back(job.snapshot);
  std::erase_if(jobs, [](const Job& job) { return terminal(job.snapshot.state); });
  return out;
}

void stop() {
  { std::lock_guard lock(guard); stopping = true; }
  wake.notify_all();
  worker.join();
  std::lock_guard lock(guard);
  for (auto& job : jobs) if (!terminal(job.snapshot.state)) { job.snapshot.state = "cancelled"; job.snapshot.error = std::strerror(ECANCELED); }
  started = false;
  stopping = false;
}
}
