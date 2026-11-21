# Copyright (C) 2026 half144 and PS5 React contributors
# SPDX-License-Identifier: GPL-3.0-or-later
# Additional attribution term: see LICENSE-ATTRIBUTION.
# Cross-compilation to PS4 homebrew with the Open Orbis toolchain
# (github.com/OpenOrbis/OpenOrbis-PS4-Toolchain). Set OO_PS4_TOOLCHAIN to its root and pass
# this file with -DCMAKE_TOOLCHAIN_FILE. Ported libraries (SDL2, curl, libarchive, OpenSSL,
# zlib, xz) are searched under the toolchain root first. The toolchain's own clang driver
# carries the PS4 target; this file only pins compilers and search roots.
if(DEFINED ENV{OO_PS4_TOOLCHAIN} AND NOT OO_PS4_TOOLCHAIN)
  set(OO_PS4_TOOLCHAIN "$ENV{OO_PS4_TOOLCHAIN}" CACHE PATH "Open Orbis toolchain root")
endif()
if(NOT OO_PS4_TOOLCHAIN)
  message(FATAL_ERROR "OO_PS4_TOOLCHAIN must name the Open Orbis-PS4-Toolchain root (see docs/PS4.md)")
endif()

set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR x86_64)
set(CMAKE_C_COMPILER "${OO_PS4_TOOLCHAIN}/bin/clang")
set(CMAKE_CXX_COMPILER "${OO_PS4_TOOLCHAIN}/bin/clang++")
set(CMAKE_AR "${OO_PS4_TOOLCHAIN}/bin/llvm-ar" CACHE FILEPATH "ar")
set(CMAKE_RANLIB "${OO_PS4_TOOLCHAIN}/bin/llvm-ranlib" CACHE FILEPATH "ranlib")
set(CMAKE_STRIP "${OO_PS4_TOOLCHAIN}/bin/llvm-strip" CACHE FILEPATH "strip")

set(CMAKE_FIND_ROOT_PATH "${OO_PS4_TOOLCHAIN}" "${OO_PS4_TOOLCHAIN}/usr" "${OO_PS4_TOOLCHAIN}/lib")
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
