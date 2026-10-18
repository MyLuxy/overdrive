// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "network.hpp"
#include <cmath>
#include <cstring>
#include <climits>
#include <cctype>
#include <utility>

namespace {
struct Value {
  JSContext* ctx; JSValue value;
  ~Value() { JS_FreeValue(ctx, value); }
};

bool text(JSContext* ctx, JSValueConst value, std::string& out, std::size_t limit) {
  if (!JS_IsString(value)) return false;
  std::size_t size = 0;
  const char* bytes = JS_ToCStringLen(ctx, &size, value);
  if (!bytes) return false;
  const bool valid = size <= limit && !std::memchr(bytes, 0, size);
  if (valid) out.assign(bytes, size);
  JS_FreeCString(ctx, bytes); return valid;
}

bool string_option(JSContext* ctx, JSValueConst options, const char* name, std::string& out, std::size_t limit) {
  Value value{ctx, JS_GetPropertyStr(ctx, options, name)};
  return JS_IsUndefined(value.value) || text(ctx, value.value, out, limit);
}

bool number_option(JSContext* ctx, JSValueConst options, const char* name, std::uint64_t& out,
                   std::uint64_t minimum, std::uint64_t maximum) {
  Value value{ctx, JS_GetPropertyStr(ctx, options, name)};
  if (JS_IsUndefined(value.value)) return true;
  double number = 0;
  if (!JS_IsNumber(value.value) || JS_ToFloat64(ctx, &number, value.value) || !std::isfinite(number) ||
      number != std::floor(number) || number < minimum || number > maximum) return false;
  out = static_cast<std::uint64_t>(number); return true;
}

bool boolean_option(JSContext* ctx, JSValueConst options, const char* name, bool& out) {
  Value value{ctx, JS_GetPropertyStr(ctx, options, name)};
  if (JS_IsUndefined(value.value)) return true;
  if (!JS_IsBool(value.value)) return false;
  out = JS_ToBool(ctx, value.value) == 1; return true;
}

bool digest(std::string& value, std::size_t size) {
  if (value.empty()) return true;
  if (value.size() != size) return false;
  for (char& c : value) {
    if (!std::isxdigit(static_cast<unsigned char>(c))) return false;
    c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  }
  return true;
}

bool mirrors(JSContext* ctx, JSValueConst options, network::Request& request) {
  Value array{ctx, JS_GetPropertyStr(ctx, options, "mirrors")};
  if (JS_IsUndefined(array.value)) return true;
  if (!JS_IsArray(array.value)) return false;
  std::uint64_t count = 0;
  if (!number_option(ctx, array.value, "length", count, 0, 4)) return false;
  for (std::uint32_t i = 0; i < count; ++i) {
    Value item{ctx, JS_GetPropertyUint32(ctx, array.value, i)};
    std::string url;
    if (!text(ctx, item.value, url, 8192) || !(url.starts_with("https://") || url.starts_with("http://")) ||
        url.find_first_of("\r\n") != std::string::npos) return false;
    request.mirrors.push_back(std::move(url));
  }
  return request.mirrors.empty() || request.pieces.empty();
}

bool pieces(JSContext* ctx, JSValueConst options, network::Request& request) {
  Value array{ctx, JS_GetPropertyStr(ctx, options, "pieces")};
  if (JS_IsUndefined(array.value)) return true;
  if (!JS_IsArray(array.value)) return false;
  std::uint64_t count = 0, offset = 0;
  if (!number_option(ctx, array.value, "length", count, 1, 1024) || !count) return false;
  for (std::uint32_t i = 0; i < count; ++i) {
    Value item{ctx, JS_GetPropertyUint32(ctx, array.value, i)};
    network::Piece piece;
    if (!JS_IsObject(item.value) || !string_option(ctx, item.value, "url", piece.url, 8192) ||
        !(piece.url.starts_with("https://") || piece.url.starts_with("http://")) ||
        piece.url.find_first_of("\r\n") != std::string::npos ||
        !number_option(ctx, item.value, "offset", piece.offset, 0, 9007199254740991ULL) ||
        !number_option(ctx, item.value, "size", piece.size, 1, 9007199254740991ULL) || !piece.size ||
        piece.offset != offset || piece.size > 9007199254740991ULL-offset ||
        !string_option(ctx, item.value, "sha1", piece.sha1, 40) || !digest(piece.sha1, 40)) return false;
    offset += piece.size;
    request.pieces.push_back(std::move(piece));
  }
  return request.expected_bytes == offset;
}

bool headers(JSContext* ctx, JSValueConst options, network::Request& request, bool download) {
  Value value{ctx, JS_GetPropertyStr(ctx, options, "headers")};
  if (JS_IsUndefined(value.value)) return true;
  if (!JS_IsObject(value.value)) return false;
  JSPropertyEnum* names = nullptr;
  std::uint32_t count = 0;
  if (JS_GetOwnPropertyNames(ctx, &names, &count, value.value, JS_GPN_STRING_MASK | JS_GPN_ENUM_ONLY) != 0) return false;
  bool valid = count <= 32;
  for (std::uint32_t i = 0; i < count; ++i) {
    Value key{ctx, JS_AtomToString(ctx, names[i].atom)};
    Value item{ctx, JS_GetProperty(ctx, value.value, names[i].atom)};
    std::string name, body;
    bool entry = text(ctx, key.value, name, 128) && !name.empty() && text(ctx, item.value, body, 2048);
    for (char c : name) if (!(std::isalnum(static_cast<unsigned char>(c)) || std::strchr("!#$%&'*+-.^_`|~", c))) entry = false;
    if (body.find_first_of("\r\n") != std::string::npos) entry = false;
    std::string lower = name;
    for (char& c : lower) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    if ((lower == "range" && download) || lower == "if-range" || lower == "accept-encoding" || lower == "content-length" ||
        lower == "connection" || lower == "host") entry = false;
    valid = valid && entry;
    if (entry && count <= 32) request.headers.push_back(name+": "+body);
    JS_FreeAtom(ctx, names[i].atom);
  }
  js_free(ctx, names); return valid;
}

JSValue begin(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv, bool download) {
  const char* call = download ? "network.download" : "network.request";
  const int options_index = download ? 2 : 1;
  if (argc <= options_index || !JS_IsObject(argv[options_index]))
    return JS_ThrowTypeError(ctx, "%s: expected URL%s and options", call, download ? ", destination" : "");
  network::Request request;
  if (!text(ctx, argv[0], request.url, 8192) ||
      !(request.url.starts_with("http://") || request.url.starts_with("https://")) ||
      request.url.find_first_of("\r\n") != std::string::npos)
    return JS_ThrowTypeError(ctx, "%s: expected an http:// or https:// URL (at most 8192 bytes)", call);
  const JSValueConst options = argv[options_index];
  if (!headers(ctx, options, request, download)) return JS_ThrowTypeError(ctx, "%s: invalid headers; transport-owned headers cannot be overridden", call);
  if (download) {
    std::string path;
    char resolved[PATH_MAX];
    if (!text(ctx, argv[1], path, PATH_MAX-32) || path.empty() || path.back() == '/' ||
        !host::resolve_path(path.c_str(), resolved, sizeof resolved))
      return JS_ThrowTypeError(ctx, "%s: destination must be an allowed absolute file path", call);
    request.destination = resolved;
    std::string storage_root;
    if (!string_option(ctx, options, "storageRoot", storage_root, PATH_MAX-32))
      return JS_ThrowTypeError(ctx, "%s %s: invalid storageRoot", call, path.c_str());
    if (!storage_root.empty()) {
      if (!host::resolve_path(storage_root.c_str(), resolved, sizeof resolved))
        return JS_ThrowTypeError(ctx, "%s %s: storageRoot must be an allowed absolute directory", call, path.c_str());
      request.storage_root = resolved;
      if (!request.destination.starts_with(request.storage_root + "/"))
        return JS_ThrowTypeError(ctx, "%s %s: destination must be inside storageRoot", call, path.c_str());
    }
    std::uint64_t connections = request.connections;
    if (!number_option(ctx, options, "connections", connections, 1, 64) ||
        !number_option(ctx, options, "rangeBytes", request.range_bytes, 1024*1024, 256*1024*1024) ||
        !boolean_option(ctx, options, "resume", request.resume) || !boolean_option(ctx, options, "adaptive", request.adaptive) ||
        !boolean_option(ctx, options, "recoverCompleted", request.recover_completed) ||
        !boolean_option(ctx, options, "rejectHtml", request.reject_html) ||
        !boolean_option(ctx, options, "unlimited", request.unlimited) ||
        !string_option(ctx, options, "sha256", request.sha256, 64) || !digest(request.sha256, 64) ||
        !number_option(ctx, options, "expectedBytes", request.expected_bytes, 1, 9007199254740991ULL) ||
        !pieces(ctx, options, request) || !mirrors(ctx, options, request))
      return JS_ThrowTypeError(ctx, "%s %s: invalid download options; pieces must cover expectedBytes exactly without gaps or overlaps, and mirrors (at most 4 http(s) URLs) cannot be combined with pieces", call, path.c_str());
    request.connections = static_cast<unsigned>(connections);
  } else {
    if (!string_option(ctx, options, "method", request.method, 16) ||
        !string_option(ctx, options, "body", request.body, 1024*1024) ||
        !number_option(ctx, options, "maxBytes", request.max_bytes, 1, 4*1024*1024) ||
        !boolean_option(ctx, options, "followRedirects", request.follow_redirects))
      return JS_ThrowTypeError(ctx, "%s: invalid method/body/maxBytes", call);
    if (request.method != "GET" && request.method != "HEAD" && request.method != "POST" && request.method != "PUT" &&
        request.method != "PATCH" && request.method != "DELETE")
      return JS_ThrowTypeError(ctx, "%s: unsupported HTTP method", call);
  }
  std::string error;
  const std::string destination = request.destination;
  const auto id = network::enqueue(std::move(request), error);
  if (!id) return JS_ThrowPlainError(ctx, "%s %s: %s", call, destination.c_str(), error.c_str());
  return JS_NewUint32(ctx, id);
}

JSValue download(JSContext* ctx, JSValueConst self, int argc, JSValueConst* argv) { return begin(ctx, self, argc, argv, true); }
JSValue request(JSContext* ctx, JSValueConst self, int argc, JSValueConst* argv) { return begin(ctx, self, argc, argv, false); }
JSValue cancel(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t id = 0;
  if (!argc) return JS_ThrowTypeError(ctx, "network.cancel: expected task id");
  if (JS_ToUint32(ctx, &id, argv[0])) return JS_EXCEPTION;
  network::cancel(id); return JS_UNDEFINED;
}
JSValue poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (const auto& snapshot : network::poll()) {
    JSValue item = JS_NewObject(ctx);
    const auto str = [&](const char* key, const std::string& value) { JS_SetPropertyStr(ctx, item, key, JS_NewStringLen(ctx, value.data(), value.size())); };
    const auto num = [&](const char* key, double value) { JS_SetPropertyStr(ctx, item, key, JS_NewFloat64(ctx, value)); };
    num("id", snapshot.id); str("state", snapshot.state); str("error", snapshot.error);
    str("body", snapshot.body); str("destination", snapshot.destination);
    str("url", snapshot.url);
    JSValue response_headers = JS_NewObject(ctx);
    for (const auto& [name, value] : snapshot.headers)
      JS_SetPropertyStr(ctx, response_headers, name.c_str(), JS_NewStringLen(ctx, value.data(), value.size()));
    JS_SetPropertyStr(ctx, item, "headers", response_headers);
    num("received", snapshot.received); num("written", snapshot.written); num("completedBytes", snapshot.completed_bytes);
    JS_SetPropertyStr(ctx, item, "total", snapshot.total_known ? JS_NewFloat64(ctx, snapshot.total) : JS_NULL);
    num("bytesPerSecond", snapshot.bytes_per_second); num("bufferedBytes", snapshot.buffered);
    num("connections", snapshot.connections); num("retries", snapshot.retries); num("status", snapshot.status);
    JS_SetPropertyUint32(ctx, out, index++, item);
  }
  return out;
}
JSValue info(JSContext* ctx, JSValueConst, int, JSValueConst*) { return JS_NewString(ctx, network::version()); }
// Bytes per second every file download shares; 0 lifts the cap.
JSValue rate_limit(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  double bytes = 0;
  if (!argc || JS_ToFloat64(ctx, &bytes, argv[0]) || !(bytes >= 0) || bytes > 9007199254740991.0)
    return JS_ThrowTypeError(ctx, "network.setRateLimit: expected bytes per second, 0 for no limit");
  network::set_rate_limit(static_cast<std::uint64_t>(bytes)); return JS_UNDEFINED;
}
} // namespace

JSValue ps5_react_network_api(JSContext* ctx) {
  JSValue out = JS_NewObject(ctx);
  for (const auto& item : {std::pair<const char*, JSCFunction*>{"download", &download}, {"request", &request}, {"cancel", &cancel}, {"poll", &poll}, {"version", &info}, {"setRateLimit", &rate_limit}})
    JS_SetPropertyStr(ctx, out, item.first, JS_NewCFunction(ctx, item.second, item.first, 0));
  return out;
}
