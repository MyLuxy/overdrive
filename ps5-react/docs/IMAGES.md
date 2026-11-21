# Remote images

`<Image>` from `@ps5-react/core` draws bundled assets (imported files, baked
into the executable) and images from `http://` or `https://` URLs:

```jsx
import {Image} from '@ps5-react/core';

<Image source={{uri: game.coverUrl}} resizeMode="cover"
  className="w-[150px] h-[200px] rounded-md bg-surface" />
```

URL images are fetched and decoded natively, off the render thread, at the size
they are drawn, so remote art adds nothing to the build. On the PS5 they need
`networking: true` (see [NETWORKING.md](NETWORKING.md)); desktop preview loads
them with no opt-in.

## Drawing

- **Corners.** `borderRadius` (`rounded-*`) clips the bitmap to the same rounded
  shape a background with that radius fills, anti-aliased like it.

- **Size.** The image is decoded for the element's box in render pixels. When
  the style fixes both `width` and `height` in pixels, loading starts on mount;
  otherwise it starts after the first layout (one frame later). A box that
  changes size loads again for the new size.
- **Fit.** `resizeMode` `cover` (the default) crops to the box's aspect ratio,
  `contain` keeps the whole image inside it, `stretch` fills it, and `center` or
  `repeat` keep the source size. The image is shrunk to the box with an area
  (box) filter but never enlarged; a source smaller than its box is scaled up by
  the engine when drawn.
- **Format.** Pixels are premultiplied ARGB8888, registered with their known
  opacity. An opaque image drawn at its decoded size takes the engine's plain
  copy path, the cheapest way the software backend draws a bitmap; RGB565
  would halve memory but this backend expands it row by row on every repaint.
- **Layers.** `<Image layer>` lets the host draw the image itself, as a texture
  beneath the framebuffer, instead of the rasterizer. A fade of it, or of a
  container holding only it, then repaints nothing, and what is drawn over it
  (gradients, text) is not repainted either. It applies while the image is
  opaque (JPEG art is), untinted, `cover` or `stretch`, with no scale or
  rotation on it or an ancestor, no translucent ancestor holding anything else,
  and at least partly in view. Below full opacity it also needs a layer directly
  under it, in the preceding sibling container and starting from an opaque
  square-cornered one that covers it: a crossfade keeps the old image opaque
  underneath until the new one is in. A rounded image is a layer only at full
  opacity; the rasterizer still draws a square of its radius at each rounded
  corner. A screen holds at most 8 layers. Otherwise, and on a host without layers, it is rasterized as usual; the result
  looks the same. Changing between the two repaints the image's box once.
  Screenshots (`shot:`) composite the layers on the CPU.
- **Placeholder.** Until the image arrives the element draws only its own style:
  give it a `backgroundColor` (as above) for a tile of that color. The image
  replaces it in one frame, without a fade.
- **Events.** `onLoad({nativeEvent: {source: {uri, width, height}}})` reports
  the decoded size, `onError({nativeEvent: {error}})` the failure. Without
  `onError`, failures are logged with `console.warn`. Messages name the call and
  the URL, for example `Image.load https://example.com/a.jpg: HTTP 404`.
- **Lifetime.** Unmounting the element or changing its `source` releases the
  image; a fetch or decode that nothing else is waiting for is cancelled.
- **Hidden screens.** `<ReleaseImages when={hidden}>` lets the images under it
  go while `when` is true, except those on screen when it turned true: they stay
  mounted, but the decoded cache may evict the released ones, least recently
  used first. When it turns false they are taken again without re-rendering when
  still cached; an evicted one keeps drawing nothing until its reload lands. On
  screen is by layout, clipped by enclosing ScrollViews, at the moment of
  release; transforms are not applied, and hiding with `display: 'none'` in the
  same render still counts the last layout. The kept images pin about one
  screen of decoded art. Wrap a screen kept mounted while hidden (see
  [NAVIGATION.md](NAVIGATION.md)): in a private 3840×2160 app, a hidden home
  screen otherwise pinned about 60 MiB of decoded art while the next page loaded
  its own, and the PS5 heap peaked at 238 of 256 MiB.
- **Lazy loading.** As with a browser's `loading="lazy"`, an element's image goes to
  the network only once it has been mounted for 120 ms, and no request starts
  while a ScrollView moves or for 150 ms after it stops: a held key scrolls past
  rows without fetching their art (holding Down through the Overdrive grid for
  3 s went from 140 fetches and 167 decodes to 45 and 69), and the rows the view
  stops on, with those a VirtualList mounts ahead, load then. Art in the decoded,
  encoded or disk cache is not held back. Prefetches skip the 120 ms wait.

`Image.prefetch(uri, {width, height, resizeMode})` loads a URL ahead of time for
a box (pass the same style size the `<Image>` will have) and resolves when it is
decoded. It holds no reference: the image waits in the cache until it is drawn
or the cache needs the room. Use it for the next slide of a carousel or the
other shots of a gallery.

`Image.getColor(uri)` resolves to the image's most prominent vivid colour as
`'#rrggbb'`, raised to full brightness, or `null` when the art is grey or dark.
It decodes a 48 × 72 cover copy off the render thread (a cached URL is not
fetched again) and samples at most about 16k pixels: use it for an accent or
`Controller.setLightBar`.

## Formats and limits

| Limit | Value |
| --- | --- |
| Formats | JPEG (baseline and progressive) and PNG, decoded by stb_image 2.30; others fail with an actionable error |
| Encoded size | 4 MiB per response (store covers and 1920 × 1080 screenshots measure under 2 MiB) |
| Source size | 5 megapixels (for example 3840 × 1300) |
| Request | GET, 30-second total timeout, the shared transport policy of [NETWORKING.md](NETWORKING.md) (verified TLS, at most five redirects, identity encoding) |
| Retries | Four more attempts, 0.5, 1, 2 and 4 s apart, after connection failures, timeouts, HTTP 429/502/503/504 and running out of heap for the response; two more, 1 and 2 s apart, from the fetched bytes after running out of heap to decode |
| Connections | At most 8 per origin, kept alive between requests (HTTP/1.1: the console's libcurl has no HTTP/2) |

## Memory and threads

Five native workers own the work: one fetches over a dedicated libcurl multi
handle (its own connections, separate from the download queue, so images
never wait behind a large file), four decode. Images that an element draws are
fetched and decoded before prefetches, in request order. Workers never touch JavaScript or
the engine. The render thread only submits, releases and polls once per frame
while loads are pending, then registers finished pixels with the engine. Each
frame hands finished loads to their elements, whose re-render runs then, until
about 4 ms have gone and at least one: images that finish together, as when a
page mounts, arrive over several frames instead of stalling one.

| Budget | Value |
| --- | --- |
| Decoded cache | 64 MiB and at most 256 images; the PS5 host keeps 64 MiB with a heap of 256 MiB or more, 40 MiB from 192 MiB and 24 MiB below. Images in use are never evicted, so a screen that draws more than that exceeds it; unused ones are evicted least recently used first |
| Encoded cache | 4 MiB of recently fetched bytes by URL, so the same image at another size decodes without a second fetch. Loads of a URL already being fetched join that request |
| Decode | Up to four images at a time, in the same priority order. A decode is counted at 8 bytes per source pixel (it holds about 4.5 for JPEG and 8 for PNG until it finishes), and those running together stay within 40 MB, what one image at the source limit takes; one always runs |
| In flight | No new fetch starts while encoded bytes held anywhere (responses, decode queue, encoded cache) pass 16 MiB; up to 32 connections, 8 while a download to a file runs |
| Threads | Five, with 1 MiB stacks |

All of it comes from the process heap shared with QuickJS, the framebuffer and
the download buffers (128 MiB at the least on the PS5; see
[DOWNLOAD-PERFORMANCE.md](DOWNLOAD-PERFORMANCE.md#framework-constraints)).
Responses and decodes allocate with `malloc` and check the result, so running
out of heap fails or retries one image instead of aborting the title. The PS5
host logs `[PS5-REACT] memory: heap=live/size … img encoded=… decoded=…` about
every ten seconds, followed by `[PS5-REACT] images:` with counters since launch:
loads by where they were served from (`decoded-cache`, `encoded-cache`, `disk`,
`net`), `decodes` with their average time, `shown` with the average and longest
time from request to pixels for images an element waits on, `cancelled` loads,
`aborted` transfers, `retries` and `failed`, then the four busiest origins with
their requests, failures, average time and size. The desktop preview prints the
same line every two seconds while it changes. Hosts stop the image workers and free
every image before shutting the runtime down.

Fetched bytes are also kept on disk in the app's data directory
(`FileSystem.dataDir` + `/.cache/images`, at most 256 MiB, least recently used
first), so a relaunch decodes art without the network. Entries are fetched
again after a week; responses over 16 MiB are not stored. Deleting the
directory clears the cache.

## Hardware status

See [HARDWARE.md](HARDWARE.md) for what has been measured on a console. Desktop
tests (`npm test` runs `tools/test_images.py` against a local HTTP server) do
not establish PS5 behavior.
