#include "network.hpp"
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <thread>
#include <fcntl.h>
#include <unistd.h>
#include <vector>
// bench_client URL DEST CONNECTIONS RANGE_MIB ADAPTIVE [MIRROR,...]
int main(int argc, char** argv) {
  if (argc < 6 || !network::start()) return 2;
  network::Request request;
  request.url = argv[1]; request.destination = argv[2];
  request.connections = std::atoi(argv[3]);
  request.range_bytes = std::strtoull(argv[4], nullptr, 10)*1024*1024;
  request.adaptive = std::atoi(argv[5]) != 0;
  request.reject_html = true;
  for (int i = 6; i < argc; ++i) request.mirrors.push_back(argv[i]);
  std::string error;
  const auto id = network::enqueue(std::move(request), error);
  if (!id) { std::fprintf(stderr, "%s\n", error.c_str()); return 4; }
  const auto started = std::chrono::steady_clock::now();
  const char* limit = std::getenv("BENCH_SECONDS");
  for (;;) {
    if (limit && std::chrono::steady_clock::now()-started > std::chrono::seconds(std::atoi(limit))) network::cancel(id);
    for (const auto& s : network::poll()) if (s.state == "completed" || s.state == "failed" || s.state == "cancelled") {
      const double sec = std::chrono::duration<double>(std::chrono::steady_clock::now()-started).count();
      std::printf("{\"state\":\"%s\",\"error\":\"%s\",\"bytes\":%llu,\"seconds\":%.2f,\"MBps\":%.2f,\"retries\":%u}\n",
        s.state.c_str(), s.error.c_str(), (unsigned long long)s.written, sec, s.written/sec/1e6, s.retries);
      network::stop();
      if (s.state == "completed" && std::getenv("BENCH_VERIFY")) {
        const int fd = open(argv[2], O_RDONLY);
        std::vector<unsigned char> buf(1 << 20);
        unsigned long long off = 0, bad = 0;
        for (ssize_t n; (n = read(fd, buf.data(), buf.size())) > 0;)
          for (ssize_t i = 0; i < n; ++i, ++off) if (buf[i] != (unsigned char)(off*131 + (off >> 17))) ++bad;
        close(fd);
        std::printf("verify: %llu bytes, %llu wrong\n", off, bad);
        if (bad || off != s.written) return 9;
      }
      return s.state == "completed" ? 0 : 1;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(20));
  }
}
