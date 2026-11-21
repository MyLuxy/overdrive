// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Hardware video decoding through libSceVideodec2: H.264 up to High, HEVC Main and Main10, VP9 profile 0.
// The ABI (struct layouts, codec tags, levels and the call sequence) is the one ProsperoLight and EVO
// Player established on hardware (GPL-3.0; see notices/video-decoder.txt); this is a new implementation
// against it. Anything the decoder does not take, FFmpeg decodes instead.
#include "video_frame.hpp"
#include "async_log.hpp"
#include "platform/ps5/system.hpp"

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavcodec/bsf.h>
#include <libavutil/pixdesc.h>
}

#include <algorithm>
#include <cstdio>
#include <atomic>
#include <chrono>
#include <cstring>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>
#include <sys/mman.h>

extern "C" {
int sceSysmoduleLoadModule(std::uint16_t id);
int sceKernelAllocateDirectMemory(std::int64_t start, std::int64_t end, std::size_t length, std::size_t alignment,
                                  int type, std::int64_t* physical);
int sceKernelMapDirectMemory(void** address, std::size_t length, int protection, int flags, std::int64_t physical,
                             std::size_t alignment);
int sceKernelReleaseDirectMemory(std::int64_t physical, std::size_t length);
int sceKernelMapNamedFlexibleMemory(void** address, std::size_t length, int protection, int flags, const char* name);
int sceKernelMunmap(void* address, std::size_t length);
std::int64_t sceKernelGetDirectMemorySize();
int sceKernelAvailableDirectMemorySize(std::int64_t start, std::int64_t end, std::size_t alignment, std::int64_t* found,
                                       std::size_t* size);
int sceKernelAvailableFlexibleMemorySize(std::size_t* size);
int sceKernelConfiguredFlexibleMemorySize(std::size_t* size);
}

namespace {
// ---- the ABI: zero each struct, set `size`; the service rejects a wrong one ----
struct ConfigInfo {
  std::uint64_t size;
  std::uint32_t resource_type, codec_type, profile, max_level;
  std::int32_t max_width, max_height, max_dpb_frames;
  std::uint32_t pipeline_depth;
  std::uint64_t compute_queue, cpu_affinity;
  std::int32_t cpu_priority;
  std::uint32_t optimize_progressive, check_memory_type, reserved;
};
struct MemoryInfo {
  std::uint64_t size, cpu_size;
  void* cpu;
  std::uint64_t gpu_size;
  void* gpu;
  std::uint64_t cpu_gpu_size;
  void* cpu_gpu;
  std::uint64_t max_frame_size;
  std::uint32_t frame_alignment, reserved;
};
struct ComputeConfig {
  std::uint64_t size;
  std::uint16_t pipe_id, queue_id;
  std::uint8_t check_memory_type, reserved0;
  std::uint16_t reserved1;
};
struct ComputeMemory {
  std::uint64_t size, cpu_gpu_size;
  void* cpu_gpu;
};
struct InputData {
  std::uint64_t size;
  void* au;
  std::uint64_t au_size, pts, dts, attached;
};
struct FrameBuffer {
  std::uint64_t size;
  void* buffer;
  std::uint64_t buffer_size;
  std::uint32_t accepted, reserved;
};
struct OutputInfo {
  std::uint64_t size;
  std::uint8_t valid, error, picture_count, padding;
  std::uint32_t codec, width, pitch, height, reserved;
  void* buffer;
  std::uint64_t buffer_size;
  std::uint32_t frame_format, pitch_bytes;
};
static_assert(sizeof(ConfigInfo) == 72 && sizeof(MemoryInfo) == 72 && sizeof(ComputeConfig) == 16 &&
              sizeof(ComputeMemory) == 24 && sizeof(InputData) == 48 && sizeof(FrameBuffer) == 32 &&
              sizeof(OutputInfo) == 56);
} // namespace

extern "C" {
int sceVideodec2QueryComputeMemoryInfo(ComputeMemory* memory);
int sceVideodec2AllocateComputeQueue(const ComputeConfig* config, const ComputeMemory* memory, void** queue);
int sceVideodec2ReleaseComputeQueue(void* queue);
int sceVideodec2QueryDecoderMemoryInfo(const ConfigInfo* config, MemoryInfo* memory);
int sceVideodec2CreateDecoder(const ConfigInfo* config, const MemoryInfo* memory, void** decoder);
int sceVideodec2DeleteDecoder(void* decoder);
int sceVideodec2Reset(void* decoder);
int sceVideodec2Decode(void* decoder, InputData* input, FrameBuffer* frame, OutputInfo* output);
int sceVideodec2Flush(void* decoder, FrameBuffer* frame, OutputInfo* output);
}

namespace {
constexpr std::uint32_t kAvc = 1, kHevc = 974921, kVp9 = 2382845;
constexpr std::size_t kInputSlots = 4, kInputSlotBytes = 8u << 20;
// Decoded pictures in flight: the player queues eight and shows one, three wait here to leave in display
// order, and one is being decoded. A 4K keyframe holds the decoder up to about 60 ms.
constexpr int kFrameSlots = 16;
constexpr int kErrorsAfterFlush = 32;
constexpr std::int64_t kNoPts = AV_NOPTS_VALUE;

std::size_t align16k(std::size_t value) { return (value + 0x3FFF) & ~std::size_t(0x3FFF); }

// Direct memory: physically contiguous, mapped for the CPU and the GPU (protection 0x33).
struct Direct {
  void* address = nullptr;
  std::int64_t physical = -1;
  std::size_t size = 0;
  int allocate(std::size_t bytes) {
    size = align16k(bytes);
    int rc = sceKernelAllocateDirectMemory(0, sceKernelGetDirectMemorySize(), size, 0x4000, 12, &physical);
    if (rc == 0) rc = sceKernelMapDirectMemory(&address, size, 0x33, 0, physical, 0x4000);
    if (rc != 0) release();
    return rc;
  }
  void release() {
    if (address) sceKernelMunmap(address, size);
    if (physical >= 0) sceKernelReleaseDirectMemory(physical, size);
    address = nullptr;
    physical = -1;
  }
};

// The output frame slots. A frame handed to the player holds its slot until the player lets it go,
// which may outlive the decoder: the pool is shared and frees its memory with the last frame.
struct FramePool {
  Direct memory;
  std::size_t frame_size = 0;
  std::atomic<bool> busy[kFrameSlots] = {};
  ~FramePool() { memory.release(); }
  std::uint8_t* slot(int index) const { return static_cast<std::uint8_t*>(memory.address) + index * frame_size; }
};


// VP9 uncompressed header prefix: hidden (alt-ref) frames decode but never show, so they take no
// timestamp; show_existing_frame does show. Unparsable means shown.
bool vp9_shown(const std::uint8_t* data, int size) {
  int at = 0;
  const auto bit = [&] {
    const int i = at++;
    return (i >> 3) < size ? (data[i >> 3] >> (7 - (i & 7))) & 1 : 0;
  };
  if (bit() != 1 || bit() != 0) return true;
  const int profile = bit() | (bit() << 1);
  if (profile == 3) bit();
  if (bit()) return true; // show_existing_frame
  bit();                  // frame_type
  return bit();
}

// Copies an HEVC access unit without NAL types 48-63 (Dolby Vision RPU and enhancement layer), which
// the decoder refuses. Returns the bytes written.
std::size_t copy_hevc_base_layer(std::uint8_t* out, const std::uint8_t* in, std::size_t size) {
  std::size_t written = 0, i = 0;
  const auto start_code = [&](std::size_t at) {
    return at + 3 <= size && in[at] == 0 && in[at + 1] == 0 && (in[at + 2] == 1 || (at + 4 <= size && in[at + 2] == 0 && in[at + 3] == 1));
  };
  if (!start_code(0)) {
    std::memcpy(out, in, size);
    return size;
  }
  while (i < size) {
    std::size_t header = i + (in[i + 2] == 1 ? 3 : 4);
    std::size_t next = header;
    while (next < size && !start_code(next)) ++next;
    const int type = header < size ? (in[header] >> 1) & 0x3F : 0;
    if (type < 48) {
      std::memcpy(out + written, in + i, next - i);
      written += next - i;
    }
    i = next;
  }
  return written;
}

// The decoders live for the whole run. After filesystem elevation swaps the process credentials every
// libSceVideodec2 call that sets one up fails (0x811D0111, as EVO Player found), so each is brought up
// at launch, before it, sized for 4K, and only reset between streams. One plays at a time: the pools
// of input and output buffers are shared.
struct Slot {
  const char* name = "";
  std::uint32_t codec = 0;
  ConfigInfo config{};
  MemoryInfo memory{};
  Direct compute, gpu, cpu_gpu, input;
  void* queue = nullptr;          // each decoder has a compute queue: a shared one takes two at most
  void* cpu = nullptr;
  std::size_t cpu_size = 0;
  void* decoder = nullptr;
  bool prepared = false;         // queue, memory and workspace ready; the decoder is created on first use
  int created = -1;              // the CreateDecoder result, -1 before the first try
  const char* failed = "";       // the bring-up stage that failed
  std::atomic<bool> in_use{false};
};

struct Resident {
  int module = -1;               // sceSysmoduleLoadModule result
  std::mutex mutex;              // creating decoders, from the players' threads
  Slot slots[3];                 // H.264, HEVC (Main10 also decodes Main), VP9
  std::shared_ptr<FramePool> pool;
};
Resident resident;

// The decoder of a prepared slot, created the first time a stream needs it: creating one starts its
// threads, and filesystem elevation wants a process with one thread (see preload_platform_decoder).
void* ready_decoder(Slot& slot) {
  std::lock_guard lock(resident.mutex);
  if (slot.prepared && slot.created == -1) {
    slot.created = sceVideodec2CreateDecoder(&slot.config, &slot.memory, &slot.decoder);
    if (slot.created == 0 && !slot.decoder) slot.created = -2;
    if (slot.created != 0) slot.decoder = nullptr;
    async_log::write("[PS5-REACT] video: %s decoder created rc=0x%08x", slot.name, static_cast<unsigned>(slot.created));
  }
  return slot.decoder;
}

int bring_up(Slot& slot, const char* name, std::uint32_t codec, std::uint32_t profile, std::uint32_t level) {
  slot.name = name;
  slot.codec = codec;
  slot.failed = "compute queue";
  ComputeMemory compute{};
  compute.size = sizeof compute;
  int rc = sceVideodec2QueryComputeMemoryInfo(&compute);
  if (rc == 0) rc = slot.compute.allocate(compute.cpu_gpu_size);
  if (rc == 0) {
    compute.cpu_gpu = slot.compute.address;
    compute.cpu_gpu_size = slot.compute.size;
    ComputeConfig queue{};
    queue.size = sizeof queue;
    rc = sceVideodec2AllocateComputeQueue(&queue, &compute, &slot.queue);
  }
  if (rc != 0) {
    slot.compute.release();
    slot.queue = nullptr;
    return rc;
  }
  ConfigInfo& config = slot.config;
  config = {};
  config.size = sizeof config;
  config.resource_type = 1; // compute
  config.codec_type = codec;
  config.profile = profile;
  config.max_level = level;
  config.max_width = 3840;
  config.max_height = 2176;
  config.max_dpb_frames = -1; // sized by the decoder
  config.pipeline_depth = 4;
  config.compute_queue = reinterpret_cast<std::uint64_t>(slot.queue);
  config.cpu_affinity = 0x3F;
  config.cpu_priority = 700;
  config.optimize_progressive = 1;
  MemoryInfo& memory = slot.memory;
  memory = {};
  memory.size = sizeof memory;
  slot.failed = "QueryDecoderMemoryInfo";
  rc = sceVideodec2QueryDecoderMemoryInfo(&config, &memory);
  if (rc == 0) {
    slot.failed = "workspace (flexible)";
    slot.cpu_size = align16k(memory.cpu_size);
    rc = sceKernelMapNamedFlexibleMemory(&slot.cpu, slot.cpu_size, 0x03, 0, "PS5ReactVideo");
    if (rc != 0) slot.cpu = nullptr;
  }
  if (rc == 0) slot.failed = "gpu (direct)", rc = slot.gpu.allocate(memory.gpu_size);
  if (rc == 0 && memory.cpu_gpu_size) slot.failed = "cpu_gpu (direct)", rc = slot.cpu_gpu.allocate(memory.cpu_gpu_size);
  if (rc == 0) slot.failed = "input (direct)", rc = slot.input.allocate(kInputSlots * kInputSlotBytes);
  if (rc == 0) {
    memory.cpu = slot.cpu;
    memory.gpu = slot.gpu.address;
    memory.gpu_size = slot.gpu.size;
    if (memory.cpu_gpu_size) {
      memory.cpu_gpu = slot.cpu_gpu.address;
      memory.cpu_gpu_size = slot.cpu_gpu.size;
    }
    slot.failed = "";
    slot.prepared = true;
  }
  if (rc != 0) {
    slot.decoder = nullptr;
    slot.gpu.release();
    slot.cpu_gpu.release();
    slot.input.release();
    if (slot.cpu) sceKernelMunmap(slot.cpu, slot.cpu_size);
    slot.cpu = nullptr;
    if (slot.queue) sceVideodec2ReleaseComputeQueue(slot.queue);
    slot.queue = nullptr;
    slot.compute.release();
  }
  return rc;
}

class Videodec2 final : public video::Decoder {
public:
  static std::unique_ptr<video::Decoder> open(const AVCodecParameters* parameters, AVRational time_base);
  ~Videodec2() override;
  bool send(const AVPacket* packet) override;
  bool receive(video::Frame& frame, bool& ended) override;
  void flush() override;
  const char* name() const override { return "sceVideodec2"; }

private:
  bool build_filter();
  void restart();
  bool submit(const std::uint8_t* au, std::size_t size, std::int64_t pts, bool shown);
  void drain();
  void take(const OutputInfo& output, int slot);
  int free_slot();

  Slot* slot_ = nullptr;
  const AVCodecParameters* parameters_ = nullptr;
  AVRational time_base_{1, 1};
  int display_width_ = 0, display_height_ = 0;
  video::Matrix matrix_ = video::Matrix::bt709;
  video::Transfer transfer_ = video::Transfer::sdr;
  bool full_range_ = false;
  float aspect_ = 1;
  std::shared_ptr<FramePool> pool_;

  AVBSFContext* filter_ = nullptr;
  AVPacket* filtered_ = nullptr;
  std::vector<std::uint8_t> annexb_header_; // Annex-B extradata, sent once ahead of the stream
  unsigned input_index_ = 0;
  std::vector<std::int64_t> pending_pts_;   // timestamps of shown AUs not yet output
  std::deque<video::Frame> ready_;          // decoded, held a little so they leave in display order
  bool draining_ = false, ended_ = false;
  int outputs_since_flush_ = 0, errors_since_flush_ = 0;
  std::uint64_t decodes_ = 0;
};

std::unique_ptr<video::Decoder> Videodec2::open(const AVCodecParameters* p, AVRational time_base) {
  const AVPixFmtDescriptor* descriptor = av_pix_fmt_desc_get(static_cast<AVPixelFormat>(p->format));
  int depth = p->bits_per_raw_sample > 8 ? p->bits_per_raw_sample : descriptor ? descriptor->comp[0].depth : 8;
  if (p->codec_id == AV_CODEC_ID_HEVC && p->profile == AV_PROFILE_HEVC_MAIN_10) depth = 10;
  int index = -1;
  bool supported = false;
  switch (p->codec_id) {
    case AV_CODEC_ID_H264:
      index = 0;
      supported = depth <= 8 && (p->profile == AV_PROFILE_UNKNOWN || p->profile <= 100 || p->profile == 578);
      break;
    case AV_CODEC_ID_HEVC:
      index = 1;
      supported = depth <= 10 && (p->profile == AV_PROFILE_UNKNOWN || p->profile == AV_PROFILE_HEVC_MAIN ||
                                  p->profile == AV_PROFILE_HEVC_MAIN_10);
      break;
    case AV_CODEC_ID_VP9:
      index = 2;
      supported = depth <= 8 && (p->profile == AV_PROFILE_UNKNOWN || p->profile == AV_PROFILE_VP9_0);
      break;
    default: break;
  }
  if (!supported || p->width < 16 || p->height < 16 || p->width > 3840 || p->height > 2176) return nullptr;
  Slot& slot = resident.slots[index];
  if (!resident.pool || !ready_decoder(slot)) {
    async_log::write("[PS5-REACT] video: no %s hardware decoder (module 0x%08x); decoding with FFmpeg",
                     avcodec_get_name(p->codec_id), static_cast<unsigned>(resident.module));
    return nullptr;
  }
  // A player closed just before may still be letting go of the decoder on its own thread.
  bool taken = false;
  for (int attempt = 0; attempt < 100 && !taken; ++attempt) {
    bool expected = false;
    taken = slot.in_use.compare_exchange_strong(expected, true);
    if (!taken) std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  if (!taken) {
    async_log::write("[PS5-REACT] video: the %s decoder is busy with another video; decoding with FFmpeg", slot.name);
    return nullptr;
  }
  auto decoder = std::unique_ptr<Videodec2>(new Videodec2());
  decoder->slot_ = &slot;
  decoder->pool_ = resident.pool;
  decoder->parameters_ = p;
  decoder->time_base_ = time_base;
  decoder->display_width_ = p->width;
  decoder->display_height_ = p->height;
  decoder->matrix_ = p->color_space == AVCOL_SPC_BT2020_NCL || p->color_space == AVCOL_SPC_BT2020_CL ? video::Matrix::bt2020
                   : p->color_space == AVCOL_SPC_BT470BG || p->color_space == AVCOL_SPC_SMPTE170M ? video::Matrix::bt601
                   : p->color_space == AVCOL_SPC_BT709 || p->height >= 720 ? video::Matrix::bt709 : video::Matrix::bt601;
  decoder->transfer_ = p->color_trc == AVCOL_TRC_SMPTE2084 ? video::Transfer::pq
                     : p->color_trc == AVCOL_TRC_ARIB_STD_B67 ? video::Transfer::hlg : video::Transfer::sdr;
  decoder->full_range_ = p->color_range == AVCOL_RANGE_JPEG;
  decoder->aspect_ = p->sample_aspect_ratio.num > 0 && p->sample_aspect_ratio.den > 0
    ? static_cast<float>(av_q2d(p->sample_aspect_ratio)) : 1.0f;
  if (!decoder->build_filter()) return nullptr;
  decoder->restart();
  async_log::write("[PS5-REACT] video: %s on sceVideodec2, %dx%d %d-bit profile %d", slot.name, p->width, p->height,
                   depth, p->profile);
  return decoder;
}

// Back to a clean stream: the resident decoder reset, the parameter sets sent again ahead of the next AU.
void Videodec2::restart() {
  const int rc = sceVideodec2Reset(slot_->decoder);
  if (rc != 0) async_log::write("[PS5-REACT] video: sceVideodec2Reset=0x%08x", static_cast<unsigned>(rc));
  outputs_since_flush_ = errors_since_flush_ = 0;
  if (!annexb_header_.empty()) submit(annexb_header_.data(), annexb_header_.size(), kNoPts, false);
}

// MP4 and Matroska carry H.264 and HEVC length-prefixed with parameter sets in avcC/hvcC; the decoder
// takes Annex-B with them in band. VP9 superframes split into their frames. A filter rebuilt after
// every flush repeats the parameter sets before the next keyframe.
bool Videodec2::build_filter() {
  av_bsf_free(&filter_);
  const AVCodecParameters* p = parameters_;
  const bool wrapped = p->extradata && p->extradata_size >= 4 && p->extradata[0] == 1;
  const std::uint32_t codec = slot_->codec;
  const char* name = codec == kVp9 ? "vp9_superframe_split"
                   : !wrapped ? nullptr : codec == kAvc ? "h264_mp4toannexb" : "hevc_mp4toannexb";
  if (!name) {
    // Already Annex-B (MPEG-TS): its extradata holds the parameter sets, sent ahead of the stream.
    if (p->extradata && p->extradata_size > 0 && annexb_header_.empty())
      annexb_header_.assign(p->extradata, p->extradata + p->extradata_size);
  } else {
    const AVBitStreamFilter* bsf = av_bsf_get_by_name(name);
    if (!bsf || av_bsf_alloc(bsf, &filter_) < 0) return false;
    avcodec_parameters_copy(filter_->par_in, p);
    filter_->time_base_in = time_base_;
    if (av_bsf_init(filter_) < 0) {
      av_bsf_free(&filter_);
      return false;
    }
  }
  if (!filtered_) filtered_ = av_packet_alloc();
  return filtered_ != nullptr;
}

Videodec2::~Videodec2() {
  ready_.clear();
  if (slot_) {
    sceVideodec2Reset(slot_->decoder);
    slot_->in_use = false;
  }
  av_bsf_free(&filter_);
  av_packet_free(&filtered_);
}

int Videodec2::free_slot() {
  // The player releases frames as it shows them; waiting here is the back-pressure that keeps the decoder
  // from overwriting a picture still queued.
  for (int attempt = 0; attempt < 2000; ++attempt) {
    for (int i = 0; i < kFrameSlots; ++i) {
      bool expected = false;
      if (pool_->busy[i].compare_exchange_strong(expected, true)) return i;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  return -1;
}

bool Videodec2::submit(const std::uint8_t* au, std::size_t size, std::int64_t pts, bool shown) {
  if (size == 0 || size > kInputSlotBytes) return size <= kInputSlotBytes;
  std::uint8_t* input = static_cast<std::uint8_t*>(slot_->input.address) + (input_index_++ % kInputSlots) * kInputSlotBytes;
  const std::size_t bytes = slot_->codec == kHevc ? copy_hevc_base_layer(input, au, size) : (std::memcpy(input, au, size), size);
  if (!bytes) return true;
  const int slot = free_slot();
  if (slot < 0) return false;
  InputData in{};
  in.size = sizeof in;
  in.au = input;
  in.au_size = bytes;
  in.pts = static_cast<std::uint64_t>(pts);
  in.dts = UINT64_MAX;
  FrameBuffer frame{};
  frame.size = sizeof frame;
  frame.buffer = pool_->slot(slot);
  frame.buffer_size = pool_->frame_size;
  OutputInfo out{};
  out.size = sizeof out;
  const int rc = sceVideodec2Decode(slot_->decoder, &in, &frame, &out);
  ++decodes_;
  if (shown) pending_pts_.push_back(pts);
  if (rc != 0) {
    pool_->busy[slot] = false;
    if (errors_since_flush_ == 0)
      async_log::write("[PS5-REACT] video: sceVideodec2Decode=0x%08x (decode %llu, %zu bytes)", static_cast<unsigned>(rc),
                       static_cast<unsigned long long>(decodes_), bytes);
    // Starting mid-stream, the first pictures may reference what was never decoded.
    return outputs_since_flush_ == 0 && ++errors_since_flush_ <= kErrorsAfterFlush;
  }
  // A hidden VP9 frame (alt-ref) comes out of the call that decodes it: kept for reference, never shown.
  if (out.valid && out.picture_count && shown) {
    take(out, slot);
    return true;
  }
  if (out.valid && out.picture_count) ++outputs_since_flush_;
  pool_->busy[slot] = false;
  return true;
}

void Videodec2::take(const OutputInfo& out, int slot) {
  ++outputs_since_flush_;
  // The picture fills the slot it was handed: from there to the player without a copy.
  const std::uint8_t* base = static_cast<const std::uint8_t*>(out.buffer);
  if (!base || base < pool_->slot(slot) || base >= pool_->slot(slot) + pool_->frame_size) {
    pool_->busy[slot] = false;
    return;
  }
  // Decode order in, display order out: each picture takes the earliest timestamp still pending.
  std::int64_t pts = kNoPts;
  if (!pending_pts_.empty()) {
    const auto earliest = std::min_element(pending_pts_.begin(), pending_pts_.end());
    pts = *earliest;
    pending_pts_.erase(earliest);
  }
  const int pitch = static_cast<int>(out.pitch_bytes ? out.pitch_bytes : out.pitch);
  const bool deep = out.pitch_bytes >= out.pitch * 2u;
  video::Frame frame;
  // 10-bit samples come low-aligned in their 16-bit words (measured: a full-range picture peaks at 1023).
  frame.format = deep ? video::Format::nv12_10 : video::Format::nv12;
  frame.width = std::min<int>(display_width_, out.width);
  frame.height = std::min<int>(display_height_, out.height);
  frame.planes[0] = base;
  frame.planes[1] = base + static_cast<std::size_t>(pitch) * out.height;
  frame.pitch[0] = frame.pitch[1] = pitch;
  frame.matrix = matrix_;
  frame.full_range = full_range_;
  frame.transfer = transfer_;
  frame.aspect = aspect_;
  frame.pts_us = pts == kNoPts ? kNoPts : av_rescale_q(pts, time_base_, {1, 1000000});
  std::shared_ptr<FramePool> pool = pool_;
  frame.owner = std::shared_ptr<void>(nullptr, [pool, slot](void*) { pool->busy[slot] = false; });
  // A short window sorted by time: pictures leave in display order however the decoder hands them over.
  const auto at = std::upper_bound(ready_.begin(), ready_.end(), frame.pts_us,
                                   [](std::int64_t t, const video::Frame& f) { return t < f.pts_us; });
  ready_.insert(at, std::move(frame));
}

void Videodec2::drain() {
  for (int guard = 0; guard < 64; ++guard) {
    const int slot = free_slot();
    if (slot < 0) break;
    FrameBuffer frame{};
    frame.size = sizeof frame;
    frame.buffer = pool_->slot(slot);
    frame.buffer_size = pool_->frame_size;
    OutputInfo out{};
    out.size = sizeof out;
    if (sceVideodec2Flush(slot_->decoder, &frame, &out) != 0 || !(out.valid && out.picture_count)) {
      pool_->busy[slot] = false;
      break;
    }
    take(out, slot);
  }
}

bool Videodec2::send(const AVPacket* packet) {
  const bool vp9 = slot_->codec == kVp9;
  if (!packet) {
    if (filter_) {
      av_bsf_send_packet(filter_, nullptr);
      while (av_bsf_receive_packet(filter_, filtered_) == 0) {
        submit(filtered_->data, filtered_->size, filtered_->pts, !vp9 || vp9_shown(filtered_->data, filtered_->size));
        av_packet_unref(filtered_);
      }
    }
    drain();
    draining_ = true;
    return true;
  }
  const std::int64_t pts = packet->pts != kNoPts ? packet->pts : packet->dts;
  if (!filter_) return submit(packet->data, packet->size, pts, true);
  AVPacket* copy = av_packet_clone(packet);
  if (!copy) return false;
  copy->pts = pts;
  const int sent = av_bsf_send_packet(filter_, copy);
  av_packet_free(&copy);
  if (sent < 0) return true; // a packet the filter cannot read is skipped
  while (av_bsf_receive_packet(filter_, filtered_) == 0) {
    const bool ok = submit(filtered_->data, filtered_->size, filtered_->pts, !vp9 || vp9_shown(filtered_->data, filtered_->size));
    av_packet_unref(filtered_);
    if (!ok) return false;
  }
  return true;
}

bool Videodec2::receive(video::Frame& frame, bool& ended) {
  // Held until three are waiting, so a late-arriving earlier picture still sorts first.
  if (ready_.empty() || (!draining_ && ready_.size() < 3)) {
    if (draining_ && ready_.empty() && !ended_) {
      ended_ = true;
      ended = true;
    }
    return false;
  }
  frame = std::move(ready_.front());
  ready_.pop_front();
  return true;
}

void Videodec2::flush() {
  ready_.clear();
  pending_pts_.clear();
  draining_ = ended_ = false;
  build_filter();
  restart();
}
} // namespace

void video::preload_platform_decoder() {
  // Before filesystem elevation: afterwards the module load reports ESDKVERSION (0x80020063) and never
  // finishes, and a compute queue or a decoder's memory cannot be had (0x811D0111, 0x811D0200). The
  // decoders themselves are created on first use: their threads would stop the elevation helper,
  // which takes only a process with one thread.
  resident.module = sceSysmoduleLoadModule(0xCF);
  std::size_t flexible = 0;
  sceKernelAvailableFlexibleMemorySize(&flexible);
  char line[256];
  if (resident.module != 0) {
    std::snprintf(line, sizeof line, "[PS5-REACT] video: sceSysmoduleLoadModule(libSceVideodec2)=0x%08x",
                  static_cast<unsigned>(resident.module));
    hui::sys::log("%s", line);
    return;
  }
  int rc = 0;
  // Levels the decoder accepts at 4K: AVC level x10, HEVC general_level_idc (x30), VP9 x10.
  const int results[3] = {bring_up(resident.slots[0], "H.264", kAvc, 100, 52),
                          bring_up(resident.slots[1], "HEVC", kHevc, 2, 153),
                          bring_up(resident.slots[2], "VP9", kVp9, 0, 51)};
  std::size_t frame_size = 0;
  for (const Slot& slot : resident.slots)
    if (slot.prepared) frame_size = std::max<std::size_t>(frame_size, align16k(slot.memory.max_frame_size));
  if (frame_size) {
    resident.pool = std::make_shared<FramePool>();
    resident.pool->frame_size = frame_size;
    rc = resident.pool->memory.allocate(frame_size * kFrameSlots);
    if (rc != 0) {
      for (Slot& slot : resident.slots) slot.prepared = false; // nothing to decode into
      resident.pool.reset();
    }
  }
  std::size_t left = 0, configured = 0, direct_left = 0;
  std::int64_t direct_at = 0;
  sceKernelAvailableFlexibleMemorySize(&left);
  sceKernelAvailableDirectMemorySize(0, sceKernelGetDirectMemorySize(), 0x4000, &direct_at, &direct_left);
  sceKernelConfiguredFlexibleMemorySize(&configured);
  hui::sys::log("[PS5-REACT] video: sceVideodec2 4K decoders prepared H.264=0x%08x%s HEVC=0x%08x%s VP9=0x%08x%s, frames "
                "%dx%zuKiB (0x%08x), flexible memory %zu -> %zu of %zu MiB, direct memory %zu MiB free", static_cast<unsigned>(results[0]),
                resident.slots[0].failed, static_cast<unsigned>(results[1]), resident.slots[1].failed,
                static_cast<unsigned>(results[2]), resident.slots[2].failed, kFrameSlots, frame_size >> 10,
                static_cast<unsigned>(rc), flexible >> 20, left >> 20, configured >> 20, direct_left >> 20);
}

std::int64_t video::software_pixel_limit() { return 1920 * 1088; }

std::unique_ptr<video::Decoder> video::make_platform_decoder(const AVCodecParameters* parameters, int time_base_num,
                                                              int time_base_den) {
  return Videodec2::open(parameters, {time_base_num, time_base_den});
}
