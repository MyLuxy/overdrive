# Animation

PS5 React animates with a Motion-style API (`motion.View`, `AnimatePresence`)
built on Embedded React's `Animated`, whose animations run in the C engine with
no per-frame JavaScript. Tailwind animation classes compile to the same props.

The UI is rasterized on the CPU, so motion has a budget: translation is cheap,
scale and rotation are limited to small elements, and large fades are the most
expensive thing you can animate. [Performance](#performance-on-the-cpu-renderer)
lists the rules; [Design guidelines](#design-guidelines) gives the motion tokens.
`apps/motion-lab` shows every pattern on this page.

## Quick start

```jsx
import {AppRegistry, View, Text, FocusScope, motion, transitions} from '@ps5-react/core';

const items = ['Play', 'Store', 'Settings'];

function Menu() {
  return (
    <FocusScope autoFocus>
      <View className="w-screen h-screen bg-slate-950 items-center justify-center">
        <motion.View className="flex-row gap-6"
          initial={{opacity: 0, y: 24}} animate={{opacity: 1, y: 0}} transition={transitions.panel}>
          {items.map(label => (
            <motion.View key={label} focusable
              whileFocus={{y: -6, scale: 1.06}} transition={transitions.focus}
              className="w-48 h-28 rounded-2xl bg-slate-800 items-center justify-center">
              <Text className="text-xl text-white">{label}</Text>
            </motion.View>
          ))}
        </motion.View>
      </View>
    </FocusScope>
  );
}

AppRegistry.registerComponent('menu', () => Menu);
```

The row fades and rises in once; each card lifts while it has focus (see
[NAVIGATION.md](NAVIGATION.md)). No JavaScript runs while a value moves: the engine drives it, and React
renders only when state changes.

## Runtime API (`@ps5-react/core`)

Also re-exported unchanged from Embedded React: `Animated`, `useAnimatedValue`,
`Easing`, `LayoutAnimation`, `Pressable`.

### `motion.View`, `motion.Text`, `motion.Image`, `motion.create(Component)`

Props, in addition to the wrapped component's:

| Prop | Type | Meaning |
| --- | --- | --- |
| `initial` | target \| variant label \| `false` | State at mount; `false` starts at `animate` without animating |
| `animate` | target \| variant label | State to animate to whenever it changes (deep-compared) |
| `exit` | target \| variant label | State animated before removal; needs an `AnimatePresence` parent |
| `transition` | transition | Default transition; per-key overrides as `transition={{x: {...}}}` |
| `variants` | `{[label]: target}` | Named targets; labels propagate to motion children |
| `whileFocus` | target \| label | Applied while the element has focus (its `focused` prop when given) |
| `whileSelect` | target \| label | Applied while `selected` is true |
| `whilePress` | target \| label | Applied while `pressed` is true |
| `onAnimationComplete` | `(definition) => void` | Called when `animate` settles |

A **target** uses only animatable keys: `opacity` (0..1), `x`, `y` (px, before
render scaling — the same logical px as Tailwind), `scale`, `scaleX`, `scaleY`,
`rotate` (degrees). Other keys throw in development builds of the motion module
with an actionable message. Colors are not animatable by the engine: use
crossfading layers.

Priority when several apply: `whilePress` > `whileSelect` > `whileFocus` >
`animate`; keys not named by a higher one fall back to the lower ones.

A **transition**:

| Key | Default | Meaning |
| --- | --- | --- |
| `type` | `'spring'` for x/y/scale/rotate, `'tween'` for opacity | `'spring'` \| `'tween'` |
| `duration` | 0.3 | Seconds (tween) |
| `delay` | 0 | Seconds |
| `ease` | `'easeOut'` | `'linear'`, `'easeIn'`, `'easeOut'`, `'easeInOut'`, `'circOut'`, `'backOut'`, `'anticipate'` or a `[x1, y1, x2, y2]` cubic bezier |
| `stiffness`, `damping`, `mass` | 300, 30, 1 | Spring |
| `repeat`, `repeatType` | 0, `'loop'` | `Infinity` loops; `'reverse'` alternates |
| `staggerChildren`, `delayChildren`, `staggerDirection` | 0, 0, 1 | Variant orchestration (seconds) |

`transitions` exports presets from the motion tokens: `transitions.focus`
(spring, quick, no overshoot), `transitions.panel`, `transitions.screen`
(tween 0.45 s quintOut), `transitions.exit` (tween, shorter, easeIn),
`transitions.pop` (spring with overshoot, for small elements).

### `AnimatePresence`

`<AnimatePresence initial={true} mode="sync" | "wait">` keeps removed keyed
motion children mounted until their `exit` finishes. `mode="wait"` enters the
next child only after the previous one left.

### Engine limits that the API respects

- Animations bind opacity and transforms only; scale/rotate render only on
  elements whose laid-out size fits the transform scratch buffer (512×512
  physical px in the default profile). Translate and opacity have no size limit;
  full-screen opacity is expensive, except on a container holding only an
  `<Image layer>`, which the host fades without repainting
  ([IMAGES.md](IMAGES.md)).
- On the PS5 the cost of a change is mostly its raster, about 5 ns per changed
  pixel at 1080p (more under scaled images and gradients), plus about 0.5 ms to
  upload 1920×540 rows through the presenter's buffer textures. Full-screen
  changes still take a frame or more each, so prefer animating small elements.
- Animated opacity applies to View-family nodes; `motion.Text`/`motion.Image`
  wrap themselves in a View to fade.
- Values are allocated lazily per animated key and released on unmount.

## Tailwind classes (compiled by tools/tailwind)

An element using any of these classes becomes the matching `motion.*`
component (host primitives only); the classes become motion props:

| Classes | Becomes |
| --- | --- |
| `animate-in` with `fade-in[-N]`, `slide-in-from-{top,bottom,left,right}[-N]`, `zoom-in[-N]`, `spin-in[-N]` | `initial` (the "from" values) and `animate` (identity) |
| `animate-out` with `fade-out[-N]`, `slide-out-to-*`, `zoom-out[-N]`, `spin-out[-N]` | `exit` |
| `duration-N`, `delay-N`, `ease-linear/in/out/in-out` | `transition` (ms → s) |
| `transition`, `transition-all`, `transition-transform`, `transition-opacity` | Opacity/transform keys of state variants (`focused:`, `selected:`, …) animate via `animate` instead of snapping |
| `animate-spin`, `animate-pulse`, `animate-bounce`, `animate-ping` | Repeating `animate` + `transition` |

`fade-in-N` / `zoom-in-N` take Tailwind opacity / scale numbers (`zoom-in-95`
→ from 0.95); `slide-in-from-bottom-4` takes spacing (16 logical px).
Non-animatable keys in a variant (colors, borders) still switch instantly.

```jsx
<View className="animate-in fade-in slide-in-from-bottom-4 duration-300 delay-75 h-5 bg-sky-400" />

<View onPress={open}
  className="w-60 h-60 rounded-2xl bg-slate-800 transition duration-200
    focused:scale-105 focused:bg-slate-700" />

<View className="size-10 rounded-full border-4 border-slate-700 border-t-sky-300 animate-spin" />
```

In the second example the scale animates and the background switches at once.

## Recipes

### Staggered entrance

Variant labels set on a parent reach every motion descendant that has
`variants` and no `animate` of its own. The parent's `staggerChildren` delays
each child after the previous one:

```jsx
const grid = {hidden: {}, shown: {transition: {staggerChildren: 0.05, delayChildren: 0.08}}};
const card = {hidden: {opacity: 0, y: 24}, shown: {opacity: 1, y: 0, transition: transitions.panel}};

<motion.View variants={grid} initial="hidden" animate="shown" className="flex-row flex-wrap gap-6">
  {items.map(item => <motion.View key={item.id} variants={card} className="w-[200px] h-[140px]" />)}
</motion.View>
```

Keep the whole sequence under about 400 ms: with ten cards, 30–50 ms per step.

### Focus: lift plus a gliding highlight

Lift the focused card a little (`y: -6`, `scale: 1.06`) and let one highlight
travel between cards instead of drawing a border on each. The highlight moves
by translation only, so its size does not matter. Navigation moves focus; the
cards only report it through `onFocus`/`onBlur` so the highlight knows where to go:

```jsx
const [current, setCurrent] = useState(-1);
const col = current % COLS, row = Math.floor(current / COLS);

<View className="relative flex-row flex-wrap gap-6">
  <motion.View className="absolute w-[224px] h-[164px] rounded-3xl border-4 border-sky-300"
    initial={false} transition={transitions.focus}
    animate={{x: col * (W + GAP) - 12, y: row * (H + GAP) - 18, opacity: current < 0 ? 0 : 1}} />
  {items.map((item, i) => (
    <motion.View key={item.id} onPress={() => open(item)} whileFocus={{y: -6, scale: 1.06}}
      onFocus={() => setCurrent(i)} onBlur={() => setCurrent(-1)}
      transition={transitions.focus} className="w-[200px] h-[140px] rounded-2xl bg-slate-800" />
  ))}
</View>
```

Fixed card sizes make the highlight position plain arithmetic. Keep scaled
cards within 256 logical px at a 2560-wide render (see
[Performance](#performance-on-the-cpu-renderer)).

### Focus: a light running around the border

The PS5 focus ring is a light travelling around the focused item's rounded
border, bright at its head and fading in a long tail. Four `View` styles draw
it, over the content, inside the box, following its `borderRadius`:

| Style | Meaning |
| --- | --- |
| `borderSweepColor` | Colour at the head (its alpha scales the whole light) |
| `borderSweepWidth` | Ring thickness in render px; 0 draws nothing |
| `borderSweepLength` | Tail as a fraction of the perimeter (default 0.3) |
| `borderSweepPhase` | Head position, 0–1 clockwise from the top edge's left end; wraps at 1 |

Animate the phase with an `Animated` value: the engine moves it every frame
with no JavaScript, and a phase-only change repaints the bands along the four
edges the ring reaches (about a quarter of a card), not the card:

```jsx
function FocusLight({style}) {
  const phase = useAnimatedValue(0);
  useEffect(() => {
    const run = Animated.loop(Animated.timing(phase, {toValue: 1, duration: 2400, easing: Easing.linear}));
    run.start();
    return () => run.stop();
  }, []);
  return (
    <Animated.View pointerEvents="none" style={[{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
      borderRadius: 18, borderSweepColor: '#ffffff', borderSweepWidth: 4, borderSweepPhase: phase}, style]} />
  );
}
```

The classic rotating-gradient border is the other way to draw it: a conic
gradient turning behind the item, seen only through its border. The
`borderGradient` style draws exactly that, and `borderGradientAngle` turns it:

```jsx
const angle = useAnimatedValue(0);
// Animated.loop(Animated.timing(angle, {toValue: 360, duration: 2400, easing: Easing.linear})).start();
<Animated.View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, right: 0, bottom: 0,
  borderRadius: 18, borderGradientAngle: angle,
  borderGradient: {type: 'conic', width: 4, stops: [
    {color: 'rgba(255,255,255,0)', offset: 0}, {color: '#ffffff', offset: 0.3},
    {color: 'rgba(255,255,255,0)', offset: 0.31}]}}} />
```

| `borderGradient` key | Meaning |
| --- | --- |
| `type` | `'conic'` or `'radial'` |
| `width` | Ring thickness in render px |
| `angle` | Conic: start angle in degrees, CSS `conic-gradient(from …)`: 0 up, clockwise. Radial: loop position (below) |
| `size` | Radial only: background size as a multiple of the box (CSS `background-size: 300%` is 3) |
| `stops` | Up to 6 `{color, offset}` around the circle, or from the centre out; colours keep their alpha |

`type: 'radial'` is Magic UI's ShineBorder: a CSS `radial-gradient` (ellipse,
farthest-corner) on a background `size` times the box, its position looping
`0% 0%` → `100% 100%` → `0% 0%`, seen through the border. One 360° turn of the
angle is one loop, so the conic example's linear 0–360 timing drives it too:

```jsx
borderGradient: {type: 'radial', width: 3, size: 3, stops: [
  {color: '#ffffff00', offset: 0.25}, {color: '#ffffff', offset: 0.5}, {color: '#ffffff00', offset: 0.75}]}
```

`borderGradientAngle` (degrees) overrides `angle` and animates on the native
driver, repainting only the ring's bands like the sweep. A conic gradient turns
around the centre, so on a long card the light moves faster along the short
sides; `borderSweep*` moves at one speed along the perimeter. Neither has a
Tailwind class: their stops and animated values need a style object.

Mount it only on the focused item (`useIsFocused`), so one light runs at a
time. Inside a scaled element (`whileFocus={{scale: 1.04}}`) the light scales
with it, but a phase step then repaints the element's whole scaled box, as any
change under a transform does; on a large card, keep the light outside the
scaled subtree, or lift the card with `y` instead of `scale`. For a soft halo,
put a second, wider sweep with a lower alpha behind the first.

### A light across a card

A gloss that sweeps over a focused card is a gradient band translated across
it. Two View styles make it look like light on glass rather than a stripe
pasted on top:

- `roundedClip: true` clips a View's children to its rounded border box,
  anti-aliased exactly as a rounded background of that box is, so the band runs
  out through the corners. It implies `overflow: 'hidden'`; `overflow: 'hidden'`
  alone still clips to the rectangle. Nested rounded clips multiply.
- `mixBlendMode: 'plus-lighter'` adds what a View and its children draw to what
  is beneath, saturating at white, so highlights brighten the art instead of
  washing it out. Each primitive adds, so overlapping layers add up. Under a
  translucent or transformed ancestor the light adds within that group, which
  then composites normally.

```jsx
<View pointerEvents="none" style={{position: 'absolute', left: 0, top: 0, width, height,
  borderRadius: 36, roundedClip: true}}>
  <Animated.View style={{position: 'absolute', top: 0, height, width: band, mixBlendMode: 'plus-lighter',
    transform: [{translateX: x}],
    backgroundGradient: {type: 'linear', angle: 112, stops: [
      {color: 'rgba(255,250,240,0)', offset: 0.3}, {color: 'rgba(255,250,240,0.5)', offset: 0.5},
      {color: 'rgba(255,250,240,0)', offset: 0.52}]}}} />
</View>
```

The band repaints only the strip it covers each frame. Neither style has a
Tailwind class. Content under either never takes the pixel-moving fast paths
(scroll and translate copies) or becomes a host layer, so keep them on small,
short-lived elements such as the focused card's light.

### Page transitions

Give each page a `key` inside `AnimatePresence mode="wait"`: the old page
leaves fast, then the new one slides in. Translate the full-screen container
and fade only its small children, which receive the same labels; never fade or
scale the container itself:

```jsx
const page = {
  hidden: {x: 90},
  shown: {x: 0, transition: {...transitions.screen, staggerChildren: 0.05}},
  gone: {x: -60, transition: transitions.exit},
};
const card = {
  hidden: {opacity: 0, y: 24},
  shown: {opacity: 1, y: 0, transition: transitions.panel},
  gone: {opacity: 0, transition: transitions.exit},
};

<AnimatePresence mode="wait">
  <motion.View key={pageIndex} variants={page} initial="hidden" animate="shown" exit="gone"
    className="flex-1">
    <Page />
  </motion.View>
</AnimatePresence>
```

Cards inside `Page` that declare `variants={card}` fade in staggered and fade
out with the page. A label change renders only the elements that use labels:
those with `variants` and no `animate` of their own, and those that pass labels
on. Elements with their own `animate` or only `whileFocus` stay as they are.

For tabs, `Screens` (NAVIGATION.md, "Tabs that keep their pages") runs the
same leave-then-enter switch with these labels but keeps every page it has
shown mounted, so going back to a page does not build it again.

A full-screen page that only slides, such as a details sheet over the screen
it came from, is moved by copying the pixels it already painted when it is one
opaque plain `View` (a solid background, no radius, border, gradient or
shadow), optionally inside paint-free single-child wrappers, with its whole
subtree inside its box and no translucent or transformed ancestor. Each frame
then repaints only the strip it uncovers, the area it left and anything drawn
over it, instead of the whole screen. Give such a sheet a solid background
rather than a translucent one, and animate `x` or `y`, not scale or opacity.

### Toasts and other pop-ins

Small, short-lived elements can overshoot. Enter with `transitions.pop`, leave
faster with `transitions.exit`, and keep the element within the scale limit:

```jsx
<AnimatePresence>
  {toast && (
    <motion.View key={toast.id} className="absolute bottom-20 right-10 w-60"
      initial={{opacity: 0, y: 24, scale: 0.9}} animate={{opacity: 1, y: 0, scale: 1}}
      exit={{opacity: 0, y: 12, transition: transitions.exit}} transition={transitions.pop} />
  )}
</AnimatePresence>
```

### Idle and ambient motion

Loops use `repeat: Infinity`. Keep them small and slow:

```jsx
<motion.View className="size-24 rounded-full bg-sky-300/40"
  initial={{opacity: 0.25}} animate={{opacity: 0.8}}
  transition={{duration: 2.8, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse'}} />

<motion.View className="size-14 rounded-full border-4 border-slate-700 border-t-sky-300"
  initial={{rotate: 0}} animate={{rotate: 360}}
  transition={{type: 'tween', duration: 1.1, ease: 'linear', repeat: Infinity}} />
```

Do not place a loop inside an element that is scaled or rotated: a change
inside a transformed node repaints the whole node every frame. Lift such
containers with `y` instead.

### Changing colors

Colors switch instantly. To make a color change feel animated, stack two
layers and crossfade the top one, preferably on a small element:

```jsx
<View className="relative w-36 h-10 rounded-full bg-slate-800 items-center justify-center">
  <motion.View className="absolute inset-0 rounded-full bg-sky-700"
    initial={false} animate={{opacity: active ? 1 : 0}} transition={{duration: active ? 0.2 : 0.12}} />
  <Text className="text-sm text-white">{label}</Text>
</View>
```

### Lower level: `Animated`

`motion` covers declarative state changes. For sequences, `interpolate`, or
imperative control, use the re-exported `Animated` and `useAnimatedValue`
directly. They follow Embedded React's API: durations in milliseconds, `Easing`
tokens, and no need for `useNativeDriver`. `LayoutAnimation.configureNext()`
tweens every node whose layout rectangle changes in the next commit.

## Performance on the CPU renderer

Embedded React rasterizes every changed pixel on the CPU, then OpenGL presents
the framebuffer. An animation costs roughly the area it repaints each frame,
plus an offscreen copy when that area is faded or transformed.

- **Translate (`x`, `y`) is cheap and unlimited.** It repaints the old and new
  rectangles and needs no offscreen copy. Prefer it for focus, sliding
  highlights, and page transitions.
- **Scale and rotate only on small elements.** The untransformed subtree is
  copied into a transform buffer of 512×512 physical px. At a
  2560-wide render with `baseWidth` 1280, that is **256×256 logical px**;
  larger elements do not render scaled. Every change inside a transformed node
  repaints the whole node.
- **Opacity composites through scratch strips.** A small fade is cheap. A
  full-screen fade blends every pixel each frame and is the most expensive
  animation available. Fade cards, toasts, and highlights rather than screens,
  and keep screen fades short.
- **Colors are not animatable.** Crossfade two layers, as shown above.
- **Values are pooled.** The engine has a fixed pool of animated values.
  `motion` allocates one per animated key on first use and releases it on
  unmount. Do not animate hundreds of elements at once or keep unbounded lists
  of motion components mounted.
- **Animate values, not state.** `setState` on a timer re-renders and
  re-commits the tree on every tick. A `motion` target or an `Animated` value
  moves in C with no JavaScript.

### Reading the frame-time log

Both hosts always print a summary every two seconds (illustrative values, not
a PS5 measurement):

```text
[PS5-REACT] frame: fps=59.9 total avg=16.7ms p95=17.1 max=21.4 | input=0.1 update=3.2 present=1.9 (upload=0.8 draw=1.1 up=2100KB) swap=11.4 | cpu=0.6 cores (main=4.8 present=0.9 swap=0.2) | js=0.4 (dispatch=0.1 react=0.2 marshal=0.1) layout=0.1 raster=2.7 (prepass=0.1 render=1.6 blit=1.0) dirty=310kpx blit=820kpx
```

On the PS5, the line goes to the kernel log (`sceKernelDebugOutText`), which
your loader's klog viewer shows, and to stdout. The macOS preview prints it to
the terminal running `npm run dev` or `npm run preview`; the desktop self-test
omits it.

| Field | Meaning |
| --- | --- |
| `fps` | Frames per second over the two-second window |
| `total avg`, `p95`, `max` | Time between frame starts in ms: mean, 95th percentile, and worst |
| `input` | Controller polling and action dispatch to JavaScript, including any render a handler causes |
| `update` | The JavaScript pump, React commits, layout, and CPU rasterization |
| `present` | Uploading the damaged framebuffer rectangles and drawing them with OpenGL, split into `upload` (texture uploads, including newly shown layer images), `draw` (draw calls) and `up` (mean kilobytes uploaded per frame). Both are CPU time issuing the work; the GPU may finish it later, inside `swap` |
| `swap` | Buffer swap, including any wait for vertical sync. A frame that changed nothing is not presented: the host sleeps to the next vertical sync instead |
| `cpu` | CPU time of the whole process over wall time, in cores: render workers, image decoding and network threads included |
| `main`, `present`, `swap` (after `cpu`) | CPU ms per frame of the render thread, then its part in `present` and `swap`; wall time minus CPU time there is waiting |
| `js` | JavaScript, split into `dispatch` (handlers, timers, microtasks), `react` (component renders) and `marshal` (props pushed into the engine) |
| `layout` | Flex layout and text measurement |
| `raster` | CPU rasterization, split into `prepass` (deciding what to repaint), `render` (compositing) and `blit` (framebuffer writes) |
| `dirty`, `blit` | Thousands of pixels repainted, and written, per frame; `blit` well above `dirty` means overlapping layers |

Phase values are per-frame means in ms. `total` minus the four host phases is
the engine's animation tick plus loop overhead. The second group comes from the
engine's own instrumentation (`ERUI_PERF_STATS`, enabled in
`native/ps5/CMakeLists.txt`) and adds `js + layout + raster ≈ input + update`.
A large `swap` with a small `update` means the frame finished early and waited
for vsync, which is healthy. When `fps` drops, look at `update`: if it rises
only while an animation runs, the animation repaints too much (a large fade, a
loop inside a scaled element, or a large image drawn at a size other than its
baked size, which is rescaled on every repaint). A `p95` or `max` far above the
mean points at hitches, such as a page transition mounting a large tree in one
frame. Desktop timings do not predict PS5 timings; measure on the console
before claiming a frame rate.

Frames longer than 33 ms also print one line each (at most eight per window),
with the same split for that frame and the bounding box of its repaint:

```text
[PS5-REACT] slow frame: 41.2ms | js=24.1 (dispatch=0.6 react=22.0 marshal=1.0) layout=0.2 raster=9.8 (prepass=0.1 render=6.4 blit=3.2 sweep=0.0) present=2.6 (upload=1.1 draw=1.5) other=4.5 | dirty=2356x1250@142,190 1849kpx blit=7013kpx
```

`other` is host work outside those phases, including the vsync wait. A PS5
test deploy can lower the 33 ms threshold with `dev/slow-frame-ms.txt` in the
app folder, and report every slow frame instead of the first eight per two-second
window with a larger limit in `dev/slow-frame-lines.txt`. The host clamps the animation step to 50 ms, so frames beyond that
make animations run in slow motion.

#### Reproducible profiling

The preview replays a scripted input sequence when `PS5_REACT_INPUT_SCRIPT` is
set, through the same dispatch path as the keyboard and controller. Steps are
separated by commas or whitespace: an action (`up`, `down`, `left`, `right`, `confirm`, `back`,
`l1`, `r1`, `l2`, `r2`, `triangle`, `square`, `options`) takes one frame, `action*N` repeats it at the held-key repeat interval
(110 ms), `wait:MS` pauses for wall-clock milliseconds, `quit` closes the
preview, `shot:NAME` saves the frame on screen (letters, digits, `_`
and `-`; see [Screenshots](#screenshots)), and `swipe:DIRECTION:TRAVEL` slides a
touchpad finger `TRAVEL` (up to 0.5 of the pad) from its middle over 16 frames and lifts it
([NAVIGATION.md](NAVIGATION.md#touchpad)). `hold:BUTTON[:MS]` holds a `GamepadState` button
(`touchpad`, `l3`, `cross`, ...) for MS or until `release:BUTTON`, and `trigger:l2|r2:VALUE[:MS]`
sets a trigger's travel (0–1; past half it is pressed, 0 lets go). They return at once, so a
hold reads `trigger:r2:1,wait:800,trigger:r2:0`; a button with an action (Cross: `confirm`,
L2 past half travel: `l2`) dispatches it as it goes down, once. `ps5_drive.py script "<steps>"`
runs steps in a running preview. `PS5_REACT_SLOW_FRAME_MS` changes the slow-frame threshold. Each
action is echoed as a `script:` line, so the log reads as a timeline. Run the
preview binary directly, with the bundle of the layout it was built for, to set them:

```sh
PS5_REACT_SANDBOX=.build/my-app/sandbox PS5_REACT_SLOW_FRAME_MS=20 \
PS5_REACT_INPUT_SCRIPT="wait:3000,right*3,wait:1500,confirm,wait:2000,back,wait:2000,quit" \
  .build/my-app/desktop/ps5-react-preview .build/my-app/generated/3840x2160/app.bundle.js
```

The variables have no effect on `--self-test`.

On the PS5, the host reads the same syntax from `dev/input-script.txt` in the
app folder (`/app0/dev/input-script.txt`) when that file exists; commas,
spaces and newlines all separate steps, and the `script:` lines go to the kernel
log. The file is never part of a build: add it to the built title folder
(`dist/<titleId>/dev/`) for a test deploy only, and end the script with `quit`
so the run closes itself.

While such a test deploy runs, the PS5 host also takes live commands: about once
a second it reads `dev/commands.txt` and runs, in the same syntax, every line of
the form `<sequence> <steps>` whose sequence number it has not seen (lines
present at launch are skipped). Writing the file with a new number, for example
the current time in milliseconds, runs its steps once; each line is echoed as a
`command:` line in the kernel log. The host polls only when the app folder has a
`dev` directory, which a build never creates.

#### Profiling JavaScript

When a slow frame's time is in `js` or `react`, a sampling profiler shows which
functions it went to. Put the sampling interval in microseconds (`1000` is a good
start) in `dev/profile.txt` of a PS5 test deploy, or set `PS5_REACT_PROFILE` to an
output path for the preview. About once per interval QuickJS's interrupt handler
records the running stack, and when the run ends the host writes folded stacks
to `dev/profile.folded` (or the given path): one line per stack, outermost frame
first, frames as `name@line`, then the microseconds charged to it. Flame-graph
tools read the format. Lines are those of `.build/<app>/generated/app.bundle.js`,
which also identifies React's minified internals. Time inside a native call is
charged to the first sample after it returns, so bridge and engine calls are
undercounted; the frame-time log measures those.

#### Screenshots

`shot:NAME` in a script or a live command saves the frame currently on screen,
at half resolution (960 × 540 for a 1080p render), as a 24-bit `NAME.bmp`. It
reads the software framebuffer between frames, so it shows exactly what was
presented; writing the file takes that frame about 100 ms on the PS5, so leave
a `wait` around shots inside a measured sequence. On the PS5 the file goes to
the title's `dev/` folder (`/data/homebrew/<titleId>/dev/NAME.bmp`); the preview
writes it to `.build/<app>/sandbox/temp0/`. Each shot logs a `shot <path>: saved`
line. Without a `dev` folder no script or command runs, so a build pays nothing.

With the PS5Upload desktop app running, fetch shots and convert them to PNG:

```sh
PS5_ADDR=<console IP> python3 tools/ps5_shots.py PPSA99058 shots/ start game-page
```

Without names it fetches every `.bmp` in `dev/`. The script only reads; it
calls PS5Upload's local `/api/transfer/download` (`kind: "file"`), the same as
downloading `dev/NAME.bmp` by hand.

Elevated titles (`filesystemAccess: "console"`) see `/app0` only as a logical
path; the host resolves `dev/` files through the same mapping as the native API.

## Design guidelines

Motion should explain where focus went and where content came from. On a TV,
viewed from across the room, small fast movements read as responsive; large
slow ones read as lag.

| Token | Duration | Curve | Use |
| --- | --- | --- | --- |
| Focus | 120–200 ms | Spring without overshoot (`transitions.focus`) | Focus lift, gliding highlight, tab pill |
| Panel | 250–350 ms | Ease-out (`transitions.panel`) | Cards, panels, drawers, list entrances |
| Screen | 400–500 ms | Quint-out (`transitions.screen`) | Page and screen changes |
| Exit | Shorter than the matching entrance | Ease-in (`transitions.exit`) | Anything leaving |
| Pop | Short spring with overshoot (`transitions.pop`) | | Toasts, badges, small confirmations |
| Stagger | 30–90 ms per item | | Grids and lists; keep the sequence under about 400 ms |

- **Exits are shorter than entrances.** The user has already decided to
  leave; do not make them watch it.
- **Overshoot only on small elements.** A bouncing grid or screen feels
  unstable; a bouncing badge feels alive. Focus never overshoots.
- **Crossfades are asymmetric.** Fade the outgoing layer out quickly and bring
  the incoming one in slightly later and slower, so the two never sit at 50 %
  together as a muddy blend.
- **Move with intent.** Enter from the direction of navigation (the next page
  from the right, the old one leaving to the left) and keep distances short:
  60–90 px for screens, 6–24 px for cards.
- **Idle motion stays small.** Breathing glows and spinners should be slow
  (a second or more per cycle), low in contrast, and limited to small elements,
  so they never compete with focus or cost frame time.
- **One focus signal.** Combine a lift with a single highlight; do not also
  pulse, recolor, and scale the same element.
