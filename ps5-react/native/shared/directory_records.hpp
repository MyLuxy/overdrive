// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace host {
// FreeBSD 9 / PS5 getdents records: inode32, length16, type8, nameLength8.
// Copy the header instead of dereferencing an unaligned or truncated dirent.
inline bool visit_directory_records(const char* bytes, std::size_t size,
                                    void (*visit)(const char*, void*), void* user) {
  constexpr std::size_t header_size = 8;
  for (std::size_t offset = 0; offset < size;) {
    const std::size_t remaining = size - offset;
    if (remaining < header_size) return false;
    std::uint32_t inode;
    std::uint16_t length;
    std::memcpy(&inode, bytes + offset, sizeof inode);
    std::memcpy(&length, bytes + offset + 4, sizeof length);
    const auto name_length = static_cast<unsigned char>(bytes[offset + 7]);
    if (length < header_size + 1 || length > remaining ||
        name_length >= length - header_size) return false;
    const char* name = bytes + offset + header_size;
    if (name[name_length] != '\0' || std::memchr(name, '\0', name_length) ||
        std::memchr(name, '/', name_length)) return false;
    if (inode && name_length && std::strcmp(name, ".") && std::strcmp(name, ".."))
      visit(name, user);
    offset += length;
  }
  return true;
}
} // namespace host
