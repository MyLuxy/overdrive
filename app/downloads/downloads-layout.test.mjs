import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateModule } from '../test-support/hooks.mjs';
const jsx = (type, props, key) => ({ type, props, key });
const flatten = (node, output = []) => {
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, output);
  } else if (node && typeof node === 'object') {
    output.push(node);
    flatten(node.props?.children, output);
  }
  return output;
};
test('Downloads sidebar is a fixed non-scrollable, non-focusable display', () => {
  const { SummaryPanel } = evaluateModule(new URL('./SummaryPanel.jsx', import.meta.url), {
    jsx, jsxs: jsx, View: 'View', Text: 'Text', ScrollView: 'ScrollView',
    useT: () => (key) => key,
    storageRoots: () => ['/data', '/usb0'],
  }, ['SummaryPanel']);
  const tree = SummaryPanel({ error: null });
  const nodes = flatten(tree);
  assert.equal(tree.type, 'View');
  assert.equal(tree.props.style.width, 420);
  assert.equal(nodes.some((n) => n.type === 'ScrollView'), false);
  assert.equal(nodes.some((n) => n.props?.focusable === true || n.props?.focusKey), false);
  assert.equal(nodes.some((n) => n.props?.children === 'downloads.panel.installing'), true);
  assert.equal(nodes.some((n) => n.props?.children === 'downloads.panel.installNote'), true);
});
test('rightmost download button stops horizontal controller navigation', () => {
  const { DeleteButton } = evaluateModule(new URL('./DownloadRow.jsx', import.meta.url), {
    jsx, jsxs: jsx, px: (n) => n, memo: (x) => x, useLocale: () => ({ rtl: false }), focusEnd: (_rtl, key) => ({ nextFocusRight: key }),
    useState: () => [false, () => {}], useEffect: () => {},
    Button2: 'Button2'
  }, ['DeleteButton']);
  const node = DeleteButton({ id: 'job-1', action: 'cancel', run() {}, onFocus() {} });
  assert.equal(node.props.focusKey, 'downloads-cancel:job-1');
  assert.equal(node.props.nextFocusRight, 'downloads-cancel:job-1');
  assert.notEqual(node.props.nextFocusRight, 'downloads:panel');
});
