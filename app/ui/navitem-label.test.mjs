import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateModule } from '../test-support/hooks.mjs';

let focused = false;
const jsx = (type, props, key) => ({ type, props, key });
const { NavContent } = evaluateModule(new URL('./NavItem.jsx', import.meta.url), {
  jsx, jsxs: jsx, memo: (fn) => fn, Fragment: 'fragment',
  useIsFocused: () => focused,
  FocusRing: 'ring', Icon: 'icon', Text: 'text', View: 'view',
  motion: { View: 'animated-label' },
  colors: { fg: '#fff' },
}, ['NavContent']);

const hasCaption = (props) => NavContent({ icon: 'star', focusLabel: 'Favorites', ...props })
  .props.children.some((child) => child?.type === 'animated-label');

test('active utility tabs keep the caption when focus moves into their pages', () => {
  focused = false;
  assert.equal(hasCaption({ current: true, suppressActiveLabel: false }), true);
  assert.equal(hasCaption({ current: false, suppressActiveLabel: false }), false);
  focused = true;
  assert.equal(hasCaption({ current: false, suppressActiveLabel: true }), true);
  assert.equal(hasCaption({ current: true, suppressActiveLabel: true }), true);
  focused = false;
  assert.equal(hasCaption({ current: true, suppressActiveLabel: true }), false,
    'another focused utility owns the only visible caption');
});
