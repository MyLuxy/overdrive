// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// RAR5 framing/crypto follows https://www.rarlab.com/technote.htm; no UnRAR code is used.
#include "rar5_password.hpp"
#include <algorithm>
#include <array>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <map>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/sha.h>
#include <sys/stat.h>
#include <unistd.h>
#include <zlib.h>

namespace archives {
namespace {
using Bytes = std::vector<unsigned char>;
constexpr std::array<unsigned char, 8> signature{'R', 'a', 'r', '!', 0x1a, 7, 1, 0};
constexpr std::size_t max_header = 2 * 1024 * 1024, block_size = 128 * 1024;
struct Cursor {
  const Bytes &bytes;
  std::size_t at = 0;
  bool ok = true;
  std::uint64_t number() {
    std::uint64_t value = 0;
    for (unsigned shift = 0; shift < 64; shift += 7) {
      if (at >= bytes.size()) {
        ok = false;
        return 0;
      }
      const auto byte = bytes[at++];
      if (shift == 63 && (byte & 0xfe)) {
        ok = false;
        return 0;
      }
      value |= std::uint64_t(byte & 0x7f) << shift;
      if (!(byte & 0x80))
        return value;
    }
    ok = false;
    return 0;
  }
  bool skip(std::size_t count) {
    if (count > bytes.size() - std::min(at, bytes.size())) {
      ok = false;
      return false;
    }
    at += count;
    return true;
  }
};
void number(Bytes &bytes, std::uint64_t value) {
  do {
    bytes.push_back((value & 127) | (value > 127 ? 128 : 0));
    value >>= 7;
  } while (value);
}
std::uint32_t little32(const unsigned char *p) {
  return std::uint32_t(p[0]) | std::uint32_t(p[1]) << 8 | std::uint32_t(p[2]) << 16 |
         std::uint32_t(p[3]) << 24;
}
Bytes framed(const Bytes &body) {
  Bytes out;
  number(out, body.size());
  out.insert(out.end(), body.begin(), body.end());
  const auto crc = crc32(0, out.data(), out.size());
  Bytes result;
  for (unsigned i = 0; i < 4; i++)
    result.push_back(crc >> (8 * i));
  result.insert(result.end(), out.begin(), out.end());
  return result;
}
using Cipher = std::unique_ptr<EVP_CIPHER_CTX, decltype(&EVP_CIPHER_CTX_free)>;
Cipher cipher(const std::array<unsigned char, 32> &key, const unsigned char *iv) {
  Cipher ctx(EVP_CIPHER_CTX_new(), EVP_CIPHER_CTX_free);
  if (!ctx || EVP_DecryptInit_ex(ctx.get(), EVP_aes_256_cbc(), nullptr, key.data(), iv) != 1 ||
      EVP_CIPHER_CTX_set_padding(ctx.get(), 0) != 1)
    ctx.reset();
  return ctx;
}
bool decrypt(Cipher &ctx, const Bytes &encrypted, Bytes &plain) {
  plain.resize(encrypted.size());
  int size = 0;
  return ctx &&
         EVP_DecryptUpdate(ctx.get(), plain.data(), &size, encrypted.data(), encrypted.size()) ==
             1 &&
         std::size_t(size) == encrypted.size();
}
} // namespace

struct Rar5PasswordReader::State {
  const std::vector<std::string> &paths;
  const std::string &password;
  const std::atomic<bool> &cancelled;
  std::size_t volume = 0;
  int fd = -1;
  bool need_signature = true, encrypted_headers = false, finished = false;
  std::array<unsigned char, 32> header_key{};
  std::uint64_t data_left = 0, emit_left = 0;
  std::string error;
  // A file's packed data is one AES-CBC stream even when RAR splits it across volumes, and the
  // split points need not be 16-byte aligned. Offsets below are positions in that stream.
  struct Span {
    std::size_t source;
    std::uint64_t offset, size;
  };
  struct Stream {
    std::string name;
    std::array<unsigned char, 32> key{};
    std::array<unsigned char, 16> iv{};
    Cipher cipher{nullptr, EVP_CIPHER_CTX_free}, probe{nullptr, EVP_CIPHER_CTX_free};
    std::vector<Span> spans;
    std::uint64_t packed = 0, emitted = 0, next_block = 0, end = UINT64_MAX;
    // Raw bytes short of a whole AES block, and decrypted bytes held back for the next piece.
    Bytes carry, pending;
  } stream;
  bool decrypting = false, last_piece = false;
  int probe_fd = -1;
  std::size_t probe_source = 0;
  Bytes output;
  std::map<std::string, std::uint32_t> checksums;
  std::size_t checksum_bytes = 0;
  State(const std::vector<std::string> &p, const std::string &pass, const std::atomic<bool> &cancel)
      : paths(p), password(pass), cancelled(cancel) {}
  ~State() {
    if (fd >= 0)
      close(fd);
    if (probe_fd >= 0)
      close(probe_fd);
    OPENSSL_cleanse(header_key.data(), header_key.size());
    OPENSSL_cleanse(stream.key.data(), stream.key.size());
  }
  void reset_stream() {
    OPENSSL_cleanse(stream.key.data(), stream.key.size());
    stream = Stream{};
  }
  bool take(Bytes &bytes, std::size_t size) {
    bytes.resize(size);
    std::size_t at = 0;
    while (at < size && !cancelled) {
      if (fd < 0) {
        if (volume >= paths.size()) {
          error = "Incomplete RAR5 archive or missing volume.";
          return false;
        }
        fd = open(paths[volume++].c_str(), O_RDONLY | O_NOFOLLOW);
        struct stat st;
        if (fd < 0 || fstat(fd, &st) || !S_ISREG(st.st_mode)) {
          error = "Cannot read RAR5 source volume.";
          return false;
        }
      }
      const auto count = ::read(fd, bytes.data() + at, size - at);
      if (count < 0 && errno == EINTR)
        continue;
      if (count < 0) {
        error = "Cannot read RAR5 source volume.";
        return false;
      }
      if (!count) {
        close(fd);
        fd = -1;
        continue;
      }
      at += count;
    }
    if (cancelled) {
      error = "Extraction cancelled; downloaded parts are preserved.";
      return false;
    }
    return true;
  }
  bool key(Cursor &fields, std::array<unsigned char, 32> &result, bool file) {
    const auto version = fields.number(), flags = fields.number();
    if (!fields.ok || version != 0 || (flags & ~(file ? 3ULL : 1ULL))) {
      error = "Unsupported RAR5 encryption version or flags.";
      return false;
    }
    // Keyed CRC/BLAKE checksums cannot be silently removed: refuse until they can be verified.
    if (file && (flags & 2)) {
      error = "RAR5 keyed checksums are not supported; downloaded parts are preserved.";
      return false;
    }
    if (!fields.skip(17)) {
      error = "Incomplete RAR5 encryption metadata.";
      return false;
    }
    const auto power = fields.bytes[fields.at - 17];
    const auto *salt = fields.bytes.data() + fields.at - 16;
    if (power > 20) {
      error = "RAR5 password derivation exceeds the CPU budget.";
      return false;
    }
    const int iterations = 1 << power;
    if (PKCS5_PBKDF2_HMAC(password.data(), password.size(), salt, 16, iterations, EVP_sha256(),
                          result.size(), result.data()) != 1) {
      error = "Cannot derive RAR5 password key.";
      return false;
    }
    if (file && !fields.skip(16)) {
      error = "Incomplete RAR5 data IV.";
      return false;
    }
    if (flags & 1) {
      if (!fields.skip(12)) {
        error = "Incomplete RAR5 password check.";
        return false;
      }
      const auto *expected = fields.bytes.data() + fields.at - 12;
      std::array<unsigned char, 32> check{}, digest{};
      std::array<unsigned char, 8> folded{};
      SHA256(expected, 8, digest.data());
      if (CRYPTO_memcmp(digest.data(), expected + 8, 4)) {
        error = "Corrupt RAR5 password check.";
        return false;
      }
      if (PKCS5_PBKDF2_HMAC(password.data(), password.size(), salt, 16, iterations + 32,
                            EVP_sha256(), check.size(), check.data()) != 1) {
        error = "Cannot verify RAR5 password.";
        return false;
      }
      for (std::size_t i = 0; i < check.size(); i++)
        folded[i % 8] ^= check[i];
      OPENSSL_cleanse(check.data(), check.size());
      if (CRYPTO_memcmp(folded.data(), expected, 8)) {
        error = "Incorrect RAR5 archive password.";
        return false;
      }
    }
    return true;
  }
  // Read ahead without advancing the stream. Only tiny compressed-block headers are decrypted here;
  // file bodies stay in the 128 KiB streaming buffer. This finds CBC padding before publishing the
  // packed size to libarchive, which would otherwise parse padding as another compression block.
  bool read_stream(std::uint64_t offset, std::size_t count, unsigned char *bytes) {
    for (const auto &span : stream.spans) {
      if (!count)
        return true;
      if (offset >= span.size) {
        offset -= span.size;
        continue;
      }
      if (probe_fd < 0 || probe_source != span.source) {
        if (probe_fd >= 0)
          close(probe_fd);
        probe_fd = open(paths[span.source].c_str(), O_RDONLY | O_NOFOLLOW);
        probe_source = span.source;
        if (probe_fd < 0) {
          error = "Cannot inspect RAR5 source.";
          return false;
        }
      }
      const auto step = std::min<std::uint64_t>(count, span.size - offset);
      std::size_t got = 0;
      while (got < step) {
        const auto n = pread(probe_fd, bytes + got, step - got, span.offset + offset + got);
        if (n < 0 && errno == EINTR)
          continue;
        if (n <= 0)
          break;
        got += n;
      }
      if (got != step) {
        error = "Incomplete RAR5 compressed data.";
        return false;
      }
      bytes += step;
      count -= step;
      offset = 0;
    }
    if (count) {
      error = "Incomplete RAR5 compressed data.";
      return false;
    }
    return true;
  }
  // Decrypts stream bytes [offset, offset + count), which must lie in whole AES blocks already read.
  bool decrypt_stream(std::uint64_t offset, std::size_t count, Bytes &plain) {
    const auto aligned = offset & ~std::uint64_t(15);
    const auto end = (offset + count + 15) & ~std::uint64_t(15);
    const std::size_t before = aligned ? 16 : 0;
    Bytes raw(before + end - aligned), decoded;
    if (!read_stream(aligned - before, raw.size(), raw.data()))
      return false;
    const auto *iv = before ? raw.data() : stream.iv.data();
    if (EVP_DecryptInit_ex(stream.probe.get(), nullptr, nullptr, nullptr, iv) != 1 ||
        !decrypt(stream.probe, Bytes(raw.begin() + before, raw.end()), decoded)) {
      error = "Cannot inspect RAR5 compressed block.";
      return false;
    }
    plain.assign(decoded.begin() + (offset - aligned), decoded.begin() + (offset - aligned) + count);
    return true;
  }
  // Walks compression block headers through the decryptable part of the stream. A header that
  // continues past it waits for the next volume; the last block's end marks where padding starts.
  bool scan_blocks() {
    const auto decryptable = stream.packed & ~std::uint64_t(15);
    // Every iteration consumes at least the three-byte block header, so the stream size bounds it.
    while (!cancelled && stream.end == UINT64_MAX && stream.next_block + 3 <= decryptable) {
      const auto at = stream.next_block;
      Bytes plain;
      if (!decrypt_stream(at, std::min<std::uint64_t>(5, decryptable - at), plain))
        return false;
      const auto block_flags = plain[0];
      const unsigned size_bytes = ((unsigned(block_flags) >> 3) & 7) + 1;
      if (size_bytes > 3) {
        error = "Unsupported RAR5 compressed block header.";
        return false;
      }
      if (2 + size_bytes > plain.size())
        break;
      std::uint64_t size = 0;
      unsigned char checksum = 0x5a ^ block_flags;
      for (unsigned i = 0; i < size_bytes; i++) {
        size |= std::uint64_t(plain[2 + i]) << (8 * i);
        checksum ^= plain[2 + i];
      }
      if (checksum != plain[1]) {
        error = "Corrupt RAR5 compressed block header.";
        return false;
      }
      stream.next_block = at + 2 + size_bytes + size;
      if (block_flags & 0x40)
        stream.end = stream.next_block;
    }
    if (cancelled) {
      error = "Extraction cancelled; downloaded parts are preserved.";
      return false;
    }
    if (!last_piece)
      return true;
    if (stream.end == UINT64_MAX || stream.end > stream.packed) {
      error = "Missing RAR5 last compression block.";
      return false;
    }
    if (stream.packed - stream.end > 15) {
      error = "Invalid RAR5 encrypted padding.";
      return false;
    }
    return true;
  }
  // Starts or continues the file's stream with this piece and returns how many decrypted bytes
  // libarchive gets for it: whole AES blocks only, never padding, and never part of a block header,
  // since libarchive cannot parse a compression block header split across volumes.
  bool encrypted_piece(const std::string &name, std::uint64_t flags, std::uint64_t packed,
                       std::uint64_t unpacked, std::uint64_t method,
                       const std::array<unsigned char, 32> &data_key, const unsigned char *data_iv,
                       std::uint64_t &emitted) {
    if (!(flags & 8) || stream.name != name || !stream.cipher) {
      reset_stream();
      stream.name = name;
      stream.key = data_key;
      std::copy(data_iv, data_iv + 16, stream.iv.begin());
      stream.cipher = cipher(stream.key, stream.iv.data());
      stream.probe = cipher(stream.key, stream.iv.data());
      // An empty compressed file stores only an encrypted padding block.
      stream.end = method && unpacked ? UINT64_MAX : method ? 0 : unpacked;
    }
    const auto at = fd < 0 ? -1 : lseek(fd, 0, SEEK_CUR);
    if (!stream.cipher || !stream.probe || at < 0 || !volume) {
      error = "Cannot read RAR5 encrypted data.";
      return false;
    }
    stream.spans.push_back({volume - 1, static_cast<std::uint64_t>(at), packed});
    stream.packed += packed;
    last_piece = !(flags & 16);
    if (last_piece && stream.packed % 16) {
      error = "Invalid RAR5 encrypted data alignment.";
      return false;
    }
    if (!method && last_piece && stream.end > stream.packed) {
      error = "Invalid RAR5 stored volume size.";
      return false;
    }
    if (stream.end == UINT64_MAX && !scan_blocks())
      return false;
    auto target = std::min(stream.end, stream.packed & ~std::uint64_t(15));
    if (stream.end == UINT64_MAX)
      target = std::min(target, stream.next_block);
    emitted = target - stream.emitted;
    stream.emitted = target;
    decrypting = true;
    return true;
  }
  bool header(Bytes &plain) {
    Cipher ctx(nullptr, EVP_CIPHER_CTX_free);
    Bytes first;
    if (encrypted_headers) {
      Bytes iv;
      if (!take(iv, 16) || !take(first, 16))
        return false;
      ctx = cipher(header_key, iv.data());
      if (!decrypt(ctx, first, plain)) {
        error = "Cannot decrypt RAR5 header.";
        return false;
      }
    } else {
      if (!take(plain, 5))
        return false;
      for (unsigned extra = 0; plain.back() & 128; extra++) {
        if (extra == 2) {
          error = "Invalid RAR5 header size.";
          return false;
        }
        Bytes byte;
        if (!take(byte, 1))
          return false;
        plain.push_back(byte[0]);
      }
    }
    Cursor length{plain, 4};
    const auto size = length.number();
    const auto total = length.at + size;
    if (!length.ok || !size || size > max_header || length.at > 7) {
      error = "Invalid RAR5 header size.";
      return false;
    }
    const auto required = encrypted_headers ? (total + 15) & ~std::size_t(15) : total;
    if (required > plain.size()) {
      Bytes tail;
      if (!take(tail, required - plain.size()))
        return false;
      if (encrypted_headers) {
        Bytes decoded;
        if (!decrypt(ctx, tail, decoded)) {
          error = "Cannot decrypt RAR5 header.";
          return false;
        }
        plain.insert(plain.end(), decoded.begin(), decoded.end());
      } else
        plain.insert(plain.end(), tail.begin(), tail.end());
    }
    plain.resize(total);
    if (little32(plain.data()) != crc32(0, plain.data() + 4, plain.size() - 4)) {
      error = encrypted_headers ? "Incorrect RAR5 password or corrupt encrypted header."
                                : "Corrupt RAR5 header.";
      return false;
    }
    return true;
  }
  bool prepare(const Bytes &plain) {
    Cursor fields{plain, 4};
    fields.number();
    const auto type = fields.number(), flags = fields.number();
    const auto extra_size = flags & 1 ? fields.number() : 0;
    const auto packed = flags & 2 ? fields.number() : 0;
    const auto common_end = fields.at;
    if (!fields.ok || extra_size > plain.size() - std::min(fields.at, plain.size())) {
      error = "Invalid RAR5 header fields.";
      return false;
    }
    const auto extra_at = plain.size() - extra_size;
    if (type == 4) {
      if (encrypted_headers || packed) {
        error = "Invalid RAR5 archive encryption header.";
        return false;
      }
      if (!key(fields, header_key, false))
        return false;
      encrypted_headers = true;
      output.clear();
      return true;
    }
    std::uint64_t emitted = packed;
    decrypting = false;
    Bytes kept_extra, specific;
    if (type == 2 || type == 3) {
      const auto file_flags = fields.number(), unpacked = fields.number();
      fields.number();
      if (file_flags & 2)
        fields.skip(4);
      const auto crc_at = fields.at;
      if (file_flags & 4)
        fields.skip(4);
      const auto compression_at = fields.at;
      const auto compression = fields.number();
      const auto compression_end = fields.at;
      fields.number();
      const auto name_size = fields.number();
      const auto name_at = fields.at;
      fields.skip(name_size);
      if (!fields.ok || fields.at > extra_at) {
        error = "Invalid RAR5 file header.";
        return false;
      }
      const auto method = (compression >> 7) & 7;
      const auto window = 2 * (128ULL * 1024 << ((compression >> 10) & 31));
      if (!(file_flags & 1) && method && window > 64 * 1024 * 1024) {
        error = "This archive needs more memory to extract than the console app can use.";
        return false;
      }
      if (file_flags & 8) {
        error = "RAR5 files with unknown unpacked size are not supported.";
        return false;
      }
      const std::string name(reinterpret_cast<const char *>(plain.data() + name_at), name_size);
      if (type == 3) {
        // Service headers (quick-open index, recovery record, comments) carry no file data, and
        // libarchive skips them. Drop them whole: the quick-open index's encryption check need not
        // match the password used for file data, and an encrypted service between the volume
        // pieces of a split file must not restart that file's AES stream.
        // The enclosing header CRC was already checked, and take() still validates payload length.
        data_left = packed;
        emit_left = 0;
        output.clear();
        return true;
      }
      if (type == 2 && !(file_flags & 1) && (file_flags & 4)) {
        if (!checksums.contains(name)) {
          checksum_bytes += name.size() + 64;
          if (checksum_bytes > 16 * 1024 * 1024 || checksums.size() >= 100000) {
            error = "RAR5 checksum metadata exceeds the limit.";
            return false;
          }
        }
        checksums[name] = little32(plain.data() + crc_at);
      }
      Cursor extra{plain, extra_at};
      bool has_crypto = false;
      while (extra.at < plain.size()) {
        const auto start = extra.at;
        const auto size = extra.number();
        if (!extra.ok || size > plain.size() - std::min(extra.at, plain.size())) {
          error = "Invalid RAR5 extra record.";
          return false;
        }
        const auto end = extra.at + size, record = extra.number();
        if (!extra.ok || extra.at > end) {
          error = "Invalid RAR5 extra record.";
          return false;
        }
        if (record == 1) {
          if (has_crypto) {
            error = "Duplicate RAR5 encryption record.";
            return false;
          }
          has_crypto = true;
          if (type == 2 && !(file_flags & 1) && !(file_flags & 4)) {
            error = "Encrypted RAR5 files without CRC32 are not supported.";
            return false;
          }
          Bytes record_bytes(plain.begin() + extra.at, plain.begin() + end);
          Cursor encryption{record_bytes};
          std::array<unsigned char, 32> data_key{};
          if (!key(encryption, data_key, true))
            return false;
          Cursor iv_fields{record_bytes};
          iv_fields.number();
          iv_fields.number();
          iv_fields.skip(17);
          const auto *iv = record_bytes.data() + iv_fields.at;
          const bool piece =
              encrypted_piece(name, flags, packed, unpacked, method, data_key, iv, emitted);
          OPENSSL_cleanse(data_key.data(), data_key.size());
          if (!piece)
            return false;
          if (!unpacked && method) {
            // RAR stores an encrypted padding block for empty compressed files. Once removed,
            // mark the empty file as stored so libarchive does not read the next header as data.
            specific.insert(specific.end(), plain.begin() + common_end,
                            plain.begin() + compression_at);
            number(specific, compression & ~(7ULL << 7));
            specific.insert(specific.end(), plain.begin() + compression_end,
                            plain.begin() + extra_at);
          }
        } else
          kept_extra.insert(kept_extra.end(), plain.begin() + start, plain.begin() + end);
        extra.at = end;
      }
    } else
      kept_extra.insert(kept_extra.end(), plain.begin() + extra_at, plain.end());
    data_left = packed;
    emit_left = emitted;
    Bytes body;
    number(body, type);
    number(body, kept_extra.empty() ? flags & ~1ULL : flags | 1ULL);
    if (!kept_extra.empty())
      number(body, kept_extra.size());
    if (flags & 2)
      number(body, emitted);
    if (specific.empty())
      body.insert(body.end(), plain.begin() + common_end, plain.begin() + extra_at);
    else
      body.insert(body.end(), specific.begin(), specific.end());
    body.insert(body.end(), kept_extra.begin(), kept_extra.end());
    output = framed(body);
    if (type == 5) {
      const auto more = fields.number();
      if (!fields.ok) {
        error = "Invalid RAR5 end header.";
        return false;
      }
      if (more & 1) {
        // Like UnRAR, continue at the start of the next volume file: a volume may end with
        // filler after its end header.
        if (fd >= 0)
          close(fd);
        fd = -1;
        need_signature = true;
        encrypted_headers = false;
      } else
        finished = true;
    }
    return true;
  }
  la_ssize_t next() {
    output.clear();
    while (error.empty() && !cancelled) {
      if (data_left || emit_left) {
        const auto count = std::min<std::uint64_t>(data_left, block_size);
        Bytes raw;
        if (!take(raw, count))
          return -1;
        data_left -= count;
        if (decrypting) {
          raw.insert(raw.begin(), stream.carry.begin(), stream.carry.end());
          const auto whole = raw.size() & ~std::size_t(15);
          stream.carry.assign(raw.begin() + whole, raw.end());
          raw.resize(whole);
          Bytes plain;
          if (!decrypt(stream.cipher, raw, plain)) {
            error = "Cannot decrypt RAR5 data.";
            return -1;
          }
          if (stream.pending.empty())
            output = std::move(plain);
          else {
            output = std::move(stream.pending);
            output.insert(output.end(), plain.begin(), plain.end());
          }
        } else
          output = std::move(raw);
        const auto emit = std::min<std::uint64_t>(emit_left, output.size());
        emit_left -= emit;
        if (decrypting)
          stream.pending.assign(output.begin() + emit, output.end());
        output.resize(emit);
        if (!data_left) {
          if (emit_left) {
            error = "Incomplete RAR5 file data.";
            return -1;
          }
          if (decrypting && last_piece)
            reset_stream();
          decrypting = false;
        }
        if (emit)
          return output.size();
        continue;
      }
      if (finished)
        return 0;
      if (need_signature) {
        if (!take(output, signature.size()))
          return -1;
        if (!std::equal(signature.begin(), signature.end(), output.begin())) {
          error = "Missing RAR5 volume signature.";
          return -1;
        }
        need_signature = false;
        return output.size();
      }
      Bytes plain;
      if (!header(plain) || !prepare(plain))
        return -1;
      if (!output.empty())
        return output.size();
    }
    if (cancelled)
      error = "Extraction cancelled; downloaded parts are preserved.";
    return -1;
  }
};
bool Rar5PasswordReader::matches(const std::string &path) {
  const int fd = open(path.c_str(), O_RDONLY | O_NOFOLLOW);
  if (fd < 0)
    return false;
  std::array<unsigned char, 8> bytes{};
  const auto count = ::read(fd, bytes.data(), bytes.size());
  close(fd);
  return count == 8 && bytes == signature;
}
Rar5PasswordReader::Rar5PasswordReader(const std::vector<std::string> &paths,
                                       const std::string &password,
                                       const std::atomic<bool> &cancelled)
    : state(std::make_unique<State>(paths, password, cancelled)) {}
Rar5PasswordReader::~Rar5PasswordReader() = default;
const std::string &Rar5PasswordReader::error() const {
  return state->error;
}
la_ssize_t Rar5PasswordReader::read(archive *archive, void *client, const void **buffer) {
  auto &state = *static_cast<Rar5PasswordReader *>(client)->state;
  const auto count = state.next();
  *buffer = state.output.data();
  if (count < 0)
    archive_set_error(archive, EINVAL, "%s", state.error.c_str());
  return count;
}
bool Rar5PasswordReader::verify(const std::string &name, std::uint32_t crc) const {
  const auto found = state->checksums.find(name);
  return found == state->checksums.end() || found->second == crc;
}
} // namespace archives
