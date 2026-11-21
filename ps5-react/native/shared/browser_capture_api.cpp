// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "browser_capture.hpp"
#include <cmath>
#include <cstring>
namespace {
bool text(JSContext* ctx, JSValueConst value, std::string& out) {
  if (!JS_IsString(value)) return false;
  size_t length = 0;
  const char* input = JS_ToCStringLen(ctx, &length, value);
  if (!input) return false;
  const bool valid = length && length <= 161 && !std::memchr(input, 0, length);
  if (valid) out.assign(input, length);
  JS_FreeCString(ctx, input);
  return valid;
}
// Links the app already refused, which the payload receives one per line.
bool links(JSContext* ctx, JSValueConst value, std::vector<std::string>& out) {
  if (!JS_IsArray(value)) return false;
  JSValue size = JS_GetPropertyStr(ctx, value, "length");
  std::uint32_t count = 0;
  const bool counted = !JS_ToUint32(ctx, &count, size);
  JS_FreeValue(ctx, size);
  if (!counted || count > 6) return false;
  for (std::uint32_t i = 0; i < count; i++) {
    JSValue item = JS_GetPropertyUint32(ctx, value, i);
    size_t length = 0;
    const char* input = JS_IsString(item) ? JS_ToCStringLen(ctx, &length, item) : nullptr;
    JS_FreeValue(ctx, item);
    if (!input) return false;
    bool valid = length >= 9 && length <= 2047 && !std::strncmp(input, "https://", 8);
    for (size_t j = 0; valid && j < length; j++)
      valid = static_cast<unsigned char>(input[j]) > 32 && static_cast<unsigned char>(input[j]) < 127;
    if (valid) out.emplace_back(input, length);
    JS_FreeCString(ctx, input);
    if (!valid) return false;
  }
  return true;
}
JSValue capture(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::string prefix, suffix;
  double timeout = 0;
  if (argc < 3 || !text(ctx, argv[0], prefix) ||
      (prefix != "https://vikingfile.com/d/" && prefix != "https://" && prefix != "https://vikingfile.com/f/") ||
      !text(ctx, argv[1], suffix) || suffix.empty() || suffix[0] != '/' ||
      suffix.find('/', 1) != std::string::npos || suffix.find('\\') != std::string::npos ||
      suffix.find("..") != std::string::npos ||
      /* The whole scheme means anchor mode, which needs a real anchor. */
      (prefix == "https://" && suffix.size() < 5) ||
      /* A Vikingfile page names no file: the vault decides which one it opens. */
      (prefix == "https://vikingfile.com/f/" && suffix != "/") ||
      JS_ToFloat64(ctx, &timeout, argv[2]) ||
      !std::isfinite(timeout) || timeout < 1 || timeout > 300 || std::floor(timeout) != timeout)
    return JS_ThrowTypeError(ctx, "browser.capture: expected the Vikingfile prefix, its page prefix with /, or https:// with an anchor of 4..160 bytes, then /filename (160 UTF-8 bytes) and 1..300 seconds");
  for (const unsigned char c : suffix) if (c < 32 || c == 127)
    return JS_ThrowTypeError(ctx, "browser.capture: filename contains a control character");
  std::vector<std::string> rejected;
  if (argc > 3 && !JS_IsUndefined(argv[3]) && !links(ctx, argv[3], rejected))
    return JS_ThrowTypeError(ctx, "browser.capture: rejected links must be an array of at most 6 https:// URLs of 9..2047 printable bytes");
  const bool resume = argc > 4 && JS_ToBool(ctx, argv[4]) > 0;
  std::string error;
  const auto id = browser_capture::capture(std::move(prefix), std::move(suffix), static_cast<int>(timeout),
                                           std::move(rejected), resume, error);
  return id ? JS_NewUint32(ctx, id) : JS_ThrowPlainError(ctx, "browser.capture: %s", error.c_str());
}
JSValue cancel(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t id = 0;
  if (!argc || JS_ToUint32(ctx, &id, argv[0])) return JS_ThrowTypeError(ctx, "browser.cancel: expected task id");
  browser_capture::cancel(id); return JS_UNDEFINED;
}
JSValue poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (const auto& snapshot : browser_capture::poll()) {
    JSValue item = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, item, "id", JS_NewUint32(ctx, snapshot.id));
    JS_SetPropertyStr(ctx, item, "state", JS_NewString(ctx, snapshot.state.c_str()));
    JS_SetPropertyStr(ctx, item, "error", JS_NewString(ctx, snapshot.error.c_str()));
    JS_SetPropertyStr(ctx, item, "url", JS_NewString(ctx, snapshot.url.c_str()));
    JS_SetPropertyUint32(ctx, out, index++, item);
  }
  return out;
}
}
JSValue ps5_react_browser_capture_api(JSContext* ctx) {
  JSValue api = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, api, "capture", JS_NewCFunction(ctx, capture, "capture", 5));
  JS_SetPropertyStr(ctx, api, "cancel", JS_NewCFunction(ctx, cancel, "cancel", 1));
  JS_SetPropertyStr(ctx, api, "poll", JS_NewCFunction(ctx, poll, "poll", 0));
  return api;
}
