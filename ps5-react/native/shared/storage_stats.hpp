// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once

#include <cstdint>
#include <cstring>

namespace storage {
// Convert before multiplying: block counts can exceed integer byte ranges.
// Negative available blocks represent exhausted user space, not negative bytes.
inline bool disk_bytes(std::uint64_t block_size, std::uint64_t blocks,
                       std::int64_t available, double& total, double& free) {
  if (!block_size) return false;
  const auto usable = available > 0 ? static_cast<std::uint64_t>(available) : 0;
  total = static_cast<double>(block_size) * static_cast<double>(blocks);
  free = static_cast<double>(block_size) * static_cast<double>(usable < blocks ? usable : blocks);
  return true;
}

// Several accessible paths can describe the same mount. Different mount paths
// remain distinct even when backed by the same device (for example nullfs).
template <typename Entry>
inline void append_unique(Entry* entries, int capacity, int& count, const Entry& entry) {
  for (int i = 0; i < count; ++i)
    if (!std::strcmp(entries[i].path, entry.path) &&
        !std::strcmp(entries[i].device, entry.device) &&
        !std::strcmp(entries[i].type, entry.type)) return;
  if (count < capacity) entries[count++] = entry;
}
} // namespace storage
