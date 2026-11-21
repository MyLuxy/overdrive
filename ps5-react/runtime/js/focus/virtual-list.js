// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// A windowed list or grid inside a ScrollView: only the rows around the viewport and the focused
// element are mounted; spacers stand in for the rest. See docs/LISTS.md.
import {createElement, forwardRef, Fragment, memo, useContext, useImperativeHandle, useLayoutEffect, useReducer,
  useRef} from 'react';
import {View} from 'embedded-react';
import {onFrame} from '../frame.js';
import {FrameContext, manager} from './runtime.js';
import {nearEnd, rebase, recycleSlots, stepRange, windowRows} from './window.js';

// Layout coordinates are 16-bit (render px up to 32767), so the content represents at most this many
// px of rows; the rest of the page shares the remainder.
const SPAN_PX = 24576;
// Rows kept between the mounted rows and an edge of the represented span before it re-centres.
const REBASE_MARGIN = 2;
// Frames focusIndex waits for its target to mount and lay out before it gives up.
const FOCUS_WAIT_FRAMES = 120;

const same = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Whether `a` and `b` hold the same items in [first, end), as far as each reaches. */
function sameItems(a, b, first, end) {
  if (a === b) return true;
  if (Math.min(a.length, end) !== Math.min(b.length, end)) return false;
  for (let index = first; index < Math.min(a.length, end); index++) if (a[index] !== b[index]) return false;
  return true;
}

// A row re-renders only when its own items or sizes change, not on every window step: re-rendering
// every mounted card on each step cost more than mounting the new row. A filling row keeps the
// elements of the items it has, so React skips them: each step renders one new card, not the row's
// earlier cards again.
const Row = memo(function Row({row, count, data, columns, renderItem, keyExtractor, recycle, height, gap, columnGap}) {
  const cache = useRef([]).current;
  const first = row * columns;
  const end = Math.min(data.length, first + count);
  const items = [];
  for (let index = first; index < end; index++) {
    const item = data[index];
    const slot = index - first;
    let entry = cache[slot];
    if (!entry || entry.item !== item || entry.index !== index || entry.renderItem !== renderItem) {
      entry = cache[slot] = {item, index, renderItem, element: createElement(Fragment,
        {key: recycle ? slot : keyExtractor(item, index)}, renderItem({item, index}))};
    }
    items.push(entry.element);
  }
  cache.length = end - first;
  return createElement(View, {style: {flexDirection: 'row', height, columnGap, marginBottom: gap}}, items);
}, (a, b) => a.row === b.row && a.count === b.count && a.columns === b.columns && a.renderItem === b.renderItem
  && a.height === b.height && a.gap === b.gap && a.columnGap === b.columnGap
  && sameItems(a.data, b.data, a.row * a.columns, (a.row + 1) * a.columns));

/**
 * @typedef {{data: readonly any[], renderItem: (info: {item: any, index: number}) => import('react').ReactNode,
 *   keyExtractor: (item: any, index: number) => string, itemHeight: number, numColumns?: number,
 *   rowGap?: number, columnGap?: number, overscan?: number, maxItemsPerFrame?: number,
 *   initialNumRows?: number, onEndReached?: () => void, onEndReachedThreshold?: number,
 *   recycle?: boolean, style?: any, onLayout?: (event: object) => void}} VirtualListProps
 *   Lengths are logical px of a 1280-wide layout, like class names.
 */

/**
 * Renders the rows of `data` near the viewport of the enclosing ScrollView and near focus. Rows ahead
 * of the scroll mount over several frames, `maxItemsPerFrame` items at a time. While focus is outside
 * the list, rows on screen fill a whole row a frame from the top, so a list that mounts or gets new data
 * spreads its mount across frames. The ref's `focusIndex(index)` scrolls to any item, mounted or not,
 * and focuses it once it is laid out (an A–Z jump).
 * @param {VirtualListProps} props
 */
export const VirtualList = forwardRef(function VirtualList(props, ref) {
  const frame = useContext(FrameContext);
  if (!frame) throw new Error('VirtualList: place it inside a ScrollView, which it windows against');
  const {data, renderItem, keyExtractor, numColumns = 1, recycle = false} = props;
  const scale = screen.width / 1280;
  const height = Math.round(props.itemHeight * scale);
  const gap = Math.round((props.rowGap ?? 0) * scale);
  const stride = height + gap;
  const rows = Math.ceil(data.length / numColumns);
  const [, rerender] = useReducer(count => count + 1, 0);
  const self = useRef(null);
  if (!self.current) {
    // `range`: rows [first, end) mounted; `filling`: row → items mounted so far, for rows still filling;
    // `base`: the first row the content represents. The first row mounts with the list, the rest of
    // the initial rows fill one a frame after it, so new data costs one row's mount per frame.
    const initial = Math.min(rows, props.initialNumRows ?? 2);
    const list = {
      props, rows, stride, layout: null, range: [0, initial],
      filling: new Map(Array.from({length: Math.max(0, initial - 1)}, (_, i) => [i + 1, 0])),
      base: 0, scroll: 0, direction: 1, slots: new Map(), stepping: null, endFor: -1, required: null, desired: null,
      pending: null, unclaim: null,
      span: () => Math.max(1, Math.floor(SPAN_PX / list.stride)),
      /** The row of the focused element when it is in this list, else -1. */
      focusedRow() {
        const node = manager.focused;
        const rect = node?.frame === frame ? node.rect : null;
        if (!rect || !list.layout || rect.x < list.layout.x || rect.x >= list.layout.x + list.layout.width) return -1;
        const offset = rect.y - list.layout.y;
        return offset < 0 || offset >= list.layout.height ? -1 : list.base + Math.floor(offset / list.stride);
      },
      geometry() {
        const {viewport} = frame;
        return {rows: list.rows, stride: list.stride, top: list.layout.y - viewport.y - list.base * list.stride,
          scroll: frame.y, viewport: viewport.height};
      },
      /** Where the scroll is now: behind the target while it animates there. */
      position() {
        return frame.timer !== null ? frame.position[1] : frame.y;
      },
      update() {
        if (!list.layout || !frame.viewport) return;
        list.range = [Math.min(list.range[0], list.rows), Math.min(list.range[1], list.rows)];
        if (frame.y !== list.scroll) {
          list.direction = Math.sign(frame.y - list.scroll);
          list.scroll = frame.y;
        }
        const {overscan = 2, onEndReached, onEndReachedThreshold = 1} = list.props;
        // During a jump the target row stands in for focus, which is still on the row being left.
        const focusedRow = () => (list.pending ? list.pending.row : list.focusedRow());
        const window = () => windowRows({...list.geometry(), from: list.position(), focusedRow: focusedRow(),
          direction: list.direction, ahead: overscan, behind: 1});
        ({required: list.required, desired: list.desired} = window());
        const base = rebase(list.base, list.desired, list.rows, list.span(), REBASE_MARGIN);
        if (base !== list.base) {
          list.move(base);
          ({required: list.required, desired: list.desired} = window());
        }
        list.mountRequired();
        if ((!same(list.range, list.desired) || list.filling.size) && !list.stepping) list.stepping = onFrame(list.step);
        if (onEndReached && list.rows > 0 && list.endFor !== list.rows
          && nearEnd({...list.geometry(), threshold: onEndReachedThreshold})) {
          list.endFor = list.rows;
          onEndReached();
        }
      },
      /**
       * Re-centres the represented span on `base`. The mounted rows move up or down by the rows the
       * spacer above them lost or gained, and the scroll and the focus rectangles move with them, so
       * nothing moves on screen; the span's height, and so the content's, stays the same.
       */
      move(base) {
        const dy = (base - list.base) * list.stride;
        const {y, height} = list.layout;
        for (const node of manager.nodes) {
          if (node.frame === frame && node.rect && node.rect.y >= y && node.rect.y < y + height) {
            manager.setRect(node, {...node.rect, y: node.rect.y - dy});
          }
        }
        list.base = base;
        // Content above the list does not move: a view or a target up there keeps its offset.
        frame.shift(dy, frame.viewport ? y - frame.viewport.y : -Infinity);
        list.scroll = frame.y;
        rerender();
      },
      /**
       * Rows on screen or around focus that are missing or still filling (a first layout, a jump). With
       * focus in the list they mount whole now, so scrolling never shows an empty row; otherwise (typing
       * a search, a page's first frames) they enter empty and step fills them a row a frame.
       */
      mountRequired() {
        const [first, end] = list.required;
        const eager = list.focusedRow() >= 0;
        let changed = false;
        if (first < list.range[0] || end > list.range[1]) {
          list.setRange(stepRange(list.range, list.required, list.desired, 1), eager ? Infinity : 0);
          changed = true;
        }
        if (eager) for (let row = first; row < end; row++) changed = list.filling.delete(row) || changed;
        if (changed) rerender();
      },
      /**
       * Once a frame: the window's edges move a row toward `desired`, entering rows starting with
       * `maxItemsPerFrame` items; or, with the edges in place, the filling row nearest focus gets more.
       */
      /**
       * Scrolls to item `index` and focuses it when it is laid out: re-centres the represented span if
       * the row is outside it, scrolls there at once (an eased scroll would need every row on the way
       * mounted, more than a span holds on a long jump), which makes the row required so it mounts
       * whole, and checks each frame for the item's focus node. @returns {boolean} whether it started
       */
      focusIndex(index) {
        if (!list.layout || !frame.viewport || list.rows === 0) return false;
        const columns = list.props.numColumns ?? 1;
        const target = Math.max(0, Math.min(list.props.data.length - 1, Math.floor(index)));
        const row = Math.floor(target / columns);
        const base = rebase(list.base, [row, row + 1], list.rows, list.span(), REBASE_MARGIN);
        // The jump can unmount the focused row; focus waits for the target rather than recovering.
        list.unclaim?.();
        list.unclaim = manager.claimFocus(list);
        if (base !== list.base) list.move(base);
        list.pending = {row, column: target % columns, frames: 0};
        const {x, y, width} = list.layout;
        frame.reveal({x, y: y + (row - list.base) * list.stride, width, height: list.height}, null, {instant: true});
        list.update();
        if (!list.stepping) list.stepping = onFrame(list.step);
        list.focusPending();
        return true;
      },
      /** Focuses the pending item if its row has laid out; the item's first focus node, by position. */
      focusPending() {
        const {row, column} = list.pending;
        const columns = list.props.numColumns ?? 1;
        const {x, width} = list.layout;
        const top = list.layout.y + (row - list.base) * list.stride;
        const nodes = [];
        for (const node of manager.nodes) {
          const rect = node.frame === frame && !node.dead ? node.rect : null;
          if (rect && rect.y >= top && rect.y < top + list.stride && rect.x >= x && rect.x < x + width) nodes.push(node);
        }
        // Items left to right; within one item (nested focusables) the first one.
        nodes.sort((a, b) => a.rect.x - b.rect.x || a.rect.y - b.rect.y);
        const itemWidth = width / columns;
        const node = nodes.find(candidate => Math.floor((candidate.rect.x - x) / itemWidth) === column);
        if ((node && manager.focus(node)) || ++list.pending.frames > FOCUS_WAIT_FRAMES) list.endPending();
      },
      endPending() {
        list.pending = null;
        list.unclaim?.();
        list.unclaim = null;
      },
      step() {
        if (list.pending) list.focusPending();
        const columns = list.props.numColumns ?? 1;
        const batch = list.props.maxItemsPerFrame ?? 1;
        // Required rows still filling come first, whole and top down.
        const [first, end] = list.required;
        const urgent = [...list.filling.keys()].filter(row => row >= first && row < end);
        if (urgent.length) {
          list.filling.delete(Math.min(...urgent));
          rerender();
          return;
        }
        const next = stepRange(list.range, list.required, list.desired, 1);
        if (!same(next, list.range)) list.setRange(next, batch);
        else if (list.filling.size) {
          const middle = (list.required[0] + list.required[1]) / 2;
          const [row, count] = [...list.filling].reduce((a, b) => (Math.abs(b[0] - middle) < Math.abs(a[0] - middle) ? b : a));
          if (count + batch >= columns) list.filling.delete(row);
          else list.filling.set(row, count + batch);
        } else {
          if (!list.pending) list.stopStepping();
          return;
        }
        rerender();
      },
      /** Mounts `range`; rows entering it start with `count` items. */
      setRange(range, count) {
        const columns = list.props.numColumns ?? 1;
        for (const row of list.filling.keys()) if (row < range[0] || row >= range[1]) list.filling.delete(row);
        if (count < columns) {
          for (let row = range[0]; row < range[1]; row++) {
            if (row < list.range[0] || row >= list.range[1]) list.filling.set(row, count);
          }
        }
        list.range = range;
      },
      stopStepping() {
        list.stepping?.();
        list.stepping = null;
      },
      onLayout(event) {
        list.layout = event.layout;
        list.update();
        list.props.onLayout?.(event);
      },
    };
    self.current = list;
  }
  const list = self.current;
  Object.assign(list, {props, rows, stride, height});
  useImperativeHandle(ref, () => ({focusIndex: index => list.focusIndex(index)}), []);

  useLayoutEffect(() => {
    frame.listeners.add(list.update);
    const unsubscribe = manager.subscribe(list.update);
    return () => {
      frame.listeners.delete(list.update);
      unsubscribe();
      list.stopStepping();
      list.unclaim?.();
    };
  }, []);
  // New data or sizes move the window; a longer list may also call onEndReached again.
  useLayoutEffect(() => list.update(), [rows, stride]);

  const {base} = list;
  const spanEnd = Math.min(rows, base + list.span());
  const first = Math.max(base, Math.min(list.range[0], spanEnd));
  const end = Math.max(first, Math.min(list.range[1], spanEnd));
  if (recycle) list.slots = recycleSlots(list.slots, [first, end]);
  const columnGap = Math.round((props.columnGap ?? 0) * scale);
  const children = [];
  if (first > base) children.push(createElement(View, {key: 'before', style: {height: (first - base) * stride}}));
  for (let row = first; row < end; row++) {
    children.push(createElement(Row, {key: recycle ? list.slots.get(row) : row, row,
      count: list.filling.get(row) ?? numColumns, data, columns: numColumns, renderItem, keyExtractor, recycle, height,
      gap: row < rows - 1 ? gap : 0, columnGap}));
  }
  if (end < spanEnd) {
    const after = (spanEnd - end) * stride - (spanEnd === rows ? gap : 0);
    children.push(createElement(View, {key: 'after', style: {height: after}}));
  }
  return createElement(View, {style: props.style, onLayout: list.onLayout}, children);
});
