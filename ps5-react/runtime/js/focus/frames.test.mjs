// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {shownIn} from './frames.js';

const SCREEN = {x: 0, y: 0, width: 1280, height: 720};
const rect = (x, y, width = 240, height = 135) => ({x, y, width, height});
const frame = (viewport, x = 0, y = 0, parent = null) => ({parent, x, y, viewport});

test('an image outside a ScrollView shows when it overlaps the screen', () => {
  assert.equal(shownIn(rect(0, 0, 1280, 720), null, SCREEN), true);
  assert.equal(shownIn(rect(1270, 700), null, SCREEN), true);
  assert.equal(shownIn(rect(0, 720), null, SCREEN), false);
  assert.equal(shownIn(rect(0, 0, 0, 0), null, SCREEN), false);
  assert.equal(shownIn(null, null, SCREEN), false);
});

test('a horizontal row shows only the cards its scroll offset brings into its viewport', () => {
  const row = frame(rect(0, 500, 1280, 166), 512);
  const card = index => rect(48 + index * 256, 514);
  const shown = [0, 1, 2, 3, 4, 5, 6, 7].filter(index => shownIn(card(index), row, SCREEN));
  // Scrolled by 512, card 0 ends at -224 and card 7 starts at 1328.
  assert.deepEqual(shown, [1, 2, 3, 4, 5, 6]);
});

test('a row below a vertical ScrollView viewport is hidden even inside the screen', () => {
  const page = frame(rect(0, 100, 1280, 500));
  const row = frame(rect(0, 640, 1280, 166), 0, 0, page);
  assert.equal(shownIn(rect(48, 654), row, SCREEN), false);
  page.y = 200;
  assert.equal(shownIn(rect(48, 654), row, SCREEN), true);
});

test('image visibility follows the displayed scroll position during animation', () => {
  const row = {...frame(rect(0, 0, 1280, 720), 0, 2412), timer: 1, position: [0, 12]};
  assert.equal(shownIn(rect(48, 100), row, SCREEN), true);
  assert.equal(shownIn(rect(48, 100), {...row, timer: null}, SCREEN), false);
});

test('what an inner viewport clips away does not count against the outer one', () => {
  const page = frame(rect(0, 0, 640, 720));
  const row = frame(rect(700, 0, 580, 200), 0, 0, page);
  // 500-900 overlaps the page's 0-640 only in the part the row's 700-1280 already hides.
  assert.equal(shownIn(rect(500, 0, 400, 100), row, SCREEN), false);
  assert.equal(shownIn(rect(500, 0, 400, 100), page, SCREEN), true);
});
