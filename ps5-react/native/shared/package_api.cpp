// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "packages.hpp"
#include "pkg_proxy.hpp"
#include <climits>
#include <cstring>

namespace {
// The installer runs with every right, so it takes only a plainly written .pkg or .fpkg on a drive.
bool package_path(JSContext* ctx, JSValueConst value, std::string& out) {
  if (!JS_IsString(value)) return false;
  std::size_t length = 0;
  const char* input = JS_ToCStringLen(ctx, &length, value);
  if (!input) return false;
  char resolved[PATH_MAX];
  const bool package = (length > 4 && !std::strcmp(input + length - 4, ".pkg")) || (length > 5 && !std::strcmp(input + length - 5, ".fpkg"));
  const bool ok = package && length < PATH_MAX && !std::memchr(input, 0, length) &&
                  !std::strstr(input, "/../") && host::resolve_path(input, resolved, sizeof resolved) &&
                  (!std::strncmp(resolved, "/data/", 6) || !std::strncmp(resolved, "/mnt/usb", 8) || !std::strncmp(resolved, "/mnt/ext", 8));
  if (ok) out = resolved;
  JS_FreeCString(ctx, input);
  return ok;
}
// ABI v20: an http(s) link, which the console's own download queue fetches and installs.
bool package_link(JSContext* ctx, JSValueConst value, std::string& out) {
  if (!JS_IsString(value)) return false;
  std::size_t length = 0;
  const char* input = JS_ToCStringLen(ctx, &length, value);
  if (!input) return false;
  bool ok = length < 1000 && (!std::strncmp(input, "https://", 8) || !std::strncmp(input, "http://", 7));
  for (std::size_t i = 0; ok && i < length; ++i) ok = static_cast<unsigned char>(input[i]) > ' ' && input[i] != 0x7F;
  if (ok) out.assign(input, length);
  JS_FreeCString(ctx, input);
  return ok;
}
std::string string_argument(JSContext* ctx, int argc, JSValueConst* argv, int index) {
  std::string out;
  if (argc > index && JS_IsString(argv[index])) {
    const char* value = JS_ToCString(ctx, argv[index]);
    if (value) { out = value; JS_FreeCString(ctx, value); }
  }
  return out;
}
// A PS4 content ID: "UP0000-CUSA00000_00-" and sixteen letters or digits.
bool content_id(const std::string& id) {
  if (id.size() != 36 || id[6] != '-' || id[16] != '_' || id[19] != '-') return false;
  for (std::size_t i = 0; i < id.size(); ++i)
    if (i != 6 && i != 16 && i != 19 && !((id[i] >= 'A' && id[i] <= 'Z') || (id[i] >= '0' && id[i] <= '9'))) return false;
  return true;
}
JSValue install(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::string path;
  const bool remote = argc > 0 && package_link(ctx, argv[0], path);
  if (argc < 1 || (!remote && !package_path(ctx, argv[0], path)))
    return JS_ThrowTypeError(ctx, "packages.install: expected a .pkg or .fpkg path under /data, /mnt/usb or /mnt/ext, or an http(s) link");
  std::string name = string_argument(ctx, argc, argv, 1);
  if (name.find('\n') != std::string::npos || name.size() > 200) return JS_ThrowTypeError(ctx, "packages.install: name must be one line of at most 200 bytes");
  std::string id_given = string_argument(ctx, argc, argv, 2);
  if (!id_given.empty() && (!remote || !content_id(id_given)))
    return JS_ThrowTypeError(ctx, "packages.install: a content ID goes with a link, as UP0000-CUSA00000_00-XXXXXXXXXXXXXXXX");
  std::string error;
  const auto id = packages::install(std::move(path), std::move(name), std::move(id_given), error);
  if (!id) return JS_ThrowPlainError(ctx, "packages.install: %s", error.c_str());
  return JS_NewUint32(ctx, id);
}
// ABI v21: the same link served by the app, for a console that refuses the origin's own answers.
// (url, total, file, token?, port?) -> {url, localUrl, token, port}; a token and port from an earlier
// session ask for the same link again.
JSValue proxy(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  pkg_proxy::Request request;
  double total = 0;
  if (argc < 2 || !package_link(ctx, argv[0], request.url) || JS_ToFloat64(ctx, &total, argv[1]) || !(total >= 1) || total > 9e15)
    return JS_ThrowTypeError(ctx, "packages.proxy: expected an http(s) link and its size in bytes");
  request.total = static_cast<std::uint64_t>(total);
  request.file = string_argument(ctx, argc, argv, 2);
  request.token = string_argument(ctx, argc, argv, 3);
  std::uint32_t wanted = 0;
  if (argc > 4 && !JS_IsUndefined(argv[4]) && !JS_IsNull(argv[4]) && (JS_ToUint32(ctx, &wanted, argv[4]) || wanted > 65535))
    return JS_ThrowTypeError(ctx, "packages.proxy: port must be 0..65535");
  request.port = static_cast<std::uint16_t>(wanted);
  pkg_proxy::Served served;
  std::string error;
  if (!pkg_proxy::serve(request, served, error)) return JS_ThrowPlainError(ctx, "packages.proxy: %s", error.c_str());
  JSValue out = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, out, "url", JS_NewString(ctx, served.url.c_str()));
  JS_SetPropertyStr(ctx, out, "localUrl", JS_NewString(ctx, served.local_url.c_str()));
  JS_SetPropertyStr(ctx, out, "token", JS_NewString(ctx, served.token.c_str()));
  JS_SetPropertyStr(ctx, out, "port", JS_NewUint32(ctx, served.port));
  return out;
}
// [{token, total, delivered, requests, idleMs}] for every link served.
JSValue proxy_stats(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (const auto& item : pkg_proxy::stats()) {
    JSValue entry = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, entry, "token", JS_NewString(ctx, item.token.c_str()));
    JS_SetPropertyStr(ctx, entry, "total", JS_NewFloat64(ctx, static_cast<double>(item.total)));
    JS_SetPropertyStr(ctx, entry, "delivered", JS_NewFloat64(ctx, static_cast<double>(item.delivered)));
    JS_SetPropertyStr(ctx, entry, "requests", JS_NewUint32(ctx, item.requests));
    JS_SetPropertyStr(ctx, entry, "idleMs", JS_NewFloat64(ctx, static_cast<double>(item.idle_ms)));
    JS_SetPropertyStr(ctx, entry, "gets", JS_NewFloat64(ctx, static_cast<double>(item.gets)));
    JS_SetPropertyStr(ctx, entry, "asked", JS_NewFloat64(ctx, static_cast<double>(item.asked)));
    JS_SetPropertyUint32(ctx, out, index++, entry);
  }
  return out;
}
// ABI v21: (port, secret, log) -> task id of the helper payload's start; pollHelper() gives its end.
JSValue start_helper(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t port = 0;
  if (argc < 2 || JS_ToUint32(ctx, &port, argv[0]) || port > 65535)
    return JS_ThrowTypeError(ctx, "packages.startHelper: expected a port (0..65535) and a secret");
  std::string error;
  const auto id = packages::start_helper(port, string_argument(ctx, argc, argv, 1), string_argument(ctx, argc, argv, 2), error);
  if (!id) return JS_ThrowPlainError(ctx, "packages.startHelper: %s", error.c_str());
  return JS_NewUint32(ctx, id);
}
// [{id, state: "ready" | "failed", port, error}] for each start that ended since the last poll.
JSValue poll_helper(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (const auto& item : packages::poll_helper()) {
    JSValue entry = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, entry, "id", JS_NewUint32(ctx, item.id));
    JS_SetPropertyStr(ctx, entry, "state", JS_NewString(ctx, item.state.c_str()));
    JS_SetPropertyStr(ctx, entry, "port", JS_NewUint32(ctx, item.port));
    JS_SetPropertyStr(ctx, entry, "error", JS_NewString(ctx, item.error.c_str()));
    JS_SetPropertyUint32(ctx, out, index++, entry);
  }
  return out;
}
JSValue proxy_remove(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  pkg_proxy::remove(string_argument(ctx, argc, argv, 0));
  return JS_UNDEFINED;
}
JSValue cancel(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t id = 0;
  if (!argc || JS_ToUint32(ctx, &id, argv[0])) return JS_ThrowTypeError(ctx, "packages.cancel: expected task id");
  packages::cancel(id);
  return JS_UNDEFINED;
}
JSValue poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (const auto& snapshot : packages::poll()) {
    JSValue item = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, item, "id", JS_NewUint32(ctx, snapshot.id));
    JS_SetPropertyStr(ctx, item, "state", JS_NewString(ctx, snapshot.state.c_str()));
    JS_SetPropertyStr(ctx, item, "error", JS_NewString(ctx, snapshot.error.c_str()));
    JS_SetPropertyStr(ctx, item, "contentId", JS_NewString(ctx, snapshot.content_id.c_str()));
    JS_SetPropertyStr(ctx, item, "status", JS_NewString(ctx, snapshot.status.c_str()));
    JS_SetPropertyStr(ctx, item, "written", JS_NewFloat64(ctx, static_cast<double>(snapshot.written)));
    JS_SetPropertyStr(ctx, item, "total", snapshot.total ? JS_NewFloat64(ctx, static_cast<double>(snapshot.total)) : JS_NULL);
    JS_SetPropertyUint32(ctx, out, index++, item);
  }
  return out;
}
}

JSValue ps5_react_package_api(JSContext* ctx) {
  JSValue api = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, api, "install", JS_NewCFunction(ctx, install, "install", 3));
  JS_SetPropertyStr(ctx, api, "proxy", JS_NewCFunction(ctx, proxy, "proxy", 5));
  JS_SetPropertyStr(ctx, api, "proxyStats", JS_NewCFunction(ctx, proxy_stats, "proxyStats", 0));
  JS_SetPropertyStr(ctx, api, "proxyRemove", JS_NewCFunction(ctx, proxy_remove, "proxyRemove", 1));
  JS_SetPropertyStr(ctx, api, "startHelper", JS_NewCFunction(ctx, start_helper, "startHelper", 3));
  JS_SetPropertyStr(ctx, api, "pollHelper", JS_NewCFunction(ctx, poll_helper, "pollHelper", 0));
  JS_SetPropertyStr(ctx, api, "cancel", JS_NewCFunction(ctx, cancel, "cancel", 1));
  JS_SetPropertyStr(ctx, api, "poll", JS_NewCFunction(ctx, poll, "poll", 0));
  return api;
}
