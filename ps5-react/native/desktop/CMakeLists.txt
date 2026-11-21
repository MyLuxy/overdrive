# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
cmake_minimum_required(VERSION 3.16)
project(ps5-react-preview C CXX)
find_package(SDL2 REQUIRED)
find_package(OpenGL REQUIRED)
find_package(CURL 7.85 REQUIRED)
find_package(Threads REQUIRED)
if(APPLE)
  foreach(FORMULA libarchive xz openssl@3)
    execute_process(COMMAND brew --prefix ${FORMULA} OUTPUT_VARIABLE FORMULA_PREFIX
      OUTPUT_STRIP_TRAILING_WHITESPACE ERROR_QUIET)
    if(FORMULA_PREFIX)
      list(PREPEND CMAKE_PREFIX_PATH "${FORMULA_PREFIX}")
    endif()
  endforeach()
endif()
find_package(LibArchive 3.7 REQUIRED)
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
# HarfBuzz (MIT) shapes and rasterizes runtime text (native/shared/text_shaper.cpp), with the
# same configuration as the PS5 build: OpenType shaping and outlines only, single-threaded.
add_library(harfbuzz STATIC "${HB_ROOT}/src/harfbuzz.cc" "${HB_ROOT}/src/hb-raster-draw.cc" "${HB_ROOT}/src/hb-raster-image.cc")
target_compile_features(harfbuzz PRIVATE cxx_std_17)
target_compile_definitions(harfbuzz PUBLIC HB_TINY HB_HAS_RASTER)
target_compile_options(harfbuzz PRIVATE -fno-exceptions -fno-rtti -w)
target_include_directories(harfbuzz PUBLIC "${HB_ROOT}/src")
# SheenBidi (Apache-2.0): the Unicode bidirectional algorithm for right-to-left text.
add_library(sheenbidi STATIC "${SB_ROOT}/Source/SheenBidi.c")
target_compile_definitions(sheenbidi PRIVATE SB_CONFIG_UNITY)
target_compile_options(sheenbidi PRIVATE -w)
target_include_directories(sheenbidi PUBLIC "${SB_ROOT}/Headers" PRIVATE "${SB_ROOT}/Source")
# Same engine options on desktop and PS5, rather than the upstream demo's profile.
add_subdirectory("${CMAKE_CURRENT_SOURCE_DIR}/../ps5" runtime)
add_executable(ps5-react-preview host.cpp host_platform.cpp network_platform.cpp ../shared/network.cpp ../shared/network_api.cpp ../shared/archives.cpp ../shared/archive_writer.cpp rar_worker_process.cpp ../shared/archive_preflight.cpp ../shared/rar5_password.cpp ../shared/archive_api.cpp ../shared/package_api.cpp ../shared/pkg_proxy.cpp package_installer.cpp ../shared/browser_capture_api.cpp browser_capture.cpp ../shared/lan.cpp ../shared/lan_api.cpp ../shared/image_loader.cpp ../shared/image_api.cpp ../shared/sound_api.cpp ../shared/audio_sink.cpp ../shared/audio_output_api.cpp ../shared/host_api.cpp ../shared/removals.cpp "${HUI_ROOT}/src/audio/mixer.cpp" ../shared/gl_presenter.cpp ../shared/frame_stats.cpp ../shared/js_heap.cpp ../shared/js_profiler.cpp ../shared/damage_tracker.cpp ../shared/render_workers.cpp ../shared/input_script.cpp ../shared/screenshot.cpp ../shared/text_shaper.cpp ../shared/video_player.cpp ../shared/video_subtitles.cpp ../shared/video_api.cpp ../shared/gl_video.cpp ../shared/gl_upscale.cpp video_decoder.cpp control.cpp "${APP_LAYOUT}/assets.generated.c" "${APP_LAYOUT}/sounds.generated.c")
target_compile_features(ps5-react-preview PRIVATE cxx_std_20)
target_compile_options(ps5-react-preview PRIVATE -Wall -Wextra -Werror)
target_include_directories(ps5-react-preview PRIVATE ../shared "${APP_GENERATED}" "${STB_IMAGE_DIR}" "${HUI_ROOT}/src" "${ER_ROOT}/engine/text")
# The preview reads the app's subset fonts where the bundle step writes them; the PS5 reads /app0/fonts.
target_compile_definitions(ps5-react-preview PRIVATE PS5_REACT_FONT_DIR="${APP_GENERATED}/fonts"
  PS5_REACT_WIDTH=${APP_LAYOUT_WIDTH} PS5_REACT_HEIGHT=${APP_LAYOUT_HEIGHT})
if(APPLE)
  target_compile_definitions(ps5-react-preview PRIVATE GL_SILENCE_DEPRECATION)
endif()
target_link_libraries(ps5-react-preview PRIVATE SDL2::SDL2 OpenGL::GL CURL::libcurl Threads::Threads LibArchive::LibArchive LibLZMA::LibLZMA OpenSSL::Crypto ZLIB::ZLIB er-bridge-quickjs er-software harfbuzz sheenbidi)
# Video: the pinned FFmpeg, built static by tools/ffmpeg.py.
# BEFORE: Homebrew's own FFmpeg headers sit in the SDL include directory, and must not be the ones seen.
target_include_directories(ps5-react-preview BEFORE PRIVATE "${FFMPEG_PREFIX}/include")
foreach(LIBRARY avformat avcodec swscale swresample avutil)
  target_link_libraries(ps5-react-preview PRIVATE "${FFMPEG_PREFIX}/lib/lib${LIBRARY}.a")
endforeach()
if(APPLE)
  target_link_libraries(ps5-react-preview PRIVATE "-framework VideoToolbox" "-framework CoreFoundation" "-framework CoreMedia"
                        "-framework CoreVideo" "-framework CoreServices" "-framework Security")
else()
  # FFmpeg's https/tls protocols use the system OpenSSL on Linux.
  target_link_libraries(ps5-react-preview PRIVATE OpenSSL::SSL OpenSSL::Crypto)
endif()
# tools/test_video.py: the player in real time on a short clip, with a stand-in mixer.
add_executable(ps5-react-video-test EXCLUDE_FROM_ALL ../../tools/tests/video_client.cpp ../shared/video_player.cpp ../shared/video_subtitles.cpp ../shared/audio_sink.cpp video_decoder.cpp)
target_compile_features(ps5-react-video-test PRIVATE cxx_std_20)
target_compile_options(ps5-react-video-test PRIVATE -Wall -Wextra -Werror)
target_include_directories(ps5-react-video-test BEFORE PRIVATE "${FFMPEG_PREFIX}/include")
target_include_directories(ps5-react-video-test PRIVATE ../shared "${HUI_ROOT}/src")
foreach(LIBRARY avformat avcodec swscale swresample avutil)
  target_link_libraries(ps5-react-video-test PRIVATE "${FFMPEG_PREFIX}/lib/lib${LIBRARY}.a")
endforeach()
target_link_libraries(ps5-react-video-test PRIVATE Threads::Threads)
if(APPLE)
  target_link_libraries(ps5-react-video-test PRIVATE "-framework VideoToolbox" "-framework CoreFoundation" "-framework CoreMedia"
                        "-framework CoreVideo" "-framework CoreServices" "-framework Security")
endif()
# tools/test_passthrough.py: the IEC 61937 packer against FFmpeg's spdif muxer, and the EDID audio parser.
add_executable(ps5-react-passthrough-test EXCLUDE_FROM_ALL ../../tools/tests/passthrough_client.cpp ../shared/audio_sink.cpp)
target_compile_features(ps5-react-passthrough-test PRIVATE cxx_std_20)
target_compile_options(ps5-react-passthrough-test PRIVATE -Wall -Wextra -Werror)
target_include_directories(ps5-react-passthrough-test PRIVATE ../shared)
# tools/test_text.py: line breaking through the shaper with the app's fonts, without a window.
add_executable(ps5-react-text-test EXCLUDE_FROM_ALL ../../tools/tests/text_client.cpp ../shared/text_shaper.cpp "${APP_LAYOUT}/assets.generated.c")
target_compile_features(ps5-react-text-test PRIVATE cxx_std_20)
target_compile_options(ps5-react-text-test PRIVATE -Wall -Wextra -Werror)
target_include_directories(ps5-react-text-test PRIVATE ../shared "${APP_GENERATED}" "${ER_ROOT}/engine/text")
target_link_libraries(ps5-react-text-test PRIVATE er-bridge-quickjs harfbuzz sheenbidi)
