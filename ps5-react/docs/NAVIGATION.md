# Navigation

Focus moves by itself, the way a browser or a TV platform moves it: mark what
is focusable, and the D-pad picks the nearest element in the pressed direction
from the elements' real positions on screen. Cross presses, Circle goes back.
Apps do not track focus indices.

```jsx
<FocusScope autoFocus>
  {games.map(game => (
    <View key={game.id} focusable onPress={() => open(game)}
      className="rounded-xl bg-slate-800 transition focused:bg-sky-700 focused:scale-105">
      <Text className="text-white">{game.title}</Text>
    </View>
  ))}
</FocusScope>
```

## Quick start

```jsx
import {useState} from 'react';
import {AppRegistry, View, Text, FocusScope} from '@ps5-react/core';

const items = ['Play', 'Settings', 'About'];

function Menu() {
  const [selected, setSelected] = useState(null);
  const clear = () => {
    setSelected(null);
    return true;
  };
  return (
    <FocusScope autoFocus wrap onBack={clear}>
      <View className="w-screen h-screen bg-slate-950 items-center justify-center gap-8">
        <View className="flex-row gap-4">
          {items.map(item => (
            <View key={item} onPress={() => setSelected(item)}
              className="w-56 h-24 rounded-xl border-4 border-slate-700 bg-slate-800
                items-center justify-center focused:border-sky-400 focused:scale-105">
              <Text className="text-xl text-white">{item}</Text>
            </View>
          ))}
        </View>
        <Text className="text-base text-sky-300">{selected ?? 'Nothing selected'}</Text>
      </View>
    </FocusScope>
  );
}

AppRegistry.registerComponent('menu', () => Menu);
```

1. Give each item `onPress` (or `focusable` when it does nothing on Cross).
2. Style the focused state with `focused:` classes, `whileFocus`, or a `style`
   function. The element's own focus drives them; there is no `focused` prop to pass.
3. Wrap the screen in `FocusScope autoFocus` so something has focus at start.
4. Handle Circle with `onBack`.

`npm run create` scaffolds this menu; `apps/starter`, `apps/tailwind-gallery`,
`apps/system-explorer`, and `apps/motion-lab` use the patterns below.

## Host input (input protocol v5)

The input protocol is versioned on its own; it is not the native API's ABI
version ([NATIVE-API.md](NATIVE-API.md#contract)).
`globalThis.__ps5ReactDispatch(action)` receives `up`, `down`, `left`, `right`
(the D-pad and the left stick, with the platform's hold-to-repeat), `confirm`,
`back`, and, since input protocol v3, `l1`, `r1`, `l2`, `r2`, `triangle`, `square`, and `options`
(one action per press, no repeat). For input protocol v1 compatibility the runtime also
delivers `previous` (after `up`/`left`) and `next` (after `down`/`right`) to
`useController` handlers only. Both hosts and input scripts take the names from
`native/shared/actions.hpp`.

Options (O on desktop) is an action like the buttons above; the PS button (Escape on
desktop) is how the user leaves. A media app uses Options for its settings, as the
system apps do.

Since input protocol v5, hosts also report the touchpad's first finger: `__ps5ReactTouch(x, y)`
with its position 0..1 across and down the pad each frame it touches, and `__ps5ReactTouch(null)`
once when it lifts (the PS5 reads the DualSense; the desktop, a controller's touchpad through SDL).
See [Touchpad](#touchpad).

The focus manager does not move on these buttons: they go to the enclosing
`FocusScope.onAction` handlers (tabs on L1/R1, a filter on Triangle, settings on Options)
and to `useController`.

Once per frame, after the pump and before the commit, hosts also call
`globalThis.__ps5ReactFrame(elapsedMs)` with the time the frame advances (on the
PS5 a whole number of 60 Hz vblanks). Focus scrolling steps there, so it moves on
every presented frame; a timer drifts against the display and skips or doubles
frames.

| Action | Desktop | PS5 |
| --- | --- | --- |
| `up`, `down`, `left`, `right` | Arrow keys (`up`/`down` also the mouse wheel) | D-pad, left stick |
| `confirm` | Enter, or a left click (it focuses the element under the pointer first) | Cross (X) |
| `back` | Backspace, right click | Circle |
| `l1`, `r1` | Q, E | L1, R1 |
| `l2`, `r2` | Z, C | L2, R2 (past half travel on the desktop) |
| `triangle`, `square` | T, F | Triangle, Square |
| `options` | O | Options (Start) |
| Exit (handled by the host) | Escape | (the PS button) |
| None: `touchpad` in `Controller.getState()` and [controller events](NATIVE-API.md#controller-events) only | P | Touchpad click |

The keys also hold their buttons in `Controller.getState()`, as a controller's
would. Z and C are L2 and R2 at full travel; with Shift down they are a light
press, 0.4 of the travel, short of the half-travel press, so a key held while
Shift goes down and up eases the trigger off and back in. On the desktop the
`l2` and `r2` actions fire as the travel crosses half, from a key or a
controller, and re-arm below a quarter.

## Touchpad

A finger sliding on the touchpad moves focus as the D-pad would, one step per stretch of travel:
about a ninth of the pad's width across, a fifth of its height down. A slow swipe walks card by card
and a long one runs further; going back over the ground steps back, like a dial. A swipe settles on
an axis after a short distance and keeps to it, and a tap moves nothing. Each step reaches
`useNavigationEvents` as a `move` or `blocked` event with `source: 'touchpad'`, so an app can tick
for swipes alone:

```js
useNavigationEvents(event => {
  if (event.type === 'move' && event.source === 'touchpad') Controller.vibrate(0.25, 25);
});
```

Pressing the touchpad stays the `touchpad` button of `useGamepad`.

## Focusable elements

`View`, `Image`, and `Pressable` from `@ps5-react/core` accept:

| Prop | Meaning |
| --- | --- |
| `focusable` | Takes part in D-pad navigation (`Pressable` and any element with `onPress` are focusable by default) |
| `onPress` | Called on Cross while focused |
| `onFocus`, `onBlur` | Focus changes |
| `autoFocus` | Takes focus when mounted if nothing in its scope has it |
| `focusKey` | Stable id for `focus(key)` and `nextFocus*` |
| `nextFocusUp`, `nextFocusDown`, `nextFocusLeft`, `nextFocusRight` | `focusKey` that overrides the spatial choice for that direction |
| `style` | May be a function `({focused, pressed}) => style` |

`pressed` is true for about 120 ms after Cross (for press feedback).
`Text` is not focusable; wrap it in a `View`.

```jsx
<View onPress={save}
  style={({focused, pressed}) => ({
    padding: 16,
    backgroundColor: pressed ? '#0369a1' : focused ? '#0ea5e9' : '#1e293b',
  })} />
```

## Spatial algorithm

Candidates are the focusable elements of the active scope whose rectangle lies
in the pressed direction from the focused one. The winner minimises
`primary distance + 2 × orthogonal offset` between the rectangles' nearest edges
(ties: the one with more overlap on the orthogonal axis, then document order).
Rectangles are the elements' laid-out screen rectangles (pre-transform), kept
up to date as layout and scrolling change. If nothing qualifies in the scope,
the search continues in the parent scope unless the scope traps. A `wrap`
scope first wraps within the same row or column; with nothing there, the search
continues outward as usual. When no scope has a candidate, focus stays where it
is.

An element inside a `ScrollView` that the focused element is not inside is a
candidate only while its rectangle overlaps that `ScrollView`'s viewport, at
least in part. Entering a scroll view from outside (Right from the last header
item, Down into a rail) therefore reaches only what it shows, never an item
scrolled out of view; moves inside a scroll view, including down a scrolling
page past its viewport, reach any of its elements as before. Nested scroll
views apply this per level.

Because rectangles are pre-transform, `focused:scale-105`, `whileFocus` lifts,
and animated translations never change where focus goes next. Let the layout
express the order you want, and use `nextFocus*` only for exceptions.

## `FocusScope`

| Prop | Meaning |
| --- | --- |
| `autoFocus` | Focus the scope's first (or remembered) element on mount |
| `trap` | Focus cannot leave the scope (modals, dialogs) |
| `wrap` | Moving past the last element in a direction wraps to the first in that row/column; with nothing in that row/column (Down from a tab row), focus leaves the scope as usual unless it traps |
| `row` | A horizontal row (a shelf of cards): Left and Right stop at its ends instead of moving into the rows around it (the move reports `blocked`). Entered for the first time it focuses its `selected` element, or else its first; after that, the one it had, as `restoreFocus` does |
| `restoreFocus` | Re-entering the scope focuses the element focused when it was left (default `true`) |
| `onBack` | Handles Circle while focus is inside; return `true` to consume |
| `onAction` | `(action) => boolean`: handles `l1`, `r1`, `l2`, `r2`, `triangle`, `square`, and `options` while focus is inside, innermost scope first; return `true` to consume |
| `focusKey` | Name for `focus(key)` on the scope (focuses its remembered element) |
| `inert` | Takes the scope's subtree out of navigation while true: no candidates, no `autoFocus`, no `focus(key)`; focus inside moves out after the commit |

Scopes nest. The active scope is the innermost scope containing the focused
element. Unmounting the focused element moves focus to the nearest focusable in
the same scope (or the scope's remembered/first element).

Use `inert` for a layer that stays mounted while hidden (`display: none`, or
covered by another screen). The engine stops laying out a hidden subtree, so its
elements keep their last rectangles and would otherwise remain reachable. Wrap
it in `ReleaseImages` too, so its images do not hold memory the visible screen
needs ([IMAGES.md](IMAGES.md)).

`FocusScope` renders no element of its own, so it does not affect layout.

## Hooks and modules

- `useFocusable({focusKey, onPress, autoFocus, ...})` → `{focused, pressed, focusProps}` for
  custom components; spread `focusProps` on a host element.
- `useFocus()` → `{focusedKey, focus(key), blur(), focusedRect()}`. `focusedRect()` is where the
  focused element is on screen, `{x, y, width, height}` in render pixels with the scrolling around
  it applied (transforms are not), or `null`: to place a menu or tooltip next to it.
- `useFocusActions()` → `{focus(key), blur(), focusedRect()}`, the same functions without
  `focusedKey`: it never re-renders its component.
- `useIsFocused()` inside a focusable subtree → boolean of the nearest focusable ancestor.
- `BackHandler.addEventListener('hardwareBackPress', fn)` → `{remove()}`; `fn`
  returning `true` consumes Circle. Order: each enclosing `FocusScope.onBack`,
  innermost first, until one returns `true`; then listeners (last added first).
  Unconsumed Circle does nothing. `BackHandler.exitApp()` is unchanged.
- `useController(handler)` keeps receiving every action (raw input for games).
- `useNavigationEvents(listener)` reports what the focus manager did with each
  input; see [Navigation events](#navigation-events).

`useFocus()` re-renders its component whenever the focused key changes; call it
in the component that needs `focusedKey`, not in every list item. A component that only
moves focus (an app root, a page) takes `useFocusActions()` instead: with `useFocus()`
every D-pad move would re-render it and everything it renders. `focus(key)`
returns whether something took focus, so it can be returned from `onBack`.

## Navigation events

`useNavigationEvents(listener)` calls `listener` after the focus manager has
handled each input, for feedback such as sounds ([NATIVE-API.md](NATIVE-API.md#sound)).
It never re-renders its component, so call it once near the root.

| Event | When |
| --- | --- |
| `{type: 'move', direction, source?}` | Focus moved (spatially, through `nextFocus*`, or onto the first element when nothing had focus); `source` is `'touchpad'` for a step of a swipe |
| `{type: 'blocked', direction, source?}` | Nothing to move to: an edge, a trap, a row's end, or no focusable element |
| `{type: 'press', handled}` | Cross on the focused element; `handled` when it is enabled and has `onPress` (no event without focus) |
| `{type: 'back', handled}` | Circle; `handled` when an `onBack` or `BackHandler` listener consumed it |
| `{type: 'action', action, handled}` | L1, R1, L2, R2, Triangle, Square or Options; `handled` when an `onAction` returned `true` |

Held directions repeat, so `move` arrives on every repeat. `FocusManager.move`
and `press` report the same outcomes (`true`/`false`, `null` for a press
without focus) to code that drives the manager directly.

## ScrollView

A `ScrollView` scrolls its focused descendant into view (minimal movement with a
margin) through the native scroll offset, stepped once per presented frame in whole
pixels: it speeds up over four frames to at most 40 logical px per frame and
brakes to stop exactly on the target, with no slow tail. A held key scrolls at that
steady speed, and a new target mid-scroll keeps the current speed. When focus
moves faster than that (a held key over tall rows) and the target gets more than
a third of the viewport ahead, the cap rises by a quarter of the excess, so the
screen follows focus instead of falling ever further behind.

```jsx
<ScrollView className="flex-1 gap-1">
  {entries.map(entry => (
    <View key={entry.path} onPress={() => open(entry)}
      className="px-3 py-1 rounded-md focused:bg-slate-700">
      <Text className="text-sm text-white">{entry.name}</Text>
    </View>
  ))}
</ScrollView>
```

Render the whole list and let the `ScrollView` follow focus instead of slicing
a window of rows around a focus index. Give it a bounded height (`flex-1` in a
sized parent, or an explicit `h-*`).

For lists of more than a few dozen items, or any list that loads more as it
scrolls, put a [`VirtualList`](LISTS.md) in the `ScrollView`: it mounts only
the rows near the viewport and near focus, and calls `onEndReached` near the end.

### Section anchors

Minimal movement reveals only the focused element: focusing a card in a
horizontal rail below a section title can leave the title cut off. Mark the
section with `scrollAnchor` (on a `View` or `Pressable`; keep it constant for
the element's lifetime) and a vertical `ScrollView` aligns the section's top to
the viewport top plus the margin instead, whichever element inside it takes focus:

```jsx
<ScrollView className="flex-1" onScrollTarget={({y}) => setHeaderHidden(y > heroHeight)}>
  <View scrollAnchor className="h-[420px]">…hero with a Play button…</View>
  {sections.map(section => (
    <View key={section.id} scrollAnchor className="pt-10 gap-4">
      <Text>{section.title}</Text>
      <ScrollView horizontal className="h-[260px]">…cards…</ScrollView>
    </View>
  ))}
</ScrollView>
```

- Each `ScrollView` uses the nearest `scrollAnchor` ancestor of the focused
  element that lies directly inside it (not inside a nested `ScrollView`). In
  the example, the horizontal rail still moves the least to show the card, and
  the page aligns the section.
- The offset is clamped to the content, so an anchor within the margin of the
  content's top (the hero) scrolls all the way back to 0.
- When the aligned offset would not show the focused element (an anchor taller
  than the viewport), the `ScrollView` falls back to minimal movement for it.
- Only the vertical axis of a vertical `ScrollView` aligns; horizontal
  `ScrollView`s and the x axis always move the least.
- An element can be its own anchor (`<View scrollAnchor focusable>`).

`onScrollTarget({x, y})` on a `ScrollView` reports the offset it scrolls to on
focus, once per new target when the scroll starts (and again if the content
shrank and the scroll settled short of it). Touch scrolling does not call it;
use `onScroll` for the live offset. Offsets are render pixels, like layout
rectangles.

## Tailwind and motion integration

- On an element that is focusable (`focusable`, `onPress`, or `Pressable`) and
  has no explicit `focused`/`pressed` prop, the `focused:` and `pressed:`
  variants read the element's own focus state: the compiler emits a `style`
  function instead of requiring the prop. An explicit `focused={...}` prop keeps
  today's behavior.
- `motion.*` elements that are focusable use their own focus state for
  `whileFocus` and `whilePress`; animation classes with `transition` work the same.

The compiler decides from the JSX attributes it sees: `focusable` or `onPress`
written on the element, or `Pressable` imported from `@ps5-react/core`. A
spread such as `{...focusProps}` does not count, so pass `focused` explicitly
there (see [custom components](#custom-focusable-components)).

Animated focus classes (`transition … focused:scale-105`) must not sit inside a
conditional class expression; choose between two complete elements instead.
See [TAILWIND.md](TAILWIND.md#focus-state).

## Recipes

### Grid

A grid needs nothing beyond focusable cells: Up and Down find the cell in the
neighbouring row from the real layout.

```jsx
<FocusScope autoFocus>
  <View className="flex-row flex-wrap gap-6 w-[1096px]">
    {apps.map(app => (
      <motion.View key={app.id} onPress={() => launch(app)}
        whileFocus={{y: -6, scale: 1.06}} transition={transitions.focus}
        className="w-[200px] h-[140px] rounded-2xl bg-slate-800 focused:bg-slate-700" />
    ))}
  </View>
</FocusScope>
```

When something outside the cell needs to know which one is focused (a gliding
halo, a details panel), mirror it from `onFocus`/`onBlur`. The state only
describes focus; it never moves it. `apps/motion-lab/pages/focus.jsx` places its
halo this way.

```jsx
const [current, setCurrent] = useState(-1);
// on each cell:
onFocus={() => setCurrent(index)} onBlur={() => setCurrent(-1)}
```

### List

A list is a column of focusable rows. Put long lists in a
[`ScrollView`](#scrollview). Add `wrap` to its scope to loop from the last row
back to the first.

### Tabs

Tabs are one scope and the page another. `wrap` loops Left and Right along the
tab row while Down still leaves it. Focusing a tab shows its page; Cross or Down
enters the page; Circle in the page returns to the tab row, which
restores the active tab because scopes remember their last element.

```jsx
function App() {
  const [page, setPage] = useState(0);
  const {focusedKey, focus} = useFocus();
  const inTabs = focusedKey?.startsWith('tab:') ?? true;
  const {Page} = PAGES[page];
  return (
    <View className="w-screen h-screen gap-6">
      <FocusScope focusKey="tabs" autoFocus wrap>
        <View className="flex-row gap-2">
          {PAGES.map(({label}, index) => (
            <View key={label} focusKey={`tab:${label}`} selected={index === page}
              onFocus={() => setPage(index)} onPress={() => focus('content')}
              className="px-5 py-2 rounded-full border-2 border-transparent
                selected:bg-slate-700 focused:border-sky-400">
              <Text className="text-white">{label}</Text>
            </View>
          ))}
        </View>
      </FocusScope>
      <FocusScope focusKey="content" onBack={() => focus('tabs')}>
        <Page key={page} />
      </FocusScope>
      <Text className="text-sm text-slate-400">
        {inTabs ? 'X / Down: enter the page' : 'Circle: back to tabs'}
      </Text>
    </View>
  );
}
```

`key={page}` remounts the page, so entering a new page starts at its first
element. `focusedKey` with a `tab:` prefix tells the app which region has focus
for hints and highlights, without an index.

### Tabs that keep their pages

Remounting rebuilds a whole page on every tab switch, tens of milliseconds of
React work on the PS5 for a page of posters. `Screens` keeps each page it has
shown mounted instead, and brings it back with its state, scroll and focus:

```jsx
import {Screen, Screens, useIsScreenActive} from '@ps5-react/core';

<Screens active={page} focusKey="content" onBack={() => focus('tabs')} preload>
  <Screen id={0}><HomePage /></Screen>
  <Screen id={1}><MoviesPage /></Screen>
  <Screen id={2}><SearchPage /></Screen>
</Screens>
```

Switching works like `AnimatePresence mode="wait"`: the page on stage leaves,
then the next one enters, with the `variants` labels `hidden`, `shown` and
`gone` (a short slide by default; ANIMATION.md, "Page transitions"). A page off
stage is `display: 'none'`, out of navigation (its `FocusScope` is `inert`),
holds no image cache entries (`ReleaseImages`), and does not re-render when the
component rendering `Screens` does; context changes still reach it. Pages
passed over while another one leaves are not mounted. `focusKey` and `onBack`
go to the scope of the page on stage, and a `Screen`'s own `onBack` wins.
`preload` mounts pages not shown yet, one at a time, after the stage has rested
for a second, so their first visit does not build them either.

Hidden pages keep their engine nodes and their timers. Pause polling, clocks
and ambient animation with `useIsScreenActive()`, which is false while the
page is off stage or leaving and true outside `Screens`.

### Modal

A modal traps focus and closes on Circle. When it unmounts, focus returns to the
element that had it before the modal opened, or the nearest one left in the
enclosing scope.

```jsx
{confirming && (
  <FocusScope trap autoFocus onBack={() => { setConfirming(false); return true; }}>
    <View className="absolute inset-0 bg-black/60 items-center justify-center">
      <View className="w-[520px] p-8 gap-6 rounded-2xl bg-slate-800">
        <Text className="text-xl text-white">Delete save data?</Text>
        <View className="flex-row gap-4">
          <View onPress={() => setConfirming(false)}
            className="px-6 py-3 rounded-xl bg-slate-700 focused:bg-slate-500">
            <Text className="text-white">Cancel</Text>
          </View>
          <View onPress={deleteSave}
            className="px-6 py-3 rounded-xl bg-slate-700 focused:bg-rose-600">
            <Text className="text-white">Delete</Text>
          </View>
        </View>
      </View>
    </View>
  </FocusScope>
)}
```

To send focus somewhere specific after closing, give that element a `focusKey`
and call `focus(key)`.

## Back handling

Circle goes to the enclosing scopes' `onBack`, innermost first, until one returns
`true`, then to `BackHandler` listeners, last added first. An unconsumed Circle
does nothing; it never exits the app.

A nested scope can handle Circle only in some states and let the rest bubble up.
The System Explorer Files page climbs folders and, at `/`, leaves Circle to the
page scope, which returns to the tabs:

```jsx
const up = () => {
  if (dir === '/') return false;
  open(parent(dir));
  return true;
};

<FocusScope onBack={up}>…</FocusScope>
```

Use `onBack` for behavior tied to a region of the screen (close the modal, leave
the page, go up a folder). Use a listener for screen-wide behavior that does not
depend on where focus is, or when nothing is focusable:

```jsx
useEffect(() => {
  const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
    if (!playing) return false;
    pause();
    return true;
  });
  return () => subscription.remove();
}, [playing]);
```

`BackHandler.exitApp()` quits explicitly; the PS button (Escape on desktop) leaves through the host.

## Custom focusable components

The simplest custom control is a focusable `View` whose children read its focus
with `useIsFocused()`. `Text` styles are not inherited, so this is also how a
label changes with focus:

```jsx
function Label({children}) {
  const focused = useIsFocused();
  return <Text focused={focused} className="text-sm text-slate-300 focused:text-white">{children}</Text>;
}

export function Button({label, onPress}) {
  return (
    <View onPress={onPress} className="px-5 py-2 rounded-full bg-slate-800 focused:bg-sky-700">
      <Label>{label}</Label>
    </View>
  );
}
```

When the component itself needs the state, use `useFocusable` and spread
`focusProps` on the element whose rectangle should be navigable. `focusProps`
already contains `focusable={false}`, so the `View` does not register a second
time; pass `focused` and `pressed` explicitly for the variants:

```jsx
import {View, Text, useFocusable} from '@ps5-react/core';

export function Toggle({label, on, onChange, focusKey}) {
  const {focused, pressed, focusProps} = useFocusable({focusKey, onPress: () => onChange(!on)});
  return (
    <View {...focusProps} focused={focused} pressed={pressed} selected={on}
      className="flex-row gap-3 px-4 py-2 rounded-xl bg-slate-800
        focused:bg-slate-700 pressed:scale-95 selected:border-2 selected:border-sky-400">
      <Text focused={focused} className="text-slate-300 focused:text-white">{label}</Text>
      <Text className="text-sky-300">{on ? 'On' : 'Off'}</Text>
    </View>
  );
}
```

`useIsFocused()` below an element that uses `useFocusable` does not see it;
pass `focused` down instead.

## Migrating from `useController`

| Before | After |
| --- | --- |
| `const [focus, setFocus] = useState(0)` plus `next`/`previous` arithmetic | `onPress` or `focusable` on each item inside a `FocusScope` |
| `focused={focus === i}` | nothing: `focused:` classes and `whileFocus` read the element's own state |
| `if (action === 'confirm') run(items[focus])` | `onPress={() => run(item)}` |
| `if (action === 'back') …` | `FocusScope onBack`, or `BackHandler.addEventListener` |
| `% length` wrapping | `FocusScope wrap` |
| A "zone" flag for tabs versus content | Two scopes and `focus('tabs')` / `focus('content')` |
| Slicing visible rows around the focus index | `ScrollView`, which follows focus; `VirtualList` for long lists |
| `focused` passed down to child `Text` | `useIsFocused()` in the child |
| A focus index needed for display | Mirror it with `onFocus`/`onBlur`, read-only |

A list screen before and after:

```jsx
// Before
const [focus, setFocus] = useState(0);
useController(action => {
  if (action === 'next') setFocus(i => (i + 1) % items.length);
  if (action === 'previous') setFocus(i => (i + items.length - 1) % items.length);
  if (action === 'confirm') open(items[focus]);
});
// …
<View focused={focus === i} className="… focused:bg-sky-700" />

// After
<FocusScope autoFocus wrap>
  {items.map(item => (
    <View key={item.id} onPress={() => open(item)} className="… focused:bg-sky-700" />
  ))}
</FocusScope>
```

Keep `useController` for raw input that is not navigation: a game loop, a
custom gesture, or a debug overlay. It receives every action alongside focus
navigation, so do not also move focus from it.

## Limits

- Only `View`, `Image`, `Pressable`, and their `motion.*` versions can be
  focusable. `Text` cannot.
- The search uses pre-transform rectangles; transforms never steer focus.
- `Text` does not follow its parent's focus automatically; use `useIsFocused()`.
- While `AnimatePresence` plays an exit, the leaving elements remain focusable
  until they unmount.
- There is no pointer, touch, or text-input focus, and the runtime draws no
  focus ring: the app styles the focused state.
- Focus is JavaScript state and resets when the preview restarts.
