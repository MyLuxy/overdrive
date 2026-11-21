# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
cmake_minimum_required(VERSION 3.16)
project(overdrive-react-ps5 C)
if(NOT ER_ROOT)
  message(FATAL_ERROR "ER_ROOT must name the pinned embedded-react checkout")
endif()
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(ERUI_BORDER_AA ON CACHE BOOL "" FORCE)
set(ERUI_TRANSFORMS FULL CACHE STRING "" FORCE)
set(ERUI_SCRATCH_W 512 CACHE STRING "" FORCE)
set(ERUI_SCRATCH_H 512 CACHE STRING "" FORCE)
# Hosts fork each commit's repaint into horizontal slices across up to this many threads
# (native/shared/render_workers.cpp). Each worker owns a transform buffer and a window of the
# opacity pool, so nesting depth per worker stays at four.
set(ERUI_RENDER_WORKERS 8 CACHE STRING "" FORCE)
set(ERUI_MAX_OPACITY_DEPTH 32 CACHE STRING "" FORCE)
# Both pools are .bss the heap cannot use: the heap takes the largest step that leaves 96 MiB of
# flexible memory free, and 768-row strips dropped it from 256 to 192 MiB. A worker's slice of a
# 2160-row repaint is 270 rows, so taller strips save few passes. Transforms (focused:scale-*) skip
# nodes larger than ERUI_XFORM_W/H, and a 4K card reaches 768 px. The engine derives both from the
# scratch size only on a fresh cache; force them.
set(ERUI_SCRATCH_BAND_H 128 CACHE STRING "" FORCE)
set(ERUI_XFORM_W 768 CACHE STRING "" FORCE)
set(ERUI_XFORM_H 768 CACHE STRING "" FORCE)
# Transform sources kept across frames, shared by every worker (2.25 MiB each at 768x768). A focus
# scale re-rendered the whole card subtree on every frame, in each slice it crossed; two slots hold
# the card scaling up and the one scaling down. Per-worker slots would cost 18 MiB, enough to drop the heap a step.
set(ERUI_XFORM_CACHE_SLOTS 2 CACHE STRING "" FORCE)
# Motion allocates one Animated.Value per animated key per element (716 B each with 8 bindings). A
# search over a large catalog mounts enough animated cards at once to exhaust 256.
set(ERUI_MAX_ANIM_VALUES 1024 CACHE STRING "" FORCE)
set(ERUI_MAX_VALUE_BINDINGS 8 CACHE STRING "" FORCE)
# Photos are baked at half size and scaled bilinearly. The scaler and gradient assemble rows of up to
# 2560 px (+7 KB per worker each over 800 px) and render wider ones in chunks. The registry holds every
# decoded image: the cache's 256 (image_loader.hpp kCacheEntries, in use or not) plus the app's baked
# ones. At 256 slots, a cache of 256 small images (an app's icons, under its 64 MiB) left none for the
# rest, and new images were discarded ("the engine image registry is full"). 512 slots cost 45 KB at
# 88 B per slot.
set(ERUI_BILINEAR_SCALE ON CACHE BOOL "" FORCE)
set(ERUI_MAX_IMG_ROW_PIXELS 2560 CACHE STRING "" FORCE)
set(ERUI_IMAGE_REGISTRY_MAX 512 CACHE STRING "" FORCE)
# View backgroundGradient (linear and radial; also <Svg> gradient fills): about 5 KB of code, an 8 KB
# colour ramp and a 10 KB row per render worker; nodes without a gradient pay nothing per frame.
set(ERUI_GRADIENT ON CACHE BOOL "" FORCE)
set(ERUI_GRADIENT_RADIAL ON CACHE BOOL "" FORCE)
# Icons are <Svg> nodes: 128 geometry slots (4.5 KB each) and 32 cached static nodes (84 KB each),
# about 3.1 MB of .bss over the 8/2 defaults, so icons are not re-flattened on nearby repaints. 64
# slots ran out in Overdrive (its hidden library page keeps a heart per favorited card mounted), and
# the legend glyphs past the 64th drew nothing.
set(ERUI_MAX_VECTOR_NODES 128 CACHE STRING "" FORCE)
set(ERUI_VECTOR_CACHE_NODES 32 CACHE STRING "" FORCE)
# Per-frame js/layout/raster split for the frame log (native/shared/frame_stats.cpp): a clock read
# per phase, per backend blit and per bridge marshal call; no overlay is drawn.
set(ERUI_PERF_STATS ON CACHE BOOL "" FORCE)
# A screen transition keeps the leaving screen mounted while the next one is created, and an app may
# keep a page mounted while hidden to return to it without rebuilding it, so several full screens must
# fit at once; the bridge needs a handle per node. Node creation fails silently past this. The damage
# pre-pass and the dirty-flag sweep walk the whole pool on every commit.
set(ERUI_MAX_NODES 4096 CACHE STRING "" FORCE)
foreach(FEATURE SMOKE RUNTEST SPLITTEST GCTEST COMPILE)
  set(ER_BRIDGE_QUICKJS_${FEATURE} OFF CACHE BOOL "" FORCE)
endforeach()
add_subdirectory("${ER_ROOT}/bridges/quickjs" bridge)
# Every running motion key holds an engine animation and a completion slot; lift both pools from 64.
target_compile_definitions(embedded-react PRIVATE ERUI_MAX_ANIMATIONS=256)
target_compile_definitions(er-bridge-quickjs PRIVATE ER_BRIDGE_MAX_ANIM_COMPLETIONS=256 ER_BRIDGE_MAX_HANDLES=4096)
get_target_property(ENGINE_LIBRARIES embedded-react INTERFACE_LINK_LIBRARIES)
list(REMOVE_ITEM ENGINE_LIBRARIES m)
set_property(TARGET embedded-react PROPERTY INTERFACE_LINK_LIBRARIES "${ENGINE_LIBRARIES}")
add_library(er-software STATIC "${ER_ROOT}/backends/software/renderer_backend.c")
target_include_directories(er-software PUBLIC "${ER_ROOT}/backends/software")
target_link_libraries(er-software PUBLIC embedded-react)
