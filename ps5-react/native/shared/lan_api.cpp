// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "lan.hpp"
#include <cmath>
#include <cstring>

namespace {
bool integer(JSContext* ctx, JSValueConst value, double minimum, double maximum, double& out) {
  return JS_IsNumber(value) && !JS_ToFloat64(ctx, &out, value) && std::isfinite(out) && out == std::floor(out) &&
         out >= minimum && out <= maximum;
}

JSValue broadcast(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  double port = 0, timeout = 0, replies = 0;
  std::size_t size = 0;
  const char* bytes = argc >= 2 && JS_IsString(argv[1]) ? JS_ToCStringLen(ctx, &size, argv[1]) : nullptr;
  std::string message;
  if (bytes) {
    if (size && size <= lan::kMaxMessageBytes) message.assign(bytes, size);
    JS_FreeCString(ctx, bytes);
  }
  if (argc < 4 || !integer(ctx, argv[0], 1, 65535, port) || message.empty() ||
      !integer(ctx, argv[2], lan::kMinTimeoutMs, lan::kMaxTimeoutMs, timeout) ||
      !integer(ctx, argv[3], 1, lan::kMaxReplies, replies))
    return JS_ThrowTypeError(ctx, "lan.broadcast: expected port 1..65535, a message of 1..%zu bytes, %d..%d ms and 1..%u replies",
                             lan::kMaxMessageBytes, lan::kMinTimeoutMs, lan::kMaxTimeoutMs, lan::kMaxReplies);
  std::string error;
  const auto id = lan::broadcast(static_cast<std::uint16_t>(port), std::move(message), static_cast<int>(timeout),
                                 static_cast<unsigned>(replies), error);
  return id ? JS_NewUint32(ctx, id) : JS_ThrowPlainError(ctx, "lan.broadcast %d: %s", static_cast<int>(port), error.c_str());
}

JSValue cancel(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t id = 0;
  if (!argc || JS_ToUint32(ctx, &id, argv[0])) return JS_ThrowTypeError(ctx, "lan.cancel: expected task id");
  lan::cancel(id);
  return JS_UNDEFINED;
}

JSValue poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (const auto& snapshot : lan::poll()) {
    JSValue item = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, item, "id", JS_NewUint32(ctx, snapshot.id));
    JS_SetPropertyStr(ctx, item, "state", JS_NewString(ctx, snapshot.state.c_str()));
    JS_SetPropertyStr(ctx, item, "error", JS_NewString(ctx, snapshot.error.c_str()));
    JSValue replies = JS_NewArray(ctx);
    std::uint32_t at = 0;
    for (const auto& reply : snapshot.replies) {
      JSValue entry = JS_NewObject(ctx);
      JS_SetPropertyStr(ctx, entry, "address", JS_NewString(ctx, reply.address.c_str()));
      JS_SetPropertyStr(ctx, entry, "port", JS_NewUint32(ctx, reply.port));
      JS_SetPropertyStr(ctx, entry, "body", JS_NewStringLen(ctx, reply.body.data(), reply.body.size()));
      JS_SetPropertyUint32(ctx, replies, at++, entry);
    }
    JS_SetPropertyStr(ctx, item, "replies", replies);
    JS_SetPropertyUint32(ctx, out, index++, item);
  }
  return out;
}
} // namespace

JSValue ps5_react_lan_api(JSContext* ctx) {
  JSValue api = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, api, "broadcast", JS_NewCFunction(ctx, broadcast, "broadcast", 4));
  JS_SetPropertyStr(ctx, api, "cancel", JS_NewCFunction(ctx, cancel, "cancel", 1));
  JS_SetPropertyStr(ctx, api, "poll", JS_NewCFunction(ctx, poll, "poll", 0));
  return api;
}
