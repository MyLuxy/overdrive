// Stress test for archives::Writer: random block sizes and file counts through rings small enough to wrap
// constantly, checked byte for byte and by digest; a failing descriptor and a cancel mid-stream must
// end without a hang and with every descriptor closed.
#include "archive_writer.hpp"
#include "archives.hpp"
#include "digest.hpp"
#include <cassert>
#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <random>
#include <string>
#include <sys/stat.h>
#include <unistd.h>
#include <vector>

std::size_t archives::pipeline_bytes(std::uint64_t, bool) { return 0; }
bool archives::hold_memory(bool, std::uint64_t, bool) { return true; }
void archives::trace(const char*, const char*) {}
bool archives::list_directory(const char*, void (*)(const char*, void*), void*) { return false; }

namespace {
int open_descriptors() {
  int count = 0;
  for (int fd = 0; fd < 1024; ++fd) count += fcntl(fd, F_GETFD) != -1;
  return count;
}
std::string sha(const std::vector<unsigned char>& bytes) {
  integrity::Hash hash;
  hash.update(bytes.data(), bytes.size());
  return hash.finish();
}
std::vector<unsigned char> slurp(const std::string& path) {
  std::vector<unsigned char> out;
  FILE* file = std::fopen(path.c_str(), "rb");
  unsigned char block[65536];
  std::size_t count;
  while ((count = std::fread(block, 1, sizeof block, file)) > 0) out.insert(out.end(), block, block + count);
  std::fclose(file);
  return out;
}

// Commits `receipt` to a file and returns its lines after the header, the file then removed.
std::string committed(archives::Receipt& receipt, const std::string& dir) {
  assert(receipt.commit("receipt-out"));
  const auto bytes = slurp(dir + "/receipt-out");
  unlink((dir + "/receipt-out").c_str());
  const std::string text(bytes.begin(), bytes.end());
  assert(text.rfind("P5AR001:test\n", 0) == 0);
  return text.substr(text.find('\n') + 1);
}

void round_trip(const std::string& dir, std::mt19937& rng, std::size_t ring) {
  std::atomic<bool> cancelled{false};
  archives::Timings timings;
  archives::Writer writer(cancelled, timings);
  archives::Receipt receipt(dir, "P5AR001:test");
  assert(writer.start(ring, receipt));
  const int files = 1 + rng() % 200;
  std::vector<std::vector<unsigned char>> contents;
  std::string expected;
  for (int i = 0; i < files; ++i) {
    const std::size_t size = rng() % 4 == 0 ? 0 : rng() % 3 == 0 ? rng() % (3 * ring) : rng() % 70000;
    std::vector<unsigned char> data(size);
    for (auto& byte : data) byte = static_cast<unsigned char>(rng());
    const std::string name = "f" + std::to_string(i);
    const int fd = open((dir + "/" + name).c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    assert(fd >= 0 && writer.begin(fd, dir + "/" + name, name));
    // Mostly in order, as decoders emit; now and then out of order, which takes the read-back path.
    std::vector<std::pair<std::size_t, std::size_t>> blocks;
    for (std::size_t at = 0; at < size;) {
      const std::size_t length = std::min<std::size_t>(size - at, 1 + rng() % (rng() % 2 ? 65536 : 2 * 1024 * 1024));
      blocks.emplace_back(at, length);
      at += length;
    }
    if (blocks.size() > 2 && rng() % 8 == 0) std::swap(blocks[0], blocks[1]);
    for (const auto& [at, length] : blocks) assert(writer.append(data.data() + at, length, at));
    assert(writer.end());
    expected += sha(data) + "|" + name + "\n";
    contents.push_back(std::move(data));
  }
  std::atomic<std::size_t> reports{0}, last_total{0}, most{0};
  const auto error = writer.finish([&](std::size_t synced, std::size_t total) {
    ++reports;
    last_total = total;
    for (auto seen = most.load(); synced > seen && !most.compare_exchange_weak(seen, synced);) {}
  });
  if (!error.empty()) std::fprintf(stderr, "error: %s\n", error.c_str());
  assert(error.empty() && committed(receipt, dir) == expected);
  // One report before the fsyncs and one after each.
  assert(reports == std::size_t(files) + 1 && last_total == std::size_t(files) && most == std::size_t(files));
  for (int i = 0; i < files; ++i) {
    assert(slurp(dir + "/f" + std::to_string(i)) == contents[i]);
    unlink((dir + "/f" + std::to_string(i)).c_str());
  }
}

void write_error(const std::string& dir) {
  std::atomic<bool> cancelled{false};
  archives::Timings timings;
  archives::Writer writer(cancelled, timings);
  archives::Receipt receipt(dir, "P5AR001:test");
  assert(writer.start(1 << 20, receipt));
  const int fd = open((dir + "/ro").c_str(), O_RDONLY | O_CREAT, 0600);
  assert(writer.begin(fd, dir + "/ro", "ro"));
  std::vector<unsigned char> data(8 << 20, 7);
  bool accepted = true;
  for (int i = 0; i < 64 && accepted; ++i) accepted = writer.append(data.data(), data.size(), std::size_t(i) * data.size());
  const auto error = accepted && writer.end() ? writer.finish() : writer.error();
  assert(!error.empty() && receipt.lines() == 0);
  unlink((dir + "/ro").c_str());
}

// One-byte blocks in reverse order never merge: each is its own command, which must stay capped.
void scattered(const std::string& dir) {
  std::atomic<bool> cancelled{false};
  archives::Timings timings;
  archives::Writer writer(cancelled, timings);
  archives::Receipt receipt(dir, "P5AR001:test");
  assert(writer.start(1 << 20, receipt));
  std::vector<unsigned char> data(20000);
  for (std::size_t i = 0; i < data.size(); ++i) data[i] = static_cast<unsigned char>(i * 7);
  const int fd = open((dir + "/s").c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
  assert(fd >= 0 && writer.begin(fd, dir + "/s", "s"));
  for (std::size_t i = data.size(); i-- > 0;) assert(writer.append(&data[i], 1, i));
  assert(writer.end());
  assert(writer.finish().empty() && committed(receipt, dir) == sha(data) + "|s\n" && slurp(dir + "/s") == data);
  unlink((dir + "/s").c_str());
}

// A file gone before the deferred fsync must fail the extraction, not complete it.
void sync_missing(const std::string& dir) {
  std::atomic<bool> cancelled{false};
  archives::Timings timings;
  archives::Writer writer(cancelled, timings);
  archives::Receipt receipt(dir, "P5AR001:test");
  assert(writer.start(1 << 20, receipt));
  std::vector<unsigned char> data(4096, 3);
  for (const char* name : {"m0", "m1", "m2"}) {
    const int fd = open((dir + "/" + name).c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    assert(fd >= 0 && writer.begin(fd, dir + "/" + name, name) && writer.append(data.data(), data.size(), 0) && writer.end());
  }
  unlink((dir + "/m1").c_str());
  assert(!writer.finish().empty());
  unlink((dir + "/m0").c_str());
  unlink((dir + "/m2").c_str());
}

void cancel_midway(const std::string& dir, std::mt19937& rng) {
  std::atomic<bool> cancelled{false};
  archives::Timings timings;
  archives::Writer writer(cancelled, timings);
  archives::Receipt receipt(dir, "P5AR001:test");
  assert(writer.start(1 << 20, receipt));
  std::vector<unsigned char> data(256 * 1024, 1);
  const int stop_after = rng() % 40;
  for (int i = 0; i < 40; ++i) {
    const std::string name = "c" + std::to_string(i);
    const int fd = open((dir + "/" + name).c_str(), O_WRONLY | O_CREAT | O_TRUNC, 0600);
    if (!writer.begin(fd, dir + "/" + name, name)) break;
    if (i == stop_after) cancelled = true;
    if (!writer.append(data.data(), data.size(), 0) || !writer.end()) break;
  }
  // Destroyed without finish(), as when extraction stops on an error or a cancel.
}
}

// A game folder's receipt (issue #52): 300,000 lines with long names, far over the 16 MiB a receipt kept
// in memory could take, go through the line file and come back whole and in order, from any line on.
void many_lines(const std::string& dir) {
  const std::string tail(140, 'x');
  {
    archives::Receipt receipt(dir, "P5AR001:test");
    for (int i = 0; i < 300000; ++i) assert(receipt.add(std::string(64, 'a' + i % 6), "Image0/data/" + std::to_string(i) + "/" + tail));
    archives::Receipt::Lines* lines = nullptr;
    assert(receipt.lines_from(299998, lines));
    std::string line;
    assert(lines->next(line) && line == std::string(64, 'a' + 299998 % 6) + "|Image0/data/299998/" + tail);
    assert(lines->next(line) && !lines->next(line));
    receipt.set_header("P5AR001:renamed");
    assert(receipt.commit("receipt-out"));
    struct stat st;
    assert(stat((dir + "/.ps5-react-receipt-lines").c_str(), &st) != 0);
  }
  const int fd = open((dir + "/receipt-out").c_str(), O_RDONLY);
  assert(fd >= 0);
  archives::LineReader reader(fd);
  std::string line;
  assert(reader.next(line) && line == "P5AR001:renamed");
  int count = 0;
  for (; reader.next(line); ++count)
    if (count % 50000 == 0) assert(line == std::string(64, 'a' + count % 6) + "|Image0/data/" + std::to_string(count) + "/" + tail);
  assert(count == 300000 && reader.clean());
  close(fd);
  struct stat st;
  assert(stat((dir + "/receipt-out").c_str(), &st) == 0 && st.st_size > 16 * 1024 * 1024);
  unlink((dir + "/receipt-out").c_str());
  // A receipt dropped before commit leaves no line file behind.
  {
    archives::Receipt receipt(dir, "P5AR001:test");
    for (int i = 0; i < 20000; ++i) assert(receipt.add(std::string(64, 'b'), tail));
  }
  assert(stat((dir + "/.ps5-react-receipt-lines").c_str(), &st) != 0);
}

int main(int argc, char** argv) {
  const std::string dir = argc > 1 ? argv[1] : "/tmp/archive-writer-test";
  mkdir(dir.c_str(), 0700);
  std::mt19937 rng(argc > 2 ? std::atoi(argv[2]) : 1);
  const int before = open_descriptors();
  for (int round = 0; round < 40; ++round) round_trip(dir, rng, (1 + rng() % 4) << 20);
  write_error(dir);
  scattered(dir);
  sync_missing(dir);
  many_lines(dir);
  for (int round = 0; round < 40; ++round) cancel_midway(dir, rng);
  for (int i = 0; i < 40; ++i) unlink((dir + "/c" + std::to_string(i)).c_str());
  assert(open_descriptors() == before);
  std::puts("PASS: writer round trips, write error, cancel without leaks, a 300,000-line receipt");
}
