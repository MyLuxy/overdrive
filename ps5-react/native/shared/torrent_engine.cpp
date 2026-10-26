// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
#include "torrent_engine.hpp"
#include "digest.hpp"
#include "network.hpp"
#include "thread_name.hpp"
#include "torrent_meta.hpp"
#include "torrent_peer.hpp"
#include "torrent_tracker.hpp"
#include "worker_thread.hpp"
#include <algorithm>
#include <arpa/inet.h>
#include <atomic>
#include <cerrno>
#include <charconv>
#include <chrono>
#include <cstring>
#include <deque>
#include <fcntl.h>
#include <limits.h>
#include <map>
#include <memory>
#include <mutex>
#include <netinet/in.h>
#include <poll.h>
#include <set>
#include <string_view>
#include <sys/socket.h>
#include <sys/stat.h>
#include <system_error>
#include <thread>
#include <unistd.h>

namespace torrent {
namespace {
using Clock = std::chrono::steady_clock;

constexpr std::size_t kMaxTorrentBytes = 64u << 20;
constexpr std::size_t kMaxPendingBytes = 2u << 20;
constexpr std::size_t kMaxCandidates = 256;
constexpr unsigned kRequestsPerPeer = 4;
constexpr int kConnectTimeoutMs = 10000;
constexpr int kRequestTimeoutMs = 60000;
constexpr int kMetadataTimeoutMs = 15000;
constexpr int kStallTimeoutMs = 10 * 60 * 1000;
constexpr std::string_view kClientName = "Overdrive";
#ifdef MSG_NOSIGNAL
constexpr int kSendFlags = MSG_NOSIGNAL;
#else
constexpr int kSendFlags = 0;
#endif

std::uint32_t get32(std::string_view bytes, std::size_t at) {
  std::uint32_t value = 0;
  for (std::size_t i = 0; i < 4; ++i) value = (value << 8) | static_cast<unsigned char>(bytes[at + i]);
  return value;
}

int hex_digit(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

bool unhex(std::string_view text, std::string& out) {
  if (text.size() % 2) return false;
  out.clear();
  out.reserve(text.size() / 2);
  for (std::size_t i = 0; i < text.size(); i += 2) {
    const int high = hex_digit(text[i]), low = hex_digit(text[i + 1]);
    if (high < 0 || low < 0) return false;
    out.push_back(static_cast<char>((high << 4) | low));
  }
  return true;
}

std::string hex_encode(std::string_view bytes) {
  constexpr char digits[] = "0123456789abcdef";
  std::string out;
  out.reserve(bytes.size() * 2);
  for (const unsigned char byte : bytes) {
    out.push_back(digits[byte >> 4]);
    out.push_back(digits[byte & 15]);
  }
  return out;
}

std::string hex64(std::uint64_t value) {
  constexpr char digits[] = "0123456789abcdef";
  std::string out(16, '0');
  for (int index = 15; index >= 0; --index) {
    out[static_cast<std::size_t>(index)] = digits[value & 15];
    value >>= 4;
  }
  return out;
}

std::uint64_t fnv1a(std::string_view bytes) {
  std::uint64_t hash = 1469598103934665603ull;
  for (const unsigned char byte : bytes) {
    hash ^= byte;
    hash *= 1099511628211ull;
  }
  return hash;
}

std::string make_peer_id(std::uint32_t id, std::uint32_t serial) {
  static constexpr char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
  std::uint64_t mix = static_cast<std::uint64_t>(Clock::now().time_since_epoch().count());
  mix ^= static_cast<std::uint64_t>(id) << 32;
  mix ^= serial;
  std::string out = "-OV0001-";
  for (int i = 0; i < 12; ++i) {
    out.push_back(digits[mix & 31]);
    mix = mix * 6364136223846793005ull + 1442695040888963407ull;
  }
  return out;
}

bool parse_u64(std::string_view text, std::uint64_t& out) {
  if (text.empty()) return false;
  const auto result = std::from_chars(text.data(), text.data() + text.size(), out);
  return result.ec == std::errc() && result.ptr == text.data() + text.size();
}

bool read_bytes(int fd, void* data, std::size_t size, std::uint64_t offset) {
  auto* bytes = static_cast<char*>(data);
  std::size_t done = 0;
  while (done < size) {
    const ssize_t count = pread(fd, bytes + done, size - done, static_cast<off_t>(offset + done));
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    done += static_cast<std::size_t>(count);
  }
  return true;
}

bool write_bytes(int fd, const void* data, std::size_t size, std::uint64_t offset) {
  const auto* bytes = static_cast<const char*>(data);
  std::size_t done = 0;
  while (done < size) {
    const ssize_t count = pwrite(fd, bytes + done, size - done, static_cast<off_t>(offset + done));
    if (count < 0 && errno == EINTR) continue;
    if (count <= 0) return false;
    done += static_cast<std::size_t>(count);
  }
  return true;
}

bool read_whole(const std::string& path, std::size_t limit, std::string& out, std::string& error) {
  const int fd = ::open(path.c_str(), O_RDONLY | O_NOFOLLOW);
  if (fd < 0) {
    error = std::string("open: ") + std::strerror(errno);
    return false;
  }
  struct stat info {};
  if (fstat(fd, &info) != 0 || info.st_size <= 0 ||
      static_cast<std::uint64_t>(info.st_size) > static_cast<std::uint64_t>(limit)) {
    close(fd);
    error = "the file is empty or larger than " + std::to_string(limit) + " bytes";
    return false;
  }
  out.assign(static_cast<std::size_t>(info.st_size), '\0');
  const bool ok = read_bytes(fd, out.data(), out.size(), 0);
  close(fd);
  if (!ok) error = "the file could not be read";
  return ok;
}

// Creates the directories that lead to `file`, not the file itself.
bool make_directories(const std::string& file) {
  char path[PATH_MAX];
  if (file.size() + 1 > sizeof path) return false;
  std::memcpy(path, file.c_str(), file.size() + 1);
  for (char* slash = std::strchr(path + 1, '/'); slash; slash = std::strchr(slash + 1, '/')) {
    *slash = '\0';
    const bool ok = mkdir(path, 0755) == 0 || errno == EEXIST;
    *slash = '/';
    if (!ok) return false;
  }
  return true;
}

std::string basename(const std::string& path) {
  const auto slash = path.find_last_of('/');
  return slash == std::string::npos ? path : path.substr(slash + 1);
}

void prepare_socket(int fd) {
  const int flags = fcntl(fd, F_GETFL, 0);
  if (flags >= 0) fcntl(fd, F_SETFL, flags | O_NONBLOCK);
#ifdef SO_NOSIGPIPE
  const int on = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, sizeof on);
#endif
}

struct Tracker {
  std::vector<std::string> urls;
  std::string info_hash, peer_id;
  std::uint16_t port = 0;
  std::mutex mutex; // peers and the last answer
  std::vector<PeerAddress> peers;
  unsigned seeds = 0, leechers = 0;
  int interval = 1800;
  std::string error;
  std::atomic<bool> stop{false}, completed{false};
  std::atomic<std::uint64_t> left{0}, uploaded{0}, downloaded{0};
  WorkerThread thread;
  bool started = false;
};

void announce_once(Tracker& tracker, const char* event) {
  Announce announce;
  announce.info_hash = tracker.info_hash;
  announce.peer_id = tracker.peer_id;
  announce.port = tracker.port;
  announce.uploaded = tracker.uploaded.load();
  announce.downloaded = tracker.downloaded.load();
  announce.left = tracker.left.load();
  announce.event = event;
  std::vector<PeerAddress> found;
  unsigned seeds = 0, leechers = 0;
  int interval = 0;
  bool answered = false;
  std::string first_error;
  for (const auto& url : tracker.urls) {
    AnnounceResult result;
    std::string error;
    if (!announce_tracker(url, announce, result, error)) {
      if (first_error.empty()) first_error = error;
      continue;
    }
    answered = true;
    if (result.interval > 0) interval = result.interval;
    seeds = result.seeds;
    leechers = result.leechers;
    for (const auto& peer : result.peers)
      if (found.size() < kMaxCandidates) found.push_back(peer);
  }
  std::lock_guard lock(tracker.mutex);
  for (auto& peer : found)
    if (tracker.peers.size() < 1024) tracker.peers.push_back(std::move(peer));
  if (answered) {
    tracker.seeds = seeds;
    tracker.leechers = leechers;
    tracker.error.clear();
    if (interval > 0) tracker.interval = interval < 60 ? 60 : (interval > 3600 ? 3600 : interval);
  } else {
    tracker.error = first_error;
  }
}

void tracker_loop(Tracker& tracker) {
  name_thread("torrent-trk");
  announce_once(tracker, "started");
  auto next = Clock::now() + std::chrono::seconds(tracker.interval);
  bool completed_announced = false;
  while (!tracker.stop.load()) {
    for (int slice = 0; slice < 4 && !tracker.stop.load(); ++slice)
      std::this_thread::sleep_for(std::chrono::milliseconds(250));
    if (tracker.stop.load()) break;
    if (tracker.completed.load() && !completed_announced) {
      announce_once(tracker, "completed");
      completed_announced = true;
    }
    if (Clock::now() >= next) {
      announce_once(tracker, "");
      next = Clock::now() + std::chrono::seconds(tracker.interval);
    }
  }
  announce_once(tracker, "stopped");
}

struct Task {
  Config config;
  std::mutex mutex; // guards `snapshot` for poll()
  Snapshot snapshot;
  std::atomic<bool> cancelled{false};
  std::atomic<bool> stop_seeding{false}; // gives a finished seeder's slot to a new download
  std::atomic<bool> done{false};
  WorkerThread thread;
};

std::mutex g_mutex;
std::map<std::uint32_t, std::shared_ptr<Task>> g_tasks;
std::uint32_t g_next_id = 1;
std::atomic<bool> g_seeding{false};
std::atomic<std::uint32_t> g_serial{0};

class Engine {
public:
  explicit Engine(Task& task) : task_(task), config_(task.config) {}
  ~Engine() {
    stop_tracker();
    close_peers();
    if (listener_ >= 0) close(listener_);
    if (destination_ >= 0) close(destination_);
  }

  void run();

private:
  struct Request {
    std::uint32_t piece = 0, begin = 0, length = 0;
    Clock::time_point sent;
  };
  struct Peer {
    int fd = -1;
    std::string host;
    std::uint16_t port = 0;
    bool outgoing = false, connecting = false, handshaken = false, extensions = false;
    bool sent_handshake = false, sent_bitfield = false;
    bool choked = true, am_choking = true, interested = false, peer_interested = false;
    Reader reader;
    std::string pre;     // bytes before the handshake
    std::string pending; // bytes waiting for POLLOUT
    std::vector<std::uint8_t> has;
    std::string bitfield; // kept until the torrent's metadata is known
    unsigned needed_has = 0;
    int ut_metadata = 0, ut_pex = 0;
    unsigned metadata_size = 0;
    std::vector<Request> requests;
    Clock::time_point connected_at, last_data, last_sent;
    std::uint64_t down = 0, up = 0;
  };

  void fail(const std::string& message) {
    if (error_.empty()) error_ = message;
    failed_ = true;
  }
  void publish_now();
  void maybe_publish();

  bool load_torrent();
  void adopt_metadata();
  bool fetch_metadata();
  bool prepare_download();
  bool choose_file();
  bool open_destination();
  bool load_parts(std::uint64_t file_size);
  void save_parts();
  void open_listener();
  bool start_tracker(const std::vector<std::string>& urls);
  void stop_tracker();
  bool download();
  void complete();
  void seeding();
  void finish_loop();
  void close_peers();

  void service(int wait_ms);
  void poll_sockets(int wait_ms);
  void accept_peers();
  void dial_candidates();
  void collect_tracker_peers();
  void add_candidate(const std::string& host, std::uint16_t port);
  void add_candidate_hostport(const std::string& text);
  void reap_dead_peers();
  void maintenance();

  void finish_connect(Peer& peer);
  bool consume_handshake(Peer& peer);
  void read_peer(Peer& peer);
  void flush_peer(Peer& peer);
  void queue_send(Peer& peer, std::string_view bytes);
  void drop(Peer& peer);
  void handle_frames(Peer& peer);
  void on_frame(Peer& peer, const Frame& frame);
  void on_extended(Peer& peer, std::string_view payload);
  void on_request(Peer& peer, std::string_view payload);
  void on_piece(Peer& peer, std::string_view payload);

  void begin_metadata(Peer& peer);
  void request_metadata(Peer& peer, unsigned index);
  void on_metadata_message(Peer& peer, std::string_view payload);
  void reset_metadata();

  void schedule();
  bool begin_piece();
  void verify_active();
  void restart_active();
  void send_bitfield(Peer& peer);
  void send_have(std::uint32_t index);
  void mark_have(Peer& peer, std::uint32_t index);
  void adopt_peer_bitfield(Peer& peer);

  std::uint32_t piece_size(std::uint32_t index) const;
  std::uint64_t intersection(std::uint32_t index) const;
  std::uint64_t wanted_verified_bytes() const;
  std::string extended_handshake() const;

  Task& task_;
  Config config_;
  MetaInfo meta_;
  Magnet magnet_;
  bool have_metadata_ = false, prepared_ = false, failed_ = false, seeding_mode_ = false;
  std::string info_hash_hex_, info_hash_raw_, peer_id_;
  std::string state_ = "starting", error_;
  std::string destination_path_, parts_path_;
  int destination_ = -1, listener_ = -1;
  std::uint16_t listen_port_ = 0;
  Tracker tracker_;
  std::deque<PeerAddress> candidates_;
  std::set<std::string> seen_;
  std::vector<std::unique_ptr<Peer>> peers_;
  FileEntry file_;
  std::uint32_t first_piece_ = 0, last_piece_ = 0, next_piece_ = 0, needed_pieces_ = 0, done_pieces_ = 0;
  std::vector<std::uint8_t> done_;
  std::uint64_t downloaded_ = 0, uploaded_ = 0, verified_ = 0;
  unsigned swarm_seeds_ = 0, swarm_leechers_ = 0;
  double speed_ = 0;
  std::uint64_t speed_bytes_ = 0;
  Clock::time_point speed_at_, last_publish_, last_progress_, last_saved_;
  bool active_ = false;
  std::uint32_t active_index_ = 0, active_size_ = 0;
  std::string active_buffer_;
  std::vector<std::uint8_t> active_blocks_;
  unsigned active_blocks_done_ = 0, attempts_ = 0;
  std::string metadata_;
  std::vector<std::uint8_t> metadata_done_;
  unsigned metadata_size_ = 0, metadata_pieces_ = 0, metadata_index_ = 0;
  Peer* metadata_peer_ = nullptr;
  Clock::time_point metadata_sent_;
};

void Engine::run() {
  name_thread("torrent");
  state_ = "starting";
  last_progress_ = Clock::now();
  speed_at_ = last_progress_;
  last_publish_ = last_progress_;
  last_saved_ = last_progress_;
  publish_now();

  if (!config_.torrent_path.empty()) {
    if (!load_torrent()) {
      finish_loop();
      return;
    }
  } else {
    Magnet parsed;
    std::string why;
    if (!parse_magnet(config_.magnet, parsed, why)) {
      fail(why);
      finish_loop();
      return;
    }
    magnet_ = std::move(parsed);
    info_hash_hex_ = magnet_.info_hash;
    for (const auto& peer : magnet_.peers) add_candidate_hostport(peer);
  }
  if (!unhex(info_hash_hex_, info_hash_raw_) || info_hash_raw_.size() != 20) {
    fail("the info hash is malformed");
    finish_loop();
    return;
  }
  peer_id_ = make_peer_id(task_.snapshot.id, g_serial.fetch_add(1));

  open_listener();
  const std::vector<std::string>& trackers = have_metadata_ ? meta_.trackers : magnet_.trackers;
  if (trackers.empty()) {
    fail("the torrent has no trackers, and this engine has no DHT to find peers without one");
    finish_loop();
    return;
  }
  if (!start_tracker(trackers)) {
    finish_loop();
    return;
  }
  tracker_.left.store(have_metadata_ ? meta_.total_length : magnet_.exact_length);

  if (!have_metadata_) {
    state_ = "metadata";
    publish_now();
    if (!fetch_metadata()) {
      finish_loop();
      return;
    }
  }
  if (!prepare_download()) {
    finish_loop();
    return;
  }
  if (!download()) {
    finish_loop();
    return;
  }
  complete();
  seeding();
  finish_loop();
}

void Engine::publish_now() {
  Snapshot snapshot;
  {
    std::lock_guard lock(task_.mutex);
    Snapshot& out = task_.snapshot;
    out.state = state_;
    out.error = error_;
    out.name = meta_.name.empty() ? magnet_.name : meta_.name;
    out.file = prepared_ ? file_.path : std::string();
    out.info_hash = info_hash_hex_;
    out.metadata = have_metadata_;
    out.seeding = seeding_mode_;
    out.size = prepared_ ? file_.length : magnet_.exact_length;
    out.total = have_metadata_ ? meta_.total_length : magnet_.exact_length;
    out.downloaded = downloaded_;
    out.verified = verified_;
    out.uploaded = uploaded_;
    out.bytes_per_second = speed_;
    out.pieces = prepared_ ? needed_pieces_ : 0;
    out.pieces_done = prepared_ ? done_pieces_ : 0;
    unsigned connected = 0, seeds = 0;
    for (const auto& peer : peers_) {
      if (peer->fd < 0 || !peer->handshaken) continue;
      ++connected;
      if (prepared_ && peer->needed_has >= needed_pieces_) ++seeds;
    }
    out.peers = connected;
    out.seeds = seeds;
    out.leechers = connected > seeds ? connected - seeds : 0;
    out.swarm_seeds = swarm_seeds_;
    out.swarm_leechers = swarm_leechers_;
    out.listen_port = listen_port_;
  }
  tracker_.uploaded.store(uploaded_);
  tracker_.downloaded.store(downloaded_);
  if (prepared_) {
    tracker_.left.store(file_.length > verified_ ? file_.length - verified_ : 0);
  } else {
    tracker_.left.store(magnet_.exact_length);
  }
}

void Engine::maybe_publish() {
  const auto now = Clock::now();
  const auto since = std::chrono::duration_cast<std::chrono::milliseconds>(now - speed_at_).count();
  if (since >= 1000) {
    const double measured = static_cast<double>(downloaded_ - speed_bytes_) * 1000.0 / static_cast<double>(since);
    speed_ = speed_ <= 0 ? measured : speed_ * 0.7 + measured * 0.3;
    speed_at_ = now;
    speed_bytes_ = downloaded_;
  }
  if (now - last_publish_ >= std::chrono::milliseconds(200)) publish_now();
}

bool Engine::load_torrent() {
  std::string bytes, why;
  if (!read_whole(config_.torrent_path, kMaxTorrentBytes, bytes, why)) {
    fail(".torrent: " + why);
    return false;
  }
  MetaInfo info;
  if (!parse_metainfo(bytes, info, why)) {
    fail(".torrent: " + why);
    return false;
  }
  meta_ = std::move(info);
  have_metadata_ = true;
  info_hash_hex_ = meta_.info_hash;
  if (meta_.trackers.empty()) {
    fail("the .torrent has no trackers, and this engine has no DHT to find peers without one");
    return false;
  }
  return true;
}

void Engine::adopt_metadata() {
  have_metadata_ = true;
  metadata_peer_ = nullptr;
  info_hash_hex_ = meta_.info_hash;
  // Bitfields that arrived during the metadata exchange stay raw; prepare_download() applies them
  // once the wanted file has fixed the piece range.
}

bool Engine::fetch_metadata() {
  while (!task_.cancelled && !failed_ && !have_metadata_) service(250);
  if (task_.cancelled) {
    state_ = "cancelled";
    return false;
  }
  if (failed_) {
    state_ = "failed";
    return false;
  }
  return have_metadata_;
}

bool Engine::choose_file() {
  const FileEntry* chosen = nullptr;
  if (!config_.wanted.empty()) {
    for (const auto& entry : meta_.files)
      if (entry.path == config_.wanted || basename(entry.path) == config_.wanted) {
        chosen = &entry;
        break;
      }
    if (!chosen) {
      fail("the torrent has no file named " + config_.wanted);
      return false;
    }
  } else {
    chosen = largest_file(meta_);
  }
  if (!chosen || chosen->length == 0) {
    fail("the torrent has no file with data");
    return false;
  }
  file_ = *chosen;
  if (meta_.piece_length == 0 || meta_.piece_length > kMaxPieceBytes) {
    fail("the torrent's piece length is larger than 8 MiB");
    return false;
  }
  return true;
}

bool Engine::prepare_download() {
  if (!choose_file()) return false;
  first_piece_ = file_.first_piece;
  last_piece_ = file_.last_piece;
  needed_pieces_ = last_piece_ - first_piece_ + 1;
  done_.assign(meta_.piece_count, 0);
  active_ = false;
  if (!open_destination()) return false;
  prepared_ = true;
  for (auto& peer : peers_) {
    peer->has.assign(meta_.piece_count, 0);
    if (!peer->bitfield.empty()) {
      merge_bitfield(peer->bitfield, peer->has);
      peer->bitfield.clear();
    }
    peer->needed_has = 0;
    for (std::uint32_t index = first_piece_; index <= last_piece_; ++index)
      if (peer->has[index]) ++peer->needed_has;
    if (!peer->handshaken) continue;
    send_bitfield(*peer);
    if (!seeding_mode_ && !peer->interested) {
      peer->interested = true;
      queue_send(*peer, frame(Message::Interested));
    }
  }
  next_piece_ = first_piece_;
  while (next_piece_ <= last_piece_ && done_[next_piece_]) ++next_piece_;
  state_ = "downloading";
  publish_now();
  return true;
}

bool Engine::open_destination() {
  destination_path_ = config_.destination;
  parts_path_ = destination_path_ + ".torrent-parts";
  if (!make_directories(destination_path_)) {
    fail("could not create the destination's folder: " + destination_path_);
    return false;
  }
  destination_ = ::open(destination_path_.c_str(), O_RDWR | O_CREAT | O_NOFOLLOW, 0666);
  if (destination_ < 0) {
    fail("could not open " + destination_path_ + ": " + std::strerror(errno));
    return false;
  }
  struct stat info {};
  const std::uint64_t size = fstat(destination_, &info) == 0 && info.st_size > 0
                                 ? static_cast<std::uint64_t>(info.st_size)
                                 : 0;
  const bool resumed = load_parts(size);
  if (!resumed && ftruncate(destination_, 0) != 0) {
    fail("could not empty " + destination_path_ + ": " + std::strerror(errno));
    return false;
  }
  if (ftruncate(destination_, static_cast<off_t>(file_.length)) != 0) {
    fail("could not size " + destination_path_ + ": " + std::strerror(errno));
    return false;
  }
  return true;
}

bool Engine::load_parts(std::uint64_t file_size) {
  if (file_size < file_.length) return false;
  std::string bytes, why;
  if (!read_whole(parts_path_, 1u << 20, bytes, why)) return false;
  if (bytes.size() < 2) return false;
  if (bytes.back() == '\n') bytes.pop_back();
  const auto last_newline = bytes.rfind('\n');
  if (last_newline == std::string::npos) return false;
  const std::string_view checksum_text = std::string_view(bytes).substr(last_newline + 1);
  const std::string_view content = std::string_view(bytes).substr(0, last_newline + 1);
  std::string checksum_bytes;
  if (!unhex(checksum_text, checksum_bytes) || checksum_bytes.size() != 8) return false;
  std::uint64_t stored = 0;
  for (const unsigned char byte : checksum_bytes) stored = (stored << 8) | byte;
  if (stored != fnv1a(content)) return false;

  std::vector<std::string_view> lines;
  std::string_view rest = content;
  while (!rest.empty()) {
    const auto newline = rest.find('\n');
    if (newline == std::string_view::npos) break;
    lines.push_back(rest.substr(0, newline));
    rest.remove_prefix(newline + 1);
  }
  if (lines.size() != 10 || lines[0] != "OVDP1" || lines[1] != info_hash_hex_) return false;
  std::uint64_t piece_length = 0, total = 0, pieces = 0, first = 0, last = 0, offset = 0, length = 0;
  if (!parse_u64(lines[2], piece_length) || !parse_u64(lines[3], total) || !parse_u64(lines[4], pieces) ||
      !parse_u64(lines[5], first) || !parse_u64(lines[6], last) || !parse_u64(lines[7], offset) ||
      !parse_u64(lines[8], length))
    return false;
  if (piece_length != meta_.piece_length || total != meta_.total_length || pieces != meta_.piece_count ||
      first != first_piece_ || last != last_piece_ || offset != file_.offset || length != file_.length)
    return false;
  std::string field;
  if (!unhex(lines[9], field) || field.size() != (meta_.piece_count + 7) / 8) return false;

  for (std::uint32_t index = first_piece_; index <= last_piece_; ++index) {
    if (!bitfield_has(field, index) || done_[index]) continue;
    done_[index] = 1;
    ++done_pieces_;
    verified_ += intersection(index);
  }
  return done_pieces_ > 0;
}

void Engine::save_parts() {
  if (!prepared_ || parts_path_.empty()) return;
  std::string content = "OVDP1\n";
  content += info_hash_hex_;
  content.push_back('\n');
  content += std::to_string(meta_.piece_length);
  content.push_back('\n');
  content += std::to_string(meta_.total_length);
  content.push_back('\n');
  content += std::to_string(meta_.piece_count);
  content.push_back('\n');
  content += std::to_string(first_piece_);
  content.push_back('\n');
  content += std::to_string(last_piece_);
  content.push_back('\n');
  content += std::to_string(file_.offset);
  content.push_back('\n');
  content += std::to_string(file_.length);
  content.push_back('\n');
  content += hex_encode(build_bitfield(done_));
  content.push_back('\n');
  content += hex64(fnv1a(content));
  content.push_back('\n');
  const int fd = ::open(parts_path_.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0600);
  if (fd < 0) return;
  write_bytes(fd, content.data(), content.size(), 0);
  fsync(fd);
  close(fd);
}

std::uint32_t Engine::piece_size(std::uint32_t index) const {
  if (index >= meta_.piece_count) return 0;
  const std::uint64_t start = static_cast<std::uint64_t>(index) * meta_.piece_length;
  if (start >= meta_.total_length) return 0;
  const std::uint64_t rest = meta_.total_length - start;
  return static_cast<std::uint32_t>(std::min<std::uint64_t>(rest, meta_.piece_length));
}

std::uint64_t Engine::intersection(std::uint32_t index) const {
  const std::uint64_t start = static_cast<std::uint64_t>(index) * meta_.piece_length;
  const std::uint64_t end = start + piece_size(index);
  const std::uint64_t from = std::max(start, file_.offset);
  const std::uint64_t to = std::min(end, file_.offset + file_.length);
  return to > from ? to - from : 0;
}

std::uint64_t Engine::wanted_verified_bytes() const {
  std::uint64_t total = 0;
  for (std::uint32_t index = first_piece_; index <= last_piece_; ++index)
    if (done_[index]) total += intersection(index);
  return total;
}

std::string Engine::extended_handshake() const {
  std::string payload = "d1:md11:ut_metadatai1e6:ut_pexi2ee";
  if (have_metadata_ && !meta_.raw_info.empty())
    payload += "13:metadata_sizei" + std::to_string(meta_.raw_info.size()) + "e";
  payload += "1:v";
  payload += std::to_string(kClientName.size());
  payload.push_back(':');
  payload.append(kClientName);
  payload.push_back('e');
  return extended_frame(0, payload);
}

void Engine::open_listener() {
  const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return;
  const int on = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &on, sizeof on);
  sockaddr_in address {};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_ANY);
  address.sin_port = htons(config_.listen_port);
  if (bind(fd, reinterpret_cast<const sockaddr*>(&address), sizeof address) != 0 || listen(fd, 8) != 0) {
    close(fd);
    return;
  }
  prepare_socket(fd);
  sockaddr_in bound {};
  socklen_t size = sizeof bound;
  listen_port_ = getsockname(fd, reinterpret_cast<sockaddr*>(&bound), &size) == 0 ? ntohs(bound.sin_port) : 0;
  listener_ = fd;
}

bool Engine::start_tracker(const std::vector<std::string>& urls) {
  tracker_.urls = urls;
  tracker_.info_hash = info_hash_raw_;
  tracker_.peer_id = peer_id_;
  tracker_.port = listen_port_;
  Tracker* raw = &tracker_;
  if (!tracker_.thread.start([raw] { tracker_loop(*raw); }, 1024 * 1024)) {
    fail("could not start the tracker worker");
    return false;
  }
  tracker_.started = true;
  return true;
}

void Engine::stop_tracker() {
  tracker_.stop.store(true);
  if (tracker_.started) {
    tracker_.thread.join();
    tracker_.started = false;
  }
}

void Engine::add_candidate(const std::string& host, std::uint16_t port) {
  if (host.empty() || port == 0) return;
  if (listen_port_ != 0 && port == listen_port_ &&
      (host == "127.0.0.1" || host == "0.0.0.0" || host == "localhost"))
    return;
  if (candidates_.size() >= kMaxCandidates) return;
  const std::string key = host + ":" + std::to_string(port);
  if (!seen_.insert(key).second) return;
  candidates_.push_back({host, port});
}

void Engine::add_candidate_hostport(const std::string& text) {
  const auto colon = text.rfind(':');
  if (colon == std::string::npos || colon == 0) return;
  std::uint64_t port = 0;
  if (!parse_u64(std::string_view(text).substr(colon + 1), port) || port == 0 || port > 65535) return;
  add_candidate(text.substr(0, colon), static_cast<std::uint16_t>(port));
}

void Engine::collect_tracker_peers() {
  std::vector<PeerAddress> found;
  {
    std::lock_guard lock(tracker_.mutex);
    found.swap(tracker_.peers);
    swarm_seeds_ = tracker_.seeds;
    swarm_leechers_ = tracker_.leechers;
  }
  for (const auto& peer : found) add_candidate(peer.host, peer.port);
}

void Engine::dial_candidates() {
  while (peers_.size() < config_.connections && !candidates_.empty()) {
    PeerAddress address = std::move(candidates_.front());
    candidates_.pop_front();
    in_addr raw {};
    if (inet_pton(AF_INET, address.host.c_str(), &raw) != 1) continue;
    const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return;
    prepare_socket(fd);
    sockaddr_in to {};
    to.sin_family = AF_INET;
    to.sin_port = htons(address.port);
    to.sin_addr = raw;
    const int connected = ::connect(fd, reinterpret_cast<const sockaddr*>(&to), sizeof to);
    if (connected != 0 && errno != EINPROGRESS) {
      close(fd);
      continue;
    }
    auto peer = std::make_unique<Peer>();
    peer->fd = fd;
    peer->host = std::move(address.host);
    peer->port = address.port;
    peer->outgoing = true;
    peer->connected_at = Clock::now();
    peer->last_data = peer->connected_at;
    peer->last_sent = peer->connected_at;
    if (connected == 0) {
      peer->sent_handshake = true;
      queue_send(*peer, handshake(info_hash_raw_, peer_id_, true));
    } else {
      peer->connecting = true;
    }
    peers_.push_back(std::move(peer));
  }
}

void Engine::accept_peers() {
  while (peers_.size() < config_.connections) {
    sockaddr_in from {};
    socklen_t size = sizeof from;
    const int fd = ::accept(listener_, reinterpret_cast<sockaddr*>(&from), &size);
    if (fd < 0) {
      if (errno == EINTR) continue;
      return;
    }
    prepare_socket(fd);
    char host[INET_ADDRSTRLEN] = {};
    inet_ntop(AF_INET, &from.sin_addr, host, sizeof host);
    auto peer = std::make_unique<Peer>();
    peer->fd = fd;
    peer->host = host;
    peer->port = ntohs(from.sin_port);
    peer->connected_at = Clock::now();
    peer->last_data = peer->connected_at;
    peer->last_sent = peer->connected_at;
    peers_.push_back(std::move(peer));
  }
}

void Engine::finish_connect(Peer& peer) {
  int error = 0;
  socklen_t size = sizeof error;
  if (getsockopt(peer.fd, SOL_SOCKET, SO_ERROR, &error, &size) != 0 || error != 0) {
    drop(peer);
    return;
  }
  peer.connecting = false;
  peer.last_data = peer.connected_at = Clock::now();
  if (!peer.sent_handshake) {
    peer.sent_handshake = true;
    queue_send(peer, handshake(info_hash_raw_, peer_id_, true));
  }
}

bool Engine::consume_handshake(Peer& peer) {
  if (peer.pre.size() < kHandshakeSize) return false;
  std::string hash, id, why;
  bool extensions = false;
  std::size_t used = 0;
  if (!parse_handshake(peer.pre, hash, id, extensions, why, used)) {
    drop(peer);
    return false;
  }
  if (hash != info_hash_raw_) {
    drop(peer);
    return false;
  }
  peer.handshaken = true;
  peer.extensions = extensions;
  std::string rest = peer.pre.substr(used);
  peer.pre.clear();
  if (!rest.empty() && !peer.reader.feed(rest.data(), rest.size())) {
    drop(peer);
    return false;
  }
  if (!peer.sent_handshake) {
    peer.sent_handshake = true;
    queue_send(peer, handshake(info_hash_raw_, peer_id_, true));
  }
  if (extensions) queue_send(peer, extended_handshake());
  if (prepared_) {
    // A peer that connects after the wanted file was chosen needs the map of its pieces before its
    // bitfield or have messages can be read into it.
    if (peer.has.size() != meta_.piece_count) {
      peer.has.assign(meta_.piece_count, 0);
      peer.needed_has = 0;
    }
    send_bitfield(peer);
    if (!seeding_mode_ && !peer.interested) {
      peer.interested = true;
      queue_send(peer, frame(Message::Interested));
    }
  }
  return true;
}

void Engine::read_peer(Peer& peer) {
  char buffer[64 * 1024];
  for (;;) {
    const ssize_t received = ::recv(peer.fd, buffer, sizeof buffer, 0);
    if (received > 0) {
      peer.last_data = Clock::now();
      peer.down += static_cast<std::uint64_t>(received);
      if (!peer.handshaken) {
        if (peer.pre.size() + static_cast<std::size_t>(received) > 4096) {
          drop(peer);
          return;
        }
        peer.pre.append(buffer, static_cast<std::size_t>(received));
        if (!consume_handshake(peer) && peer.fd < 0) return;
        continue;
      }
      if (!peer.reader.feed(buffer, static_cast<std::size_t>(received))) {
        drop(peer);
        return;
      }
      handle_frames(peer);
      if (peer.fd < 0) return;
      continue;
    }
    if (received == 0) {
      drop(peer);
      return;
    }
    if (errno == EINTR) continue;
    if (errno == EAGAIN || errno == EWOULDBLOCK) return;
    drop(peer);
    return;
  }
}

void Engine::flush_peer(Peer& peer) {
  if (peer.fd < 0 || peer.connecting) return;
  while (!peer.pending.empty()) {
    const ssize_t sent = ::send(peer.fd, peer.pending.data(), peer.pending.size(), kSendFlags);
    if (sent > 0) {
      peer.pending.erase(0, static_cast<std::size_t>(sent));
      peer.last_sent = Clock::now();
      continue;
    }
    if (sent < 0 && errno == EINTR) continue;
    if (sent <= 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return;
    if (sent == 0) return;
    drop(peer);
    return;
  }
}

void Engine::queue_send(Peer& peer, std::string_view bytes) {
  if (peer.fd < 0) return;
  peer.pending.append(bytes);
  if (peer.pending.size() > kMaxPendingBytes) {
    drop(peer);
    return;
  }
  flush_peer(peer);
}

void Engine::drop(Peer& peer) {
  if (peer.fd >= 0) {
    close(peer.fd);
    peer.fd = -1;
  }
  peer.requests.clear();
  if (metadata_peer_ == &peer) reset_metadata();
}

void Engine::handle_frames(Peer& peer) {
  Frame frame;
  while (peer.fd >= 0 && peer.reader.next(frame)) on_frame(peer, frame);
  if (peer.fd >= 0 && peer.reader.failed()) drop(peer);
}

void Engine::on_frame(Peer& peer, const Frame& message) {
  switch (message.id) {
  case Message::Choke:
    peer.choked = true;
    peer.requests.clear();
    break;
  case Message::Unchoke:
    peer.choked = false;
    break;
  case Message::Interested:
    peer.peer_interested = true;
    if (seeding_mode_ && peer.am_choking) {
      peer.am_choking = false;
      queue_send(peer, frame(Message::Unchoke));
    }
    break;
  case Message::NotInterested:
    peer.peer_interested = false;
    break;
  case Message::Have:
    if (message.payload.size() != 4) {
      drop(peer);
      break;
    }
    mark_have(peer, get32(message.payload, 0));
    break;
  case Message::Bitfield:
    peer.bitfield.assign(message.payload.data(), message.payload.size());
    adopt_peer_bitfield(peer);
    break;
  case Message::Request:
    on_request(peer, message.payload);
    break;
  case Message::Piece:
    on_piece(peer, message.payload);
    break;
  case Message::Extended:
    on_extended(peer, message.payload);
    break;
  default:
    break; // keep-alive, port, cancel and ids this engine does not use
  }
}

void Engine::on_extended(Peer& peer, std::string_view payload) {
  if (payload.empty()) return;
  const auto id = static_cast<unsigned char>(payload[0]);
  const std::string_view body = payload.substr(1);
  if (id == 0) {
    ExtendedHandshake handshake;
    std::string why;
    if (!parse_extended_handshake(body, handshake, why)) {
      drop(peer);
      return;
    }
    peer.ut_metadata = handshake.ut_metadata;
    peer.ut_pex = handshake.ut_pex;
    peer.metadata_size = handshake.metadata_size;
    if (!have_metadata_ && metadata_peer_ == nullptr && peer.ut_metadata > 0 && peer.metadata_size > 0 &&
        peer.metadata_size <= kMaxMetadataBytes)
      begin_metadata(peer);
  } else if (id == 1) {
    on_metadata_message(peer, body);
  } else if (id == 2) {
    std::vector<std::pair<std::string, std::uint16_t>> added;
    std::string why;
    if (parse_pex(body, added, why))
      for (const auto& entry : added) add_candidate(entry.first, entry.second);
  }
}

void Engine::begin_metadata(Peer& peer) {
  metadata_size_ = peer.metadata_size;
  metadata_pieces_ = (metadata_size_ + kBlockSize - 1) / kBlockSize;
  metadata_ = std::string(metadata_size_, '\0');
  metadata_done_.assign(metadata_pieces_, 0);
  metadata_peer_ = &peer;
  request_metadata(peer, 0);
}

void Engine::request_metadata(Peer& peer, unsigned index) {
  metadata_index_ = index;
  metadata_sent_ = Clock::now();
  queue_send(peer, extended_frame(static_cast<std::uint8_t>(peer.ut_metadata), metadata_request(index)));
}

void Engine::on_metadata_message(Peer& peer, std::string_view payload) {
  if (metadata_peer_ != &peer) return;
  MetadataMessage message;
  std::string why;
  if (!parse_metadata_message(payload, message, why)) return;
  if (message.msg_type == 2) {
    reset_metadata();
    drop(peer);
    return;
  }
  if (message.msg_type != 1) return;
  if (message.total_size != 0 && message.total_size != metadata_size_) {
    reset_metadata();
    drop(peer);
    return;
  }
  if (message.piece >= metadata_pieces_) {
    reset_metadata();
    drop(peer);
    return;
  }
  const std::size_t offset = static_cast<std::size_t>(message.piece) * kBlockSize;
  const std::size_t expected = std::min<std::size_t>(kBlockSize, metadata_size_ - offset);
  if (message.data.size() != expected) {
    reset_metadata();
    drop(peer);
    return;
  }
  if (!metadata_done_[message.piece]) {
    std::memcpy(&metadata_[offset], message.data.data(), expected);
    metadata_done_[message.piece] = 1;
    last_progress_ = Clock::now();
  }
  for (unsigned index = 0; index < metadata_pieces_; ++index) {
    if (metadata_done_[index]) continue;
    request_metadata(peer, index);
    return;
  }
  integrity::Hash hash(true);
  if (!hash.update(metadata_.data(), metadata_.size()) || hash.finish() != info_hash_hex_) {
    reset_metadata();
    drop(peer);
    return;
  }
  MetaInfo parsed;
  if (!parse_info(metadata_, parsed, why)) {
    fail("the peer sent unusable metadata: " + why);
    return;
  }
  meta_ = std::move(parsed);
  adopt_metadata();
  metadata_ = std::string();
  metadata_done_.clear();
}

void Engine::reset_metadata() {
  metadata_peer_ = nullptr;
  metadata_size_ = 0;
  metadata_pieces_ = 0;
  metadata_index_ = 0;
  metadata_ = std::string();
  metadata_done_.clear();
}

void Engine::on_request(Peer& peer, std::string_view payload) {
  if (!seeding_mode_ || !prepared_ || payload.size() != 12) return;
  const std::uint32_t index = get32(payload, 0), begin = get32(payload, 4), length = get32(payload, 8);
  if (index >= meta_.piece_count || !done_[index] || length == 0 || length > kBlockSize) return;
  const std::uint64_t start = static_cast<std::uint64_t>(index) * meta_.piece_length;
  const std::uint32_t size = piece_size(index);
  if (start < file_.offset || start + size > file_.offset + file_.length) return;
  if (static_cast<std::uint64_t>(begin) + length > size) return;
  std::string block(length, '\0');
  if (!read_bytes(destination_, &block[0], length, start + begin - file_.offset)) return;
  queue_send(peer, piece_frame(index, begin, block));
  uploaded_ += length;
  peer.up += length;
}

void Engine::on_piece(Peer& peer, std::string_view payload) {
  if (payload.size() < 8) {
    drop(peer);
    return;
  }
  const std::uint32_t index = get32(payload, 0), begin = get32(payload, 4);
  const std::string_view block = payload.substr(8);
  for (auto request = peer.requests.begin(); request != peer.requests.end(); ++request) {
    if (request->piece != index || request->begin != begin) continue;
    if (request->length != block.size()) {
      drop(peer);
      return;
    }
    peer.requests.erase(request);
    downloaded_ += block.size();
    last_progress_ = Clock::now();
    if (!active_ || index != active_index_) return;
    if (begin >= active_size_ || block.size() > active_size_ - begin) return;
    const std::size_t slot = begin / kBlockSize;
    if (slot >= active_blocks_.size() || active_blocks_[slot]) return;
    std::memcpy(&active_buffer_[begin], block.data(), block.size());
    active_blocks_[slot] = 1;
    ++active_blocks_done_;
    if (active_blocks_done_ == active_blocks_.size()) verify_active();
    return;
  }
  // No matching request: a late block from a piece this engine abandoned. Ignore it.
}

void Engine::send_bitfield(Peer& peer) {
  if (peer.sent_bitfield || peer.fd < 0) return;
  peer.sent_bitfield = true;
  queue_send(peer, frame(Message::Bitfield, build_bitfield(done_)));
}

void Engine::send_have(std::uint32_t index) {
  for (auto& peer : peers_) {
    if (peer->fd < 0 || !peer->handshaken) continue;
    queue_send(*peer, have_frame(index));
  }
}

void Engine::mark_have(Peer& peer, std::uint32_t index) {
  if (!prepared_ || index >= peer.has.size() || peer.has[index]) return;
  peer.has[index] = 1;
  if (index >= first_piece_ && index <= last_piece_) ++peer.needed_has;
}

void Engine::adopt_peer_bitfield(Peer& peer) {
  if (!prepared_ || peer.bitfield.empty() || peer.has.size() != meta_.piece_count) return;
  merge_bitfield(peer.bitfield, peer.has);
  peer.bitfield.clear();
  peer.needed_has = 0;
  for (std::uint32_t index = first_piece_; index <= last_piece_; ++index)
    if (peer.has[index]) ++peer.needed_has;
}

void Engine::service(int wait_ms) {
  if (task_.cancelled || failed_) return;
  reap_dead_peers();
  collect_tracker_peers();
  dial_candidates();
  poll_sockets(wait_ms);
  reap_dead_peers();
  maintenance();
  schedule();
  maybe_publish();
}

void Engine::poll_sockets(int wait_ms) {
  std::vector<pollfd> fds;
  std::vector<Peer*> owners;
  if (listener_ >= 0) {
    fds.push_back({listener_, POLLIN, 0});
    owners.push_back(nullptr);
  }
  for (auto& peer : peers_) {
    if (peer->fd < 0) continue;
    short events = POLLIN;
    if (peer->connecting) events = POLLOUT;
    else if (!peer->pending.empty()) events = POLLIN | POLLOUT;
    fds.push_back({peer->fd, events, 0});
    owners.push_back(peer.get());
  }
  if (fds.empty()) {
    std::this_thread::sleep_for(std::chrono::milliseconds(wait_ms));
    return;
  }
  const int ready = ::poll(fds.data(), static_cast<nfds_t>(fds.size()), wait_ms);
  if (ready < 0) {
    if (errno != EINTR) std::this_thread::sleep_for(std::chrono::milliseconds(wait_ms));
    return;
  }
  if (ready == 0) return;
  for (std::size_t index = 0; index < fds.size(); ++index) {
    if (!fds[index].revents) continue;
    if (!owners[index]) {
      if (fds[index].revents & POLLIN) accept_peers();
      continue;
    }
    Peer& peer = *owners[index];
    if (peer.fd < 0 || peer.fd != fds[index].fd) continue;
    if (peer.connecting) {
      if (fds[index].revents & (POLLOUT | POLLERR | POLLHUP)) finish_connect(peer);
      continue;
    }
    if (fds[index].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) {
      read_peer(peer);
      if (peer.fd < 0) continue;
    }
    if (fds[index].revents & POLLOUT) flush_peer(peer);
  }
}

void Engine::reap_dead_peers() {
  for (auto peer = peers_.begin(); peer != peers_.end();) {
    if ((*peer)->fd >= 0) {
      ++peer;
      continue;
    }
    if (metadata_peer_ == peer->get()) reset_metadata();
    peer = peers_.erase(peer);
  }
}

void Engine::maintenance() {
  const auto now = Clock::now();
  for (auto& peer : peers_) {
    if (peer->fd < 0) continue;
    if (peer->connecting && now - peer->connected_at > std::chrono::milliseconds(kConnectTimeoutMs)) {
      drop(*peer);
      continue;
    }
    if (!peer->handshaken && now - peer->connected_at > std::chrono::seconds(30)) {
      drop(*peer);
      continue;
    }
    bool stalled = false;
    for (const auto& request : peer->requests)
      if (now - request.sent > std::chrono::milliseconds(kRequestTimeoutMs)) stalled = true;
    if (stalled) {
      drop(*peer);
      continue;
    }
    if (peer->handshaken && now - peer->last_sent > std::chrono::seconds(90)) {
      peer->last_sent = now;
      queue_send(*peer, std::string(4, '\0'));
    }
  }
  if (metadata_peer_) {
    if (metadata_peer_->fd < 0) reset_metadata();
    else if (now - metadata_sent_ > std::chrono::milliseconds(kMetadataTimeoutMs)) {
      Peer* peer = metadata_peer_;
      reset_metadata();
      drop(*peer);
    }
  }
  if (now - last_progress_ > std::chrono::milliseconds(kStallTimeoutMs)) {
    if (!have_metadata_) fail("no peer sent the torrent's metadata in ten minutes");
    else if (state_ == "downloading") fail("the download stalled for ten minutes");
  }
}

bool Engine::begin_piece() {
  std::uint32_t index = next_piece_;
  while (index <= last_piece_ && done_[index]) ++index;
  if (index > last_piece_) {
    for (index = first_piece_; index <= last_piece_ && done_[index]; ++index) {}
    if (index > last_piece_) return false;
  }
  next_piece_ = index + 1;
  active_ = true;
  active_index_ = index;
  active_size_ = piece_size(index);
  if (active_size_ == 0) {
    active_ = false;
    return false;
  }
  active_buffer_.assign(active_size_, '\0');
  active_blocks_.assign((active_size_ + kBlockSize - 1) / kBlockSize, 0);
  active_blocks_done_ = 0;
  attempts_ = 0;
  return true;
}

void Engine::schedule() {
  if (!prepared_ || seeding_mode_ || failed_) return;
  if (!active_ && !begin_piece()) return;
  std::vector<std::uint8_t> requested(active_blocks_.size(), 0);
  for (const auto& peer : peers_)
    for (const auto& request : peer->requests)
      if (request.piece == active_index_ && request.begin % kBlockSize == 0 &&
          request.begin / kBlockSize < requested.size())
        requested[request.begin / kBlockSize] = 1;
  for (auto& peer : peers_) {
    if (peer->fd < 0 || !peer->handshaken || peer->choked) continue;
    if (active_index_ >= peer->has.size() || !peer->has[active_index_]) continue;
    while (peer->requests.size() < kRequestsPerPeer) {
      bool sent = false;
      for (std::size_t block = 0; block < active_blocks_.size(); ++block) {
        if (active_blocks_[block] || requested[block]) continue;
        const std::uint32_t begin = static_cast<std::uint32_t>(block * kBlockSize);
        const std::uint32_t length =
            static_cast<std::uint32_t>(std::min<std::size_t>(kBlockSize, active_size_ - begin));
        queue_send(*peer, request_frame(active_index_, begin, length));
        if (peer->fd < 0) break;
        peer->requests.push_back({active_index_, begin, length, Clock::now()});
        requested[block] = 1;
        sent = true;
        break;
      }
      if (!sent || peer->fd < 0) break;
    }
  }
}

void Engine::restart_active() {
  for (auto& peer : peers_) {
    for (auto request = peer->requests.begin(); request != peer->requests.end();) {
      if (request->piece == active_index_) request = peer->requests.erase(request);
      else ++request;
    }
  }
  active_blocks_.assign(active_blocks_.size(), 0);
  active_blocks_done_ = 0;
  std::fill(active_buffer_.begin(), active_buffer_.end(), '\0');
}

void Engine::verify_active() {
  integrity::Hash hash(true);
  const bool hashed = hash.update(active_buffer_.data(), active_buffer_.size());
  const std::string digest = hashed ? hash.finish() : std::string();
  const std::string_view expected = std::string_view(meta_.pieces).substr(
      static_cast<std::size_t>(active_index_) * 20, 20);
  if (digest.size() != 40 || std::string_view(digest) != hex_encode(expected)) {
    ++attempts_;
    if (attempts_ >= 3) {
      fail("piece " + std::to_string(active_index_) + " failed its SHA-1 check three times");
      active_ = false;
      return;
    }
    restart_active();
    return;
  }
  const std::uint64_t start = static_cast<std::uint64_t>(active_index_) * meta_.piece_length;
  const std::uint64_t from = std::max(start, file_.offset);
  const std::uint64_t to = std::min(start + active_size_, file_.offset + file_.length);
  if (to > from &&
      !write_bytes(destination_, active_buffer_.data() + (from - start), static_cast<std::size_t>(to - from),
                   from - file_.offset)) {
    fail("could not write " + destination_path_ + ": " + std::strerror(errno));
    return;
  }
  if (!done_[active_index_]) {
    done_[active_index_] = 1;
    ++done_pieces_;
    verified_ += to - from;
    send_have(active_index_);
  }
  const auto now = Clock::now();
  if (now - last_saved_ > std::chrono::seconds(2)) {
    save_parts();
    last_saved_ = now;
  }
  active_ = false;
  attempts_ = 0;
}

bool Engine::download() {
  while (!task_.cancelled && !failed_ && done_pieces_ < needed_pieces_) service(250);
  if (task_.cancelled) {
    state_ = "cancelled";
    return false;
  }
  if (failed_) {
    state_ = "failed";
    return false;
  }
  return true;
}

void Engine::complete() {
  if (destination_ >= 0) fsync(destination_);
  if (!parts_path_.empty()) unlink(parts_path_.c_str());
  state_ = "completed";
  seeding_mode_ = config_.seeding && g_seeding.load();
  tracker_.completed.store(true);
  for (auto& peer : peers_) {
    peer->requests.clear();
    if (seeding_mode_ && peer->peer_interested && peer->am_choking) {
      peer->am_choking = false;
      queue_send(*peer, frame(Message::Unchoke));
    }
  }
  publish_now();
}

void Engine::seeding() {
  if (!seeding_mode_) return;
  while (!task_.cancelled && !task_.stop_seeding && !failed_ && config_.seeding && g_seeding.load())
    service(250);
  seeding_mode_ = false;
  if (task_.cancelled) state_ = "cancelled";
  // stop_seeding leaves the job completed: the file and its verified pieces stay as they are.
}

void Engine::finish_loop() {
  close_peers();
  if (listener_ >= 0) {
    close(listener_);
    listener_ = -1;
  }
  stop_tracker();
  if (task_.cancelled) state_ = "cancelled";
  else if (failed_) state_ = "failed";
  if (destination_ >= 0) {
    if (state_ == "failed" || state_ == "cancelled") {
      if (prepared_ && done_pieces_ > 0) save_parts();
      fsync(destination_);
    }
    close(destination_);
    destination_ = -1;
  }
  seeding_mode_ = false;
  publish_now();
}

void Engine::close_peers() {
  for (auto& peer : peers_)
    if (peer->fd >= 0) {
      close(peer->fd);
      peer->fd = -1;
    }
  peers_.clear();
  metadata_peer_ = nullptr;
}
} // namespace

std::uint32_t start(Config config, std::string& error) {
  if (!network::running()) {
    error = "enable networking: true and filesystemAccess: console in app.json";
    return 0;
  }
  if (config.destination.empty() || config.destination.back() == '/') {
    error = "a destination file is required";
    return 0;
  }
  if (config.magnet.empty() == config.torrent_path.empty()) {
    error = "give either a magnet link or a .torrent path";
    return 0;
  }
  if (!config.magnet.empty()) {
    Magnet magnet;
    std::string why;
    if (!parse_magnet(config.magnet, magnet, why)) {
      error = why;
      return 0;
    }
    if (magnet.trackers.empty()) {
      error = "the magnet link has no trackers, and this engine has no DHT";
      return 0;
    }
  } else if (access(config.torrent_path.c_str(), R_OK) != 0) {
    error = config.torrent_path + " cannot be read: " + std::strerror(errno);
    return 0;
  }
  if (config.connections == 0) config.connections = 1;
  if (config.connections > kMaxConnections) config.connections = kMaxConnections;
  std::lock_guard lock(g_mutex);
  // Workers that already finished may outlive the last poll (the JavaScript side stops polling a
  // completed transfer), so they are reaped before the limits are counted.
  for (auto entry = g_tasks.begin(); entry != g_tasks.end();) {
    if (entry->second->done.load(std::memory_order_acquire)) {
      entry->second->thread.join();
      entry = g_tasks.erase(entry);
    } else {
      ++entry;
    }
  }
  unsigned running = 0;
  for (const auto& entry : g_tasks) {
    std::lock_guard task_lock(entry.second->mutex);
    running += entry.second->snapshot.state != "completed";
  }
  if (running >= kMaxJobs) {
    error = "too many downloads are running (" + std::to_string(kMaxJobs) + ")";
    return 0;
  }
  // A finished job that still seeds holds a connection budget no one is watching. When the table is
  // full the oldest one makes room: seeding lasts while the application runs, within its capacity.
  if (g_tasks.size() >= kMaxTasks) {
    std::uint32_t stopping = 0;
    for (const auto& entry : g_tasks) {
      std::lock_guard task_lock(entry.second->mutex);
      if (entry.second->snapshot.state == "completed") {
        stopping = entry.first;
        break;
      }
    }
    if (!stopping) {
      error = "too many torrents are open (" + std::to_string(kMaxTasks) + "); cancel one first";
      return 0;
    }
    g_tasks[stopping]->stop_seeding.store(true);
  }
  auto task = std::make_shared<Task>();
  task->config = std::move(config);
  const std::uint32_t id = g_next_id++;
  {
    std::lock_guard task_lock(task->mutex);
    task->snapshot.id = id;
    task->snapshot.state = "starting";
  }
  Task* raw = task.get();
  if (!task->thread.start(
          [raw] {
            Engine engine(*raw);
            engine.run();
            raw->done.store(true, std::memory_order_release);
          },
          1024 * 1024)) {
    error = "could not start the worker";
    return 0;
  }
  g_tasks.emplace(id, std::move(task));
  return id;
}

void cancel(std::uint32_t id) {
  std::lock_guard lock(g_mutex);
  const auto found = g_tasks.find(id);
  if (found != g_tasks.end()) found->second->cancelled.store(true);
}

std::vector<Snapshot> poll() {
  std::vector<Snapshot> out;
  std::lock_guard lock(g_mutex);
  for (auto entry = g_tasks.begin(); entry != g_tasks.end();) {
    Task& task = *entry->second;
    if (task.done.load(std::memory_order_acquire)) {
      task.thread.join();
      std::lock_guard task_lock(task.mutex);
      out.push_back(task.snapshot);
      entry = g_tasks.erase(entry);
      continue;
    }
    std::lock_guard task_lock(task.mutex);
    out.push_back(task.snapshot);
    ++entry;
  }
  return out;
}

void set_seeding(bool enabled) {
  g_seeding.store(enabled);
}

void stop() {
  std::map<std::uint32_t, std::shared_ptr<Task>> stopping;
  {
    std::lock_guard lock(g_mutex);
    stopping.swap(g_tasks);
  }
  for (auto& entry : stopping) entry.second->cancelled.store(true);
  for (auto& entry : stopping) entry.second->thread.join();
}
} // namespace torrent
