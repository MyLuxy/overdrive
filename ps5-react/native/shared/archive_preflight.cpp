// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "archive_preflight.hpp"
#include "archives.hpp"
#include <lzma.h>
#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <string_view>
#include <sys/stat.h>
#include <unistd.h>

namespace archives {
// A RAR's headers sit between its files' data, each a disk read of its own, and inspect() runs on the
// render thread: walking thousands of them while a download filled the drive held a tester's screen
// for over 40 s.
std::chrono::milliseconds inspect_budget{100};
namespace {
// libarchive sizes its decoder windows from the archive and has no memory limit option, while the title
// shares one heap (128 MiB on a console that leaves little flexible memory) and a failed allocation
// inside libarchive aborts the app. 64 MiB fits that floor because an app's
// queue never downloads while it extracts (downloads alone peak past 100 MiB), and it admits 7-Zip ultra
// and WinRAR 7's default 32 MB dictionary, which libarchive doubles. Only archive-declared windows count;
// fixed decoder state (bzip2's 3.6 MiB, LZMA's 30 KiB) does not.
constexpr std::uint64_t max_decoder_memory = 64ULL * 1024 * 1024;
constexpr std::uint64_t mib = 1024 * 1024;
constexpr std::uint64_t unbounded = UINT64_MAX;
constexpr unsigned max_coders = 64;
constexpr std::uint64_t max_7z_header_bytes = 32ULL * 1024 * 1024;
const std::string too_much_memory = "This archive needs more memory to extract than the console app can use.";
const std::string malformed = "Unsupported or incomplete archive.";
const std::string too_many_entries = "Archive has too many entries.";
// A partial walk always reaches the first file header, then stops at the first header it starts past
// the budget.
bool within(bool partial, bool file_seen, std::chrono::steady_clock::time_point deadline) {
  return !partial || !file_seen || std::chrono::steady_clock::now() < deadline;
}

std::uint64_t little_endian(const unsigned char* bytes, unsigned count) {
  std::uint64_t value = 0;
  for (unsigned i = count; i--;) value = value << 8 | bytes[i];
  return value;
}

// The ordered volumes as the one byte stream libarchive reads.
class Volumes {
public:
  explicit Volumes(const std::vector<std::string>& paths) : paths_(paths) {
    for (const auto& path : paths_) {
      struct stat st;
      starts_.push_back(total_);
      if (!stat(path.c_str(), &st) && st.st_size > 0) total_ += st.st_size;
    }
  }
  Volumes(const Volumes&) = delete;
  Volumes& operator=(const Volumes&) = delete;
  ~Volumes() {
    if (fd_ >= 0) close(fd_);
  }
  std::uint64_t size() const { return total_; }
  bool read(std::uint64_t offset, void* out, std::size_t size) {
    if (offset > total_ || size > total_ - offset) return false;
    auto* target = static_cast<unsigned char*>(out);
    while (size) {
      const auto volume = static_cast<std::size_t>(std::upper_bound(starts_.begin(), starts_.end(), offset) - starts_.begin()) - 1;
      if (volume != open_ && !open(volume)) return false;
      const auto end = volume + 1 < starts_.size() ? starts_[volume + 1] : total_;
      const auto wanted = static_cast<std::size_t>(std::min<std::uint64_t>(size, end - offset));
      const auto count = pread(fd_, target, wanted, static_cast<off_t>(offset - starts_[volume]));
      if (count < 0 && errno == EINTR) continue;
      if (count <= 0) return false;
      target += count;
      offset += count;
      size -= count;
    }
    return true;
  }

private:
  bool open(std::size_t volume) {
    if (fd_ >= 0) close(fd_);
    fd_ = ::open(paths_[volume].c_str(), O_RDONLY | O_NOFOLLOW);
    open_ = volume;
    return fd_ >= 0;
  }
  const std::vector<std::string>& paths_;
  std::vector<std::uint64_t> starts_;
  std::uint64_t total_ = 0;
  std::size_t open_ = SIZE_MAX;
  int fd_ = -1;
};

struct Cursor {
  const unsigned char* at;
  const unsigned char* end;
  bool ok = true;
  unsigned char byte() {
    if (at == end) {
      ok = false;
      return 0;
    }
    return *at++;
  }
  void skip(std::uint64_t count) {
    if (count > static_cast<std::uint64_t>(end - at)) ok = false;
    at += std::min<std::uint64_t>(count, end - at);
  }
  std::uint64_t fixed(unsigned count) {
    std::array<unsigned char, 8> bytes{};
    for (unsigned i = 0; i < count; ++i) bytes[i] = byte();
    return little_endian(bytes.data(), count);
  }
  // RAR5 and xz: seven bits per byte, low bits first.
  std::uint64_t vint() {
    std::uint64_t value = 0;
    for (unsigned shift = 0; shift < 64; shift += 7) {
      const auto next = byte();
      value |= static_cast<std::uint64_t>(next & 0x7F) << shift;
      if (!(next & 0x80)) return value;
    }
    ok = false;
    return 0;
  }
  // 7z: the leading one bits of the first byte count the little-endian bytes that follow.
  std::uint64_t number() {
    const auto first = byte();
    std::uint64_t value = 0;
    for (unsigned i = 0; i < 8; ++i) {
      const unsigned mask = 0x80u >> i;
      if (!(first & mask)) return value | static_cast<std::uint64_t>(first & (mask - 1)) << (8 * i);
      value |= static_cast<std::uint64_t>(byte()) << (8 * i);
    }
    return value;
  }
};

std::uint64_t lzma2_dictionary(unsigned bits) {
  if (bits > 40) return unbounded;
  if (bits == 40) return 0xFFFFFFFF;
  return static_cast<std::uint64_t>(2 | (bits & 1)) << (bits / 2 + 11);
}

// Only the first block is read; a later block declaring a larger dictionary is not caught.
std::uint64_t xz_window(Volumes& in, std::uint64_t at) {
  std::array<unsigned char, 13> head{};
  if (!in.read(at, head.data(), head.size()) || std::memcmp(head.data(), "\xFD" "7zXZ\0", 6) || !head[12]) return 0;
  std::vector<unsigned char> block((head[12] + 1) * 4);
  if (!in.read(at + 12, block.data(), block.size())) return 0;
  Cursor cursor{block.data() + 2, block.data() + block.size()};
  const unsigned flags = block[1];
  if (flags & 0x40) cursor.vint();
  if (flags & 0x80) cursor.vint();
  std::uint64_t window = 0;
  for (unsigned filter = 0; filter <= (flags & 3); ++filter) {
    const auto id = cursor.vint();
    const auto size = cursor.vint();
    if (id == 0x21 && size == 1) window = std::max(window, lzma2_dictionary(cursor.byte()));
    else cursor.skip(size);
  }
  return cursor.ok ? window : unbounded;
}

// Only the first frame is read; a later frame declaring a larger window is not caught.
std::uint64_t zstd_window(Volumes& in, std::uint64_t at) {
  std::array<unsigned char, 8> head{};
  for (unsigned skipped = 0; skipped < 16 && in.read(at, head.data(), head.size()); ++skipped) {
    if ((little_endian(head.data(), 4) & 0xFFFFFFF0) != 0x184D2A50) break;
    at += 8 + little_endian(head.data() + 4, 4);
  }
  if (!in.read(at, head.data(), 6) || little_endian(head.data(), 4) != 0xFD2FB528) return 0;
  const unsigned descriptor = head[4];
  if (!(descriptor & 0x20)) {
    const auto base = 1ULL << (10 + (head[5] >> 3));
    return base + base / 8 * (head[5] & 7);
  }
  // A single-segment frame decodes into one buffer of its content size.
  constexpr std::array<unsigned, 4> id_bytes{0, 1, 2, 4}, size_bytes{1, 2, 4, 8};
  const auto count = size_bytes[descriptor >> 6];
  if (!in.read(at + 5 + id_bytes[descriptor & 3], head.data(), count)) return 0;
  return little_endian(head.data(), count) + (count == 2 ? 256 : 0);
}

std::uint64_t lzip_window(Volumes& in) {
  std::array<unsigned char, 6> head{};
  if (!in.read(0, head.data(), head.size()) || std::memcmp(head.data(), "LZIP", 4)) return 0;
  const auto base = 1ULL << (head[5] & 0x1F);
  return base - base / 16 * ((head[5] >> 5) & 7);
}

// .lzma has no magic; libarchive only recognises 2^n and 3*2^n dictionaries, which tar names never form.
std::uint64_t lzma_alone_window(Volumes& in) {
  std::array<unsigned char, 5> head{};
  if (!in.read(0, head.data(), head.size()) || head[0] >= 225) return 0;
  const auto dictionary = little_endian(head.data() + 1, 4);
  const auto low = dictionary & (~dictionary + 1);
  const auto rest = dictionary - low;
  return dictionary && (!rest || rest == 2 * low) ? dictionary : 0;
}

std::string fits(std::uint64_t memory) { return memory > max_decoder_memory ? too_much_memory : std::string(); }

namespace seven_zip {
enum : std::uint64_t {
  copy = 0x00, lzma = 0x030101, lzma2 = 0x21, ppmd = 0x030401, bcj2 = 0x0303011B, zstd = 0x04F71101,
};
namespace property {
enum : unsigned char {
  end = 0x00, header = 0x01, archive_properties = 0x02, additional_streams = 0x03, main_streams = 0x04,
  files = 0x05, pack_info = 0x06, unpack_info = 0x07, substreams = 0x08, size = 0x09, crc = 0x0A,
  folder = 0x0B, unpack_size = 0x0C, unpack_streams = 0x0D, encoded_header = 0x17,
};
}
constexpr std::uint64_t signature_size = 32;
constexpr unsigned max_header_passes = 4;

struct Coder {
  std::uint64_t method = copy, inputs = 1, outputs = 1;
  std::vector<unsigned char> properties;
};
struct Folder {
  std::vector<Coder> coders;
  std::vector<std::pair<std::uint64_t, std::uint64_t>> bindings;
  std::vector<std::uint64_t> packed, sizes;
  std::uint64_t first_pack = 0, streams = 1;
  bool crc = false;
};
struct Streams {
  std::uint64_t pack_position = 0;
  std::vector<std::uint64_t> pack_sizes;
  std::vector<Folder> folders;
};

std::vector<bool> digests(Cursor& cursor, std::uint64_t count) {
  std::vector<bool> defined(count, true);
  if (!cursor.byte()) {
    unsigned char bits = 0;
    for (std::uint64_t i = 0; i < count; ++i) {
      if (!(i % 8)) bits = cursor.byte();
      defined[i] = bits & (0x80 >> (i % 8));
    }
  }
  cursor.skip(4 * static_cast<std::uint64_t>(std::count(defined.begin(), defined.end(), true)));
  return defined;
}

bool parse_pack_info(Cursor& cursor, Streams& streams) {
  streams.pack_position = cursor.number();
  const auto count = cursor.number();
  if (count > max_entries) return false;
  streams.pack_sizes.assign(count, 0);
  while (cursor.ok) {
    const auto id = cursor.byte();
    if (id == property::end) return true;
    if (id == property::size) {
      for (auto& value : streams.pack_sizes) value = cursor.number();
    } else if (id == property::crc) {
      digests(cursor, count);
    } else {
      return false;
    }
  }
  return false;
}

bool parse_folder(Cursor& cursor, Folder& folder) {
  const auto count = cursor.number();
  if (!count || count > max_coders) return false;
  std::uint64_t inputs = 0, outputs = 0;
  for (std::uint64_t i = 0; i < count && cursor.ok; ++i) {
    Coder coder;
    const auto flags = cursor.byte();
    const unsigned id_size = flags & 0x0F;
    // Bit 0x80 announces alternative methods, which neither 7-Zip nor libarchive write or read.
    if (id_size > 8 || (flags & 0x80)) return false;
    coder.method = 0;
    for (unsigned b = 0; b < id_size; ++b) coder.method = coder.method << 8 | cursor.byte();
    if (flags & 0x10) {
      coder.inputs = cursor.number();
      coder.outputs = cursor.number();
      if (coder.inputs > max_coders || coder.outputs > max_coders) return false;
    }
    if (flags & 0x20) {
      const auto size = cursor.number();
      if (size > static_cast<std::uint64_t>(cursor.end - cursor.at)) return false;
      coder.properties.assign(cursor.at, cursor.at + size);
      cursor.skip(size);
    }
    inputs += coder.inputs;
    outputs += coder.outputs;
    folder.coders.push_back(std::move(coder));
  }
  if (!outputs || inputs < outputs - 1) return false;
  for (std::uint64_t i = 0; i + 1 < outputs; ++i) {
    const auto input = cursor.number();
    const auto output = cursor.number();
    folder.bindings.emplace_back(input, output);
  }
  const auto packed = inputs - (outputs - 1);
  if (packed == 1) {
    for (std::uint64_t input = 0; input < inputs; ++input) {
      const auto bound = std::any_of(folder.bindings.begin(), folder.bindings.end(), [&](const auto& binding) { return binding.first == input; });
      if (!bound) folder.packed.push_back(input);
    }
    return cursor.ok && folder.packed.size() == 1;
  }
  for (std::uint64_t i = 0; i < packed; ++i) folder.packed.push_back(cursor.number());
  return cursor.ok;
}

bool parse_unpack_info(Cursor& cursor, Streams& streams) {
  if (cursor.byte() != property::folder) return false;
  const auto count = cursor.number();
  if (count > max_entries || cursor.byte()) return false;
  streams.folders.resize(count);
  std::uint64_t first_pack = 0;
  for (auto& item : streams.folders) {
    if (!parse_folder(cursor, item)) return false;
    item.first_pack = first_pack;
    first_pack += item.packed.size();
    std::uint64_t outputs = 0;
    for (const auto& coder : item.coders) outputs += coder.outputs;
    item.sizes.resize(outputs);
  }
  if (cursor.byte() != property::unpack_size) return false;
  for (auto& item : streams.folders) for (auto& value : item.sizes) value = cursor.number();
  while (cursor.ok) {
    const auto id = cursor.byte();
    if (id == property::end) return true;
    if (id != property::crc) return false;
    const auto defined = digests(cursor, count);
    for (std::uint64_t i = 0; i < count; ++i) streams.folders[i].crc = defined[i];
  }
  return false;
}

bool parse_substreams(Cursor& cursor, Streams& streams) {
  while (cursor.ok) {
    const auto id = cursor.byte();
    if (id == property::end) return true;
    if (id == property::unpack_streams) {
      std::uint64_t total = 0;
      for (auto& item : streams.folders) {
        item.streams = cursor.number();
        if (item.streams > max_entries - total) return false;
        total += item.streams;
      }
    } else if (id == property::size) {
      for (const auto& item : streams.folders) for (std::uint64_t i = 1; i < item.streams; ++i) cursor.number();
    } else if (id == property::crc) {
      std::uint64_t unknown = 0;
      for (const auto& item : streams.folders) unknown += item.streams == 1 && item.crc ? 0 : item.streams;
      digests(cursor, unknown);
    } else return false;
  }
  return false;
}

bool parse_streams(Cursor& cursor, Streams& streams) {
  while (cursor.ok) {
    const auto id = cursor.byte();
    if (id == property::end) return true;
    const bool ok = id == property::pack_info ? parse_pack_info(cursor, streams)
                  : id == property::unpack_info ? parse_unpack_info(cursor, streams)
                  : id == property::substreams && parse_substreams(cursor, streams);
    if (!ok) return false;
  }
  return false;
}

// A folder decodes as one unit, so its coders' windows are held at the same time.
std::uint64_t folder_memory(const Folder& item, const Streams& streams, Volumes& in) {
  std::uint64_t memory = 0, input = 0;
  auto pack_offset = [&](std::uint64_t index) {
    std::uint64_t offset = signature_size + streams.pack_position;
    for (std::uint64_t i = 0; i < index && i < streams.pack_sizes.size(); ++i) offset += streams.pack_sizes[i];
    return offset;
  };
  // A coder input is fed either by another coder's output or by a packed stream.
  auto source_size = [&](std::uint64_t index) -> std::uint64_t {
    for (const auto& [bound_input, output] : item.bindings)
      if (bound_input == index) return output < item.sizes.size() ? item.sizes[output] : unbounded;
    const auto at = static_cast<std::size_t>(std::find(item.packed.begin(), item.packed.end(), index) - item.packed.begin());
    const auto pack = item.first_pack + at;
    return at < item.packed.size() && pack < streams.pack_sizes.size() ? streams.pack_sizes[pack] : unbounded;
  };
  for (const auto& coder : item.coders) {
    const auto& properties = coder.properties;
    std::uint64_t need = 0;
    if ((coder.method == lzma || coder.method == ppmd) && properties.size() >= 5) need = little_endian(properties.data() + 1, 4);
    else if (coder.method == lzma2 && !properties.empty()) need = lzma2_dictionary(properties[0]);
    else if (coder.method == zstd) {
      const auto at = static_cast<std::size_t>(std::find(item.packed.begin(), item.packed.end(), input) - item.packed.begin());
      need = at < item.packed.size() ? zstd_window(in, pack_offset(item.first_pack + at)) : unbounded;
    } else if (coder.method == bcj2) {
      // libarchive buffers BCJ2's call, jump and range streams whole; only the main stream is streamed.
      for (std::uint64_t extra = 1; extra < coder.inputs; ++extra) need += std::min(source_size(input + extra), unbounded - need);
    }
    memory += std::min(need, unbounded - memory);
    input += coder.inputs;
  }
  return memory;
}

bool decode_header(const Coder& coder, const std::vector<unsigned char>& packed, std::vector<unsigned char>& header) {
  std::array<lzma_filter, 2> filters{{{coder.method == lzma2 ? LZMA_FILTER_LZMA2 : LZMA_FILTER_LZMA1, nullptr}, {LZMA_VLI_UNKNOWN, nullptr}}};
  if (lzma_properties_decode(filters.data(), nullptr, coder.properties.data(), coder.properties.size()) != LZMA_OK) return false;
  lzma_stream stream = LZMA_STREAM_INIT;
  auto result = lzma_raw_decoder(&stream, filters.data());
  std::free(filters[0].options);
  if (result != LZMA_OK) return false;
  stream.next_in = packed.data();
  stream.avail_in = packed.size();
  stream.next_out = header.data();
  stream.avail_out = header.size();
  while (stream.avail_out && result == LZMA_OK) result = lzma_code(&stream, LZMA_RUN);
  lzma_end(&stream);
  return !stream.avail_out;
}

// 7-Zip compresses the header itself by default; its folders are only visible once it is decoded.
bool unpack_header(Volumes& in, Cursor& cursor, std::vector<unsigned char>& header, std::string& refusal) {
  Streams streams;
  if (!parse_streams(cursor, streams) || streams.folders.size() != 1 || streams.pack_sizes.size() != 1) return false;
  const auto& item = streams.folders[0];
  const auto& coder = item.coders[0];
  if (item.coders.size() != 1 || (coder.method != lzma && coder.method != lzma2)) return false;
  if (!(refusal = fits(folder_memory(item, streams, in))).empty()) return false;
  const auto packed_size = streams.pack_sizes[0];
  const auto unpacked_size = item.sizes[0];
  if (packed_size > max_metadata_bytes || unpacked_size > max_7z_header_bytes) return false;
  std::vector<unsigned char> packed(packed_size);
  header.assign(unpacked_size, 0);
  return in.read(signature_size + streams.pack_position, packed.data(), packed.size()) && decode_header(coder, packed, header);
}

std::string check(Volumes& in) {
  std::array<unsigned char, signature_size> signature{};
  if (!in.read(0, signature.data(), signature.size())) return malformed;
  const auto offset = little_endian(signature.data() + 12, 8);
  const auto size = little_endian(signature.data() + 20, 8);
  if (!size) return {};
  if (size > max_metadata_bytes || offset > in.size() || signature_size + offset > in.size() - size) return malformed;
  std::vector<unsigned char> header(size);
  if (!in.read(signature_size + offset, header.data(), header.size())) return malformed;
  Streams main;
  for (unsigned pass = 0;; ++pass) {
    Cursor cursor{header.data(), header.data() + header.size()};
    const auto kind = cursor.byte();
    if (kind == property::header) break;
    std::vector<unsigned char> unpacked;
    std::string refusal;
    if (kind != property::encoded_header || pass == max_header_passes || !unpack_header(in, cursor, unpacked, refusal))
      return refusal.empty() ? malformed : refusal;
    header = std::move(unpacked);
  }
  Cursor cursor{header.data() + 1, header.data() + header.size()};
  while (cursor.ok) {
    const auto id = cursor.byte();
    if (id == property::end) break;
    if (id == property::archive_properties) {
      while (cursor.ok && cursor.byte()) cursor.skip(cursor.number());
    } else if (id == property::additional_streams || id == property::main_streams) {
      Streams streams;
      if (!parse_streams(cursor, streams)) return malformed;
      if (id == property::main_streams) main = std::move(streams);
    } else if (id == property::files) {
      if (cursor.number() > max_entries) return too_many_entries;
      break;
    } else return malformed;
  }
  if (!cursor.ok) return malformed;
  std::uint64_t memory = 0;
  for (const auto& item : main.folders) memory = std::max(memory, folder_memory(item, main, in));
  return fits(memory);
}
}

namespace rar5 {
constexpr std::string_view signature("Rar!\x1A\x07\x01\x00", 8);
constexpr std::uint64_t window_unit = 128 * 1024, max_header_size = 2 * 1024 * 1024;
enum : std::uint64_t { file = 2, service = 3, encryption = 4, end = 5 };

std::string check(Volumes& in, bool partial) {
  std::uint64_t at = signature.size(), memory = 0;
  // A partial download stops at its first hole or at the walk's budget.
  bool file_seen = false;
  for (const auto deadline = std::chrono::steady_clock::now() + inspect_budget; within(partial, file_seen, deadline);) {
    std::array<unsigned char, 7> prefix{};
    const auto available = std::min<std::uint64_t>(prefix.size(), in.size() - std::min(at, in.size()));
    if (available < 5 || !in.read(at, prefix.data(), available)) break;
    Cursor length{prefix.data() + 4, prefix.data() + available};
    const auto header_size = length.vint();
    if (!length.ok || !header_size || header_size > max_header_size) return partial ? fits(memory) : malformed;
    const auto header_at = at + (length.at - prefix.data());
    std::vector<unsigned char> header(header_size);
    if (!in.read(header_at, header.data(), header.size())) break;
    Cursor cursor{header.data(), header.data() + header.size()};
    const auto type = cursor.vint();
    const auto flags = cursor.vint();
    if (flags & 1) cursor.vint();
    const auto data_size = flags & 2 ? cursor.vint() : 0;
    if (type == encryption) break;
    if (type == file || type == service) {
      const auto file_flags = cursor.vint();
      cursor.vint();
      cursor.vint();
      if (file_flags & 2) cursor.skip(4);
      if (file_flags & 4) cursor.skip(4);
      const auto compression = cursor.vint();
      const auto method = (compression >> 7) & 7;
      // libarchive allocates both a window and an equally sized filter buffer for every compressed file.
      if (!(file_flags & 1) && method) memory = std::max(memory, 2 * (window_unit << ((compression >> 10) & 0x1F)));
    }
    file_seen = file_seen || type == file;
    if (!cursor.ok) return partial ? fits(memory) : malformed;
    at = header_at + header_size;
    if (data_size > in.size() - std::min(at, in.size())) break;
    at += data_size;
    if (type == end) {
      const bool more_volumes = cursor.vint() & 1;
      std::array<char, signature.size()> next{};
      if (!more_volumes || !in.read(at, next.data(), next.size()) || std::string_view(next.data(), next.size()) != signature) break;
      at += signature.size();
    }
  }
  return fits(memory);
}
}

namespace rar4 {
constexpr std::string_view signature("Rar!\x1A\x07\x00", 7);
enum : unsigned { archive_header = 0x73, file = 0x74, end = 0x7B };
enum : unsigned {
  continued = 0x01, encrypted = 0x04, solid = 0x10, directory = 0xE0, large = 0x100, has_data = 0x8000,
  encrypted_headers = 0x80, more_volumes = 0x01,
};
constexpr unsigned stored = 0x30, ppmd_version = 29, ppmd_block = 0x80, ppmd_memory = 0x20;

// The LZSS window is capped at 4 MiB by libarchive; PPMd sizes its model from the first data bytes.
// Only blocks at the start of a non-solid file are seen; a PPMd block switched to later is not caught.
std::string check(Volumes& in, bool partial) {
  std::uint64_t at = signature.size(), memory = 0;
  bool file_seen = false;
  for (const auto deadline = std::chrono::steady_clock::now() + inspect_budget; within(partial, file_seen, deadline);) {
    std::array<unsigned char, 32> header{};
    const auto available = std::min<std::uint64_t>(header.size(), in.size() - std::min(at, in.size()));
    if (available < 7 || !in.read(at, header.data(), available)) break;
    const unsigned type = header[2];
    const auto flags = static_cast<unsigned>(little_endian(header.data() + 3, 2));
    const auto size = little_endian(header.data() + 5, 2);
    if (size < 7 || ((flags & has_data) && available < 11)) return partial ? fits(memory) : malformed;
    std::uint64_t data = flags & has_data ? little_endian(header.data() + 7, 4) : 0;
    if (type == archive_header && (flags & encrypted_headers)) break;
    if (type == file) {
      if (available < 32 || size < 32) return partial ? fits(memory) : malformed;
      if ((flags & large) && size >= 36) {
        std::array<unsigned char, 4> high{};
        if (!in.read(at + 32, high.data(), high.size())) break;
        data += little_endian(high.data(), 4) << 32;
      }
      const unsigned version = header[24], method = header[25];
      const bool fresh = version >= ppmd_version && !(flags & (continued | encrypted | solid)) && (flags & directory) != directory;
      std::array<unsigned char, 2> first{};
      if (fresh && method != stored && data >= 2 && in.read(at + size, first.data(), first.size()) &&
          (first[0] & ppmd_block) && (first[0] & ppmd_memory))
        memory = std::max<std::uint64_t>(memory, (first[1] + 1ULL) * mib);
    }
    file_seen = file_seen || type == file;
    if (size + data > in.size() - std::min(at, in.size())) break;
    at += size + data;
    if (type == end) {
      std::array<char, signature.size()> next{};
      if (!(flags & more_volumes) || !in.read(at, next.data(), next.size()) || std::string_view(next.data(), next.size()) != signature) break;
      at += signature.size();
    }
  }
  return fits(memory);
}
}

namespace zip {
constexpr std::uint32_t local_signature = 0x04034B50, central_signature = 0x02014B50, end_signature = 0x06054B50;
constexpr std::uint32_t zip64_locator_signature = 0x07064B50, zip64_end_signature = 0x06064B50;
constexpr std::uint64_t end_size = 22, max_comment = 0xFFFF, saturated = 0xFFFFFFFF;
enum : unsigned { lzma = 14, zstd = 93, xz = 95, ppmd = 98 };

std::uint64_t entry_window(Volumes& in, unsigned method, std::uint64_t local) {
  std::array<unsigned char, 30> head{};
  if (!in.read(local, head.data(), head.size()) || little_endian(head.data(), 4) != local_signature) return unbounded;
  const auto data = local + head.size() + little_endian(head.data() + 26, 2) + little_endian(head.data() + 28, 2);
  if (method == xz) return xz_window(in, data);
  if (method == zstd) return zstd_window(in, data);
  std::array<unsigned char, 9> start{};
  if (!in.read(data, start.data(), method == ppmd ? 2 : start.size())) return 0;
  // PPMd8 keeps its model size in MiB in bits 4-11; LZMA keeps 5 property bytes after a 4-byte header.
  if (method == ppmd) return (((little_endian(start.data(), 2) >> 4) & 0xFF) + 1) * mib;
  return little_endian(start.data() + 5, 4);
}

// Returns false when the stream has no central directory, i.e. libarchive will not read it as ZIP.
bool check(Volumes& in, std::string& refusal) {
  const auto tail_size = std::min(in.size(), end_size + max_comment);
  std::vector<unsigned char> tail(tail_size);
  if (tail_size < end_size || !in.read(in.size() - tail_size, tail.data(), tail.size())) return false;
  auto found = tail_size - end_size + 1;
  while (found-- && little_endian(tail.data() + found, 4) != end_signature) {}
  if (found > tail_size) return false;
  const auto* record = tail.data() + found;
  const auto end_at = in.size() - tail_size + found;
  std::uint64_t entries = little_endian(record + 10, 2);
  std::uint64_t directory_size = little_endian(record + 12, 4);
  std::uint64_t directory_at = little_endian(record + 16, 4);
  std::uint64_t base = 0;
  if (entries == 0xFFFF || directory_size == saturated || directory_at == saturated) {
    std::array<unsigned char, 56> zip64{};
    if (end_at < 20 || !in.read(end_at - 20, zip64.data(), 20) || little_endian(zip64.data(), 4) != zip64_locator_signature) return false;
    if (!in.read(little_endian(zip64.data() + 8, 8), zip64.data(), zip64.size()) || little_endian(zip64.data(), 4) != zip64_end_signature) return false;
    entries = little_endian(zip64.data() + 32, 8);
    directory_size = little_endian(zip64.data() + 40, 8);
    directory_at = little_endian(zip64.data() + 48, 8);
  } else if (end_at >= directory_size && end_at - directory_size >= directory_at) {
    // Data prepended to the archive shifts every recorded offset; libarchive reads it the same way.
    base = end_at - directory_size - directory_at;
  } else return false;
  if (entries > max_entries) {
    refusal = too_many_entries;
    return true;
  }
  std::uint64_t at = base + directory_at, memory = 0;
  for (std::uint64_t entry = 0; entry < entries; ++entry) {
    std::array<unsigned char, 46> central{};
    if (!in.read(at, central.data(), central.size()) || little_endian(central.data(), 4) != central_signature) {
      refusal = malformed;
      return true;
    }
    const auto method = static_cast<unsigned>(little_endian(central.data() + 10, 2));
    const auto name_size = little_endian(central.data() + 28, 2);
    const auto extra_size = little_endian(central.data() + 30, 2);
    std::uint64_t local = little_endian(central.data() + 42, 4);
    if (method == lzma || method == zstd || method == xz || method == ppmd) {
      if (local == saturated) {
        std::vector<unsigned char> extra(extra_size);
        if (!in.read(at + central.size() + name_size, extra.data(), extra.size())) {
          refusal = malformed;
          return true;
        }
        Cursor cursor{extra.data(), extra.data() + extra.size()};
        while (cursor.ok && cursor.at < cursor.end) {
          const auto id = cursor.fixed(2);
          const auto size = cursor.fixed(2);
          if (id != 1) {
            cursor.skip(size);
            continue;
          }
          if (little_endian(central.data() + 24, 4) == saturated) cursor.skip(8);
          if (little_endian(central.data() + 20, 4) == saturated) cursor.skip(8);
          local = cursor.fixed(8);
          break;
        }
      }
      memory = std::max(memory, entry_window(in, method, base + local));
    }
    at += central.size() + name_size + extra_size + little_endian(central.data() + 32, 2);
  }
  refusal = fits(memory);
  return true;
}
}

bool starts_with(const std::array<unsigned char, 8>& magic, std::string_view prefix) {
  return std::memcmp(magic.data(), prefix.data(), prefix.size()) == 0;
}
}

std::string preflight(const std::vector<std::string>& sources) {
  Volumes in(sources);
  std::array<unsigned char, 8> magic{};
  in.read(0, magic.data(), static_cast<std::size_t>(std::min<std::uint64_t>(magic.size(), in.size())));
  // libarchive searches executables for an embedded archive, which these checks do not follow.
  if (starts_with(magic, "MZ") || starts_with(magic, "\x7F" "ELF")) return "Self-extracting archives are not supported.";
  if (starts_with(magic, "7z\xBC\xAF\x27\x1C")) return seven_zip::check(in);
  if (starts_with(magic, rar5::signature)) return rar5::check(in, false);
  if (starts_with(magic, rar4::signature)) return rar4::check(in, false);
  // Compression around a TAR: only the outer layer is checked.
  if (const auto window = std::max({xz_window(in, 0), zstd_window(in, 0), lzip_window(in)})) return fits(window);
  std::string refusal;
  if (zip::check(in, refusal)) return refusal;
  if (starts_with(magic, "PK\x03\x04")) return malformed;
  return fits(lzma_alone_window(in));
}

Inspection inspect(const std::vector<std::string>& sources) {
  Volumes in(sources);
  std::array<unsigned char, 8> magic{};
  in.read(0, magic.data(), static_cast<std::size_t>(std::min<std::uint64_t>(magic.size(), in.size())));
  std::array<unsigned char, 8> boot{}, ustar{}, ufs{};
  in.read(3, boot.data(), boot.size());
  in.read(257, ustar.data(), 5);
  // UFS2 keeps its superblock at 64 KiB, with fs_magic 1372 bytes in.
  in.read(65536 + 1372, ufs.data(), 4);
  if (starts_with(magic, rar5::signature)) return {"rar", rar5::check(in, true)};
  if (starts_with(magic, rar4::signature)) return {"rar", rar4::check(in, true)};
  // 7z and ZIP keep their directories at the end, so a partial download shows nothing to refuse yet.
  if (starts_with(magic, "7z\xBC\xAF\x27\x1C")) return {"7z", {}};
  if (starts_with(magic, "PK\x03\x04") || starts_with(magic, "PK\x05\x06") || starts_with(magic, "PK\x07\x08")) return {"zip", {}};
  if (starts_with(magic, "\x1F\x8B")) return {"tar.gz", {}};
  if (starts_with(magic, "BZh")) return {"tar.bz2", {}};
  if (starts_with(magic, "\xFD" "7zXZ")) return {"tar.xz", fits(xz_window(in, 0))};
  if (starts_with(magic, "\x28\xB5\x2F\xFD")) return {"tar.zst", fits(zstd_window(in, 0))};
  if (std::string_view(reinterpret_cast<const char*>(ustar.data()), 5) == "ustar") return {"tar", {}};
  if (starts_with(magic, "\x7F" "CNT")) {
    std::array<char, 36> content{};
    std::string title;
    if (in.read(0x40, content.data(), content.size()) && content[6] == '-') {
      title.assign(content.data() + 7, 9);
      const bool valid = std::all_of(title.begin(), title.begin() + 4, [](char c) { return c >= 'A' && c <= 'Z'; }) &&
                         std::all_of(title.begin() + 4, title.end(), [](char c) { return c >= '0' && c <= '9'; });
      if (!valid) title.clear();
    }
    return {"pkg", {}, title};
  }
  // A PS5 package opens on "\x7F" "FIH" where a PS4 one has "\x7F" "CNT": it installs the same way.
  if (starts_with(magic, "\x7F" "FIH")) return {"pkg", {}};
  if (starts_with(magic, "PFSC")) return {"ffpfsc", {}};
  if (little_endian(magic.data(), 8) == 1) {
    std::array<unsigned char, 8> pfs{};
    if (in.read(8, pfs.data(), pfs.size()) && little_endian(pfs.data(), 8) == 0x20130315) return {"ffpfs", {}};
  }
  if (starts_with(boot, "EXFAT   ")) return {"exfat", {}};
  if (little_endian(ufs.data(), 4) == 0x19540119) return {"ffpkg", {}};
  return {};
}
}
