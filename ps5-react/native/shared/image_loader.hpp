// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Remote images: a worker fetches (libcurl) and a few decode (stb_image) off the render thread and
// resample to the size the image is drawn at. The render thread only submits, releases and polls.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace images {
// How a decoded image is fitted to the requested box, as the engine's resizeMode draws it.
enum class Fit : std::uint8_t { cover, contain, stretch, none };

// Decoded pixels that stay cached while unused, least recently used evicted first, by default. Images
// in use are never evicted, so a screen that shows more than this exceeds it. set_cache_bytes() sizes
// it for the host's heap.
constexpr std::size_t kCacheBytes = 64 * 1024 * 1024;
constexpr std::size_t kCacheEntries = 256;
// Larger responses fail. Store covers and 1920x1080 screenshots measure under 2 MiB.
constexpr std::size_t kMaxEncodedBytes = 4 * 1024 * 1024;
// Encoded bytes kept by URL, so the same image drawn at another size decodes without a fetch.
constexpr std::size_t kEncodedCacheBytes = 4 * 1024 * 1024;
// Encoded responses kept on disk between launches; entries older than a week are fetched again.
constexpr std::size_t kDiskCacheBytes = 256 * 1024 * 1024;
// While memory is held (see hold_memory) or the heap is above kPressurePercent of its size, unused
// decoded images are kept to kLowCacheBytes and encoded bytes to kLowEncodedBytes; a decode that would
// take the heap past kCeilingPercent is refused and tried again later. Images re-decode when shown.
constexpr std::size_t kLowCacheBytes = 16 * 1024 * 1024;
constexpr std::size_t kLowEncodedBytes = 1024 * 1024;
constexpr std::size_t kPressurePercent = 70, kCeilingPercent = 85;
// A decode holds up to about 8 bytes per source pixel (PNG); decodes running together hold no more
// than one at this limit.
constexpr std::uint64_t kMaxSourcePixels = 5000000;

struct Result {
  std::uint32_t id = 0;
  bool ready = false, failed = false;
  int width = 0, height = 0;
  bool opaque = true;
  const std::uint32_t* pixels = nullptr; // premultiplied ARGB8888; valid until evicted
  std::int32_t color = -1;               // most prominent vivid colour as 0xRRGGBB, -1 when none
  std::string error;
};

// start() requires a started network::start(); `cache_directory` (created when missing, empty to
// disable) holds the disk cache. stop() calls `evict` for every image handed out by poll(), then
// joins the workers and frees every image.
bool start(const std::string& cache_directory);
void stop(void (*evict)(std::uint32_t id));
// Render thread. Returns the id (0 with `error` on invalid input); each load takes one reference,
// shared by every load of the same url, box and fit. `result` reports a finished entry at once.
// Prefetches are fetched and decoded after images an element draws.
std::uint32_t load(const std::string& url, int width, int height, Fit fit, bool prefetch, Result& result,
                   std::string& error);
// Drops one reference, taken by a load with the same `prefetch`. Unfinished work without references
// is cancelled; an image no element draws any more waits behind those on screen.
void release(std::uint32_t id, bool prefetch);
// Replaces the warm list: URLs fetched into the disk cache, in order, on a few connections while no
// load waits, skipping those cached and responses over 512 KiB. Nothing is decoded.
void warm(std::vector<std::string> urls);
// Finished loads since the last poll. Evicts unused images over budget first, calling `evict`
// before their pixels are freed.
std::vector<Result> poll(void (*evict)(std::uint32_t id));
// Turns a ready image the caller could not use into a failure, freeing its pixels.
void discard(std::uint32_t id, const std::string& reason);
// Evicts the least recently used cached image nothing holds, other than `keep`, calling `evict` before
// its pixels are freed (render thread): room for `keep` in an engine registry that is full. False when
// every cached image is held.
bool evict_unused(std::uint32_t keep, void (*evict)(std::uint32_t id));
// The engine registry's slots in use after the host's last poll, for stats().
void note_registry(unsigned used);
// Heap the loader holds now: encoded bytes (transfers, decode queue, encoded cache) and decoded pixels.
struct Memory { std::size_t encoded = 0, decoded = 0; };
Memory memory();
// Holds back requests to the network for `ms` from now (render thread), while a list scrolls past
// images it would only fetch to drop: loads from the caches carry on, the rest start once it ends.
void defer(int ms);
// Replaces the decoded cache budget (render thread, any time).
void set_cache_bytes(std::size_t bytes);
// Holds memory for a job that needs the heap (an extraction), or ends one hold (any thread). Holds
// nest; the next poll() trims to the low budgets and the normal ones return when the last ends.
void hold_memory(bool hold);
// The heap the loader runs in, read on the render, fetch and decode threads (size 0: unknown).
struct Heap { std::size_t live = 0, size = 0; };
void set_heap_probe(Heap (*probe)());
// Counters since start() and the busiest origins, one line for the host's periodic memory log:
// how loads were served (decoded cache, encoded cache, disk, network), decodes, cancellations,
// retries and failures, and per origin its requests, failures, average latency and bytes.
std::string stats();
} // namespace images
