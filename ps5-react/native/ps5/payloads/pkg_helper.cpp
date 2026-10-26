// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
//
// The package server (native/shared/pkg_proxy.cpp) as a payload of its own, so the console's download
// queue keeps fetching a package after the app has closed: a server inside the app dies with it, and
// the player could not use the console while a game came down. The engine sends this program to the
// payload loader (127.0.0.1:9021), which hands it the rest of the connection as standard input and
// output, as it does the PKG installer.
//
// Request lines: "PKH1", the port to listen on (0: any), the control secret, the certificate store
// the app's own transfers use, and the log file. Answers "ready <port>" or "fail <reason>"; from then
// on the app adds and reads links over HTTP (pkg_proxy.hpp, /control/<secret>/…), from this session
// or a later one. It ends by itself once every link has been fetched whole and nothing asked for ten
// minutes, or nothing asked for an hour.
#include "../../shared/pkg_proxy.hpp"
#include "../../shared/network.hpp"
#include <chrono>
#include <csignal>
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <ctime>
#include <map>
#include <curl/curl.h>
#include <mutex>
#include <string>
#include <thread>
#include <sys/socket.h>
#include <unistd.h>

namespace {
std::mutex log_mutex;
std::string log_path, ca_store;
bool stdout_open = true;

bool read_line(std::string& out) {
  out.clear();
  char byte;
  while (read(STDIN_FILENO, &byte, 1) == 1) {
    if (byte == '\n') return true;
    if (out.size() > 1024) return false;
    out.push_back(byte);
  }
  return false;
}

void say(const std::string& line) {
  if (!stdout_open) return;
  const std::string text = line + "\n";
  if (write(STDOUT_FILENO, text.data(), text.size()) != static_cast<ssize_t>(text.size())) stdout_open = false;
}

// A log the app is not around to keep: one file beside app.log, cut back when it passes 512 KiB.
void append(const char* line) {
  std::lock_guard lock(log_mutex);
  if (log_path.empty()) return;
  FILE* file = std::fopen(log_path.c_str(), "a");
  if (!file) return;
  if (std::ftell(file) > 512 * 1024) {
    std::fclose(file);
    file = std::fopen(log_path.c_str(), "w");
    if (!file) return;
  }
  char stamp[32];
  const std::time_t now = std::time(nullptr);
  std::strftime(stamp, sizeof stamp, "%Y-%m-%d %H:%M:%S", std::localtime(&now));
  std::fprintf(file, "%s %s\n", stamp, line);
  std::fclose(file);
}

}

// What pkg_proxy.cpp asks of its host, as the app's network.cpp gives it there.
namespace network {
void platform_log(const char* line) {
  append(line);
  say(std::string("log ") + line);
}

bool configure_transport(void* handle, const std::string& url, bool follow_redirects) {
  CURL* curl = static_cast<CURL*>(handle);
  bool ok = true;
  const auto set = [&](CURLoption option, auto value) {
    if (curl_easy_setopt(curl, option, value) != CURLE_OK) ok = false;
  };
  set(CURLOPT_URL, url.c_str());
  set(CURLOPT_NOSIGNAL, 1L);
  set(CURLOPT_PROTOCOLS_STR, "http,https");
  set(CURLOPT_REDIR_PROTOCOLS_STR, url.starts_with("https:") ? "https" : "http,https");
  set(CURLOPT_FOLLOWLOCATION, follow_redirects ? 1L : 0L);
  set(CURLOPT_MAXREDIRS, 5L);
  set(CURLOPT_HTTP_VERSION, static_cast<long>(CURL_HTTP_VERSION_1_1));
  set(CURLOPT_SSL_VERIFYPEER, 1L);
  set(CURLOPT_SSL_VERIFYHOST, 2L);
  if (!ca_store.empty()) set(CURLOPT_CAINFO, ca_store.c_str());
  set(CURLOPT_ACCEPT_ENCODING, "identity");
  set(CURLOPT_USERAGENT, "PS5React/0.1");
  set(CURLOPT_CONNECTTIMEOUT, 10L);
  set(CURLOPT_LOW_SPEED_LIMIT, 1L);
  set(CURLOPT_LOW_SPEED_TIME, 30L);
  set(CURLOPT_TCP_KEEPALIVE, 1L);
  set(CURLOPT_IPRESOLVE, static_cast<long>(CURL_IPRESOLVE_V4));
  set(CURLOPT_SOCKOPTFUNCTION, +[](void*, curl_socket_t fd, curlsocktype) -> int {
    // As the app's transfers: a 2 MiB receive window, which a high-latency origin needs.
    int window = 2 * 1024 * 1024;
    setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &window, sizeof window);
    return CURL_SOCKOPT_OK;
  });
  // Not every curl build has it: a refusal leaves the system resolver, which may well be enough. The
  // server's own pool (pkg_proxy.cpp) keeps the names, so a package's host is looked up once.
  curl_easy_setopt(curl, CURLOPT_DOH_URL, "https://1.1.1.1/dns-query");
  return ok;
}
}

int main() {
  std::signal(SIGPIPE, SIG_IGN);
  std::string magic, port_text, secret;
  if (!read_line(magic) || magic != "PKH1" || !read_line(port_text) || !read_line(secret) ||
      !read_line(ca_store) || !read_line(log_path)) {
    say("fail the request was not understood");
    return 1;
  }
  if (secret.size() < 16) { say("fail the control secret is too short"); return 1; }
  if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) { say("fail curl did not start"); return 1; }
  std::uint16_t bound = 0;
  std::string error;
  const auto wanted = static_cast<std::uint16_t>(std::strtoul(port_text.c_str(), nullptr, 10));
  if (!pkg_proxy::start(wanted, secret, bound, error)) {
    say("fail " + error);
    return 1;
  }
  network::platform_log(("helper started on port " + std::to_string(bound) + ", pid " + std::to_string(getpid())).c_str());
  say("ready " + std::to_string(bound));

  // Every 30 s: what each link sent since the last look, and whether there is anything left to do.
  std::map<std::string, std::uint64_t> sent, gets, asked;
  for (;;) {
    std::this_thread::sleep_for(std::chrono::seconds(30));
    bool owed = false;
    for (const auto& item : pkg_proxy::stats()) {
      const std::uint64_t before = sent[item.token], gets_before = gets[item.token], asked_before = asked[item.token];
      sent[item.token] = item.delivered;
      gets[item.token] = item.gets;
      asked[item.token] = item.asked;
      if (item.delivered < item.total) owed = true;
      if (item.delivered != before) {
        // The size of the console's ranges says whether reading ahead of it would help.
        const std::uint64_t ranges = item.gets - gets_before;
        char line[240];
        std::snprintf(line, sizeof line, "%s sent %.1f MB in 30 s (%.1f MB/s), %.1f of %.1f GB, %llu ranges of %.0f KiB on average",
                      item.token.substr(0, 8).c_str(), (item.delivered - before) / 1e6, (item.delivered - before) / 30e6,
                      item.delivered / 1e9, item.total / 1e9, static_cast<unsigned long long>(ranges),
                      ranges ? (item.asked - asked_before) / 1024.0 / ranges : 0.0);
        network::platform_log(line);
      }
    }
    const std::uint64_t idle = pkg_proxy::idle_ms();
    if ((!owed && idle > 10 * 60 * 1000) || idle > 60 * 60 * 1000) {
      network::platform_log(owed ? "nothing asked for an hour; the helper ends" : "every package sent; the helper ends");
      break;
    }
  }
  pkg_proxy::stop();
  curl_global_cleanup();
  return 0;
}
