// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Variant labels, rendered: motion.* bundled against a stand-in engine and rendered by react-reconciler,
// counting the motion elements each commit renders.
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const er = process.env.PS5_REACT_ER ?? resolve(here, '../../../.deps/embeddedReact');
const modules = resolve(er, 'bridges/quickjs/js/node_modules');
const esbuild = createRequire(resolve(modules, 'x.js'))('esbuild');

// Animations finish at once and remember where they went.
const ENGINE = `
class Value {
  constructor(value) { this.value = value; this._handle = 1; }
  setValue(value) { this.value = value; }
  __getValue() { return this.value; }
  destroy() {}
}
const run = (value, {toValue}) => ({start(done) { value.value = toValue; done({finished: true}); }, stop() {}});
export const Animated = {Value, timing: run, spring: run};
export const View = 'View', Text = 'Text', Image = 'Image';
`;

const ENTRY = `
import {createElement, useState} from 'react';
import Reconciler from 'react-reconciler';
import {motion} from './index.js';
export {createElement, useState, Reconciler, motion};
`;

async function load() {
  const result = await esbuild.build({
    stdin: {contents: ENTRY, resolveDir: here, loader: 'js'},
    bundle: true, write: false, format: 'esm', platform: 'node', nodePaths: [modules],
    define: {'process.env.NODE_ENV': '"production"'}, logLevel: 'silent',
    // One React for the runtime and the reconciler: the bridge's, which the app bundle uses too.
    alias: {react: resolve(modules, 'react')},
    plugins: [{
      name: 'engine',
      setup(build) {
        build.onResolve({filter: /^embedded-react$/}, () => ({path: 'engine', namespace: 'engine'}));
        build.onLoad({filter: /.*/, namespace: 'engine'}, () => ({contents: ENGINE, loader: 'js'}));
      },
    }],
  });
  globalThis.screen ??= {width: 1280, height: 720};
  const file = join(mkdtempSync(join(tmpdir(), 'motion-labels-')), 'bundle.mjs');
  writeFileSync(file, result.outputFiles[0].text);
  return import(file);
}

/** A legacy root (as the bridge uses) with a DevTools hook that counts rendered motion elements. */
function renderer({Reconciler}) {
  const commits = [];
  globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, isDisabled: false, renderers: new Map(), inject: () => 1, checkDCE() {},
    onScheduleFiberRoot() {}, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
    onCommitFiberRoot(id, root) {
      let motion = 0;
      const stack = [root.current];
      while (stack.length) {
        const fiber = stack.pop();
        const type = fiber.elementType;
        if (fiber.flags & 1 && type?.displayName?.startsWith('motion(')) motion++;
        if (fiber.subtreeFlags & 1 || !fiber.alternate) for (let c = fiber.child; c; c = c.sibling) stack.push(c);
      }
      commits.push(motion);
    },
  };
  const nodes = new Map();
  const reconciler = Reconciler({
    supportsMutation: true, isPrimaryRenderer: true, noTimeout: -1, supportsMicrotasks: true,
    scheduleMicrotask: queueMicrotask, scheduleTimeout: setTimeout, cancelTimeout: clearTimeout,
    createInstance(type, props) {
      const node = {type, props};
      if (props.nativeID) nodes.set(props.nativeID, node);
      return node;
    },
    createTextInstance: text => ({text}), appendInitialChild() {}, appendChild() {}, appendChildToContainer() {},
    insertBefore() {}, insertInContainerBefore() {}, removeChild() {}, removeChildFromContainer() {},
    finalizeInitialChildren: () => false, prepareUpdate: () => true,
    commitUpdate(node, payload, type, previous, next) { node.props = next; },
    commitTextUpdate() {}, resetTextContent() {}, shouldSetTextContent: () => false,
    getRootHostContext: () => ({}), getChildHostContext: context => context, getPublicInstance: node => node,
    prepareForCommit: () => null, resetAfterCommit() {}, preparePortalMount() {}, clearContainer() {},
    getCurrentEventPriority: () => 16, getInstanceFromNode: () => null, beforeActiveInstanceBlur() {},
    afterActiveInstanceBlur() {}, prepareScopeUpdate() {}, getInstanceFromScope: () => null, detachDeletedInstance() {},
  });
  reconciler.injectIntoDevTools({bundleType: 0, version: '18.3.1', rendererPackageName: 'test'});
  const root = reconciler.createContainer({}, 0, null, false, null, '', console.error, null);
  return {
    commits, nodes,
    render(element) {
      reconciler.updateContainer(element, root, null, null);
      reconciler.flushPassiveEffects();
    },
    // Animations start in a microtask after the commit (motion.js applyAfterCommit).
    async flush() {
      reconciler.flushPassiveEffects();
      await Promise.resolve();
    },
  };
}

const opacity = node => {
  const value = [node.props.style].flat(Infinity).find(part => part?.opacity !== undefined)?.opacity;
  return typeof value === 'object' ? value.__getValue() : value;
};

test('a label change re-renders only the motion elements that use the labels', async () => {
  const lib = await load();
  const {createElement: h, useState, motion} = lib;
  const view = renderer(lib);
  const fade = {a: {opacity: 0.25}, b: {opacity: 0.75}};
  let setLabel;
  function Root({children}) {
    const [label, set] = useState('a');
    setLabel = set;
    return h(motion.View, {variants: {a: {x: 0}, b: {x: 10}}, animate: label}, children);
  }
  // Built once, so only context can make them render again.
  const children = [
    h(motion.View, {key: 'follows', nativeID: 'follows', variants: fade}),
    h(motion.View, {key: 'through'}, h(motion.View, {nativeID: 'nested', variants: fade})),
    ...Array.from({length: 10}, (_, i) => h(motion.View, {key: `own${i}`, animate: {x: i}})),
    ...Array.from({length: 10}, (_, i) => h(motion.View, {key: `focus${i}`, whileFocus: {y: -4}})),
  ];
  view.render(h(Root, null, children));
  assert.equal(opacity(view.nodes.get('follows')), 0.25);
  assert.equal(opacity(view.nodes.get('nested')), 0.25);

  view.commits.length = 0;
  setLabel('b');
  await view.flush();
  assert.equal(opacity(view.nodes.get('follows')), 0.75);
  assert.equal(opacity(view.nodes.get('nested')), 0.75, 'labels pass through an element without variants');
  const rendered = view.commits.reduce((sum, count) => sum + count, 0);
  assert.equal(rendered, 3, `the parent and the two elements with variants render, not the other ${23 - 3}`);
});
