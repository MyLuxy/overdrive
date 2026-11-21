// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
namespace archives {
inline constexpr std::uint64_t max_entries = 1000000;
inline constexpr std::size_t max_metadata_bytes = 16 * 1024 * 1024;
// `stream`: a RAR set whose later volumes are still downloading. Only the first exists yet; each next one is
// read once its final name appears.
struct Request { std::vector<std::string> sources; std::string destination, password; std::uint64_t max_bytes = 1024ULL*1024*1024*1024; bool stream = false; };
// While extracting, `phase` is "extracting" until every entry is decoded, then "finishing" while the files
// are flushed and synced and the set is published. `synced` of `sync_total` files are on disk then, both 0
// where the writer cannot tell (inline writes, the RAR worker). `total` is what the files unpack to, once
// known before they are written (the RAR worker reads it from every volume's headers), else 0.
struct Snapshot {
  std::uint32_t id = 0; std::string state = "queued", error, destination, phase;
  std::uint64_t written = 0, total = 0, entries = 0, synced = 0, sync_total = 0;
  std::vector<std::string> artifacts;
};
std::uint32_t enqueue(Request request, std::string& error);
void cancel(std::uint32_t id);
std::vector<Snapshot> poll();
void stop();
// The names in a directory, from the host's own listing (a console title cannot use opendir).
bool list_directory(const char* path, void (*visit)(const char* name, void* user), void* user);
// Each extraction step, for the console's crash log; the host defines it (a no-op on the desktop).
void trace(const char* step, const char* detail = "");
// Bytes the host lets one extraction hold for buffered writes; under 1 MiB, files are written inline.
// `decoder` is what the archive's own decoder will take, as the preflight measured it (0: the 64 MiB
// ceiling the preflight admits). `measured`: the preflight read that figure from the archive's folders,
// so a 0 is an archive that stores and needs nothing, rather than a size nobody knows.
std::size_t pipeline_bytes(std::uint64_t decoder = 0, bool measured = false);
// Called with true before an in-process (libarchive) extraction opens its archive and with false after
// it ends. The host frees what it can for it; false means the heap lacks room even for inline writes,
// and the job fails with no_memory instead of the title running out of heap. `decoder` is what the
// archive's decoder will take besides them (0: the 64 MiB ceiling), and `measured` says whether that 0
// is a measured none (see pipeline_bytes).
bool hold_memory(bool hold, std::uint64_t decoder = 0, bool measured = false);
inline constexpr const char* no_memory = "Not enough memory to extract.";
// True while the host downloads a file; a RAR extraction then leaves it more cores. Cheap, any thread.
bool downloading();
// RAR sets go to rar-extract (native/rar_worker), a program of its own: UnRAR's license keeps its code
// out of this engine. So does a 7z whose decoder needs more memory than this heap gives, within the
// worker's budget, and any 7z the heap has no room for when its extraction starts: the worker has the
// console's memory. The host starts it with `request` as its input
// (the console's payload loader, a child process on the desktop) and returns its stream, or -1 with
// `error` when it cannot.
int start_rar_worker(const std::string& request, std::string& error);
// Bytes of its output; 0 at its end, -1 when none came within about a quarter second or on an error.
long read_rar_worker(int stream, char* data, std::size_t size);
void cancel_rar_worker(int stream);
void close_rar_worker(int stream);
}
