# Video

`<Video>` plays a file or an http(s) stream full screen or in any box: H.264, HEVC
(including 10-bit HDR) and VP9 up to 3840×2160 through the PS5's hardware decoder,
and what FFmpeg decodes in software up to 1080p. Audio plays through the app's
sound mixer and is the clock the picture follows.

```jsx
import {useRef} from 'react';
import {Video} from '@ps5-react/core';

function Player({url, onClose}) {
  const video = useRef(null);
  return (
    <Video ref={video} source={{uri: url}} className="absolute inset-0"
      onLoad={({duration, naturalSize}) => console.log(duration, naturalSize)}
      onProgress={({currentTime}) => console.log(currentTime)}
      onEnd={onClose} onError={({error}) => console.log(error)} />
  );
}
```

Turn it on in `app.json`; streams also need networking:

```json
{"video": true, "networking": true, "filesystemAccess": "console"}
```

Without `"video": true` the app links no FFmpeg (about 11 MB less in the PS5 build)
and `<Video>` reports how to turn it on. `apps/video-lab` plays everything in its
`media/` folder and measures it.

## Props

| Prop | Meaning |
| --- | --- |
| `source` | An app path (`/app0/...`, `/download0/...`) or an http(s) URL, or `{uri, headers}` with request headers |
| `paused`, `muted`, `volume` (0–1), `repeat` | Playback controls; change them at any time |
| `resizeMode` | `'contain'` (default, letterboxed in black), `'cover'` or `'stretch'` |
| `upscale` | A network for animation that doubles a picture shown bigger than its source, before it is scaled to the box: `'artcnn'` (or `true`; ArtCNN C4F16, the luma only, chroma stays bilinear) or `'anime4k-s'`, `-m`, `-l`, `-vl`, `-ul` (Anime4K Upscale CNN x2, on R'G'B'). Its passes are split over two display frames, so the picture shows one display frame (17 ms) late. Needs compute shaders (the PS5); elsewhere it scales as before. A model compiles the first time it is used (0.5 to 0.8 s on the PS5). One upscaled video at a time |
| `compare` | `{upscale, split}`: right of `split` (0 to 1 across the picture) the picture goes through the model `upscale` (any `upscale` value, or `false`/`''` for none) instead of the element's own, so two models, or a model and none, show side by side on the same frame. That model runs whole in the display frame its picture first shows in, on top of the element's own model: a heavy pair drops frames while playing. A paused picture is upscaled once per model. Leave it out to end the comparison |
| `startTime` | Seconds to start at, for resuming |
| `audioDelay` | Seconds (-2 to 2) the sound plays later than the picture, to match a TV that shows the picture late; negative for earlier |
| `audio` | `false` decodes no audio and leaves the mixer to other players (default `true`) |
| `audioOutput` | `'pcm'` (default) decodes the track to the mixer; `'auto'` sends AC-3, E-AC-3 and DTS to the TV or receiver undecoded when its EDID lists them; `'passthrough'` sends them whatever the EDID says. See [Audio output](#audio-output) |
| `onLoad({duration, currentTime, naturalSize, audioTracks})` | Once, when the first picture or sound is ready |
| `onProgress({currentTime, playableDuration, seekableDuration})` | Every `progressUpdateInterval` ms (250) while playing |
| `onBuffer({isBuffering})`, `onSeek({currentTime})`, `onEnd()`, `onError({error})` | State changes |
| `subtitles`, `subtitleTrack` | Text subtitle files to add as tracks (`[{uri, language, title}]`, read when the video opens), and the track shown: an `index` from `subtitleTracks`, or `-1` (default) for none |
| `onSubtitle(text)` | Whenever the subtitle text showing changes; `''` when none shows |
| `onStatus(status)` | The player's full status (below) whenever its state, pause, seek or track changes |

The ref has `seek(seconds)`, `selectAudioTrack(index)` (an `index` from
`audioTracks`, or `-1` for none) and `getStatus()`. The status has `state`
(`'loading'`, `'ready'`, `'buffering'`, `'ended'`, `'failed'`), `position`,
`duration`, `buffered`, `width`, `height`, `videoCodec`, `audioCodec`, `decoder`
(`'sceVideodec2'` or `'ffmpeg'`), `audioTracks`, `audioTrack`, `shownFrames`,
`droppedFrames`, `lateMs` (how far, on average, a picture is shown past its time),
`audioClock` (whether audio is the clock), `audioPassthrough` (whether the sink decodes the track), `subtitleTracks` (`{index, language,
title, codec, external}`), `subtitleTrack` and `subtitle`.

## Subtitles

Text subtitles show as the app draws them: `onSubtitle` gives the text showing
now, its lines separated by `\n`, and the app renders it over the video like any
other text. They come from the file's own text tracks (SubRip, ASS/SSA, mov_text,
WebVTT), listed in `subtitleTracks` by their stream index, or from separate files
(`.srt`, `.ass`, `.vtt`, by path or URL) added with `subtitles`, listed from index
1000 and loaded off the render thread. ASS styling and positioning are dropped;
only the text is kept. Bitmap subtitles (PGS, DVD) are not read: a server can burn
them into the picture. Choosing a track of the file reads the file again from the
playhead, so its cues before the current read-ahead show.

`<Video>` is an `<Image layer>` the presenter fills with the picture: it is drawn
by the GPU beneath the interface, and anything drawn over it (controls,
gradients, text) composites as over any layer ([IMAGES.md](IMAGES.md)). Like any
layer it needs a host that draws layers; both hosts do.

## What plays

| | PS5 | Desktop preview |
| --- | --- | --- |
| H.264 Baseline, Main, High, 8-bit | hardware, up to 3840×2176 | FFmpeg |
| HEVC Main, Main 10 | hardware, up to 3840×2176 | FFmpeg |
| VP9 profile 0 | hardware, up to 3840×2176 | FFmpeg |
| Other H.264 (Hi10P, 4:2:2, 4:4:4), VP9 profile 2, MPEG-4 Part 2, MPEG-2, VC-1, MJPEG | FFmpeg, up to 1920×1088 | FFmpeg |
| AV1 | no (FFmpeg's decoder needs hardware; no dav1d yet) | no |
| Containers | MP4/MOV, Matroska/WebM, MPEG-TS, MPEG-PS, AVI, FLV, HLS | same |
| Audio | AAC, AC-3, E-AC-3, MP3, MP2, Opus, Vorbis, FLAC, ALAC, TrueHD, DTS, PCM | same |

Bigger than 1080p and not taken by the hardware fails with an error that says so:
a 4K picture decoded in software runs the app's heap out of memory. One video per
hardware decoder plays at a time (one H.264, one HEVC, one VP9); another one of the
same codec decodes in software when it fits.

Decoded audio of any layout and rate is mixed down to the mixer's 48 kHz stereo. AC-3, E-AC-3 and
DTS can instead go to the TV or receiver undecoded, surround and all: see [Audio output](#audio-output).

HDR10 and HLG are tone-mapped to SDR in the shader (BT.2100 to BT.709, reference
white at 203 nits, a soft shoulder): the presenter outputs 8-bit SDR, so the TV
does not switch to HDR. Dolby Vision profile 5 is not supported; other Dolby
Vision streams play their HDR10 base layer.

## Audio output

`audioOutput` picks where the track goes:

| | |
| --- | --- |
| `'pcm'` (default) | Decoded and mixed down to 48 kHz stereo, with the app's sounds |
| `'auto'` | AC-3, E-AC-3 and DTS at 48 kHz pass through to the sink when its EDID lists the codec (an E-AC-3 decoder counts for AC-3, a DTS-HD one for DTS); everything else is decoded |
| `'passthrough'` | AC-3, E-AC-3 and DTS at 48 kHz pass through whatever the EDID says (for a sink whose EDID is wrong or unreadable); the rest is decoded |

Passed through, the frames are packed as IEC 61937 bursts, byte for byte as FFmpeg's `spdif`
muxer writes them, and the PS5 sends them on the HDMI output its disc player uses
(`sceAudioOutExConfigureOutput` and `sceAudioOutExOpen`): AC-3 and DTS on a 48 kHz carrier, E-AC-3 on
192 kHz. DTS sends the core only: a DTS-HD MA or DTS:X track plays as its DTS core (5.1 at most), and
DTS Express, which has no core, is decoded. TrueHD is always decoded: it does not pass through. If the
console refuses the output, the track is decoded instead. Changing `audioOutput` reads the track again
from the playhead, as changing the track does; `status.audioPassthrough` says which happened.

While a track passes through:

- **Clock.** The bursts the output has read are the clock, as decoded samples are, so pause, seek and
  buffering work the same. A seek starts the sound at the frame the target falls in (at most 32 ms
  before it), since a burst cannot be cut. The sink decodes after the console, which may delay the
  sound a frame or more; `audioDelay` corrects what remains.
- **Volume.** A bitstream has no volume: `volume` does nothing, the sink's volume is the one. `muted`
  (or `volume` 0) sends silence.
- **Switching.** Opening the output switches the HDMI audio mode, so the sink may take a moment to
  lock on, and so may switching between AC-3, E-AC-3 and DTS. A seek or pause keeps the output open.
  Pausing cuts a burst short, which the sink drops: a frame's sound (32 ms) may go missing there.
- **App sounds.** The app's sounds still play through the mixer's stereo output. Whether the
  console mixes them in while its HDMI output carries a bitstream is not established yet.

`AudioOutput.capabilities()` reads the connected sink's EDID now, so an app can decide what to ask a
media server for before it opens a video:

```js
import {AudioOutput} from '@ps5-react/core';

const sink = AudioOutput.capabilities();
// {known: true, name: 'AVR-X1700H',
//  formats: [{codec: 'pcm', channels: 8, sampleRates: [32000, ..., 192000], bitDepths: [16, 20, 24]},
//            {codec: 'ac3', channels: 6, sampleRates: [32000, 44100, 48000], maxBitrate: 640000},
//            {codec: 'eac3', channels: 8, sampleRates: [44100, 48000]}, {codec: 'truehd', ...}, ...],
//  passthrough: ['ac3', 'eac3', 'dts'], pcmChannels: 8}
```

| Field | Meaning |
| --- | --- |
| `known` | An EDID was read. `false` on the desktop preview (and then `formats` and `passthrough` are empty) |
| `name` | The sink's EDID name, `''` when it has none |
| `formats` | Every codec the EDID's audio descriptors list, merged per codec: `codec` (`'pcm'`, `'ac3'`, `'eac3'`, `'dts'`, `'dtshd'`, `'truehd'`, `'aac'`, `'mp3'`, `'mp2'`, ...), the most `channels`, `sampleRates` in Hz, `bitDepths` for PCM, `maxBitrate` in bit/s where the descriptor gives one. A TV with only the EDID's basic audio flag lists two-channel PCM |
| `passthrough` | The codecs this host sends to this sink undecoded with `audioOutput: 'auto'`: `'ac3'`, `'eac3'`, `'dts'` |
| `pcmChannels` | The most PCM channels the sink takes (2 when it lists none). Decoded audio is still stereo |

It reads the EDID through `sceVideoOutGetHdmiRawEdid_` at each call (a request to a system service,
not yet timed): call it when needed, not every frame. Through an AV receiver the EDID is the
receiver's. **Not yet validated on hardware** inside an app: see [HARDWARE.md](HARDWARE.md#hdmi-audio-passthrough--2026-10-11).

## How it plays

- **Threads.** Each player demuxes on one thread and decodes video and audio on two
  more; the render thread only picks the picture due and presents it. This is the
  one exception to "engine work on the render thread": decoding a 4K frame takes
  longer than a frame. Players are closed off the render thread too.
- **Clock.** The audio the mixer has played, less its output latency, is the
  clock; without audio the wall clock is. At each display frame the player shows
  the picture due within half a frame, at most one new one per display frame
  unless it is behind: a 60 fps video on a 60 Hz display shows each picture once.
  A display at 59.94 Hz still has to drop one picture of a 60.00 fps video about
  every 17 seconds.
- **Read-ahead.** 4 seconds of a local file, 30 seconds of a stream (at most
  160 MiB), so a network stall plays through; FFmpeg's http reconnects. A stream that
  runs dry is `'buffering'`: the clock and the sound stop, and play again once 2 seconds
  are read ahead. When FFmpeg stops reconnecting, the player opens the stream again
  every 2 seconds where it broke off, for up to five minutes, then fails.
- **End.** Sound that ends before the picture hands the clock to the wall clock, so
  the last pictures still play.
- **Hardware decoding (PS5).** At launch, before the app's filesystem elevation,
  the host loads `libSceVideodec2` and prepares a decoder each for H.264, HEVC and
  VP9, sized for 4K: a compute queue, its memory and workspace. After elevation
  the module will not load and none of that can be had. The decoders themselves
  are created the first time a stream needs one, because creating one starts
  threads and the elevation helper takes only a process with a single thread;
  creating one after elevation works. Between streams a decoder is reset. It writes
  each picture into one of sixteen frame buffers the player reads directly; a buffer is
  reused once the player has shown its picture. The player keeps eight decoded pictures
  ahead: a 4K keyframe holds the decoder for up to about 60 ms, three and a half display
  frames. A hidden VP9 frame (alt-ref) is decoded for reference and never shown. See
  `licenses/video-decoder-NOTICE.txt` for whose findings this follows.
- **Upload.** On the PS5 a frame goes to the GPU as one storage buffer the shader
  reads bytes from (about 1.5 ms for a 4K frame); the console's 2D texture uploads
  run at a fraction of that speed. The desktop uploads plane textures.

## Memory (PS5)

A video app's `param.json` asks for the most flexible memory the console gives,
1 GiB instead of 448 MiB, and the app heap leaves 448 MiB of it outside: the
three 4K decoders' workspaces take about 160 MiB. The heap is then 384 MiB. The
frame buffers and decoder memory are direct memory (about 390 MiB for frames, of more
than 9 GiB free).

## Testing

`apps/video-lab` lists the files in its `media/` folder (not in the repository;
on the PS5, the title folder's `media/`) and the URLs in `media/urls.txt`
(`Label | URL` per line), and shows the status on screen. A PS5 test deploy with
`dev/playlist.txt` (`file seconds [seek-to]` per line) plays each file for that
long, logs a line per file and quits. With a video open the PS5 host logs each
player's state, decoder, shown and dropped frames and queue depths every two
seconds, and the upload volume and time.

## Cost (PS5)

The whole process, measured with `getrusage` while playing (the PS5 log line has it
every two seconds): about 1.0 to 1.2 cores busy for 3840×2160 60 fps H.264, 0.8 for
3840×2160 24 fps HEVC 10-bit, 0.18 for 320×240 MPEG-4 decoded by FFmpeg, out of the
console's eight cores. Most of the 4K cost is moving each picture to the GPU, 12 to
25 MB a frame.

## Not yet

- HDR10 output: the scanout has to be registered as 10-bit BT.2100 PQ (EVO Player does it
  on AGC), and the OpenGL layer that owns it offers no way to ask for that.
- Bitmap subtitles (PGS, DVD), ASS styling.
- AV1 (dav1d), Dolby Vision profile 5.
- Multichannel PCM: decoded surround is mixed down to stereo; only passthrough carries surround.
- TrueHD and DTS-HD MA / DTS:X passthrough (DTS sends its core).
- Matching the display's refresh rate to the film (24p judder at 60 Hz).
