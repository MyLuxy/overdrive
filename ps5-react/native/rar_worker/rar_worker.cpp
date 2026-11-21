// Copyright (C) 2026 half144
// SPDX-License-Identifier: MIT
//
// rar-extract: extracts one RAR set with RarLab's UnRAR library, in a process of its own. UnRAR's license
// does not let it be linked into the GPL engine, so the engine talks to this program over a stream
// (the PS5 payload loader's socket, or a pipe on the desktop) and never loads its code. Its own
// crashes and C++ exceptions stay in this process too. A request that starts with "7ZX1" is a 7z whose
// decoder needs more memory than the app's heap can give, extracted with libarchive (sevenzip.cpp).
//
// Request, one item per line: "RARX1", then "threads <n>" (0 picks from the cores), "window <bytes>",
// "limit <bytes>", "flatten <extension>"..., "reserved <text>", "password <hex>", "dest <directory>",
// "source <path>"... in volume order, "wait 1" when later volumes are still downloading (each is read once
// a file has its name), then "end". The engine can then write "cancel" at any time.
// Answers: "ready", "p <bytes written>" a few times a second, "k" every second, "f <sha256> <size>
// <path>" once a file is on disk and synced, "d <bytes>" first with the unpacked size of every file when
// all volumes are there and their headers read, "s" once every file is decoded and only writes and fsyncs are
// left, "t <key>=<value>..." with where the time went (an engine that does not know a line or a key ignores
// it), then "ok", "cancelled" or "fail <reason>". A set whose last volume is not the last fails before any
// decoding with "fail Incomplete RAR archive or missing volume.", one whose first is not the first with
// "fail Missing first RAR volume."; the app reads these two exactly.
#include "rar.hpp"
#include "sevenzip.hpp"
#include "worker_io.hpp"
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#else
#include <openssl/evp.h>
#endif
#include <chrono>
#include <condition_variable>
#include <deque>
#include <fcntl.h>
#include <mutex>
#include <poll.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <thread>
#include <time.h>
#include <unistd.h>

namespace {
using namespace worker;
const char* missing_first = "Missing first RAR volume.";

struct Options {
  unsigned threads = 0;
  uint64 window = 0, limit = 0;
  bool wait = false;
  std::vector<std::string> flatten, sources;
  std::string reserved, password, destination;
};

bool cancelled = false;  // Only the decoding thread reads and sets it.

bool from_hex(const std::string& hex, std::string& out) {
  if (hex.size() % 2) return false;
  for (size_t i = 0; i < hex.size(); i += 2) {
    int value = 0;
    for (char c : hex.substr(i, 2)) {
      const int digit = c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : -1;
      if (digit < 0) return false;
      value = value * 16 + digit;
    }
    out += char(value);
  }
  return true;
}

// The lines after "RARX1".
bool read_request(Options& options) {
  std::string line;
  while (read_line(line)) {
    const auto space = line.find(' ');
    const std::string key = line.substr(0, space), value = space == std::string::npos ? "" : line.substr(space + 1);
    if (key == "end") return !options.destination.empty() && !options.sources.empty() && options.limit && options.window;
    if (key == "threads") options.threads = unsigned(strtoul(value.c_str(), nullptr, 10));
    else if (key == "window") options.window = strtoull(value.c_str(), nullptr, 10);
    else if (key == "limit") options.limit = strtoull(value.c_str(), nullptr, 10);
    else if (key == "flatten") options.flatten.push_back(value);
    else if (key == "reserved") options.reserved = value;
    else if (key == "password" && !from_hex(value, options.password)) return false;
    else if (key == "dest") options.destination = value;
    else if (key == "wait") options.wait = value == "1";
    else if (key == "source") options.sources.push_back(value);
  }
  return false;
}

struct Session {
  explicit Session(const Options& options) : options(options) {}
  const Options& options;
  Writer writer;
  // `reading` is the index of the volume UnRAR is reading, the count of them once it wants one past the last.
  size_t next_volume = 1, reading = 0;
  bool writing = false, missing_volume = false, missing_password = false, last_checked = false, last_cut = false;
  const Archive* archive = nullptr;
  uint64 written = 0, last_report = 0;
  std::string error;
};

void check_last(Session& session);

// Progress, a look for "cancel" and, while a set downloads, for its last volume, a few times a second.
void heartbeat(Session& session) {
  const uint64 now = now_ns();
  if (now - session.last_report < progress_ns) return;
  session.last_report = now;
  say("p " + std::to_string(session.written));
  if (stop_requested()) cancelled = true;
  check_last(session);
}

// The app renames a volume to its final name once it is complete; until then, progress and a look for
// "cancel" go on as while decoding. Without hard links (the console, exFAT) the download reserves the final
// name with an empty file just before renaming the volume over it: an empty file is not the volume yet.
bool await_volume(Session& session, const std::string& path) {
  for (;;) {
    struct stat st;
    if (!lstat(path.c_str(), &st)) {
      if (!S_ISREG(st.st_mode)) return false;
      if (st.st_size) return true;
    } else if (errno != ENOENT) {
      return false;
    }
    heartbeat(session);
    if (cancelled || !session.error.empty()) return false;
    usleep(250000);
  }
}

int CALLBACK callback(UINT message, LPARAM user, LPARAM p1, LPARAM p2) {
  Session& session = *reinterpret_cast<Session*>(user);
  switch (message) {
    case UCM_PROCESSDATA: {
      // Service data (NTFS streams and such) after a file is read and dropped.
      if (!session.writing) return 1;
      const size_t size = size_t(p2);
      if (size > session.options.limit - session.written) {
        session.error = "Archive exceeds the extraction size limit.";
        return -1;
      }
      session.written += size;
      if (!session.writer.append(reinterpret_cast<const byte*>(p1), size)) return -1;
      heartbeat(session);
      return cancelled || !session.error.empty() ? -1 : 1;
    }
    case UCM_NEXTVOLUMEW: {
      // Volumes are exactly the engine's list, in order, whatever their names.
      if (session.next_volume >= session.options.sources.size()) {
        session.reading = session.next_volume;
        session.missing_volume = true;
        return -1;
      }
      session.reading = session.next_volume;
      const std::string& path = session.options.sources[session.next_volume++];
      if (session.options.wait && !await_volume(session, path)) {
        if (!cancelled) session.missing_volume = true;
        return -1;
      }
      UtfToWide(path.c_str(), reinterpret_cast<wchar*>(p1), size_t(p2));
      return 1;
    }
    case UCM_CHANGEVOLUME:
      return p2 == RAR_VOL_NOTIFY ? 1 : -1;
    case UCM_CHANGEVOLUMEW:
      // A RAR5 volume names its place in the set; one out of place means a volume between is missing.
      if (p2 == RAR_VOL_NOTIFY && session.archive->Format == RARFMT50 && session.archive->VolNumber &&
          session.archive->VolNumber != session.next_volume - 1)
        session.missing_volume = true;
      return p2 == RAR_VOL_NOTIFY && !session.missing_volume ? 1 : -1;
    case UCM_NEEDPASSWORD:
    case UCM_NEEDPASSWORDW:  // Asked only when none was given.
      session.missing_password = true;
      return -1;
    default:  // No dictionary beyond the limit.
      return -1;
  }
}

std::string describe(int code) {
  switch (code) {
    case ERAR_EOPEN: return "Incomplete RAR archive or missing volume.";
    case ERAR_BAD_DATA: return "RAR checksum mismatch; the archive is damaged.";
    case ERAR_EREAD: return "Cannot read the RAR archive; it may be truncated.";
    case ERAR_MISSING_PASSWORD: return "RAR archive password is missing.";
    case ERAR_BAD_PASSWORD: return "Incorrect RAR archive password.";
    case ERAR_NO_MEMORY:
    case ERAR_LARGE_DICT: return too_much_memory;
    case ERAR_BAD_ARCHIVE:
    case ERAR_UNKNOWN_FORMAT: return "Unsupported or damaged RAR archive.";
    default: return "RAR extraction failed.";
  }
}

int dll_error(CommandData& command) {
  if (command.DllError) return command.DllError;
  switch (ErrHandler.GetErrorCode()) {
    case RARX_SUCCESS: return ERAR_SUCCESS;
    case RARX_FATAL:
    case RARX_READ: return ERAR_EREAD;
    case RARX_CRC: return ERAR_BAD_DATA;
    case RARX_OPEN: return ERAR_EOPEN;
    case RARX_MEMORY: return ERAR_NO_MEMORY;
    case RARX_BADPWD: return ERAR_BAD_PASSWORD;
    case RARX_BADARC: return ERAR_BAD_ARCHIVE;
    default: return ERAR_UNKNOWN;
  }
}

// The engine asks for fewer while downloads run. One core always stays with the app's interface; when the
// count is unknown, the cap alone applies.
unsigned pick_threads(unsigned requested) {
  const long known = cores();
  if (!requested) return unsigned(std::clamp(known - 2, 1L, 4L));
  return unsigned(std::min<long>(requested, known > 0 ? std::clamp(known - 1, 1L, 6L) : 6));
}

// Throws RAR_EXIT or std::bad_alloc from UnRAR; returns the reason extraction stopped, empty on success.
std::string extract(Session& session, CommandData& command, Archive& archive, CmdExtract& extractor) {
  const Options& options = session.options;
  uint64 declared = 0;
  while (true) {
    heartbeat(session);
    if (cancelled) return {};
    if (!session.error.empty()) return session.error;
    const size_t header_size = archive.SearchBlock(HEAD_FILE);
    if (header_size == 0) {
      if (archive.Volume && archive.GetHeaderType() == HEAD_ENDARC && archive.EndArcHead.NextVolume) {
        if (!MergeArchive(archive, nullptr, false, 'L')) return describe(ERAR_EOPEN);
        archive.Seek(archive.CurBlockPos, SEEK_SET);
        continue;
      }
      if (archive.BrokenHeader) return describe(ERAR_BAD_DATA);
      if (archive.FailedHeaderDecryption) return describe(ERAR_BAD_PASSWORD);
      if (const int code = dll_error(command)) return describe(code);
      return {};
    }
    const FileHeader& header = archive.FileHead;
    if (header.SplitBefore) return describe(ERAR_EOPEN);
    std::string name;
    WideToUtf(header.FileName, name);
    while (!name.empty() && name.back() == '/') name.pop_back();
    if (!name.empty() && name[0] != '/') name = without_dots(name);
    if (!safe(name) || header.RedirType != FSREDIR_NONE || (!options.reserved.empty() && name.find(options.reserved) != std::string::npos))
      return "Archive contains an unsafe path, link or special file.";
    if (header.Method != 0 && header.WinSize > options.window) return too_much_memory;
    if (!header.Dir) {
      if (header.UnpSize < 0 || uint64(header.UnpSize) > options.limit - declared) return "Archive exceeds the extraction size limit.";
      declared += header.UnpSize;
    }
    // ShadowMount's default scan reaches one subdirectory, so images are published at the set root.
    if (!header.Dir && flattened(options.flatten, name)) name = name.substr(name.rfind('/') + 1);
    std::string target;
    if (!make_parents(options.destination, name, target)) return strerror(errno);
    if (header.Dir) {
      if (mkdir(target.c_str(), 0777) && (errno != EEXIST || !plain_directory(target))) return strerror(errno);
    } else {
      const int fd = open(target.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0666);
      if (fd < 0) return strerror(errno);
      session.writer.begin(fd, name);
      session.writing = true;
    }
    // Reading the service headers below may load the next file's header.
    const uint64 size = uint64(header.UnpSize);
    const bool directory = header.Dir;
    command.DllError = 0;
    command.DllOpMode = RAR_TEST;
    command.Command = L"T";
    command.Test = true;
    bool repeat = false;
    extractor.ExtractCurrentFile(archive, header_size, repeat);
    session.writing = false;
    // As unrar.dll does: the file's service headers are handled in the same step.
    while (archive.IsOpened() && archive.ReadHeader() != 0 && archive.GetHeaderType() == HEAD_SERVICE) {
      extractor.ExtractCurrentFile(archive, header_size, repeat);
      archive.SeekToNext();
    }
    archive.Seek(archive.CurBlockPos, SEEK_SET);
    if (!session.error.empty()) return session.error;
    if (const auto error = session.writer.error(); !error.empty()) return error;
    if (cancelled) return {};
    if (const int code = dll_error(command)) return describe(code);
    if (!directory) session.writer.end(size);
  }
}

void use_password(CommandData& command, const Options& options) {
  if (options.password.empty()) return;
  std::wstring password;
  UtfToWide(options.password.c_str(), password);
  command.Password.Set(password.c_str());
}

// The unpacked size of every file in the set, from each volume's headers; 0 while volumes are still
// downloading or when one cannot be read, and the engine keeps its own estimate.
uint64 declared_total(const Options& options) {
  if (options.wait) return 0;
  CommandData command;
  use_password(command, options);
  uint64 total = 0;
  try {
    for (const auto& path : options.sources) {
      std::wstring name;
      UtfToWide(path.c_str(), name);
      Archive archive(&command);
      if (!archive.Open(name) || !archive.IsArchive(false)) return 0;
      while (archive.ReadHeader() > 0 && archive.GetHeaderType() != HEAD_ENDARC) {
        const FileHeader& header = archive.FileHead;
        // A file split across volumes declares its whole size in each part; it counts once.
        if (archive.GetHeaderType() == HEAD_FILE && !header.Dir && !header.SplitBefore) {
          if (header.UnknownUnpSize || header.UnpSize < 0) return 0;
          total += uint64(header.UnpSize);
        }
        archive.SeekToNext();
      }
      if (archive.BrokenHeader || archive.FailedHeaderDecryption) return 0;
    }
  } catch (...) {
    total = 0;
  }
  return total;
}

// The volume to blame for a set that ended early or failed its checksum, 1-based, or 0 when none stands
// out: the last if its headers run past its end; else, as a set's volumes are all one size but the last, a
// shorter one, cut off; otherwise, for an early end, the volume UnRAR was reading.
size_t suspect_volume(const Session& session, bool early_end) {
  const auto& sources = session.options.sources;
  if (session.last_cut) return sources.size();
  std::vector<uint64> sizes;
  for (const auto& path : sources) {
    struct stat st;
    sizes.push_back(lstat(path.c_str(), &st) ? 0 : uint64(st.st_size));
  }
  const uint64 full = sizes.size() > 1 ? *std::max_element(sizes.begin(), sizes.end() - 1) : 0;
  for (size_t i = 0; i + 1 < sizes.size(); ++i)
    if (sizes[i] < full) return i + 1;
  return early_end && session.reading < sources.size() ? session.reading + 1 : 0;
}

// What a volume's own headers say about its place in the set. Not known when they cannot be read for a
// reason the extraction names better: no password, a wrong one, not a RAR volume. `whole` once every
// header and entry fits in the file: a volume cut short says nothing about what follows it. `cut` when an
// entry or the header after it runs past the file's end; a header damaged within the file is not a cut.
struct Place {
  bool known = false, whole = false, cut = false, first = true, last = true;
};

Place place_of(const Options& options, const std::string& path) {
  // A streamed set is checked while UnRAR decodes; its error state stays the decoder's.
  const ErrorHandler saved = ErrHandler;
  Place place;
  try {
    CommandData command;
    use_password(command, options);
    std::wstring name;
    UtfToWide(path.c_str(), name);
    Archive archive(&command);
    if (archive.Open(name) && archive.IsArchive(false) && archive.Format != RARFMT14) {
      bool entries = false, split_before = false, split_after = false, ended = false;
      int64 entry_end = 0;
      while (archive.ReadHeader() > 0) {
        const HEADER_TYPE type = archive.GetHeaderType();
        if (type == HEAD_ENDARC) {
          ended = true;
          break;
        }
        if (type == HEAD_FILE || type == HEAD_SERVICE) {
          const FileHeader& header = type == HEAD_FILE ? archive.FileHead : archive.SubHead;
          if (!entries) split_before = header.SplitBefore;
          entries = true;
          split_after = header.SplitAfter;
          entry_end = archive.NextBlockPos;
        }
        archive.SeekToNext();
      }
      // RAR4 has no password check: a header cut short fails to decrypt as with a wrong password, but only
      // after the right one decrypted the entries before it.
      if (!archive.FailedHeaderDecryption || entries) {
        place.known = true;
        // Reading stops at the end block, or where no whole header is left: the file's end if nothing is cut.
        const int64 size = archive.FileLength();
        place.whole = !archive.BrokenHeader && entry_end <= size && (ended || archive.CurBlockPos >= size);
        place.cut = entry_end > size || (!ended && archive.CurBlockPos < size && archive.Tell() >= size);
        if (archive.Format == RARFMT50) {
          place.first = !archive.Volume || archive.VolNumber == 0;
          place.last = !archive.Volume || (ended && !archive.EndArcHead.NextVolume);
        } else {
          // RAR 2.x volumes have no first volume flag; RAR 3 and later ones number themselves in their end block.
          const bool numbered = ended && archive.EndArcHead.StoreVolNumber && archive.EndArcHead.VolNumber;
          place.first = !archive.Volume || (archive.MainHead.Flags & MHD_FIRSTVOLUME) || !(split_before || numbered);
          // Without an end block (RAR 2.x, or "-en"), the last entry tells.
          place.last = ended ? !archive.EndArcHead.NextVolume : entries && !split_after;
        }
      }
    }
  } catch (...) {
  }
  ErrHandler = saved;
  return place;
}

// A set that lacks its last volume would otherwise fail only once every other volume is decoded, hours later
// on the console. A last volume cut short fails as before, named, so that one is downloaded again. A
// streamed set's last volume is checked once it is there.
void check_last(Session& session) {
  const std::string& path = session.options.sources.back();
  struct stat st;
  if (session.last_checked || (session.options.wait && (lstat(path.c_str(), &st) || !S_ISREG(st.st_mode) || !st.st_size))) return;
  session.last_checked = true;
  const Place place = place_of(session.options, path);
  session.last_cut = place.known && place.cut;
  if (place.known && place.whole && !place.last) session.error = describe(ERAR_EOPEN);
}

void check_first(Session& session) {
  const Place place = place_of(session.options, session.options.sources.front());
  if (place.known && !place.first) session.error = missing_first;
}

std::string run(Session& session) {
  const Options& options = session.options;
  CommandData command;
  command.FileArgs.AddString(L"*");
  command.Overwrite = OVERWRITE_ALL;
  command.VersionControl = 1;
  command.Callback = callback;
  command.UserData = LPARAM(&session);
  command.Threads = pick_threads(options.threads);
  command.WinSizeLimit = options.window;
  use_password(command, options);
  std::wstring name;
  UtfToWide(options.sources.front().c_str(), name);
  command.AddArcName(name);
  Archive archive(&command);
  session.archive = &archive;
  if (!archive.Open(name)) return describe(ERAR_EOPEN);
  if (!archive.IsArchive(true)) return describe(command.DllError ? command.DllError : dll_error(command) ? dll_error(command) : ERAR_BAD_ARCHIVE);
  CmdExtract extractor(&command);
  extractor.ExtractArchiveInit(archive);
  return extract(session, command, archive, extractor);
}
}

int main() {
  signal(SIGPIPE, SIG_IGN);
  // Directories and files stay usable by the app, which may run as another user than this program.
  umask(0);
  // "7ZX1" asks for a 7z (sevenzip.cpp); "RARX1" for a RAR set.
  std::string magic;
  if (read_line(magic) && magic == "7ZX1") return sevenzip::run();
  Options options;
  if (magic != "RARX1" || !read_request(options)) {
    say("fail Invalid RAR worker request.");
    return 1;
  }
  say("ready");
  // Progress comes from the decoder's callback only, so one long fsync on a slow drive would look like a
  // dead worker to the engine. "k" every second says this process is still alive whatever it is doing.
  std::mutex alive_mutex;
  std::condition_variable alive_wake;
  bool done = false;
  std::thread alive;
  try {
    alive = std::thread([&] {
      std::unique_lock lock(alive_mutex);
      while (!alive_wake.wait_for(lock, std::chrono::seconds(1), [&] { return done; })) say("k");
    });
  } catch (...) {
  }
  std::string error;
  {
    Session session{options};
    try {
      check_last(session);
      if (session.error.empty()) check_first(session);
      if (session.error.empty()) {
        if (const uint64 total = declared_total(options)) say("d " + std::to_string(total));
        ErrHandler.Clean();
        error = run(session);
      } else {
        error = session.error;
      }
    } catch (RAR_EXIT code) {
      error = !session.error.empty() ? session.error : session.writer.error();
      if (error.empty() && !cancelled) error = code == RARX_MEMORY ? too_much_memory : describe(ERAR_UNKNOWN);
    } catch (std::bad_alloc&) {
      error = too_much_memory;
    } catch (...) {
      error = describe(ERAR_UNKNOWN);
    }
    if (error.empty() && !cancelled) say("s");
    const auto written = session.writer.finish();
    if (error.empty()) error = written;
    const Writer& w = session.writer;
    const auto ms = [](uint64 ns) { return std::to_string(ns / 1000000) + "ms"; };
    std::string timings = "t threads=" + std::to_string(pick_threads(options.threads)) + " cores=" + std::to_string(cores())
        + " write=" + ms(w.write_ns) + "/" + std::to_string(w.writes) + " fsync=" + ms(w.sync_ns) + "/" + std::to_string(w.syncs)
        + " waited=" + ms(w.wait_ns);
    if (const uint64 cpu = process_cpu_us()) timings += " cpu=" + ms(cpu * 1000);
    say(timings);
    // The precise cause, rather than the checksum or header failure it leads to.
    if (!error.empty() && session.error.empty() && !cancelled) {
      if (session.missing_password) error = describe(ERAR_MISSING_PASSWORD);
      else if (session.missing_volume) error = describe(ERAR_EOPEN);
    }
    // Which volume, so that one alone is downloaded again: "... Volume 6 of 12 looks incomplete." A volume
    // check's reason stands as it is. A last volume cut in its end block fails with no more precise reason.
    const bool early_end = error == describe(ERAR_EOPEN) || error == describe(ERAR_EREAD) ||
                           (session.last_cut && error == describe(ERAR_UNKNOWN));
    if (!cancelled && session.error.empty() && session.options.sources.size() > 1 && (early_end || error == describe(ERAR_BAD_DATA)))
      if (const size_t volume = suspect_volume(session, early_end))
        error += " Volume " + std::to_string(volume) + " of " + std::to_string(session.options.sources.size()) + " looks incomplete.";
  }
  {
    std::lock_guard lock(alive_mutex);
    done = true;
  }
  alive_wake.notify_all();
  if (alive.joinable()) alive.join();
  if (cancelled) say("cancelled");
  else say(error.empty() ? "ok" : "fail " + error);
  return error.empty() ? 0 : 1;
}
