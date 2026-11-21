// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createElement} from 'react';
import {unwrapText} from './inspect-text.js';

test('nested wrapped Text comes back as the engine Text, so the line stays inline spans', () => {
  const Wrapper = () => null;
  const inner = createElement(Wrapper, {style: {color: 'gray'}}, ' · ', createElement(Wrapper, null, 'RPG'));
  const [plain, nested] = unwrapText(['Larian Studios', inner], 'Text', Wrapper);
  assert.equal(plain, 'Larian Studios');
  assert.equal(nested.type, 'Text');
  assert.deepEqual(nested.props.style, {color: 'gray'});
  const [dot, deepest] = nested.props.children;
  assert.equal(dot, ' · ');
  assert.equal(deepest.type, 'Text');
  assert.deepEqual(deepest.props.children, ['RPG']);
});
