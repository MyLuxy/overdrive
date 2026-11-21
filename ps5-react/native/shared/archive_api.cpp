// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "archives.hpp"
#include "archive_preflight.hpp"
#include <climits>
#include <cmath>
#include <cstring>

namespace {
bool path(JSContext* ctx, JSValueConst value, std::string& out) {
  if (!JS_IsString(value)) return false;
  std::size_t length = 0; const char* input = JS_ToCStringLen(ctx,&length,value);
  if (!input) return false;
  char resolved[PATH_MAX];
  const bool ok = length && length < PATH_MAX && !std::memchr(input,0,length) && host::resolve_path(input,resolved,sizeof resolved);
  if (ok) out = resolved;
  JS_FreeCString(ctx,input); return ok;
}
JSValue extract(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  if (argc < 3 || !JS_IsArray(argv[0])) return JS_ThrowTypeError(ctx,"archives.extract: expected sources, destination, maxBytes");
  archives::Request request;
  if (!path(ctx,argv[1],request.destination)) return JS_ThrowTypeError(ctx,"archives.extract: destination is not allowed");
  // Package resources are always read-only, even when console access is enabled.
  const char* destination = JS_ToCString(ctx,argv[1]);
  const bool readonly = destination && (!std::strcmp(destination,"/app0") || !std::strncmp(destination,"/app0/",6));
  if (destination) JS_FreeCString(ctx,destination);
  if (readonly) return JS_ThrowTypeError(ctx,"archives.extract: /app0 is read-only");
  double maximum = 0;
  if (JS_ToFloat64(ctx,&maximum,argv[2]) || !std::isfinite(maximum) || maximum < 1 || maximum > 1099511627776.0 || std::floor(maximum) != maximum)
    return JS_ThrowTypeError(ctx,"archives.extract: maxBytes must be an integer between 1 and 1 TiB");
  request.max_bytes = static_cast<std::uint64_t>(maximum);
  if (argc > 3 && !JS_IsUndefined(argv[3]) && !JS_IsNull(argv[3])) {
    if (!JS_IsString(argv[3])) return JS_ThrowTypeError(ctx,"archives.extract: password must be a string");
    std::size_t size = 0;
    const char* password = JS_ToCStringLen(ctx,&size,argv[3]);
    if (!password) return JS_EXCEPTION;
    const bool valid = size <= 1024 && !std::memchr(password,0,size);
    if (valid) request.password.assign(password,size);
    JS_FreeCString(ctx,password);
    if (!valid) return JS_ThrowTypeError(ctx,"archives.extract: password must have at most 1024 UTF-8 bytes and no NUL");
  }
  const JSValue length_value = JS_GetPropertyStr(ctx,argv[0],"length"); std::uint32_t length = 0;
  const int result = JS_ToUint32(ctx,&length,length_value); JS_FreeValue(ctx,length_value);
  if (result || !length || length > 1024) return JS_ThrowTypeError(ctx,"archives.extract: expected 1–1024 ordered volumes");
  for (std::uint32_t i = 0; i < length; ++i) {
    const JSValue value = JS_GetPropertyUint32(ctx,argv[0],i); std::string file;
    const bool ok = path(ctx,value,file); JS_FreeValue(ctx,value);
    if (!ok) return JS_ThrowTypeError(ctx,"archives.extract: source path is not allowed");
    request.sources.push_back(std::move(file));
  }
  if (argc > 4) request.stream = JS_ToBool(ctx,argv[4]) == 1;
  std::string error; const auto id = archives::enqueue(std::move(request),error);
  if (!id) return JS_ThrowPlainError(ctx,"archives.extract: %s",error.c_str());
  return JS_NewUint32(ctx,id);
}
// The ordered volumes `call` names, as real paths; false after throwing.
bool volumes(JSContext* ctx, JSValueConst value, const char* call, std::vector<std::string>& sources) {
  if (!JS_IsArray(value)) { JS_ThrowTypeError(ctx,"%s: expected sources",call); return false; }
  const JSValue length_value = JS_GetPropertyStr(ctx,value,"length"); std::uint32_t length = 0;
  const int result = JS_ToUint32(ctx,&length,length_value); JS_FreeValue(ctx,length_value);
  if (result || !length || length > 1024) { JS_ThrowTypeError(ctx,"%s: expected 1–1024 ordered volumes",call); return false; }
  for (std::uint32_t i = 0; i < length; ++i) {
    const JSValue item = JS_GetPropertyUint32(ctx,value,i); std::string file;
    const bool ok = path(ctx,item,file); JS_FreeValue(ctx,item);
    if (!ok) { JS_ThrowTypeError(ctx,"%s: source path is not allowed",call); return false; }
    sources.push_back(std::move(file));
  }
  return true;
}
void set_inspection(JSContext* ctx, JSValue out, const archives::Inspection& inspection) {
  JS_SetPropertyStr(ctx,out,"kind",JS_NewString(ctx,inspection.kind.c_str()));
  JS_SetPropertyStr(ctx,out,"refusal",JS_NewString(ctx,inspection.refusal.c_str()));
  JS_SetPropertyStr(ctx,out,"title",JS_NewString(ctx,inspection.title.c_str()));
}
// Reads only a few headers on the render thread, but a download's growing file can make it wait for
// the drive: while one is written, inspectAsync is the one to use.
JSValue inspect(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::vector<std::string> sources;
  if (argc < 1 || !volumes(ctx,argv[0],"archives.inspect",sources)) return argc < 1 ? JS_ThrowTypeError(ctx,"archives.inspect: expected sources") : JS_EXCEPTION;
  const host::CallScope scope("archives.inspect");
  const auto inspection = archives::inspect(sources);
  JSValue out = JS_NewObject(ctx);
  set_inspection(ctx,out,inspection);
  return out;
}
JSValue inspect_async(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::vector<std::string> sources;
  if (argc < 1 || !volumes(ctx,argv[0],"archives.inspectAsync",sources)) return argc < 1 ? JS_ThrowTypeError(ctx,"archives.inspectAsync: expected sources") : JS_EXCEPTION;
  std::string error; const auto id = archives::inspect_start(std::move(sources),error);
  if (!id) return JS_ThrowPlainError(ctx,"archives.inspectAsync: %s",error.c_str());
  return JS_NewUint32(ctx,id);
}
JSValue inspections_poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx); std::uint32_t index = 0;
  for (const auto& snapshot : archives::inspect_poll()) {
    JSValue item = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,item,"id",JS_NewUint32(ctx,snapshot.id));
    JS_SetPropertyStr(ctx,item,"state",JS_NewString(ctx,snapshot.state.c_str()));
    JS_SetPropertyStr(ctx,item,"error",JS_NewString(ctx,snapshot.error.c_str()));
    set_inspection(ctx,item,snapshot.inspection);
    JS_SetPropertyStr(ctx,item,"waitedMs",JS_NewFloat64(ctx,static_cast<double>(snapshot.waited_ms)));
    JS_SetPropertyStr(ctx,item,"tookMs",JS_NewFloat64(ctx,static_cast<double>(snapshot.took_ms)));
    JS_SetPropertyUint32(ctx,out,index++,item);
  }
  return out;
}
JSValue inspections_cancel(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t id = 0;
  if (!argc || JS_ToUint32(ctx,&id,argv[0])) return JS_ThrowTypeError(ctx,"inspections.cancel: expected task id");
  archives::inspect_cancel(id); return JS_UNDEFINED;
}
JSValue cancel(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t id = 0;
  if (!argc || JS_ToUint32(ctx,&id,argv[0])) return JS_ThrowTypeError(ctx,"archives.cancel: expected task id");
  archives::cancel(id); return JS_UNDEFINED;
}
JSValue poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx); std::uint32_t index = 0;
  for (const auto& snapshot : archives::poll()) {
    JSValue item = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx,item,"id",JS_NewUint32(ctx,snapshot.id));
    JS_SetPropertyStr(ctx,item,"state",JS_NewString(ctx,snapshot.state.c_str()));
    JS_SetPropertyStr(ctx,item,"error",JS_NewString(ctx,snapshot.error.c_str()));
    JS_SetPropertyStr(ctx,item,"phase",JS_NewString(ctx,snapshot.phase.c_str()));
    JS_SetPropertyStr(ctx,item,"synced",JS_NewFloat64(ctx,snapshot.synced));
    JS_SetPropertyStr(ctx,item,"syncTotal",JS_NewFloat64(ctx,snapshot.sync_total));
    JS_SetPropertyStr(ctx,item,"written",JS_NewFloat64(ctx,snapshot.written));
    JS_SetPropertyStr(ctx,item,"total",snapshot.total ? JS_NewFloat64(ctx,snapshot.total) : JS_NULL);
    JS_SetPropertyStr(ctx,item,"entries",JS_NewFloat64(ctx,snapshot.entries));
    JSValue artifacts = JS_NewArray(ctx); std::uint32_t at = 0;
    for (const auto& path : snapshot.artifacts) JS_SetPropertyUint32(ctx,artifacts,at++,JS_NewString(ctx,path.c_str()));
    JS_SetPropertyStr(ctx,item,"artifacts",artifacts);
    JS_SetPropertyUint32(ctx,out,index++,item);
  }
  return out;
}
}
JSValue ps5_react_archive_api(JSContext* ctx) {
  JSValue api = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx,api,"extract",JS_NewCFunction(ctx,extract,"extract",5));
  JS_SetPropertyStr(ctx,api,"inspect",JS_NewCFunction(ctx,inspect,"inspect",1));
  JS_SetPropertyStr(ctx,api,"inspectAsync",JS_NewCFunction(ctx,inspect_async,"inspectAsync",1));
  JS_SetPropertyStr(ctx,api,"cancel",JS_NewCFunction(ctx,cancel,"cancel",1));
  JS_SetPropertyStr(ctx,api,"poll",JS_NewCFunction(ctx,poll,"poll",0));
  return api;
}
JSValue ps5_react_inspection_api(JSContext* ctx) {
  JSValue api = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx,api,"poll",JS_NewCFunction(ctx,inspections_poll,"poll",0));
  JS_SetPropertyStr(ctx,api,"cancel",JS_NewCFunction(ctx,inspections_cancel,"cancel",1));
  return api;
}
