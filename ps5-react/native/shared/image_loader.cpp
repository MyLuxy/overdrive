// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "image_loader.hpp"
#include "thread_name.hpp"
#include "network.hpp"
#ifdef PROSPERO
#include "app_config.hpp"
#endif
#if !defined(PROSPERO) || PS5_REACT_NETWORKING
#include <curl/curl.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cerrno>
#include <cstring>
#include <ctime>
#include <sys/time.h>
#include <deque>
#include <dirent.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#include <map>
#include <memory>
#include <mutex>
#include <pthread.h>
#include <unordered_map>

// Several threads decode at once. stb_image's failure strings are not thread-safe (a global, or a
// thread_local the title has never used, plus a static buffer it rewrites for unknown PNG chunks), so
// they are compiled out, and running out of heap is told apart by counting failed allocations
// instead. Its other globals are only read.
namespace {
// The hooks cannot tell which decode allocates: one that fails while this moved is treated as out of
// memory and retried, which under heap pressure is right for any of them.
std::atomic<unsigned> stb_failed_allocations{0};
void* stb_malloc(std::size_t size) {
  void* p = std::malloc(size);
  if (!p) ++stb_failed_allocations;
  return p;
}
void* stb_realloc(void* address, std::size_t size) {
  void* p = std::realloc(address, size);
  if (!p) ++stb_failed_allocations;
  return p;
}
} // namespace
#define STBI_MALLOC stb_malloc
#define STBI_REALLOC stb_realloc
#define STBI_FREE std::free
#define STBI_NO_THREAD_LOCALS
#define STBI_NO_FAILURE_STRINGS
#define STBI_NO_STDIO
#define STBI_NO_HDR
#define STBI_NO_LINEAR
#define STBI_ONLY_JPEG
#define STBI_ONLY_PNG
#define STB_IMAGE_STATIC
#define STB_IMAGE_IMPLEMENTATION
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-function"
#pragma clang diagnostic ignored "-Wsign-compare"
#pragma clang diagnostic ignored "-Wunused-parameter"
#pragma clang diagnostic ignored "-Wmissing-field-initializers"
#pragma clang diagnostic ignored "-Wimplicit-fallthrough"
#include "stb_image.h"
#pragma clang diagnostic pop

namespace images {
namespace {
using Clock = std::chrono::steady_clock;
// Five attempts, 0.5 + 1 + 2 + 4 s apart: a console that briefly cannot connect (Wi-Fi waking, a
// burst of handshakes refused) recovers instead of failing every image on screen at once.
constexpr unsigned kConnections = 32, kAttempts = 5;
// IP literals, so the DoH request itself needs no DNS. A network that blocks the first gets the second.
constexpr std::array<const char*, 2> kDohURLs = {"https://1.1.1.1/dns-query", "https://8.8.8.8/dns-query"};
constexpr std::size_t kResolver = kDohURLs.size();
// A decode that ran out of heap is tried again 1 and 2 s later, from the cached bytes.
constexpr unsigned kDecodeAttempts = 3;
// A screen of evicted covers reloads from the disk cache at 8-10 ms of decode each on the PS5. Its
// title sees 16 CPUs and a commit raster takes 9 (eight render workers); four decoders fit beside
// them. A fixed count keeps the preview's behaviour the console's.
constexpr unsigned kDecoders = 4;
// A decode holds up to about 8 bytes per source pixel: stb_image's buffers (4.5 for JPEG, 8 for PNG),
// then its output and the resampled pixels. Decodes running together stay within what one image at
// the source limit took when a single thread decoded; one always runs, whatever it holds.
constexpr std::size_t kDecodeBytesPerPixel = 8;
constexpr std::size_t kDecodeBudget = kMaxSourcePixels * kDecodeBytesPerPixel;
// While a download runs it holds up to 64 connections and their TLS state; images take fewer.
constexpr unsigned kDownloadConnections = 8;
// Per origin, on reused keep-alive connections (the console's curl has no HTTP/2): a grid of 30 Sony
// covers opened 30 TLS handshakes to one host at once.
constexpr long kHostConnections = 8;
// An element's image goes to the network only once it has been wanted this long, like a browser's
// lazy loading: a held key scrolls a card past in about 50 ms and it is released before it fetches.
// Images in the decoded, encoded or disk cache skip the wait.
constexpr auto kDwell = std::chrono::milliseconds(120);
std::atomic<std::size_t> cache_bytes{kCacheBytes};
std::atomic<int> holds{0};
std::atomic<Heap (*)()> heap_probe{nullptr};
Heap heap() {
  const auto probe = heap_probe.load();
  return probe ? probe() : Heap{};
}
bool low_memory() {
  const Heap h = heap();
  return holds > 0 || (h.size && h.live > h.size / 100 * kPressurePercent);
}
std::atomic<Clock::rep> deferred_until{0};
// New fetches wait while encoded bytes held anywhere (transfers, the decode queue, the encoded
// cache) exceed this; transfers in flight still finish. Responses are rarely over 2 MiB.
constexpr std::size_t kEncodedBudget = kEncodedCacheBytes + 12 * 1024 * 1024;
constexpr std::size_t kMinBodyCapacity = 64 * 1024;
std::atomic<std::size_t> encoded_bytes{0}, decoded_bytes{0};

// Encoded bytes in one malloc'd block: running out of heap fails one load (and retries it) instead
// of aborting the title the way a throwing std::string allocation does without exceptions.
struct Bytes {
  Bytes() = default;
  Bytes(Bytes&& other) noexcept { *this = std::move(other); }
  Bytes& operator=(Bytes&& other) noexcept {
    clear();
    std::swap(data, other.data); std::swap(size, other.size); std::swap(capacity, other.capacity);
    return *this;
  }
  ~Bytes() { clear(); }
  bool reserve(std::size_t want) {
    if (want <= capacity) return true;
    void* grown = std::realloc(data, want);
    if (!grown) return false;
    encoded_bytes += want - capacity;
    data = static_cast<char*>(grown); capacity = want;
    return true;
  }
  void clear() {
    std::free(data);
    encoded_bytes -= capacity;
    data = nullptr; size = capacity = 0;
  }
  char* data = nullptr;
  std::size_t size = 0, capacity = 0;
};
using Body = std::shared_ptr<const Bytes>;

// Telemetry for the host's memory log. Counters are atomics; origins are guarded by their mutex.
struct Counters {
  std::atomic<std::uint64_t> loads{0}, decoded_hits{0}, encoded_hits{0}, disk_hits{0}, fetches{0}, decodes{0},
    decode_us{0}, cancelled{0}, aborted{0}, retries{0}, failed{0}, shown{0}, shown_ms{0}, shown_max_ms{0};
  // After each poll: decoded images in the cache, those an element or prefetch still holds, and the
  // engine registry's slots in use (images published from the cache plus the app's baked ones).
  std::atomic<std::uint64_t> cached{0}, pinned{0}, registry{0};
} counters;
// `last`: the latest failure's reason, so the stats line says why an origin fails.
struct Origin { std::string host, last; std::uint64_t requests = 0, failures = 0, ms = 0, bytes = 0; };
std::mutex origins_mutex;
std::vector<Origin> origins;

std::string host_of(const std::string& url) {
  const std::size_t start = url.find("://");
  if (start == std::string::npos) return url;
  const std::size_t end = url.find_first_of("/?#", start + 3);
  return url.substr(start + 3, end == std::string::npos ? std::string::npos : end - start - 3);
}

void count_request(const std::string& url, const std::string& failure, std::uint64_t ms, std::size_t bytes) {
  std::lock_guard lock(origins_mutex);
  const std::string host = host_of(url);
  auto it = std::find_if(origins.begin(), origins.end(), [&](const Origin& o) { return o.host == host; });
  if (it == origins.end()) { origins.push_back({host, {}}); it = origins.end() - 1; }
  ++it->requests; it->ms += ms; it->bytes += bytes;
  if (!failure.empty()) { ++it->failures; it->last = failure; }
}
constexpr std::uint64_t kDrawn = std::uint64_t{1} << 62;
// Warming fills the disk cache in the background: a few connections, only while no load waits, and
// only files small enough that many fit.
constexpr unsigned kWarmConnections = 4;
constexpr std::size_t kWarmMaxBytes = 512 * 1024;

struct Entry {
  ~Entry() { free_pixels(); }
  void free_pixels() {
    if (pixels) decoded_bytes -= static_cast<std::size_t>(width) * height * 4;
    std::free(pixels);
    pixels = nullptr;
  }
  std::uint32_t id = 0;
  std::string key, url;
  int box_width = 0, box_height = 0;
  Fit fit = Fit::cover;
  std::atomic<bool> cancelled{false};
  // Fetch order, highest first: kDrawn plus the request sequence while an element draws it (the image
  // that came on screen last is the one looked at), else the sequence of its latest prefetch. A held
  // key scrolls past hundreds of covers; serving them oldest first left the ones on screen waiting.
  std::atomic<std::uint64_t> rank{0};
  // Written by the workers before the entry is handed to poll() under the service mutex.
  Body body;
  std::size_t decode_cost = 0;
  std::uint32_t* pixels = nullptr;
  int width = 0, height = 0;
  bool opaque = true;
  std::int32_t color = -1;
  std::string error;
  unsigned attempts = 0;
  Clock::time_point retry_at{}, dwell_until{};
  // Render thread only.
  Clock::time_point requested{};
  unsigned refs = 0, drawers = 0;
  std::uint64_t used = 0, prefetched = 0;
  bool reported = false;
};
using EntryPtr = std::shared_ptr<Entry>;

// One request per URL: loads of the same URL for other boxes join it and decode its bytes.
struct Transfer {
  CURL* curl = nullptr;
  std::string url;
  Bytes body;
  std::vector<EntryPtr> entries;
  bool overflow = false, out_of_memory = false;
  // Started by warm(): written to the disk cache; loads of its URL join it.
  bool warm = false;
  Clock::time_point started{};
  // How it reached its host: the console's resolver (kResolver), kDohURLs[doh], or the address `pin`.
  std::size_t doh = 0;
  const curl_slist* pin = nullptr;
};

// Recently fetched encoded bytes by URL, so another box for the same image decodes without a fetch.
struct Encoded {
  std::string url;
  Body body;
  std::uint64_t used = 0;
};

std::string message(const Entry& entry, const std::string& reason) {
  return "Image.load " + entry.url + ": " + reason;
}

// Box filter over a source span: output i averages source [i*scale, (i+1)*scale), partial
// pixels weighted by coverage. The scale is at least 1; images are never enlarged here.
struct Taps {
  std::vector<int> first, count;
  std::vector<float> weights;
  Taps(int offset, int source, int target) {
    const double scale = static_cast<double>(source) / target;
    for (int i = 0; i < target; ++i) {
      const double a = i * scale, b = std::min<double>(source, (i + 1) * scale);
      const int begin = static_cast<int>(a), end = std::min(source, static_cast<int>(std::ceil(b)));
      first.push_back(offset + begin);
      count.push_back(std::max(end - begin, 1));
      for (int j = begin; j < begin + count.back(); ++j)
        weights.push_back(static_cast<float>((std::min<double>(b, j + 1) - std::max<double>(a, j)) / scale));
    }
  }
};

struct Plan { int x = 0, y = 0, width = 0, height = 0, out_width = 0, out_height = 0; };

// The source crop and output size for a box: cover crops to the box's aspect ratio, contain keeps
// the whole image; both shrink to the box but never enlarge, leaving upscaling to the engine.
Plan plan(int width, int height, int box_width, int box_height, Fit fit) {
  Plan p{0, 0, width, height, width, height};
  if (fit == Fit::none) return p;
  if (fit == Fit::cover) {
    if (static_cast<std::int64_t>(width) * box_height > static_cast<std::int64_t>(height) * box_width)
      p.width = std::max(1, static_cast<int>(std::lround(static_cast<double>(height) * box_width / box_height)));
    else
      p.height = std::max(1, static_cast<int>(std::lround(static_cast<double>(width) * box_height / box_width)));
    p.x = (width - p.width) / 2; p.y = (height - p.height) / 2;
    p.out_width = p.width; p.out_height = p.height;
    if (p.width > box_width) { p.out_width = box_width; p.out_height = box_height; }
  } else if (fit == Fit::contain) {
    const double scale = std::min({1.0, static_cast<double>(box_width) / width, static_cast<double>(box_height) / height});
    p.out_width = std::max(1, static_cast<int>(std::lround(width * scale)));
    p.out_height = std::max(1, static_cast<int>(std::lround(height * scale)));
  } else {
    p.out_width = std::min(width, box_width); p.out_height = std::min(height, box_height);
  }
  return p;
}

// Resamples the planned crop of 8-bit RGB or RGBA rows into premultiplied ARGB8888.
bool resample(const unsigned char* source, int width, int channels, const Plan& p, Entry& entry) {
  const std::size_t count = static_cast<std::size_t>(p.out_width) * p.out_height;
  auto* out = static_cast<std::uint32_t*>(std::malloc(count * sizeof(std::uint32_t)));
  if (!out) return false;
  const Taps columns(p.x, p.width, p.out_width), rows(p.y, p.height, p.out_height);
  std::vector<std::size_t> column_weight(p.out_width);
  for (int x = 0, w = 0; x < p.out_width; w += columns.count[x], ++x) column_weight[x] = static_cast<std::size_t>(w);
  std::vector<float> line(static_cast<std::size_t>(p.out_width) * 4), sum(line.size());
  bool opaque = true;
  for (int y = 0, row_weight = 0; y < p.out_height; row_weight += rows.count[y], ++y) {
    std::fill(sum.begin(), sum.end(), 0.0f);
    for (int k = 0; k < rows.count[y]; ++k) {
      const float wy = rows.weights[static_cast<std::size_t>(row_weight + k)];
      const unsigned char* row = source + static_cast<std::size_t>(rows.first[y] + k) * width * channels;
      for (int x = 0; x < p.out_width; ++x) {
        float r = 0, g = 0, b = 0, a = 0;
        const float* weight = &columns.weights[column_weight[x]];
        const unsigned char* px = row + static_cast<std::size_t>(columns.first[x]) * channels;
        for (int i = 0; i < columns.count[x]; ++i, px += channels) {
          const float alpha = channels == 4 ? px[3] : 255.0f, w = weight[i] * alpha / 255.0f;
          r += w * px[0]; g += w * px[1]; b += w * px[2]; a += weight[i] * alpha;
        }
        float* s = &sum[static_cast<std::size_t>(x) * 4];
        s[0] += wy * a; s[1] += wy * r; s[2] += wy * g; s[3] += wy * b;
      }
    }
    std::uint32_t* target = out + static_cast<std::size_t>(y) * p.out_width;
    for (int x = 0; x < p.out_width; ++x) {
      const float* s = &sum[static_cast<std::size_t>(x) * 4];
      const auto a = static_cast<std::uint32_t>(std::clamp(std::lround(s[0]), 0L, 255L));
      const auto channel = [&](float value) { return std::min(static_cast<std::uint32_t>(std::clamp(std::lround(value), 0L, 255L)), a); };
      opaque = opaque && a == 255;
      target[x] = a << 24 | channel(s[1]) << 16 | channel(s[2]) << 8 | channel(s[3]);
    }
  }
  entry.pixels = out; entry.width = p.out_width; entry.height = p.out_height; entry.opaque = opaque;
  decoded_bytes += count * sizeof(std::uint32_t);
  return true;
}

// The most prominent saturated hue, raised to full brightness and to at least 85% saturation: what a
// light bar or accent can show of the art (an LED shows a pale tint as a washed-out colour). -1 when
// the art has no vivid colour. Samples at most about 16k pixels.
std::int32_t vivid_color(const std::uint32_t* pixels, int width, int height) {
  constexpr int bins = 24;
  float weight[bins] = {}, red[bins] = {}, green[bins] = {}, blue[bins] = {};
  const int count = width * height, step = std::max(1, count / 16384);
  int sampled = 0;
  for (int i = 0; i < count; i += step) {
    ++sampled;
    const std::uint32_t pixel = pixels[i];
    const float alpha = static_cast<float>(pixel >> 24);
    if (alpha < 128) continue;
    const float r = ((pixel >> 16) & 255) / alpha, g = ((pixel >> 8) & 255) / alpha, b = (pixel & 255) / alpha;
    const float high = std::max({r, g, b}), low = std::min({r, g, b}), range = high - low;
    if (high < 0.25f || range < 0.25f * high) continue;
    float hue = high == r ? (g - b) / range : high == g ? 2 + (b - r) / range : 4 + (r - g) / range;
    if (hue < 0) hue += 6;
    const int bin = std::min(bins - 1, static_cast<int>(hue / 6 * bins));
    weight[bin] += range;
    // Weighted by saturation, so the purest pixels of a hue set its colour rather than its pale edges.
    red[bin] += r * range; green[bin] += g * range; blue[bin] += b * range;
  }
  const int best = static_cast<int>(std::max_element(weight, weight + bins) - weight);
  if (weight[best] < 0.01f * sampled) return -1;
  const float peak = std::max({red[best], green[best], blue[best]});
  const float floor = std::min({red[best], green[best], blue[best]}), saturation = (peak - floor) / peak;
  // Scaling each channel's distance below the peak keeps the hue while raising the saturation.
  const float boost = std::max(1.0f, 0.85f / saturation);
  const auto channel = [&](float value) {
    return static_cast<std::int32_t>(std::lround(std::max(0.0f, peak - (peak - value) * boost) / peak * 255));
  };
  return channel(red[best]) << 16 | channel(green[best]) << 8 | channel(blue[best]);
}

// Returns false when the heap ran out, so the load can be tried again later.
bool decode(Entry& entry) {
  const auto* bytes = reinterpret_cast<const stbi_uc*>(entry.body->data);
  const int size = static_cast<int>(entry.body->size);
  int width = 0, height = 0, components = 0;
  const unsigned failed_allocations = stb_failed_allocations;
  const auto out_of_memory = [&] { return stb_failed_allocations != failed_allocations; };
  bool retry = false;
  if (!stbi_info_from_memory(bytes, size, &width, &height, &components)) {
    retry = out_of_memory();
    entry.error = message(entry, retry ? "out of memory to decode" : "not a decodable JPEG or PNG");
  } else if (static_cast<std::uint64_t>(width) * height > kMaxSourcePixels) {
    entry.error = message(entry, std::to_string(width) + "x" + std::to_string(height) +
                          " exceeds the 5-megapixel source limit");
  }
  if (!entry.error.empty()) { entry.body.reset(); return !retry; }
  const int channels = components == 2 || components == 4 ? 4 : 3;
  const Plan p = plan(width, height, entry.box_width, entry.box_height, entry.fit);
  const std::size_t need = static_cast<std::size_t>(width) * height * 8 + static_cast<std::size_t>(p.out_width) * p.out_height * 4;
  if (const Heap h = heap(); h.size && h.live + need > h.size / 100 * kCeilingPercent) {
    entry.body.reset();
    entry.error = message(entry, "out of memory to decode (heap near full)");
    return false;
  }
  stbi_uc* source = stbi_load_from_memory(bytes, size, &width, &height, &components, channels);
  entry.body.reset();
  if (!source) {
    retry = out_of_memory();
    entry.error = message(entry, retry ? "out of memory to decode" : "decode failed");
    return !retry;
  }
  const bool resampled = resample(source, width, channels, p, entry);
  ++counters.decodes;
  stbi_image_free(source);
  if (!resampled) { entry.error = message(entry, "out of memory for decoded pixels"); return false; }
  entry.color = vivid_color(entry.pixels, entry.width, entry.height);
  return true;
}

// Heap a decode of `body` holds at most, from its header; 0 when it fails before allocating.
std::size_t decode_cost(const Bytes& body) {
  int width = 0, height = 0, components = 0;
  if (!stbi_info_from_memory(reinterpret_cast<const stbi_uc*>(body.data), static_cast<int>(body.size), &width, &height,
                             &components)) return 0;
  const auto pixels = static_cast<std::uint64_t>(width) * height;
  return pixels > kMaxSourcePixels ? 0 : static_cast<std::size_t>(pixels) * kDecodeBytesPerPixel;
}

// Encoded responses kept on disk between launches, keyed by a hash of the URL. Each file holds a
// header (magic, fetch time, URL) and the body; the fetch thread alone touches the directory.
class DiskCache {
public:
  void open(const std::string& directory) {
    directory_ = directory;
    if (directory_.empty() || !make_directories(directory_)) { directory_.clear(); return; }
    files_.clear(); total_ = 0;
    if (DIR* dir = opendir(directory_.c_str())) {
      while (dirent* item = readdir(dir)) {
        struct stat info;
        if (item->d_name[0] == '.' || stat(path(item->d_name).c_str(), &info) != 0 || !S_ISREG(info.st_mode)) continue;
        files_.push_back({item->d_name, static_cast<std::size_t>(info.st_size), static_cast<std::int64_t>(info.st_mtime)});
        total_ += static_cast<std::size_t>(info.st_size);
      }
      closedir(dir);
    }
    trim();
  }

  bool has(const std::string& url) { return !directory_.empty() && find(key(url)); }

  // Null when missing, stale, corrupt or when the heap cannot hold it.
  Body read(const std::string& url) {
    if (directory_.empty()) return nullptr;
    const std::string name = key(url);
    File* file = find(name);
    if (!file) return nullptr;
    Header header{};
    const std::size_t start = sizeof header + url.size();
    if (file->size < start || file->size - start > kMaxEncodedBytes) { remove(name); return nullptr; }
    const int fd = ::open(path(name).c_str(), O_RDONLY);
    if (fd < 0) return nullptr;
    std::string stored(url.size(), '\0');
    const bool valid = ::read(fd, &header, sizeof header) == static_cast<ssize_t>(sizeof header) &&
      !std::memcmp(header.magic, kMagic, sizeof header.magic) && header.url_size == url.size() &&
      ::read(fd, stored.data(), stored.size()) == static_cast<ssize_t>(stored.size()) && stored == url &&
      std::time(nullptr) - header.fetched <= kMaxAgeSeconds;
    Bytes body;
    const std::size_t size = file->size - start;
    const bool held = valid && body.reserve(std::max<std::size_t>(size, 1));
    const bool whole = held && ::read(fd, body.data, size) == static_cast<ssize_t>(size);
    close(fd);
    if (valid && !held) return nullptr;
    if (!whole) { remove(name); return nullptr; }
    body.size = size;
    file->used = std::time(nullptr);
    utimes(path(name).c_str(), nullptr);
    return std::make_shared<const Bytes>(std::move(body));
  }

  void write(const std::string& url, const Bytes& body) {
    if (directory_.empty()) return;
    const std::string name = key(url), temporary = path(name + ".tmp");
    Header header{};
    std::memcpy(header.magic, kMagic, sizeof header.magic);
    header.fetched = std::time(nullptr);
    header.url_size = static_cast<std::uint32_t>(url.size());
    const int fd = ::open(temporary.c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (fd < 0) return;
    const bool ok = ::write(fd, &header, sizeof header) == static_cast<ssize_t>(sizeof header) &&
      ::write(fd, url.data(), url.size()) == static_cast<ssize_t>(url.size()) &&
      ::write(fd, body.data, body.size) == static_cast<ssize_t>(body.size);
    if (close(fd) != 0 || !ok || rename(temporary.c_str(), path(name).c_str()) != 0) { unlink(temporary.c_str()); return; }
    const std::size_t size = sizeof header + url.size() + body.size;
    if (File* old = find(name)) { total_ -= old->size; old->size = size; old->used = header.fetched; }
    else files_.push_back({name, size, header.fetched});
    total_ += size;
    trim();
  }

private:
  static constexpr char kMagic[8] = {'P', '5', 'R', 'I', 'M', 'G', '0', '1'};
  static constexpr std::int64_t kMaxAgeSeconds = 7 * 24 * 3600;
  struct Header { char magic[8]; std::int64_t fetched; std::uint32_t url_size, reserved; };
  struct File { std::string name; std::size_t size; std::int64_t used; };

  static std::string key(const std::string& url) {
    std::uint64_t hash = 14695981039346656037ULL;
    for (unsigned char c : url) hash = (hash ^ c) * 1099511628211ULL;
    char text[17];
    std::snprintf(text, sizeof text, "%016llx", static_cast<unsigned long long>(hash));
    return text;
  }
  static bool make_directories(const std::string& directory) {
    for (std::size_t at = 1; at != std::string::npos;) {
      at = directory.find('/', at + 1);
      const std::string part = directory.substr(0, at);
      if (mkdir(part.c_str(), 0700) != 0 && errno != EEXIST) return false;
    }
    return true;
  }
  std::string path(const std::string& name) const { return directory_ + "/" + name; }
  File* find(const std::string& name) {
    for (File& file : files_) if (file.name == name) return &file;
    return nullptr;
  }
  void remove(const std::string& name) {
    unlink(path(name).c_str());
    for (auto it = files_.begin(); it != files_.end(); ++it)
      if (it->name == name) { total_ -= it->size; files_.erase(it); return; }
  }
  // Least recently used files go first once the directory is over its cap.
  void trim() {
    while (total_ > kDiskCacheBytes && !files_.empty()) {
      auto oldest = std::min_element(files_.begin(), files_.end(), [](const File& a, const File& b) { return a.used < b.used; });
      remove(std::string(oldest->name));
    }
  }

  std::string directory_;
  std::vector<File> files_;
  std::size_t total_ = 0;
};

bool spawn(pthread_t& thread, void* (*body)(void*), void* data) {
  pthread_attr_t attributes;
  if (pthread_attr_init(&attributes) != 0) return false;
  const int stack = pthread_attr_setstacksize(&attributes, 1024 * 1024);
  const int result = stack ? stack : pthread_create(&thread, &attributes, body, data);
  pthread_attr_destroy(&attributes);
  return result == 0;
}

class Service {
public:
  bool start(const std::string& cache_directory) {
    if (running_) return true;
    cache_directory_ = cache_directory;
    stopping_ = false;
    multi_ = curl_multi_init();
    if (!multi_ || curl_multi_setopt(multi_, CURLMOPT_MAX_HOST_CONNECTIONS, kHostConnections) != CURLM_OK) {
      stop(nullptr);
      return false;
    }
    for (Transfer& t : transfers_) if (!(t.curl = curl_easy_init())) { stop(nullptr); return false; }
    fetch_started_ = spawn(fetch_thread_, +[](void* p)->void* { static_cast<Service*>(p)->fetch_loop(); return nullptr; }, this);
    while (fetch_started_ && decoders_ < kDecoders &&
           spawn(decode_threads_[decoders_], +[](void* p)->void* { static_cast<Service*>(p)->decode_loop(); return nullptr; }, this))
      ++decoders_;
    if (decoders_ < kDecoders) { stop(nullptr); return false; }
    running_ = true; return true;
  }

  void stop(void (*evict)(std::uint32_t)) {
    for (const auto& [id, entry] : by_id_) if (entry->reported && entry->pixels) evict(id);
    { std::lock_guard lock(mutex_); stopping_ = true; }
    wake_.notify_all();
    if (multi_) curl_multi_wakeup(multi_);
    if (fetch_started_) pthread_join(fetch_thread_, nullptr);
    for (unsigned i = 0; i < decoders_; ++i) pthread_join(decode_threads_[i], nullptr);
    fetch_started_ = false; decoders_ = 0;
    for (Transfer& t : transfers_) {
      if (t.curl) curl_easy_cleanup(t.curl);
      t = Transfer{};
    }
    if (multi_) curl_multi_cleanup(multi_);
    multi_ = nullptr;
    for (curl_slist* pin : doh_pins_) curl_slist_free_all(pin);
    doh_pins_.clear(); doh_hosts_.clear();
    fetches_.clear(); decodes_.clear(); finished_.clear(); by_key_.clear(); by_id_.clear(); encoded_.clear();
    running_ = false;
  }

  std::uint32_t load(const std::string& url, int width, int height, Fit fit, bool prefetch, Result& result, std::string& error) {
    if (!running_) { error = "Image.load " + url + ": networking is not available"; return 0; }
    const std::string key = std::to_string(static_cast<int>(fit)) + ' ' + std::to_string(width) + 'x' +
                            std::to_string(height) + ' ' + url;
    auto found = by_key_.find(key);
    EntryPtr entry;
    if (found != by_key_.end()) {
      entry = found->second;
      if (entry->reported && entry->pixels) ++counters.decoded_hits;
    } else {
      ++counters.loads;
      entry = std::make_shared<Entry>();
      entry->id = next_id_++; entry->key = key; entry->url = url;
      entry->box_width = width; entry->box_height = height; entry->fit = fit;
      entry->requested = Clock::now();
      if (!prefetch) entry->dwell_until = entry->requested + kDwell;
      by_key_.emplace(key, entry); by_id_.emplace(entry->id, entry);
      { std::lock_guard lock(mutex_); fetches_.push_back(entry); }
      curl_multi_wakeup(multi_);
    }
    ++entry->refs; entry->used = ++clock_;
    if (prefetch) entry->prefetched = clock_;
    else ++entry->drawers;
    entry->rank = entry->drawers ? kDrawn | clock_ : entry->prefetched;
    result = report(*entry);
    return entry->id;
  }

  void warm(std::vector<std::string> urls) {
    if (!running_) return;
    { std::lock_guard lock(mutex_); warms_.assign(std::make_move_iterator(urls.begin()), std::make_move_iterator(urls.end())); }
    curl_multi_wakeup(multi_);
  }

  void discard(std::uint32_t id, const std::string& reason) {
    const auto found = by_id_.find(id);
    if (found == by_id_.end()) return;
    Entry& entry = *found->second;
    entry.free_pixels();
    entry.error = message(entry, reason);
  }

  void release(std::uint32_t id, bool prefetch) {
    const auto found = by_id_.find(id);
    if (found == by_id_.end()) return;
    const EntryPtr entry = found->second;
    if (!prefetch && entry->drawers && !--entry->drawers) entry->rank = entry->prefetched;
    if (--entry->refs) return;
    entry->used = ++clock_;
    if (entry->reported && entry->pixels) { over_budget_ = true; return; }
    entry->cancelled = true;
    forget(*entry);
    if (!entry->reported) { ++counters.cancelled; curl_multi_wakeup(multi_); }
  }

  std::vector<Result> poll(void (*evict)(std::uint32_t)) {
    std::vector<EntryPtr> done;
    { std::lock_guard lock(mutex_); done.swap(finished_); }
    std::vector<Result> out;
    for (const EntryPtr& entry : done) {
      if (entry->cancelled) continue;
      entry->reported = true;
      if (entry->pixels && entry->drawers) {
        // Time from the first request to pixels, for images an element is waiting to draw.
        const auto ms = static_cast<std::uint64_t>(
          std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - entry->requested).count());
        ++counters.shown; counters.shown_ms += ms;
        if (ms > counters.shown_max_ms) counters.shown_max_ms = ms;
      }
      out.push_back(report(*entry));
      over_budget_ = over_budget_ || entry->pixels;
    }
    // A lower budget (memory held, heap pressure) trims at once; a higher one waits for new images.
    const std::size_t budget = low_memory() ? std::min(cache_bytes.load(), kLowCacheBytes) : cache_bytes.load();
    const bool lowered = budget < budget_;
    budget_ = budget;
    if (over_budget_ || lowered) trim(evict);
    std::uint64_t cached = 0, pinned = 0;
    for (const auto& [id, entry] : by_id_)
      if (entry->reported && entry->pixels) { ++cached; pinned += entry->refs ? 1 : 0; }
    counters.cached = cached;
    counters.pinned = pinned;
    return out;
  }

  bool evict_unused(std::uint32_t keep, void (*evict)(std::uint32_t)) {
    EntryPtr oldest;
    for (const auto& [id, entry] : by_id_)
      if (id != keep && entry->reported && entry->pixels && !entry->refs && (!oldest || entry->used < oldest->used)) oldest = entry;
    if (!oldest) return false;
    evict(oldest->id);
    forget(*oldest);
    return true;
  }

private:
  static std::size_t bytes(const Entry& entry) { return static_cast<std::size_t>(entry.width) * entry.height * 4; }

  static Result report(const Entry& entry) {
    Result r;
    r.id = entry.id;
    if (!entry.reported) return r;
    r.failed = !entry.pixels; r.ready = !r.failed; r.error = entry.error;
    r.width = entry.width; r.height = entry.height; r.opaque = entry.opaque; r.pixels = entry.pixels;
    r.color = entry.color;
    return r;
  }

  void forget(const Entry& entry) {
    by_key_.erase(entry.key);
    by_id_.erase(entry.id);
  }

  // Evicts unused images, least recently used first, until the cache fits its budget.
  void trim(void (*evict)(std::uint32_t)) {
    over_budget_ = false;
    std::size_t total = 0, decoded = 0;
    for (const auto& [id, entry] : by_id_) if (entry->reported && entry->pixels) { total += bytes(*entry); ++decoded; }
    while (total > budget_ || decoded > kCacheEntries) {
      EntryPtr oldest;
      for (const auto& [id, entry] : by_id_)
        if (entry->reported && entry->pixels && !entry->refs && (!oldest || entry->used < oldest->used)) oldest = entry;
      if (!oldest) return;
      evict(oldest->id);
      total -= bytes(*oldest); --decoded;
      forget(*oldest);
    }
  }

  void finish(const EntryPtr& entry) {
    { std::lock_guard lock(mutex_); finished_.push_back(entry); }
  }

  // Grows the body to the announced length at once when there is one, else by doubling, never
  // past the limit.
  static std::size_t body(char* data, std::size_t size, std::size_t count, void* opaque) {
    auto& t = *static_cast<Transfer*>(opaque);
    const std::size_t length = size * count;
    const std::size_t limit = t.entries.empty() ? kWarmMaxBytes : kMaxEncodedBytes;
    curl_off_t announced = -1;
    curl_easy_getinfo(t.curl, CURLINFO_CONTENT_LENGTH_DOWNLOAD_T, &announced);
    if (length > limit - t.body.size || (announced > 0 && static_cast<std::uint64_t>(announced) > limit)) {
      t.overflow = true;
      return 0;
    }
    const std::size_t needed = t.body.size + length;
    if (needed > t.body.capacity) {
      const std::size_t want = announced > 0 && static_cast<std::size_t>(announced) >= needed
        ? static_cast<std::size_t>(announced) : std::max({needed, kMinBodyCapacity, t.body.capacity * 2});
      if (!t.body.reserve(std::min(want, limit))) { t.out_of_memory = true; return 0; }
    }
    std::memcpy(t.body.data + t.body.size, data, length);
    t.body.size = needed;
    return length;
  }

  // Aborts a transfer once every load waiting for it has been released.
  static int progress(void* opaque, curl_off_t, curl_off_t, curl_off_t, curl_off_t) {
    const auto& t = *static_cast<Transfer*>(opaque);
    const auto& entries = t.entries;
    if (t.warm && entries.empty()) return 0;
    return std::all_of(entries.begin(), entries.end(), [](const EntryPtr& e) { return e->cancelled.load(); }) ? 1 : 0;
  }

  void fail(const EntryPtr& entry, const std::string& reason) {
    entry->error = message(*entry, reason);
    finish(entry);
  }

  void decode_later(std::vector<EntryPtr> entries, const Body& body) {
    const std::size_t cost = decode_cost(*body);
    {
      std::lock_guard lock(mutex_);
      for (EntryPtr& entry : entries) {
        if (entry->cancelled) continue;
        entry->body = body; entry->decode_cost = cost;
        decodes_.push_back(std::move(entry));
      }
    }
    wake_.notify_all();
  }

  bool held(const std::string& url) const {
    return std::any_of(encoded_.begin(), encoded_.end(), [&](const Encoded& e) { return e.url == url; });
  }

  Body cached(const std::string& url) {
    for (Encoded& e : encoded_) if (e.url == url) { e.used = ++fetch_clock_; return e.body; }
    return nullptr;
  }

  void remember(const std::string& url, Body body) {
    if (fit_encoded(body->size)) encoded_.push_back({url, std::move(body), ++fetch_clock_});
  }

  // Drops the least recently used encoded bytes until `extra` more fit the budget; false when they cannot.
  bool fit_encoded(std::size_t extra) {
    const std::size_t limit = low_memory() ? kLowEncodedBytes : kEncodedCacheBytes;
    std::size_t total = extra;
    for (const Encoded& e : encoded_) total += e.body->size;
    while (total > limit && !encoded_.empty()) {
      auto oldest = std::min_element(encoded_.begin(), encoded_.end(),
                                     [](const Encoded& a, const Encoded& b) { return a.used < b.used; });
      total -= oldest->body->size;
      encoded_.erase(oldest);
    }
    return total <= limit;
  }

  // Fetch thread: serves the entry from cached bytes, joins a transfer of its URL, or starts one.
  void start_fetch(EntryPtr entry, unsigned& active) {
    if (auto body = cached(entry->url)) { ++counters.encoded_hits; decode_later({std::move(entry)}, body); return; }
    if (auto body = disk_.read(entry->url)) {
      ++counters.disk_hits;
      remember(entry->url, body);
      decode_later({std::move(entry)}, body);
      return;
    }
    for (Transfer& t : transfers_) if (busy(t) && t.url == entry->url) { t.entries.push_back(std::move(entry)); return; }
    Transfer* t = begin(entry->url, false);
    // Counted as cached when picked, it found its bytes gone (stale, evicted) and every connection busy
    // (issue #56): it waits for the next round, where it counts as a network load.
    if (!t) {
      std::lock_guard lock(mutex_);
      fetches_.push_back(std::move(entry));
      return;
    }
    ++counters.fetches;
    t->entries.push_back(std::move(entry));
    if (!send(*t)) {
      for (const EntryPtr& e : t->entries) fail(e, "could not configure the HTTP transport");
      t->entries.clear();
      return;
    }
    ++active;
  }

  static bool busy(const Transfer& t) { return t.warm || !t.entries.empty(); }

  Transfer* begin(const std::string& url, bool warm) {
    Transfer* t = nullptr;
    for (Transfer& candidate : transfers_) if (!busy(candidate)) { t = &candidate; break; }
    if (!t) return nullptr;
    t->url = url; t->body.clear(); t->overflow = t->out_of_memory = false; t->warm = warm;
    return t;
  }

  // Fetch thread: the next warm URL not already cached or in flight, on a connection of its own.
  void start_warm(unsigned& active, unsigned& warming) {
    while (true) {
      std::string url;
      {
        std::lock_guard lock(mutex_);
        if (warms_.empty()) return;
        url = std::move(warms_.front());
        warms_.pop_front();
      }
      if (cached(url) || disk_.has(url) || std::any_of(transfers_.begin(), transfers_.end(),
          [&](const Transfer& t) { return busy(t) && t.url == url; })) continue;
      Transfer* t = begin(url, true);
      if (!t) {
        std::lock_guard lock(mutex_);
        warms_.push_front(std::move(url));
        return;
      }
      if (!send(*t)) { t->warm = false; return; }
      ++active; ++warming;
      return;
    }
  }

  bool send(Transfer& transfer) {
    Transfer* t = &transfer;
    curl_easy_reset(t->curl);
    bool ok = network::configure_transport(t->curl, t->url, true);
    const auto set = [&](CURLoption option, auto value) { ok = ok && curl_easy_setopt(t->curl, option, value) == CURLE_OK; };
    set(CURLOPT_TIMEOUT, 30L);
    t->doh = kResolver;
    t->pin = nullptr;
    if (const auto doh = doh_hosts_.find(host_of(t->url)); doh != doh_hosts_.end()) {
      t->doh = doh->second.server;
      t->pin = doh->second.pin;
      // Once a DoH load has connected, the rest go straight to its address: a DoH query per image made
      // a fresh install's first screen of covers take seconds.
      if (doh->second.pin) {
        set(CURLOPT_RESOLVE, doh->second.pin);
      } else {
        // The handle's cache still holds the blocked address, which a lookup would return before DoH.
        set(CURLOPT_DOH_URL, kDohURLs[doh->second.server]);
        set(CURLOPT_DNS_CACHE_TIMEOUT, 0L);
      }
    }
    set(CURLOPT_WRITEFUNCTION, body); set(CURLOPT_WRITEDATA, t);
    set(CURLOPT_XFERINFOFUNCTION, progress); set(CURLOPT_XFERINFODATA, t);
    set(CURLOPT_NOPROGRESS, 0L); set(CURLOPT_PRIVATE, t);
    t->started = Clock::now();
    return ok && curl_multi_add_handle(multi_, t->curl) == CURLM_OK;
  }

  void complete(Transfer& t, CURLcode result) {
    curl_multi_remove_handle(multi_, t.curl);
    const bool warm = t.warm;
    t.warm = false;
    std::vector<EntryPtr> entries;
    entries.swap(t.entries);
    std::erase_if(entries, [](const EntryPtr& e) { return e->cancelled.load(); });
    long status = 0;
    curl_easy_getinfo(t.curl, CURLINFO_RESPONSE_CODE, &status);
    // What a blocking DNS gives: a name that does not resolve, a connection refused at once, or (a DNS
    // that points the vendor's domains at its own server) a TLS handshake for a certificate that is not
    // the host's, or nothing at all. The host switches to DoH, then to the second DoH server, and the
    // load retries.
    const std::string host = host_of(t.url);
    const bool blocked = result == CURLE_COULDNT_CONNECT || result == CURLE_COULDNT_RESOLVE_HOST ||
      result == CURLE_SSL_CONNECT_ERROR || result == CURLE_PEER_FAILED_VERIFICATION || result == CURLE_GOT_NOTHING;
    // Only a failure on the host's current route moves it on: the loads sent before a switch fail
    // together, and one switch covers them all. A pinned address that stops answering is looked up
    // again on the same server first.
    const auto doh = doh_hosts_.find(host);
    const bool current = doh == doh_hosts_.end() ? t.doh == kResolver
      : t.pin ? t.pin == doh->second.pin : !doh->second.pin && t.doh == doh->second.server;
    const bool moved = blocked && current && (doh == doh_hosts_.end() || doh->second.pin || doh->second.server + 1 < kDohURLs.size());
    if (moved) {
      Doh& route = doh_hosts_[host];
      if (doh != doh_hosts_.end() && !route.pin) ++route.server;
      route.pin = nullptr;
      network::platform_log(("images: " + host + " unreachable (" + curl_easy_strerror(result) + "); resolving it over " +
                    kDohURLs[route.server]).c_str());
    }
    // Retried on the new route, whatever the error was on the old one.
    const bool rerouted = blocked && (moved || !current);
    if (result == CURLE_OK && current && doh != doh_hosts_.end() && !doh->second.pin) {
      // A redirect's address is its target's, not this host's.
      char* ip = nullptr;
      char* landed = nullptr;
      curl_easy_getinfo(t.curl, CURLINFO_EFFECTIVE_URL, &landed);
      if (landed && host_of(landed) == host && curl_easy_getinfo(t.curl, CURLINFO_PRIMARY_IP, &ip) == CURLE_OK && ip && *ip) {
        const bool tls = t.url.rfind("https:", 0) == 0;
        const std::string entry = host + (tls ? ":443:" : ":80:") + (std::strchr(ip, ':') ? "[" + std::string(ip) + "]" : std::string(ip));
        doh_pins_.push_back(curl_slist_append(nullptr, entry.c_str()));
        doh->second.pin = doh_pins_.back();
        network::platform_log(("images: " + host + " pinned to " + ip + " from DoH").c_str());
      }
    }
    const bool transient = t.out_of_memory || rerouted || result == CURLE_COULDNT_CONNECT || result == CURLE_COULDNT_RESOLVE_HOST || result == CURLE_OPERATION_TIMEDOUT ||
      result == CURLE_RECV_ERROR || result == CURLE_SEND_ERROR || result == CURLE_PARTIAL_FILE ||
      status == 429 || status == 502 || status == 503 || status == 504;
    std::string reason;
    if (t.overflow) reason = "response exceeds " + std::to_string(kMaxEncodedBytes >> 20) + " MiB";
    else if (t.out_of_memory) reason = "out of memory for the response";
    else if (result != CURLE_OK) reason = curl_easy_strerror(result);
    else if (status != 200) reason = "HTTP " + std::to_string(status);
    if (result == CURLE_ABORTED_BY_CALLBACK) ++counters.aborted;
    // A warm response over its size limit is skipped, not failed.
    else count_request(t.url, warm && t.overflow ? std::string() : reason,
                       std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - t.started).count(), t.body.size);
    if (reason.empty() && entries.empty()) {
      disk_.write(t.url, t.body);
    } else if (reason.empty()) {
      Body body = std::make_shared<const Bytes>(std::move(t.body));
      remember(t.url, body);
      disk_.write(t.url, *body);
      decode_later(std::move(entries), body);
    } else {
      std::lock_guard lock(mutex_);
      for (EntryPtr& entry : entries) {
        if (transient && ++entry->attempts < kAttempts) {
          ++counters.retries;
          entry->retry_at = Clock::now() + std::chrono::milliseconds(500 << (entry->attempts - 1));
          fetches_.push_back(std::move(entry));
        } else {
          ++counters.failed;
          entry->error = message(*entry, reason);
          finished_.push_back(std::move(entry));
        }
      }
    }
    t.body.clear();
  }

  void fetch_loop() {
    name_thread("img-fetch");
    disk_.open(cache_directory_);
    unsigned active = 0, warming = 0;
    while (true) {
      std::vector<EntryPtr> starting;
      bool idle = false;
      const unsigned connections = network::downloading() ? kDownloadConnections : kConnections;
      auto due = Clock::now() + std::chrono::milliseconds(100);
      {
        std::lock_guard lock(mutex_);
        if (stopping_) break;
        const auto now = Clock::now();
        std::erase_if(fetches_, [](const EntryPtr& e) { return e->cancelled.load(); });
        std::stable_sort(fetches_.begin(), fetches_.end(), [](const EntryPtr& a, const EntryPtr& b) { return a->rank > b->rank; });
        // Cached bytes start at once and take no connection; the rest wait out their dwell or retry
        // delay and a free connection. Loads joining a transfer still count one: the bound is loose.
        unsigned networked = 0;
        const Clock::time_point deferred{Clock::duration{deferred_until.load()}};
        for (auto it = fetches_.begin(); it != fetches_.end() && encoded_bytes < kEncodedBudget;) {
          Entry& e = **it;
          const bool cached = held(e.url) || disk_.has(e.url);
          const auto wait = std::max(e.retry_at, cached ? Clock::time_point{} : std::max(e.dwell_until, deferred));
          if (wait > now) { due = std::min(due, wait); ++it; continue; }
          if (!cached && active + networked >= connections) { ++it; continue; }
          networked += !cached;
          starting.push_back(std::move(*it));
          it = fetches_.erase(it);
        }
        idle = fetches_.empty() && deferred <= now;
        if (fetches_.empty() && deferred > now) due = std::min(due, deferred);
      }
      fit_encoded(0);
      for (EntryPtr& entry : starting) start_fetch(std::move(entry), active);
      while (idle && active < connections && warming < kWarmConnections && encoded_bytes < kEncodedBudget) {
        const unsigned before = warming;
        start_warm(active, warming);
        if (warming == before) break;
      }
      int running = 0;
      curl_multi_perform(multi_, &running);
      int left = 0;
      while (CURLMsg* done = curl_multi_info_read(multi_, &left)) {
        if (done->msg != CURLMSG_DONE) continue;
        Transfer* t = nullptr;
        curl_easy_getinfo(done->easy_handle, CURLINFO_PRIVATE, &t);
        if (t->warm) --warming;
        complete(*t, done->data.result);
        --active;
      }
      const auto wait = std::chrono::duration_cast<std::chrono::milliseconds>(due - Clock::now()).count();
      curl_multi_poll(multi_, nullptr, 0, static_cast<int>(std::clamp<long long>(wait, 1, 100)), nullptr);
    }
    for (Transfer& t : transfers_) if (busy(t)) { curl_multi_remove_handle(multi_, t.curl); t.entries.clear(); t.warm = false; }
  }

  void decode_loop() {
    name_thread("img-decode");
    while (true) {
      EntryPtr entry;
      {
        std::unique_lock lock(mutex_);
        // The most wanted image waits for room in the budget rather than letting smaller ones pass it.
        auto next = decodes_.end();
        wake_.wait(lock, [&] {
          std::erase_if(decodes_, [](const EntryPtr& e) { return e->cancelled.load(); });
          next = std::max_element(decodes_.begin(), decodes_.end(),
                                  [](const EntryPtr& a, const EntryPtr& b) { return a->rank < b->rank; });
          return stopping_ || (next != decodes_.end() && (!decoding_ || decoding_ + (*next)->decode_cost <= kDecodeBudget));
        });
        if (stopping_) break;
        entry = std::move(*next);
        decodes_.erase(next);
        decoding_ += entry->decode_cost;
      }
      const auto started = Clock::now();
      const bool decoded = decode(*entry);
      counters.decode_us += std::chrono::duration_cast<std::chrono::microseconds>(Clock::now() - started).count();
      // Out of heap: fetched again (usually from the encoded or disk cache) once memory may be free.
      const bool retry = !decoded && ++entry->attempts < kDecodeAttempts;
      if (retry) {
        entry->error.clear();
        entry->retry_at = Clock::now() + std::chrono::seconds(entry->attempts);
      }
      {
        std::lock_guard lock(mutex_);
        decoding_ -= entry->decode_cost;
        if (retry) fetches_.push_back(std::move(entry));
        else finished_.push_back(std::move(entry));
      }
      wake_.notify_all();
      if (retry) curl_multi_wakeup(multi_);
    }
  }

  std::mutex mutex_;
  std::condition_variable wake_;
  std::deque<EntryPtr> fetches_, decodes_;
  std::deque<std::string> warms_;
  std::vector<EntryPtr> finished_;
  std::array<Transfer, kConnections> transfers_{};
  // Fetch thread only.
  DiskCache disk_;
  std::vector<Encoded> encoded_;
  std::uint64_t fetch_clock_ = 0;
  // Hosts the console's resolver sends nowhere: a DNS that blocks a vendor's domains (as consoles
  // running homebrew do, against system updates) also blocks its image CDN. These resolve over DoH,
  // through kDohURLs[server], until a load connects and pins its address.
  struct Doh { std::size_t server = 0; curl_slist* pin = nullptr; };
  std::map<std::string, Doh> doh_hosts_;
  // Every pin made, kept until stop(): a transfer in flight may still read a replaced one.
  std::vector<curl_slist*> doh_pins_;
  // Decode costs of the images being decoded, guarded by the mutex.
  std::size_t decoding_ = 0;
  CURLM* multi_ = nullptr;
  pthread_t fetch_thread_{};
  std::array<pthread_t, kDecoders> decode_threads_{};
  unsigned decoders_ = 0;
  std::string cache_directory_;
  bool stopping_ = false, running_ = false, fetch_started_ = false, over_budget_ = false;
  // Render thread only.
  std::unordered_map<std::string, EntryPtr> by_key_;
  std::unordered_map<std::uint32_t, EntryPtr> by_id_;
  std::uint32_t next_id_ = 1;
  std::uint64_t clock_ = 0;
  std::size_t budget_ = kCacheBytes;
};
Service service;
} // namespace

bool start(const std::string& cache_directory) { return service.start(cache_directory); }
void stop(void (*evict)(std::uint32_t)) { service.stop(evict); }
void discard(std::uint32_t id, const std::string& reason) { service.discard(id, reason); }
std::uint32_t load(const std::string& url, int width, int height, Fit fit, bool prefetch, Result& result,
                   std::string& error) {
  return service.load(url, width, height, fit, prefetch, result, error);
}
void release(std::uint32_t id, bool prefetch) { service.release(id, prefetch); }
void warm(std::vector<std::string> urls) { service.warm(std::move(urls)); }
std::vector<Result> poll(void (*evict)(std::uint32_t)) { return service.poll(evict); }
bool evict_unused(std::uint32_t keep, void (*evict)(std::uint32_t)) { return service.evict_unused(keep, evict); }
void note_registry(unsigned used) { counters.registry = used; }
Memory memory() { return {encoded_bytes.load(), decoded_bytes.load()}; }
void set_cache_bytes(std::size_t bytes) { cache_bytes = bytes; }
void hold_memory(bool hold) { holds += hold ? 1 : -1; }
void set_heap_probe(Heap (*probe)()) { heap_probe = probe; }
void defer(int ms) {
  deferred_until = (Clock::now() + std::chrono::milliseconds(ms)).time_since_epoch().count();
}

std::string stats() {
  char line[512];
  const std::uint64_t decodes = counters.decodes;
  std::snprintf(line, sizeof line,
                "loads=%llu decoded-cache=%llu encoded-cache=%llu disk=%llu net=%llu decodes=%llu (%.1f ms avg) "
                "shown=%llu (%llu ms avg, %llu max) cancelled=%llu aborted=%llu retries=%llu failed=%llu "
                "cached=%llu pinned=%llu registry=%llu",
                static_cast<unsigned long long>(counters.loads.load()), static_cast<unsigned long long>(counters.decoded_hits.load()),
                static_cast<unsigned long long>(counters.encoded_hits.load()), static_cast<unsigned long long>(counters.disk_hits.load()),
                static_cast<unsigned long long>(counters.fetches.load()), static_cast<unsigned long long>(decodes),
                decodes ? counters.decode_us / 1000.0 / decodes : 0.0, static_cast<unsigned long long>(counters.shown.load()),
                static_cast<unsigned long long>(counters.shown ? counters.shown_ms / counters.shown : 0),
                static_cast<unsigned long long>(counters.shown_max_ms.load()),
                static_cast<unsigned long long>(counters.cancelled.load()), static_cast<unsigned long long>(counters.aborted.load()),
                static_cast<unsigned long long>(counters.retries.load()), static_cast<unsigned long long>(counters.failed.load()),
                static_cast<unsigned long long>(counters.cached.load()), static_cast<unsigned long long>(counters.pinned.load()),
                static_cast<unsigned long long>(counters.registry.load()));
  std::string out = line;
  std::vector<Origin> busiest;
  { std::lock_guard lock(origins_mutex); busiest = origins; }
  std::sort(busiest.begin(), busiest.end(), [](const Origin& a, const Origin& b) { return a.requests > b.requests; });
  if (busiest.size() > 4) busiest.resize(4);
  for (const Origin& o : busiest) {
    std::snprintf(line, sizeof line, " | %s %llu req %llu fail %llu ms avg %llu KiB avg", o.host.c_str(),
                  static_cast<unsigned long long>(o.requests), static_cast<unsigned long long>(o.failures),
                  static_cast<unsigned long long>(o.ms / o.requests), static_cast<unsigned long long>(o.bytes / o.requests >> 10));
    out += line;
    if (o.failures) out += " (last: " + o.last + ")";
  }
  return out;
}
} // namespace images
#else
namespace images {
bool start(const std::string&) { return false; }
void stop(void (*)(std::uint32_t)) {}
void discard(std::uint32_t, const std::string&) {}
std::uint32_t load(const std::string& url, int, int, Fit, bool, Result&, std::string& error) {
  error = "Image.load " + url + ": enable networking: true and filesystemAccess: console in app.json"; return 0;
}
void release(std::uint32_t, bool) {}
void warm(std::vector<std::string>) {}
std::vector<Result> poll(void (*)(std::uint32_t)) { return {}; }
bool evict_unused(std::uint32_t, void (*)(std::uint32_t)) { return false; }
void note_registry(unsigned) {}
Memory memory() { return {}; }
void set_cache_bytes(std::size_t) {}
void hold_memory(bool) {}
void set_heap_probe(Heap (*)()) {}
void defer(int) {}
std::string stats() { return {}; }
} // namespace images
#endif
