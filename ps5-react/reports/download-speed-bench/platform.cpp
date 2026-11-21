#include "network.hpp"
#include <chrono>
#include <cstdio>
#include <cstdlib>
namespace network {
static const auto origin = std::chrono::steady_clock::now();
bool platform_start(std::string&) { return true; }
void platform_stop() {}
const char* ca_path() { return std::getenv("BENCH_CA"); }
void platform_log(const char* line) {
  const double t = std::chrono::duration<double>(std::chrono::steady_clock::now()-origin).count();
  std::fprintf(stderr, "%7.2f %s\n", t, line);
}
}
