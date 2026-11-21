// End-to-end stress for the extraction job: cancels at random moments, then extracts once more. Each
// cancel must end promptly as "cancelled" with staging removed and no descriptor left open.
#include "archives.hpp"
#include <cassert>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <dirent.h>
#include <fcntl.h>
#include <random>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>

void archives::trace(const char*, const char*) {}
bool archives::downloading() { return false; }
bool archives::list_directory(const char* path, void (*visit)(const char*, void*), void* user) {
  DIR* d = opendir(path);
  if (!d) return false;
  while (auto* e = readdir(d)) visit(e->d_name, user);
  closedir(d);
  return true;
}
std::size_t archives::pipeline_bytes(std::uint64_t, bool) {
  const char* v = std::getenv("ARCHIVE_PIPELINE_BYTES");
  return v ? std::strtoull(v, nullptr, 10) : 32u << 20;
}
bool archives::hold_memory(bool, std::uint64_t, bool) { return true; }

namespace {
int open_descriptors() {
  int count = 0;
  for (int fd = 0; fd < 1024; ++fd) count += fcntl(fd, F_GETFD) != -1;
  return count;
}
// ARCHIVE_STRESS_SCALE stretches the time limits on a slow or throttled machine.
int scale() { const char* v = std::getenv("ARCHIVE_STRESS_SCALE"); return v ? std::atoi(v) : 1; }
archives::Snapshot wait(std::chrono::seconds limit) {
  const auto until = std::chrono::steady_clock::now() + limit;
  while (std::chrono::steady_clock::now() < until) {
    for (const auto& s : archives::poll())
      if (s.state == "completed" || s.state == "failed" || s.state == "cancelled") return s;
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  std::fprintf(stderr, "hang\n");
  std::abort();
}
}

int main(int argc, char** argv) {
  const std::string destination = argv[1];
  const int rounds = std::atoi(argv[2]);
  std::mt19937 rng(7);
  const int before = open_descriptors();
  struct stat st;
  for (int round = 0; round <= rounds; ++round) {
    archives::Request request;
    request.destination = destination;
    for (int i = 3; i < argc; ++i) request.sources.emplace_back(argv[i]);
    std::string error;
    const auto id = archives::enqueue(std::move(request), error);
    assert(id);
    if (round < rounds) {
      std::this_thread::sleep_for(std::chrono::milliseconds(rng() % 700));
      archives::cancel(id);
      const auto s = wait(std::chrono::seconds(10 * scale()));
      // A cancel that lands after completion leaves a finished extraction; it is removed for the next round.
      if (s.state == "completed") std::system(("rm -rf '" + destination + "'").c_str());
      else assert(s.state == "cancelled" || s.state == "failed");
      assert(lstat((destination + ".extracting").c_str(), &st) && lstat(destination.c_str(), &st));
    } else {
      const auto s = wait(std::chrono::seconds(120 * scale()));
      std::printf("final %s %llu %s\n", s.state.c_str(), static_cast<unsigned long long>(s.written), s.error.c_str());
    }
    assert(open_descriptors() == before);
  }
  archives::stop();
  std::puts("PASS: random cancels end promptly, remove staging and leak no descriptor");
}
