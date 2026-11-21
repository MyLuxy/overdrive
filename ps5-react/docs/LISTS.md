# Long lists

`VirtualList` renders a long list or grid inside a `ScrollView` while keeping
only the rows near the viewport and near focus mounted. Spacers stand in for the
rest, so the scroll range matches the list and focus scrolling works as it does
for ordinary content. `onEndReached` adds items as focus approaches the end
(infinite scroll) instead of a "Next page" control.

```jsx
import {useCallback, useState} from 'react';
import {ScrollView, VirtualList, View, Text} from '@ps5-react/core';

function Library({games, open}) {
  const [count, setCount] = useState(40);
  const renderItem = useCallback(({item}) => (
    <View onPress={() => open(item)} className="w-[150px] h-[200px] rounded-lg bg-slate-800 focused:bg-sky-700">
      <Text className="text-white">{item.title}</Text>
    </View>
  ), [open]);
  return (
    <ScrollView className="flex-1 px-8">
      <VirtualList data={games.slice(0, count)} keyExtractor={game => game.id} renderItem={renderItem}
        numColumns={5} itemHeight={200} rowGap={32} columnGap={40}
        onEndReached={() => setCount(n => n + 40)} />
    </ScrollView>
  );
}
```

## Why

The engine has a fixed node pool (`ERUI_MAX_NODES`, 4096 on the PS5), and its
layout coordinates are 16-bit: content more than 32767 render px tall wraps
around. A 611-game library at 1080p is about 125 rows and 53000 px of cards,
around 6000 nodes. Paging kept both in bounds by mounting 20 cards at a time.
`VirtualList` keeps them in bounds for any length:

- Mounted nodes are bounded by the window: on-screen rows, the focused row and
  its neighbours, and the overscan, about seven rows of a 1080p card grid.
- The content represents at most 24576 render px of rows at a time (the
  "span"). When the window nears an edge of the span that is not the list's
  own, the span re-centres: the spacer above the rows shrinks or grows, and the
  scroll offset and the focus rectangles move by the same amount in the same
  frame, so nothing moves on screen. The page around the list must fit in the
  remaining 8000 px. A re-centre does not call the `ScrollView`'s
  `onScrollTarget`: its offsets past the span are not page positions.

## Props

Lengths are logical px of a 1280-wide layout, like class names.

| Prop | Meaning |
| --- | --- |
| `data` | Items. Pass a new array to change them; appending keeps the mounted rows |
| `renderItem({item, index})` | The item's element. Keep it stable (`useCallback`): a new function re-renders every mounted row |
| `keyExtractor(item, index)` | Stable key per item |
| `itemHeight` | Fixed height of every row |
| `numColumns` | Items per row (default 1) |
| `rowGap`, `columnGap` | Space between rows and between items in a row |
| `overscan` | Rows mounted beyond the viewport in the direction of travel (default 2; one row behind) |
| `maxItemsPerFrame` | Items a row entering ahead of the scroll mounts per frame (default 1) |
| `initialNumRows` | Rows mounted before the first layout (default 2): the first whole, the rest one a frame |
| `onEndReached` | Called once per list length when the visible end is within `onEndReachedThreshold` viewports of the content end (default 1) |
| `recycle` | Reuse leaving rows for entering ones (same elements, new items) instead of unmounting and mounting |
| `style`, `className` | The list's own box |

`ref.current.focusIndex(index)` scrolls to any item, mounted or not, and focuses it once its row has
mounted and laid out (an A–Z jump, a "jump to" menu). It re-centres the represented span first when the
row is outside it and scrolls there at once rather than easing: an eased scroll passes every row on the
way, and a long jump passes more than a span holds. It gives up after two seconds without a focusable
element at that position. Until then it holds focus recovery off, so the focused row unmounting under
the jump does not send focus elsewhere (another page's tab), and D-pad presses report `blocked`. It
focuses the first focus node of the item, by position; it returns `false` before the list's first layout.

## How the window moves

1. **What must be mounted now** (`required`): rows overlapping the viewport of
   the enclosing `ScrollView`, plus the focused row and the rows above and
   below it. The viewport position is the scroll *target*, which focus sets
   before the scroll animates, so rows exist where the scroll is going; while
   the scroll is still on its way there, every row between where it is and the
   target is required too, so a held key never unmounts rows still on screen.
2. **What is worth mounting** (`desired`): `required` plus `overscan` rows in
   the direction of travel and one behind.
3. Each presented frame (`globalThis.__ps5ReactFrame`) does one step: each
   edge of the mounted range moves a row toward `desired`, and a row entering
   it starts with `maxItemsPerFrame` items; with the edges in place, the
   filling row nearest focus gets that many more. Rows fill as a prefix (left
   to right), so mounted items are always in their final place. Mounting a
   whole row of cards in one frame costs more JavaScript than a frame has; one
   card a frame does not, and a held key still leaves several frames per row.
   Rows in `required` that are missing or still filling (the first layout, a
   jump) mount whole at once while focus is in the list, so scrolling never
   shows an empty row. With focus elsewhere (typing a search, a page's first
   frames) they enter empty and fill a whole row a frame, top down, before any
   other step, so new data costs one row's mount per frame.
4. Each mounted row is a memoized component: a window step renders the
   entering row only, not every mounted card. A row that gains an item
   re-renders alone, without the list, and keeps the elements of the items it
   already shows, so React renders the new card only. Rendering the row's
   earlier cards again on each step added half again to the garbage a scroll leaves for
   QuickJS's collector.

Because the next row down already has laid-out rectangles when focus moves,
spatial navigation finds it, and the per-frame scroll stepping is unchanged. The
focused row is always required, so the focused element never unmounts while it
has focus. A list scrolled off screen keeps the rows at its nearer edge
mounted, so focus arriving from the content above or below finds them.

## Limits

- Rows have one fixed height. Measured, variable heights would shift the
  content under the scroll as rows measure, and the focus scroll would chase it.
- The list windows against its nearest `ScrollView`; it throws outside one.
- Mounting order follows the scroll, so elements mounted later get later
  document order. Focus tie-breaks and a scope's first element follow mount
  order, not item order.
- Unmounted items have no focus node: `focus(key)` and `nextFocus*` cannot
  reach an item outside the window; use `focusIndex` for that.
- A recycled row keeps its components' state: reset state that belongs to the
  item, or key the item's state by its id.
- Images in mounted overscan rows start loading before they scroll into view;
  items further away load when their row mounts.

## References

The design follows established virtualizers, adapted to focus-driven
scrolling and the engine's limits:

- TanStack Virtual: `overscan`, `lanes` for grids, and infinite loading driven
  by the last rendered row rather than a separate trigger.
- React Native `FlatList`/`VirtualizedList`: `onEndReached` and
  `onEndReachedThreshold` in viewport lengths, `initialNumToRender`, and
  incremental batches per frame (`maxToRenderPerBatch`).
- Shopify FlashList: recycling cells by re-rendering them with new items, and
  its caveat about component state in recycled cells.
- Android `RecyclerView` and `GapWorker`: prefetching the next rows in the
  direction of travel, and a scroll position that does not depend on the
  absolute size of the content.
- react-tv-space-navigation `SpatialNavigationVirtualizedList`/`Grid`: rendering
  around the focused index so the next focus target exists before the move,
  with `onEndReachedThresholdRowsNumber`.
