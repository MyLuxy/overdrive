// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "host_api.hpp"
#include "image_loader.hpp"
#include <climits>
#include <cstdio>
#include <cstring>
#include <string>
#include <utility>

extern "C" {
#include "er_scene.h"
// The engine's count of registered images (engine/rendering/image_registry.c), for the stats line.
unsigned image_registry_in_use(void);
}

namespace {
// The engine name an Image node draws a loaded image under.
void engine_name(std::uint32_t id, char (&out)[24]) { std::snprintf(out, sizeof out, "@image:%u", id); }

void unregister(std::uint32_t id) {
  char name[24];
  engine_name(id, name);
  er_image_unload(name);
}

// Registers a newly decoded image; returns false when the engine registry is full.
bool publish(const images::Result& result) {
  char name[24];
  engine_name(result.id, name);
  return er_image_load_argb(name, result.pixels, result.width, result.height, result.opaque);
}

JSValue state(JSContext* ctx, const images::Result& result) {
  JSValue out = JS_NewObject(ctx);
  char name[24];
  engine_name(result.id, name);
  JS_SetPropertyStr(ctx, out, "id", JS_NewUint32(ctx, result.id));
  JS_SetPropertyStr(ctx, out, "state", JS_NewString(ctx, result.ready ? "ready" : result.failed ? "failed" : "loading"));
  JS_SetPropertyStr(ctx, out, "name", JS_NewString(ctx, result.ready ? name : ""));
  JS_SetPropertyStr(ctx, out, "width", JS_NewInt32(ctx, result.width));
  JS_SetPropertyStr(ctx, out, "height", JS_NewInt32(ctx, result.height));
  JS_SetPropertyStr(ctx, out, "error", JS_NewStringLen(ctx, result.error.data(), result.error.size()));
  char color[8];
  std::snprintf(color, sizeof color, "#%06x", static_cast<unsigned>(result.color));
  JS_SetPropertyStr(ctx, out, "color", result.color < 0 ? JS_NULL : JS_NewString(ctx, color));
  return out;
}

JSValue load(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  if (argc < 4) return JS_ThrowTypeError(ctx, "image.load: expected url, width, height and fit");
  std::size_t size = 0;
  const char* text = JS_ToCStringLen(ctx, &size, argv[0]);
  if (!text) return JS_EXCEPTION;
  std::string url(text, size);
  JS_FreeCString(ctx, text);
  if (!(url.starts_with("https://") || url.starts_with("http://")) || url.size() > 8192 ||
      url.find_first_of(std::string("\r\n\0", 3)) != std::string::npos)
    return JS_ThrowTypeError(ctx, "image.load %s: expected an http:// or https:// URL (at most 8192 bytes)", url.c_str());
  int width = 0, height = 0, fit = 0;
  if (JS_ToInt32(ctx, &width, argv[1]) || JS_ToInt32(ctx, &height, argv[2]) || JS_ToInt32(ctx, &fit, argv[3]))
    return JS_EXCEPTION;
  if (width < 1 || height < 1 || width > 8192 || height > 8192 || fit < 0 || fit > 3)
    return JS_ThrowRangeError(ctx, "image.load %s: box %dx%d must be 1..8192 pixels per side", url.c_str(), width, height);
  const bool prefetch = argc > 4 && JS_ToBool(ctx, argv[4]) == 1;
  images::Result result;
  std::string error;
  if (!images::load(url, width, height, static_cast<images::Fit>(fit), prefetch, result, error))
    return JS_ThrowPlainError(ctx, "%s", error.c_str());
  return state(ctx, result);
}

JSValue release(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t id = 0;
  if (!argc || JS_ToUint32(ctx, &id, argv[0])) return JS_ThrowTypeError(ctx, "image.release: expected an image id");
  images::release(id, argc > 1 && JS_ToBool(ctx, argv[1]) == 1);
  return JS_UNDEFINED;
}

JSValue warm(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  if (!argc || !JS_IsArray(argv[0])) return JS_ThrowTypeError(ctx, "image.warm: expected an array of URLs");
  std::int64_t length = 0;
  if (JS_GetLength(ctx, argv[0], &length)) return JS_EXCEPTION;
  std::vector<std::string> urls;
  for (std::int64_t i = 0; i < length; ++i) {
    JSValue item = JS_GetPropertyInt64(ctx, argv[0], i);
    if (const char* text = JS_ToCString(ctx, item)) {
      std::string url(text);
      JS_FreeCString(ctx, text);
      if ((url.starts_with("https://") || url.starts_with("http://")) && url.size() <= 8192 &&
          url.find_first_of(std::string("\r\n\0", 3)) == std::string::npos) urls.push_back(std::move(url));
    }
    JS_FreeValue(ctx, item);
  }
  images::warm(std::move(urls));
  return JS_UNDEFINED;
}

JSValue defer(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  int ms = 0;
  if (!argc || JS_ToInt32(ctx, &ms, argv[0]) || ms < 0 || ms > 10000)
    return JS_ThrowRangeError(ctx, "image.defer: expected 0..10000 milliseconds");
  images::defer(ms);
  return JS_UNDEFINED;
}

JSValue poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (auto& result : images::poll(unregister)) {
    // A full registry gets room from cached images nothing holds, least recently used first, before the
    // new image is given up: the cache trims by its own count, which the app's baked images and the
    // images still held can push the registry past.
    bool published = !result.ready || publish(result);
    while (!published && images::evict_unused(result.id, unregister)) published = publish(result);
    if (!published) {
      images::discard(result.id, "the engine image registry is full");
      result.ready = false; result.failed = true; result.pixels = nullptr;
      result.error = "Image.load: the engine image registry is full";
    }
    JS_SetPropertyUint32(ctx, out, index++, state(ctx, result));
  }
  images::note_registry(image_registry_in_use());
  return out;
}

} // namespace

bool ps5_react_start_images() {
  char cache[PATH_MAX];
  return images::start(host::resolve_path("/cache0/images", cache, sizeof cache) ? cache : "");
}

void ps5_react_stop_images() { images::stop(unregister); }

JSValue ps5_react_image_api(JSContext* ctx) {
  JSValue out = JS_NewObject(ctx);
  for (const auto& item : {std::pair<const char*, JSCFunction*>{"load", &load}, {"release", &release}, {"warm", &warm}, {"defer", &defer}, {"poll", &poll}})
    JS_SetPropertyStr(ctx, out, item.first, JS_NewCFunction(ctx, item.second, item.first, 0));
  return out;
}
