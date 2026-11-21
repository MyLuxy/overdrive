// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Drives native/shared/image_loader.cpp for tools/test_images.py; one scenario per run.
#include "image_loader.hpp"
#include "network.hpp"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>
#include <thread>
#include <vector>
#include <malloc/malloc.h>

// The loader's own allocations (bodies, stb_image buffers, pixels) bind to these, not libc's, so
// IMAGE_FAIL_LARGE_MS can refuse every allocation of 128 KiB or more for that many milliseconds
// (-1: always), as an exhausted console heap does. libcurl and libc++ keep the system allocator.
namespace {
std::atomic<long long> fail_until_ms{0};
long long now_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();
}
bool refused(std::size_t size) {
  const long long until = fail_until_ms.load();
  return size >= 128 * 1024 && (until < 0 || (until > 0 && now_ms() < until));
}
} // namespace
extern "C" void* malloc(std::size_t size) { return refused(size) ? nullptr : malloc_zone_malloc(malloc_default_zone(), size); }
extern "C" void* calloc(std::size_t count, std::size_t size) {
  return refused(count * size) ? nullptr : malloc_zone_calloc(malloc_default_zone(), count, size);
}
extern "C" void* realloc(void* address, std::size_t size) {
  return refused(size) ? nullptr : malloc_zone_realloc(malloc_default_zone(), address, size);
}

namespace {
std::vector<std::uint32_t> evicted;
std::atomic<std::size_t> heap_live{0};

std::vector<images::Result> wait(std::size_t count, int timeout_ms) {
  std::vector<images::Result> out;
  const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
  while (out.size() < count && std::chrono::steady_clock::now() < until) {
    for (auto& r : images::poll([](std::uint32_t id) { evicted.push_back(id); })) out.push_back(r);
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  return out;
}

void print(const images::Result& r) {
  std::printf("{\"id\":%u,\"ready\":%s,\"failed\":%s,\"width\":%d,\"height\":%d,\"opaque\":%s,\"color\":%d,\"error\":\"%s\"}\n",
              r.id, r.ready ? "true" : "false", r.failed ? "true" : "false", r.width, r.height,
              r.opaque ? "true" : "false", r.color, r.error.c_str());
}

std::uint32_t load(const std::string& url, int w, int h, int fit, images::Result& result) {
  std::string error;
  const auto id = images::load(url, w, h, static_cast<images::Fit>(fit), false, result, error);
  if (!id) { std::cerr << error << '\n'; std::exit(4); }
  return id;
}
} // namespace

int main(int argc, char** argv) {
  if (argc < 3 || !network::start() || !images::start(std::getenv("IMAGE_CACHE") ? std::getenv("IMAGE_CACHE") : "")) return 3;
  const std::string mode = argv[1], url = argv[2];
  if (const char* fail = std::getenv("IMAGE_FAIL_LARGE_MS")) {
    const long long ms = std::atoll(fail);
    fail_until_ms = ms < 0 ? -1 : now_ms() + ms;
  }
  images::Result now;
  if (mode == "load" && argc >= 7) {
    load(url, std::atoi(argv[3]), std::atoi(argv[4]), std::atoi(argv[5]), now);
    const auto results = wait(1, 10000);
    if (results.empty()) return 5;
    print(results[0]);
    if (results[0].ready) {
      FILE* file = std::fopen(argv[6], "wb");
      std::fwrite(results[0].pixels, 4, static_cast<std::size_t>(results[0].width) * results[0].height, file);
      std::fclose(file);
    }
  } else if (mode == "shared") {
    // Two references to one box share an entry, another box shares the fetch, and a finished
    // entry reports at once.
    images::Result second, third, other;
    const auto a = load(url, 64, 64, 0, now), b = load(url, 64, 64, 0, second);
    load(url, 32, 32, 0, other);
    if (a != b || wait(2, 10000).size() != 2) return 6;
    const auto c = load(url, 64, 64, 0, third);
    std::printf("{\"same\":%s,\"immediate\":%s}\n", c == a ? "true" : "false", third.ready ? "true" : "false");
  } else if (mode == "cancel") {
    // A release before completion cancels the transfer and never reports.
    const auto id = load(url, 64, 64, 0, now);
    std::this_thread::sleep_for(std::chrono::milliseconds(200));
    images::release(id, false);
    std::printf("{\"reported\":%zu}\n", wait(1, 1500).size());
  } else if (mode == "flyby") {
    // An image released within its dwell, as a card a held key scrolls past, is never requested.
    const auto id = load(url, 64, 64, 0, now);
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    images::release(id, false);
    std::printf("{\"reported\":%zu}\n", wait(1, 400).size());
  } else if (mode == "evict") {
    // Unused images over budget are evicted oldest first; images in use never are.
    images::set_cache_bytes(24 * 1024 * 1024);
    const int count = std::atoi(argv[3]);
    std::vector<std::uint32_t> ids;
    for (int i = 0; i < count; ++i) ids.push_back(load(url + "?n=" + std::to_string(i), 1024, 1024, 2, now));
    const auto results = wait(static_cast<std::size_t>(count), 30000);
    for (std::size_t i = 1; i < ids.size(); ++i) images::release(ids[i], false);
    wait(1, 50);
    std::printf("{\"loaded\":%zu,\"evicted\":%zu,\"first\":%u,\"kept\":%s}\n", results.size(), evicted.size(),
                evicted.empty() ? 0 : evicted.front(),
                std::find(evicted.begin(), evicted.end(), ids[0]) == evicted.end() ? "true" : "false");
  } else if (mode == "squeeze") {
    // 12 images of 4 MiB fit the 64 MiB budget. A memory hold trims the unused ones to 16 MiB and its
    // end restores the budget; then heap pressure (75% of a 100 MiB probe) trims the same way, a calm
    // heap does not, and a decode that would pass 85% is refused.
    std::vector<std::uint32_t> ids;
    for (int i = 0; i < 12; ++i) ids.push_back(load(url + "?n=" + std::to_string(i), 1024, 1024, 2, now));
    const auto loaded = wait(12, 30000).size();
    for (std::size_t i = 1; i < ids.size(); ++i) images::release(ids[i], false);
    wait(1, 50);
    const auto calm = evicted.size();
    images::hold_memory(true);
    wait(1, 50);
    const auto held = evicted.size();
    const auto held_decoded = images::memory().decoded >> 20;
    images::hold_memory(false);
    for (int i = 0; i < 8; ++i) ids.push_back(load(url + "?n=" + std::to_string(i + 1), 1024, 1024, 2, now));
    const auto reloaded = wait(8, 30000).size();
    for (std::size_t i = 12; i < ids.size(); ++i) images::release(ids[i], false);
    wait(1, 50);
    const auto restored = evicted.size() - held;
    images::set_heap_probe([] { return images::Heap{heap_live.load(), 100 * 1024 * 1024}; });
    heap_live = 75 * 1024 * 1024;
    wait(1, 50);
    const auto pressed = evicted.size() - held - restored;
    heap_live = 50 * 1024 * 1024;
    load(url + "?n=calm", 1024, 1024, 2, now);
    const auto relieved = wait(1, 10000);
    heap_live = 84 * 1024 * 1024;
    load(url + "?n=full", 1024, 1024, 2, now);
    const auto full = wait(1, 10000);
    std::printf("{\"loaded\":%zu,\"calm\":%zu,\"held\":%zu,\"held_mib\":%zu,\"reloaded\":%zu,\"restored\":%zu,"
                "\"pressed\":%zu,\"relieved\":%s,\"full\":\"%s\"}\n",
                loaded, calm, held, held_decoded, reloaded, restored, pressed,
                !relieved.empty() && relieved[0].ready ? "true" : "false", full.empty() ? "" : full[0].error.c_str());
  } else {
    return 2;
  }
  images::stop([](std::uint32_t) {});
  network::stop();
  return 0;
}
