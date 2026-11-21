// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Lays out text through native/shared/text_shaper.cpp for tools/test_text.py, with text-lab's baked
// Inter and runtime fonts. Each stdin line is a request, answered by one stdout line:
//   lines <language> <family> <size> <max_w> <text>  ->  <engine line count> <widest line> <start>:<end> ...
//   clip <max_bytes> <text>                          ->  <bytes er_utf8_clip keeps>
// Fields are tab separated.
#include "host_api.hpp"
#include "text_shaper.hpp"

#include "er_scene.h"
#include "er_text_shaper.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>

extern "C" void er_register_assets(void);
// The engine's renderer initializes its font registry; without one, every family is the built-in Inter.
extern "C" void font_registry_init(void);

namespace host {
void device_info(DeviceInfo& info) { std::strcpy(info.language, "en"); }
}  // namespace host

int main(int argc, char** argv) {
  if (argc != 2) {
    std::fprintf(stderr, "usage: %s <font directory>\n", argv[0]);
    return 2;
  }
  font_registry_init();
  er_register_assets();
  text_shaper::install(argv[1], [](const char* line) { std::fprintf(stderr, "%s\n", line); });
  std::string request;
  while (std::getline(std::cin, request)) {
    std::vector<std::string> field;
    std::stringstream stream(request);
    for (std::string part; std::getline(stream, part, '\t');) field.push_back(part);
    if (field.size() == 3 && field[0] == "clip") {
      std::printf("%zu\n", er_utf8_clip(field[2].c_str(), std::strtoul(field[1].c_str(), nullptr, 10)));
    } else if (field.size() == 6 && field[0] == "lines") {
      text_shaper::set_language(field[1].c_str());
      const char* family = field[2].c_str();
      const int size = std::atoi(field[3].c_str()), max_w = std::atoi(field[4].c_str());
      const char* text = field[5].c_str();
      int width = 0;
      // What layout sizes the node with: the engine's wrap, through the shaper's claims().
      std::printf("%d", er_text_wrap(text, nullptr, 0, static_cast<std::uint8_t>(size), family, 0, 0, max_w, 0, &width));
      std::printf(" %d", width);
      for (const auto& [start, end] : text_shaper::lines(text, family, size, max_w)) std::printf(" %d:%d", start, end);
      std::printf("\n");
    } else {
      std::fprintf(stderr, "bad request: %s\n", request.c_str());
      return 2;
    }
    std::fflush(stdout);
  }
  text_shaper::shutdown();
  return 0;
}
