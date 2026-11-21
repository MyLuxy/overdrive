// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "network.hpp"
#include "image_loader.hpp"
#include "app_config.hpp"
#include "filesystem_access.hpp"
#include "platform/ps5/system.hpp"
#include <cstdio>
#include <string>
#include <unistd.h>
#if PS5_REACT_NETWORKING
extern "C" {
int sceNetInit(void);
int sceNetTerm(void);
int sceNetPoolCreate(const char*, int, int);
int sceNetPoolDestroy(int);
}
namespace network {
namespace {
int pool = -1; bool initialized = false;
constexpr const char* kSystemStore = "/system/common/cert/CA_LIST.cer";
constexpr const char* kCertificate = "-----BEGIN CERTIFICATE-----";
char store[256] = "/system/common/cert/CA_LIST.cer";

bool read_file(const char* path, std::string& out) {
  FILE* file = std::fopen(path, "rb");
  if (!file) return false;
  out.clear();
  char buffer[16384];
  std::size_t n;
  while ((n = std::fread(buffer, 1, sizeof buffer, file)) > 0) out.append(buffer, n);
  const bool ok = !std::ferror(file);
  std::fclose(file);
  return ok;
}

// Old firmwares' store lacks roots that sites moved to since (4.03 fails GitHub and the cover servers).
// The app ships Mozilla's (certs/cacert.pem); both go into one file in the cache, passed to curl by path
// so each transfer pool loads one store and reuses it. Anything missing keeps the system store alone.
void merge_certificates() {
  char bundle[256], merged[256];
  std::string system, extra, current;
  if (!resolve_filesystem_path("/app0/certs/cacert.pem", bundle, sizeof bundle) ||
      !resolve_filesystem_path("/cache0/ca-bundle.pem", merged, sizeof merged)) {
    hui::sys::log("[PS5-REACT] certificates: no path for the bundle; system store only"); return;
  }
  if (!read_file(bundle, extra) || extra.find(kCertificate) == std::string::npos) {
    hui::sys::log("[PS5-REACT] certificates: %s unreadable; system store only", bundle); return;
  }
  if (!read_file(kSystemStore, system) || system.find(kCertificate) == std::string::npos) {
    hui::sys::log("[PS5-REACT] certificates: the system store is not PEM; system store only"); return;
  }
  if (system.back() != '\n') system += '\n';
  system += extra;
  extra = std::string();
  if (!read_file(merged, current) || current != system) {
    const std::string temporary = std::string(merged) + ".tmp";
    bool written = false;
    if (FILE* file = std::fopen(temporary.c_str(), "wb")) {
      written = std::fwrite(system.data(), 1, system.size(), file) == system.size();
      written = std::fclose(file) == 0 && written;
    }
    if (!written || std::rename(temporary.c_str(), merged) != 0) {
      std::remove(temporary.c_str());
      hui::sys::log("[PS5-REACT] certificates: cannot write %s; system store only", merged); return;
    }
  }
  std::snprintf(store, sizeof store, "%s", merged);
  hui::sys::log("[PS5-REACT] certificates: system store + bundle, %zu bytes", system.size());
}
}
bool platform_start(std::string& error) {
  if (!console_filesystem_accessible()) {
    error = "native networking requires successful console filesystem elevation"; return false;
  }
  if (access(kSystemStore, R_OK) != 0) {
    error = "native networking cannot read the system certificate store"; return false;
  }
  merge_certificates();
  initialized = sceNetInit() == 0;
  pool = sceNetPoolCreate("ps5-react-http", 1024*1024, 0);
  if (pool < 0) {
    if (initialized) sceNetTerm(); initialized = false;
    error = "native networking could not create its libSceNet pool"; return false;
  }
  return true;
}
void platform_stop() {
  if (pool >= 0) sceNetPoolDestroy(pool);
  if (initialized) sceNetTerm();
  pool = -1; initialized = false;
}
const char* ca_path() { return store; }
// The title's heap (platform app_heap.c), so download telemetry shows how close it runs.
extern "C" void hui_heap_stats(std::size_t* live_bytes, std::size_t* peak_bytes, std::size_t* blocks, std::size_t* failures);
extern "C" void hui_heap_capacity(std::size_t* size, std::size_t* flexible_before, std::size_t* flexible_after);
void platform_log(const char* line) {
  std::size_t live = 0, peak = 0, blocks = 0, failures = 0, size = 0;
  hui_heap_stats(&live, &peak, &blocks, &failures);
  hui_heap_capacity(&size, nullptr, nullptr);
  const images::Memory image = images::memory();
  hui::sys::log("[PS5-REACT] %s heap=%zu/%zuMiB peak=%zuMiB failed=%zu img=%zu+%zuMiB", line, live >> 20, size >> 20,
                peak >> 20, failures, image.encoded >> 20, image.decoded >> 20);
}
}
#endif
