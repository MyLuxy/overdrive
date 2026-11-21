# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
# The PS4 host builds the desktop preview's file set against the Open Orbis toolchain: the same
# SDL2 entry point (../desktop/host.cpp) with the platform layer and the console-specific stubs
# from this directory. See native/ps4/README.md for the per-component status.
cmake_minimum_required(VERSION 3.16)
project(ps5-react-ps4 C CXX)
find_package(SDL2 REQUIRED)
find_package(CURL REQUIRED)
find_package(Threads REQUIRED)
find_package(LibArchive REQUIRED)
find_package(LibLZMA REQUIRED)
find_package(OpenSSL REQUIRED)
find_package(ZLIB REQUIRED)
get_target_property(SDL_INCLUDES SDL2::SDL2 INTERFACE_INCLUDE_DIRECTORIES)
foreach(SDL_INCLUDE IN LISTS SDL_INCLUDES)
  if(EXISTS "${SDL_INCLUDE}/SDL.h")
    get_filename_component(SDL_PARENT "${SDL_INCLUDE}" DIRECTORY)
    include_directories("${SDL_PARENT}")
  endif()
endforeach()
# HarfBuzz (MIT) and SheenBidi (Apache-2.0) shape and rasterize runtime text, exactly as the
# desktop and PS5 builds do.
add_library(harfbuzz STATIC "${HB_ROOT}/src/harfbuzz.cc" "${HB_ROOT}/src/hb-raster-draw.cc" "${HB_ROOT}/src/hb-raster-image.cc")
target_compile_features(harfbuzz PRIVATE cxx_std_17)
target_compile_definitions(harfbuzz PUBLIC HB_TINY HB_HAS_RASTER)
target_compile_options(harfbuzz PRIVATE -fno-exceptions -fno-rtti -w)
target_include_directories(harfbuzz PUBLIC "${HB_ROOT}/src")
add_library(sheenbidi STATIC "${SB_ROOT}/Source/SheenBidi.c")
target_compile_definitions(sheenbidi PRIVATE SB_CONFIG_UNITY)
target_compile_options(sheenbidi PRIVATE -w)
target_include_directories(sheenbidi PUBLIC "${SB_ROOT}/Headers" PRIVATE "${SB_ROOT}/Source")
# The React engine is platform-independent C: the PS5 runtime subdirectory builds it unchanged.
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../ps5" runtime)
add_executable(overdrive-ps4 ../desktop/host.cpp ../desktop/control.cpp ../desktop/network_platform.cpp
  ../desktop/video_decoder.cpp host_platform.cpp rar_worker_process.cpp package_installer.cpp browser_capture.cpp
  ../shared/network.cpp ../shared/network_api.cpp ../shared/archives.cpp ../shared/archive_writer.cpp
  ../shared/archive_preflight.cpp ../shared/rar5_password.cpp ../shared/archive_api.cpp ../shared/package_api.cpp
  ../shared/pkg_proxy.cpp ../shared/browser_capture_api.cpp ../shared/lan.cpp ../shared/lan_api.cpp
  ../shared/image_loader.cpp ../shared/image_api.cpp ../shared/sound_api.cpp ../shared/audio_sink.cpp
  ../shared/audio_output_api.cpp ../shared/host_api.cpp ../shared/removals.cpp
  "${HUI_ROOT}/src/audio/mixer.cpp" ../shared/gl_presenter.cpp ../shared/frame_stats.cpp ../shared/js_heap.cpp
  ../shared/js_profiler.cpp ../shared/damage_tracker.cpp ../shared/render_workers.cpp ../shared/input_script.cpp
  ../shared/screenshot.cpp ../shared/text_shaper.cpp "${APP_LAYOUT}/assets.generated.c" "${APP_LAYOUT}/sounds.generated.c")
target_compile_features(overdrive-ps4 PRIVATE cxx_std_20)
target_compile_options(overdrive-ps4 PRIVATE -Wall -Wextra)
target_include_directories(overdrive-ps4 PRIVATE ../shared ../desktop "${APP_GENERATED}" "${STB_IMAGE_DIR}" "${HUI_ROOT}/src" "${ER_ROOT}/engine/text")
target_compile_definitions(overdrive-ps4 PRIVATE PS5_REACT_FONT_DIR="${APP_GENERATED}/fonts"
  PS5_REACT_WIDTH=${APP_LAYOUT_WIDTH} PS5_REACT_HEIGHT=${APP_LAYOUT_HEIGHT})
if(PS4_REACT_VIDEO AND FFMPEG_PREFIX)
  target_include_directories(overdrive-ps4 BEFORE PRIVATE "${FFMPEG_PREFIX}/include")
  foreach(LIBRARY avformat avcodec swscale swresample avutil)
    target_link_libraries(overdrive-ps4 PRIVATE "${FFMPEG_PREFIX}/lib/lib${LIBRARY}.a")
  endforeach()
  target_link_libraries(overdrive-ps4 PRIVATE OpenSSL::SSL OpenSSL::Crypto)
endif()
target_link_libraries(overdrive-ps4 PRIVATE SDL2::SDL2 CURL::libcurl Threads::Threads LibArchive::LibArchive
  LibLZMA::LibLZMA OpenSSL::Crypto ZLIB::ZLIB er-bridge-quickjs er-software harfbuzz sheenbidi)
