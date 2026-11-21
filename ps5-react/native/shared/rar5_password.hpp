// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <archive.h>
#include <atomic>
#include <memory>
#include <string>
#include <vector>
namespace archives {
// Presents decrypted RAR5 headers/data to libarchive without copying whole archives to disk.
// The RAR5 compression decoder, path checks and output receipts remain the existing worker's.
class Rar5PasswordReader {
public:
  static bool matches(const std::string &path);
  Rar5PasswordReader(const std::vector<std::string> &paths, const std::string &password,
                     const std::atomic<bool> &cancelled);
  ~Rar5PasswordReader();
  static la_ssize_t read(archive *archive, void *client, const void **buffer);
  const std::string &error() const;
  bool verify(const std::string &name, std::uint32_t crc) const;

private:
  struct State;
  std::unique_ptr<State> state;
};
} // namespace archives
