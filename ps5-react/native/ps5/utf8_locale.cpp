// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
//
// The console's libc has no UTF-8 locale (setlocale "C.UTF-8" fails), so libarchive, which asks it for
// the character set, could not read an archive entry named "PPSA15246 – USA ...". The title links
// these with --wrap: libarchive is told the character set is UTF-8 and converts multibyte text as UTF-8,
// so a UTF-8 name needs no conversion at all.
#include <cstddef>
#include <cstdint>
#include <cwchar>

extern "C" {
char* __real_nl_langinfo(int item);
constexpr int kCodeset = 0;  // FreeBSD's CODESET

char* __wrap_nl_langinfo(int item) {
  static char utf8[] = "UTF-8";
  return item == kCodeset ? utf8 : __real_nl_langinfo(item);
}

int __wrap____mb_cur_max() { return 4; }

std::size_t __wrap_mbrtowc(wchar_t* out, const char* in, std::size_t n, std::mbstate_t*) {
  if (!in) return 0;
  if (!n) return static_cast<std::size_t>(-2);
  const auto* s = reinterpret_cast<const unsigned char*>(in);
  std::uint32_t c = s[0];
  std::size_t length = c < 0x80 ? 1 : (c & 0xE0) == 0xC0 ? 2 : (c & 0xF0) == 0xE0 ? 3 : (c & 0xF8) == 0xF0 ? 4 : 0;
  if (!length) return static_cast<std::size_t>(-1);
  if (n < length) return static_cast<std::size_t>(-2);
  if (length > 1) c &= 0x3F >> (length - 1);
  for (std::size_t i = 1; i < length; ++i) {
    if ((s[i] & 0xC0) != 0x80) return static_cast<std::size_t>(-1);
    c = c << 6 | (s[i] & 0x3F);
  }
  // Overlong forms, surrogates and values past Unicode are not characters.
  static constexpr std::uint32_t kMinimum[] = {0, 0, 0x80, 0x800, 0x10000};
  if (c < kMinimum[length] || (c >= 0xD800 && c <= 0xDFFF) || c > 0x10FFFF) return static_cast<std::size_t>(-1);
  if (out) *out = static_cast<wchar_t>(c);
  return c ? length : 0;
}

std::size_t __wrap_wcrtomb(char* out, wchar_t wide, std::mbstate_t*) {
  char scratch[4];
  if (!out) { out = scratch; wide = 0; }
  const auto c = static_cast<std::uint32_t>(wide);
  if ((c >= 0xD800 && c <= 0xDFFF) || c > 0x10FFFF) return static_cast<std::size_t>(-1);
  if (c < 0x80) { out[0] = static_cast<char>(c); return 1; }
  if (c < 0x800) { out[0] = static_cast<char>(0xC0 | c >> 6); out[1] = static_cast<char>(0x80 | (c & 0x3F)); return 2; }
  if (c < 0x10000) {
    out[0] = static_cast<char>(0xE0 | c >> 12); out[1] = static_cast<char>(0x80 | (c >> 6 & 0x3F));
    out[2] = static_cast<char>(0x80 | (c & 0x3F)); return 3;
  }
  out[0] = static_cast<char>(0xF0 | c >> 18); out[1] = static_cast<char>(0x80 | (c >> 12 & 0x3F));
  out[2] = static_cast<char>(0x80 | (c >> 6 & 0x3F)); out[3] = static_cast<char>(0x80 | (c & 0x3F)); return 4;
}
}
