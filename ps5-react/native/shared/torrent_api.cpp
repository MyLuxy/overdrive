// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// ABI v21: the torrent engine's JavaScript surface. Submission is cheap and synchronous; the native
// sockets, hashing and disk writes run on the job's own worker. poll() carries running jobs too, so
// the app can draw progress and swarm health while they run.
#include "host_api.hpp"
#include "torrent_engine.hpp"
#include <climits>
#include <cmath>
#include <string>
#include <utility>

namespace {
bool text_field(JSContext* ctx, JSValueConst object, const char* name, std::size_t maximum, std::string& out) {
  JSValue value = JS_GetPropertyStr(ctx, object, name);
  bool ok = true;
  if (!JS_IsUndefined(value) && !JS_IsNull(value)) {
    std::size_t size = 0;
    const char* text = JS_IsString(value) ? JS_ToCStringLen(ctx, &size, value) : nullptr;
    if (!text) {
      ok = false;
    } else {
      if (size > maximum) {
        ok = false;
      } else {
        out.assign(text, size);
      }
      JS_FreeCString(ctx, text);
    }
  }
  JS_FreeValue(ctx, value);
  return ok;
}

bool number_field(JSContext* ctx, JSValueConst object, const char* name, double minimum, double maximum,
                  double& out) {
  JSValue value = JS_GetPropertyStr(ctx, object, name);
  bool ok = true;
  if (!JS_IsUndefined(value) && !JS_IsNull(value)) {
    double parsed = 0;
    ok = JS_IsNumber(value) && !JS_ToFloat64(ctx, &parsed, value) && std::isfinite(parsed) &&
         parsed == std::floor(parsed) && parsed >= minimum && parsed <= maximum;
    if (ok) out = parsed;
  }
  JS_FreeValue(ctx, value);
  return ok;
}

bool flag_field(JSContext* ctx, JSValueConst object, const char* name, bool& out) {
  JSValue value = JS_GetPropertyStr(ctx, object, name);
  bool ok = true;
  if (!JS_IsUndefined(value) && !JS_IsNull(value)) {
    ok = JS_IsBool(value);
    if (ok) out = JS_ToBool(ctx, value) > 0;
  }
  JS_FreeValue(ctx, value);
  return ok;
}

JSValue start(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  if (argc < 1 || !JS_IsObject(argv[0]))
    return JS_ThrowTypeError(ctx, "torrent.start: expected an options object");
  torrent::Config config;
  double connections = torrent::kMaxConnections;
  double port = 0;
  if (!text_field(ctx, argv[0], "magnet", 8192, config.magnet) ||
      !text_field(ctx, argv[0], "torrentPath", 4096, config.torrent_path) ||
      !text_field(ctx, argv[0], "destination", 4096, config.destination) ||
      !text_field(ctx, argv[0], "wanted", 4096, config.wanted) ||
      !number_field(ctx, argv[0], "connections", 1, torrent::kMaxConnections, connections) ||
      !number_field(ctx, argv[0], "listenPort", 0, 65535, port) ||
      !flag_field(ctx, argv[0], "seeding", config.seeding))
    return JS_ThrowTypeError(ctx, "torrent.start: magnet, torrentPath, destination and wanted must be strings; "
                                  "connections is 1..16, listenPort 0..65535, seeding a boolean");
  config.connections = static_cast<unsigned>(connections);
  config.listen_port = static_cast<std::uint16_t>(port);
  // The app names paths as it does everywhere else (/download0, /app0), and the desktop maps those
  // into its sandbox. Resolve them here, before the engine reaches the real filesystem: without this
  // a preview download tried to create /download0 at the filesystem root and failed.
  char resolved[PATH_MAX];
  if (!config.destination.empty()) {
    if (!host::resolve_path(config.destination.c_str(), resolved, sizeof resolved))
      return JS_ThrowTypeError(ctx, "torrent.start: destination must be an allowed absolute file path: %s",
                               config.destination.c_str());
    config.destination = resolved;
  }
  if (!config.torrent_path.empty()) {
    if (!host::resolve_path(config.torrent_path.c_str(), resolved, sizeof resolved))
      return JS_ThrowTypeError(ctx, "torrent.start: torrentPath must be an allowed absolute file path: %s",
                               config.torrent_path.c_str());
    config.torrent_path = resolved;
  }
  std::string error;
  const std::uint32_t id = torrent::start(std::move(config), error);
  return id ? JS_NewUint32(ctx, id) : JS_ThrowPlainError(ctx, "torrent.start: %s", error.c_str());
}

JSValue cancel(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  std::uint32_t id = 0;
  if (!argc || JS_ToUint32(ctx, &id, argv[0])) return JS_ThrowTypeError(ctx, "torrent.cancel: expected task id");
  torrent::cancel(id);
  return JS_UNDEFINED;
}

JSValue poll(JSContext* ctx, JSValueConst, int, JSValueConst*) {
  JSValue out = JS_NewArray(ctx);
  std::uint32_t index = 0;
  for (const auto& snapshot : torrent::poll()) {
    JSValue item = JS_NewObject(ctx);
    JS_SetPropertyStr(ctx, item, "id", JS_NewUint32(ctx, snapshot.id));
    JS_SetPropertyStr(ctx, item, "state", JS_NewString(ctx, snapshot.state.c_str()));
    JS_SetPropertyStr(ctx, item, "error", JS_NewString(ctx, snapshot.error.c_str()));
    JS_SetPropertyStr(ctx, item, "name", JS_NewString(ctx, snapshot.name.c_str()));
    JS_SetPropertyStr(ctx, item, "file", JS_NewString(ctx, snapshot.file.c_str()));
    JS_SetPropertyStr(ctx, item, "infoHash", JS_NewString(ctx, snapshot.info_hash.c_str()));
    JS_SetPropertyStr(ctx, item, "metadata", JS_NewBool(ctx, snapshot.metadata));
    JS_SetPropertyStr(ctx, item, "seeding", JS_NewBool(ctx, snapshot.seeding));
    JS_SetPropertyStr(ctx, item, "size", JS_NewFloat64(ctx, static_cast<double>(snapshot.size)));
    JS_SetPropertyStr(ctx, item, "total", JS_NewFloat64(ctx, static_cast<double>(snapshot.total)));
    JS_SetPropertyStr(ctx, item, "downloaded", JS_NewFloat64(ctx, static_cast<double>(snapshot.downloaded)));
    JS_SetPropertyStr(ctx, item, "verified", JS_NewFloat64(ctx, static_cast<double>(snapshot.verified)));
    JS_SetPropertyStr(ctx, item, "uploaded", JS_NewFloat64(ctx, static_cast<double>(snapshot.uploaded)));
    JS_SetPropertyStr(ctx, item, "bytesPerSecond", JS_NewFloat64(ctx, snapshot.bytes_per_second));
    JS_SetPropertyStr(ctx, item, "pieces", JS_NewUint32(ctx, snapshot.pieces));
    JS_SetPropertyStr(ctx, item, "piecesDone", JS_NewUint32(ctx, snapshot.pieces_done));
    JS_SetPropertyStr(ctx, item, "peers", JS_NewUint32(ctx, snapshot.peers));
    JS_SetPropertyStr(ctx, item, "seeds", JS_NewUint32(ctx, snapshot.seeds));
    JS_SetPropertyStr(ctx, item, "leechers", JS_NewUint32(ctx, snapshot.leechers));
    JS_SetPropertyStr(ctx, item, "swarmSeeds", JS_NewUint32(ctx, snapshot.swarm_seeds));
    JS_SetPropertyStr(ctx, item, "swarmLeechers", JS_NewUint32(ctx, snapshot.swarm_leechers));
    JS_SetPropertyStr(ctx, item, "listenPort", JS_NewUint32(ctx, snapshot.listen_port));
    JS_SetPropertyUint32(ctx, out, index++, item);
  }
  return out;
}

JSValue set_seeding(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv) {
  if (!argc) return JS_ThrowTypeError(ctx, "torrent.setSeeding: expected a boolean");
  torrent::set_seeding(JS_ToBool(ctx, argv[0]) > 0);
  return JS_UNDEFINED;
}
} // namespace

JSValue ps5_react_torrent_api(JSContext* ctx) {
  JSValue api = JS_NewObject(ctx);
  JS_SetPropertyStr(ctx, api, "start", JS_NewCFunction(ctx, start, "start", 1));
  JS_SetPropertyStr(ctx, api, "cancel", JS_NewCFunction(ctx, cancel, "cancel", 1));
  JS_SetPropertyStr(ctx, api, "poll", JS_NewCFunction(ctx, poll, "poll", 0));
  JS_SetPropertyStr(ctx, api, "setSeeding", JS_NewCFunction(ctx, set_seeding, "setSeeding", 1));
  return api;
}
