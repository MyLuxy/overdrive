// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {screenRect} from './frames.js';
import {FocusManager} from './manager.js';

/** A manager whose recovery and press timers run when the test says so. */
function setup() {
  const queue = [];
  const timers = new Map();
  let nextTimer = 0;
  const focus = new FocusManager({
    schedule: fn => queue.push(fn),
    setTimer: (fn, ms) => { timers.set(++nextTimer, {fn, ms}); return nextTimer; },
    clearTimer: id => timers.delete(id),
  });
  const log = [];
  const flush = () => { while (queue.length) queue.shift()(); };
  const runTimers = () => {
    for (const [id, {fn}] of timers) {
      timers.delete(id);
      fn();
    }
  };
  /** Mounts a node at (x, y), 100×100. */
  const node = (key, x, y, scope = focus.root, props = {}) => {
    const created = focus.createNode(scope, null, {focusKey: key, onFocus: () => log.push(key), ...props});
    focus.register(created);
    focus.setRect(created, {x, y, width: 100, height: 100});
    return created;
  };
  const scope = (parent, props = {}) => focus.createScope(parent, props);
  const key = () => focus.focused?.props.focusKey ?? null;
  return {focus, node, scope, key, log, flush, runTimers, timers};
}

function grid({focus, node}, scope, prefix, originX = 0) {
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) node(`${prefix}${row}${column}`, originX + column * 120, row * 120, scope);
  }
  focus.mountScope(scope);
}

test('scope autoFocus takes the first element, and moves stay inside the grid', () => {
  const t = setup();
  const scope = t.scope(t.focus.root, {autoFocus: true});
  grid(t, scope, 'g');
  assert.equal(t.key(), 'g00');
  t.focus.move('right');
  t.focus.move('down');
  assert.equal(t.key(), 'g11');
  t.focus.move('up');
  t.focus.move('up');
  assert.equal(t.key(), 'g01');
});

test('move and press report what happened, for navigation feedback', () => {
  const t = setup();
  const scope = t.scope(t.focus.root, {autoFocus: true, trap: true});
  t.node('a', 0, 0, scope, {onPress: () => {}});
  t.node('b', 120, 0, scope, {onPress: () => {}, disabled: true});
  t.node('c', 240, 0, scope);
  t.focus.mountScope(scope);
  assert.equal(t.focus.move('left'), false);
  assert.equal(t.focus.press(), true);
  assert.equal(t.focus.move('right'), true);
  assert.equal(t.focus.press(), false);
  t.focus.move('right');
  assert.equal(t.focus.press(), false);
  t.focus.blur();
  assert.equal(t.focus.press(), null);
});

test('a move escapes to the parent scope unless the scope traps', () => {
  const t = setup();
  const left = t.scope(t.focus.root, {autoFocus: true});
  grid(t, left, 'a');
  const right = t.scope(t.focus.root);
  grid(t, right, 'b', 400);
  t.focus.focus('a02');
  t.focus.move('right');
  assert.equal(t.key(), 'b00');
  const modal = t.scope(t.focus.root, {trap: true});
  grid(t, modal, 'm', 800);
  t.focus.focus('m00');
  t.focus.move('left');
  assert.equal(t.key(), 'm00');
});

test('wrap returns to the start of the row', () => {
  const t = setup();
  const scope = t.scope(t.focus.root, {wrap: true});
  grid(t, scope, 'w');
  const outside = t.node('outside', 400, 0);
  t.focus.focus('w02');
  t.focus.move('right');
  assert.equal(t.key(), 'w00');
  assert.notEqual(t.focus.focused, outside);
});

test('wrap stays on its row; other directions escape unless the scope traps', () => {
  const t = setup();
  const tabs = t.scope(t.focus.root, {wrap: true});
  t.node('t0', 0, 0, tabs);
  t.node('t1', 120, 0, tabs);
  t.node('t2', 240, 0, tabs);
  t.focus.mountScope(tabs);
  const page = t.scope(t.focus.root);
  t.node('content', 0, 200, page);
  t.focus.focus('t2');
  t.focus.move('right');
  assert.equal(t.key(), 't0');
  t.focus.move('down');
  assert.equal(t.key(), 'content');

  tabs.props = {wrap: true, trap: true};
  t.focus.focus('t1');
  t.focus.move('down');
  assert.equal(t.key(), 't1');
  t.focus.move('left');
  t.focus.move('left');
  assert.equal(t.key(), 't2');
});

test('re-entering a scope restores its remembered element unless restoreFocus is false', () => {
  const t = setup();
  const list = t.scope(t.focus.root);
  grid(t, list, 'l');
  t.node('side', 400, 240);
  t.focus.focus('l22');
  t.focus.move('right');
  assert.equal(t.key(), 'side');
  t.focus.move('left');
  assert.equal(t.key(), 'l22');
  t.focus.focus('l00');
  t.focus.move('right');
  t.focus.move('right');
  t.focus.move('right');
  t.focus.move('left');
  assert.equal(t.key(), 'l02', 'restoreFocus off would land on the spatial winner l22');

  const fresh = setup();
  const plain = fresh.scope(fresh.focus.root, {restoreFocus: false});
  grid(fresh, plain, 'p');
  fresh.node('side', 400, 240);
  fresh.focus.focus('p00');
  fresh.focus.focus('side');
  fresh.focus.move('left');
  assert.equal(fresh.key(), 'p22');
});

test('nextFocus overrides the spatial choice', () => {
  const t = setup();
  t.node('a', 0, 0, t.focus.root, {nextFocusRight: 'c'});
  t.node('b', 120, 0);
  t.node('c', 240, 0);
  t.focus.focus('a');
  t.focus.move('right');
  assert.equal(t.key(), 'c');
});

test('autoFocus applies only when nothing in its scope has focus', () => {
  const t = setup();
  t.node('first', 0, 0, t.focus.root, {autoFocus: true});
  t.node('second', 120, 0, t.focus.root, {autoFocus: true});
  assert.equal(t.key(), 'first');
  const other = t.scope(t.focus.root);
  t.node('elsewhere', 0, 200, other, {autoFocus: true});
  assert.equal(t.key(), 'elsewhere');
});

test('unmounting the focused element focuses the nearest one in its scope', () => {
  const t = setup();
  const scope = t.scope(t.focus.root);
  grid(t, scope, 'g');
  t.focus.focus('g11');
  t.focus.unregister(t.focus.keys.get('g11'));
  assert.equal(t.focus.focused, null);
  t.flush();
  assert.ok(['g01', 'g10', 'g12', 'g21'].includes(t.key()));
});

test('a focus claim holds recovery and moves off until its owner focuses', () => {
  const t = setup();
  t.node('tab', 0, 0);
  const list = t.scope(t.focus.root);
  const leaving = t.node('leaving', 0, 200, list);
  t.focus.focus('leaving');
  const release = t.focus.claimFocus('jump');
  t.focus.unregister(leaving);
  t.flush();
  assert.equal(t.focus.focused, null, 'recovery waits for the claim');
  assert.equal(t.focus.move('down'), false, 'a move from nowhere does not take the first element');
  t.node('target', 0, 900, list);
  t.focus.focus('target');
  release();
  assert.equal(t.key(), 'target');
});

test('releasing a claim without focusing anything recovers as usual', () => {
  const t = setup();
  const list = t.scope(t.focus.root);
  t.node('neighbour', 0, 320, list);
  const leaving = t.node('leaving', 0, 200, list);
  t.focus.focus('leaving');
  const release = t.focus.claimFocus('jump');
  t.focus.unregister(leaving);
  t.flush();
  release();
  assert.equal(t.key(), 'neighbour');
});

test('closing a modal returns focus to where it came from', () => {
  const t = setup();
  t.node('open', 0, 0);
  t.node('other', 120, 0);
  t.focus.focus('open');
  const modal = t.scope(t.focus.root, {autoFocus: true, trap: true});
  const ok = t.node('ok', 500, 500, modal);
  const cancel = t.node('cancel', 620, 500, modal);
  t.focus.mountScope(modal);
  assert.equal(t.key(), 'ok');
  t.focus.unmountScope(modal);
  t.focus.unregister(ok);
  t.focus.unregister(cancel);
  t.flush();
  assert.equal(t.key(), 'open');
});

test('a page keeps where it returns to while a page opened over it comes and goes', () => {
  const t = setup();
  const browse = t.scope(t.focus.root);
  t.node('heart', 0, 0, browse);
  t.node('card', 0, 600, browse);
  t.focus.mountScope(browse);
  t.focus.focus('card');
  const detail = t.scope(t.focus.root, {autoFocus: true, trap: true});
  t.node('play', 0, 100, detail);
  t.node('similar', 0, 800, detail);
  t.focus.setProps(browse, {inert: true});
  t.focus.mountScope(detail);
  t.flush();
  assert.equal(t.key(), 'play');

  // The player over it, which focus reaches as it leaves the page gone inert, so closing it returns to
  // the page. Closed by unmounting (recovery has no previous focus) and by going inert.
  for (const close of ['unmount', 'inert']) {
    const player = t.scope(t.focus.root, {trap: true});
    const bar = t.node('bar', 0, 900, player);
    t.focus.setProps(detail, {inert: true});
    t.focus.mountScope(player);
    t.flush();
    assert.equal(t.key(), 'bar');
    t.focus.setProps(detail, {trap: true});
    if (close === 'unmount') {
      t.focus.unmountScope(player);
      t.focus.unregister(bar);
    } else t.focus.setProps(player, {inert: true});
    t.flush();
    assert.equal(t.key(), 'play', close);
  }

  t.focus.setProps(browse, {});
  t.focus.setProps(detail, {inert: true});
  t.flush();
  assert.equal(t.key(), 'card');
});

test('Circle bubbles through enclosing onBack handlers until one consumes it', () => {
  const t = setup();
  const calls = [];
  const outer = t.scope(t.focus.root, {onBack: () => { calls.push('outer'); return true; }});
  const inner = t.scope(outer, {onBack: () => { calls.push('inner'); return false; }});
  t.node('button', 0, 0, inner, {autoFocus: true});
  assert.equal(t.focus.back(), true);
  assert.deepEqual(calls, ['inner', 'outer']);
  calls.length = 0;
  inner.props = {onBack: () => { calls.push('inner'); return true; }};
  assert.equal(t.focus.back(), true);
  assert.deepEqual(calls, ['inner']);
  calls.length = 0;
  outer.props = {onBack: () => { calls.push('outer'); }};
  inner.props = {};
  assert.equal(t.focus.back(), false);
  assert.deepEqual(calls, ['outer']);
});

test('Cross presses for a while, then calls onPress', () => {
  const t = setup();
  const presses = [];
  const outer = t.scope(t.focus.root, {onBack: () => { presses.push('outer'); return true; }});
  const inner = t.scope(outer, {});
  t.node('button', 0, 0, inner, {onPress: () => presses.push('press'), autoFocus: true});
  t.focus.press();
  assert.equal(t.focus.focused.pressed, true);
  assert.equal([...t.timers.values()][0].ms, 120);
  t.runTimers();
  assert.equal(t.focus.focused.pressed, false);
  assert.equal(t.focus.back(), true);
  assert.deepEqual(presses, ['press', 'outer']);
});

test('focus by key reaches elements and scopes; listeners see each change', () => {
  const t = setup();
  const scope = t.scope(t.focus.root, {focusKey: 'menu'});
  t.node('m1', 0, 0, scope);
  t.node('m2', 0, 120, scope);
  t.focus.mountScope(scope);
  t.node('x', 400, 0);
  let changes = 0;
  t.focus.subscribe(() => changes++);
  t.focus.focus('m2');
  t.focus.focus('x');
  assert.equal(t.focus.focus('menu'), true);
  assert.equal(t.key(), 'm2');
  t.focus.blur();
  assert.equal(t.key(), null);
  assert.equal(changes, 4);
  assert.equal(t.focus.focus('missing'), false);
});

test('scrolled frames shift rectangles and are revealed innermost first', () => {
  const t = setup();
  const revealed = [];
  const outer = {parent: null, x: 0, y: 0, reveal: rect => revealed.push(['outer', rect.y])};
  const inner = {parent: outer, x: 0, y: 300, reveal: rect => revealed.push(['inner', rect.y])};
  const top = t.node('top', 0, 0);
  const node = t.focus.createNode(t.focus.root, inner, {focusKey: 'deep'});
  t.focus.register(node);
  t.focus.setRect(node, {x: 0, y: 400, width: 100, height: 100});
  assert.equal(screenRect(node).y, 100);
  t.focus.focus(top);
  t.focus.move('down');
  assert.equal(t.key(), 'deep');
  assert.deepEqual(revealed, [['inner', 400], ['outer', 100]]);
});

test('focusedRect is the focused element on screen, past the scrolling around it', () => {
  const t = setup();
  assert.equal(t.focus.focusedRect(), null);
  const frame = {parent: null, x: 40, y: 300, reveal: () => {}};
  const node = t.focus.createNode(t.focus.root, frame, {focusKey: 'card'});
  t.focus.register(node);
  t.focus.setRect(node, {x: 100, y: 500, width: 200, height: 120});
  t.focus.focus(node);
  assert.deepEqual(t.focus.focusedRect(), {x: 60, y: 200, width: 200, height: 120});
});

test('a row keeps Left and Right inside, starts at its first element, and comes back where it was', () => {
  const t = setup();
  const top = t.scope(t.focus.root, {row: true});
  const below = t.scope(t.focus.root, {row: true});
  for (let i = 0; i < 4; i++) t.node(`a${i}`, i * 120, 0, top);
  // The row below sits further right, so a plain scope would let Right step down into it.
  for (let i = 0; i < 4; i++) t.node(`b${i}`, 240 + i * 120, 120, below);
  t.focus.mountScope(top);
  t.focus.mountScope(below);
  t.focus.focus(t.focus.firstOf(top));
  for (let i = 0; i < 3; i++) t.focus.move('right');
  assert.equal(t.key(), 'a3');
  assert.equal(t.focus.move('right'), false);
  assert.equal(t.key(), 'a3');
  t.focus.move('down');
  assert.equal(t.key(), 'b0', 'entered for the first time: its first element, not the nearest');
  t.focus.move('right');
  t.focus.move('up');
  assert.equal(t.key(), 'a3', 'back where the row was left');
  t.focus.move('down');
  assert.equal(t.key(), 'b1');
});

test('a row entered for the first time starts at its selected element', () => {
  const t = setup();
  const top = t.scope(t.focus.root);
  t.node('above', 0, 0, top);
  const pills = t.scope(t.focus.root, {row: true});
  for (let i = 0; i < 4; i++) t.node(`p${i}`, i * 120, 120, pills, i === 2 ? {selected: true} : {});
  t.focus.mountScope(top);
  t.focus.mountScope(pills);
  t.focus.focus(t.focus.firstOf(top));
  t.focus.move('down');
  assert.equal(t.key(), 'p2');
});

test('an inert scope is out of navigation; a move with nothing visible stays put', () => {
  const t = setup();
  const browse = t.scope(t.focus.root, {inert: true});
  t.node('hidden', 0, 800, browse, {autoFocus: true});
  t.focus.mountScope(browse);
  assert.equal(t.key(), null);
  const game = t.scope(t.focus.root, {autoFocus: true});
  t.node('top', 0, 0, game);
  t.node('last', 0, 200, game);
  t.focus.mountScope(game);
  t.focus.focus('last');
  t.focus.move('down');
  assert.equal(t.key(), 'last');
  assert.equal(t.focus.focus('hidden'), false);
  browse.props = {};
  t.focus.move('down');
  assert.equal(t.key(), 'hidden');
});

test('a scope that becomes inert hands focus back once the commit settles', () => {
  const t = setup();
  t.node('header', 0, 0);
  const page = t.scope(t.focus.root);
  t.node('card', 0, 300, page);
  t.node('other', 120, 300, page);
  t.focus.mountScope(page);
  t.focus.focus('header');
  t.focus.focus('card');
  t.focus.setProps(page, {inert: true});
  assert.equal(t.key(), 'card');
  t.flush();
  assert.equal(t.key(), 'header');

  t.focus.setProps(page, {});
  t.focus.focus('card');
  const screen = t.scope(t.focus.root, {autoFocus: true});
  t.node('play', 0, 600, screen);
  t.focus.setProps(page, {inert: true});
  t.focus.mountScope(screen);
  t.flush();
  assert.equal(t.key(), 'play', 'a screen that took focus in the same commit keeps it');
});

test('shoulder and face buttons bubble through enclosing onAction handlers', () => {
  const t = setup();
  const calls = [];
  const outer = t.scope(t.focus.root, {onAction: action => { calls.push(`outer:${action}`); return action === 'r1'; }});
  const inner = t.scope(outer, {onAction: action => { calls.push(`inner:${action}`); return action === 'l1'; }});
  assert.equal(t.focus.action('l1'), false);
  t.node('button', 0, 0, inner, {autoFocus: true});
  assert.equal(t.focus.action('l1'), true);
  assert.equal(t.focus.action('r1'), true);
  assert.equal(t.focus.action('triangle'), false);
  assert.deepEqual(calls, ['inner:l1', 'inner:r1', 'outer:r1', 'inner:triangle', 'outer:triangle']);
  assert.equal(t.key(), 'button');
});

test('each frame reveals with the nearest scrollAnchor ancestor that it contains directly', () => {
  const t = setup();
  const revealed = [];
  const outer = {parent: null, x: 0, y: 0, reveal: (rect, anchor) => revealed.push(['outer', anchor?.y])};
  const rail = {parent: outer, x: 0, y: 0, reveal: (rect, anchor) => revealed.push(['rail', anchor?.y])};
  const page = {parent: null, frame: null, rect: {x: 0, y: 0, width: 1000, height: 5000}};
  const section = {parent: page, frame: outer, rect: {x: 0, y: 600, width: 1000, height: 300}};
  const card = t.focus.createNode(t.focus.root, rail, {focusKey: 'card'}, section);
  t.focus.register(card);
  t.focus.setRect(card, {x: 0, y: 650, width: 100, height: 100});
  t.focus.focus('card');
  assert.deepEqual(revealed, [['rail', undefined], ['outer', 600]]);
});

test('entering a ScrollView from outside reaches only items it shows, moves inside reach any', () => {
  const t = setup();
  const page = {parent: null, x: 0, y: 0, viewport: {x: 0, y: 200, width: 1000, height: 400}, reveal: () => {}};
  const rail = {parent: page, x: 0, y: 0, viewport: {x: 0, y: 200, width: 500, height: 100}, reveal: () => {}};
  const inFrame = (key, frame, x, y) => {
    const node = t.focus.createNode(t.focus.root, frame, {focusKey: key});
    t.focus.register(node);
    t.focus.setRect(node, {x, y, width: 100, height: 100});
  };
  t.node('header-end', 400, 0);
  inFrame('hidden', rail, 600, 200);
  inFrame('below', page, 0, 700);
  inFrame('deep', page, 0, 300);
  t.focus.focus('header-end');
  t.focus.move('right');
  assert.equal(t.key(), 'header-end');
  inFrame('partly', rail, 450, 200);
  t.focus.move('right');
  assert.equal(t.key(), 'partly');
  t.focus.move('right');
  assert.equal(t.key(), 'hidden');
  // Inside the page, the item below its viewport stays reachable: the normal way down a page.
  t.focus.focus('deep');
  t.focus.move('down');
  assert.equal(t.key(), 'below');
});
