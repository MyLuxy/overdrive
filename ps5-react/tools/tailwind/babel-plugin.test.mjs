// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {createCompiler} from './compile.mjs';
import {transform} from './esbuild-plugin.mjs';

const root = resolve(fileURLToPath(import.meta.url), '../../..');
const er = process.env.PS5_REACT_ER ?? resolve(root, '.deps/embeddedReact');
const require = createRequire(resolve(er, 'bridges/quickjs/js/package.json'));
const babel = {core: require('@babel/core'), syntaxJsx: require('@babel/plugin-syntax-jsx').default};
const compiler = createCompiler({renderWidth: 1280, renderHeight: 720, appDir: '/app',
  config: {theme: {extend: {fontFamily: {inter: './Inter.ttf'}}}}});

const compile = source => transform(babel, compiler, source, '/app/index.jsx').replace(/\s+/g, ' ').trim();
const fails = (source, pattern) => assert.throws(() => compile(source), pattern);

test('static className becomes a style object', () => {
  assert.equal(compile('<View className="p-4 bg-white" />;'),
    '<View style={{ padding: 16, backgroundColor: "#fff" }} />;');
});

test('explicit style keeps precedence', () => {
  assert.equal(compile('<View style={s} className="p-4" />;'), '<View style={[{ padding: 16 }, s]} />;');
});

test('conditional and logical classes stay conditional', () => {
  assert.equal(compile('<View className={`p-2 ${on ? "bg-white" : "bg-black"}`} />;'),
    '<View style={[{ padding: 8 }, on ? { backgroundColor: "#fff" } : { backgroundColor: "#000" }]} />;');
  assert.equal(compile('<View className={on && "p-1"} />;'), '<View style={on ? { padding: 4 } : null} />;');
});

test('const identifiers resolve at build time', () => {
  assert.match(compile('const card = "p-1"; <View className={card} />;'), /style=\{\{ padding: 4 \}\}/);
});

test('variants read the same-named prop and compose transforms', () => {
  assert.equal(compile('<View focused={i === f} className="scale-100 translate-x-1 focused:scale-110" />;'),
    '<View focused={i === f} style={[{ transform: [{ translateX: 4 }, { scale: 1 }] }, ' +
    'i === f ? { transform: [{ translateX: 4 }, { scale: 1.1 }] } : null]} />;');
  fails('<View className="focused:p-1" />;', /needs a focused=\{\.\.\.\} prop/);
  assert.equal(compile('<View focused={on} className="hover:p-1 focus:m-1" />;'),
    '<View focused={on} style={on ? { padding: 4, margin: 4 } : null} />;');
  fails('<View focused={check()} className="focused:p-1" />;', /read twice/);
});

test('relative leading in a branch uses the static font size', () => {
  assert.match(compile('<Text className={`text-base ${a ? "leading-tight" : ""}`} />;'),
    /a \? \{ lineHeight: 20 \} : null/);
});

test('tw templates from @ps5-react/core compile to objects', () => {
  assert.match(compile('import {tw} from "@ps5-react/core"; const s = tw`m-1`;'), /const s = \{ margin: 4 \};/);
  assert.match(compile('const tw = x => x; const s = tw`m-1`;'), /tw`m-1`/);
});

test('font paths are imported for baking', () => {
  assert.match(compile('<Text className="font-inter" />;'), /^import "\/app\/Inter\.ttf";.*fontFamily: "Inter"/);
});

test('dynamic or partial classes are rejected with a location', () => {
  fails('<View className={cls} />;', /known at build time/);
  fails('<View className={`bg-${c}`} />;', /whole words/);
  assert.throws(() => compile('<View\n  className="p-4 shadow-lg" />;'),
    error => assert.deepEqual(error.loc, {line: 2, column: 17}) ?? true);
});

test('unknown classes suggest the closest valid utility', () => {
  fails('<View className="text-whit" />;', /did you mean text-white\?/);
  fails('<View className="qqqq-zzzz" />;', /unknown utility$/);
});

const core = 'import {View, Text as T} from "@ps5-react/core"; ';
const motionImport = 'import { motion as __ps5Motion } from "@ps5-react/core";';
const tween = 'transition={{ type: "tween", duration: 0.15, ease: [0.4, 0, 0.2, 1] }}';

test('animation classes turn core primitives into motion components', () => {
  assert.equal(compile(`${core}<T className="p-1 animate-in fade-in translate-y-1">a</T>; <View className="animate-spin" />;`),
    `${motionImport}import { View, Text as T } from "@ps5-react/core";<__ps5Motion.Text style={{ padding: 4 }} ` +
    `initial={{ y: 4, opacity: 0 }} animate={{ opacity: 1, y: 4 }} ${tween}>a</__ps5Motion.Text>;` +
    '<__ps5Motion.View initial={{ rotate: 0 }} animate={{ rotate: 360 }} transition={{ type: "tween", ' +
    'duration: 0.15, ease: [0.4, 0, 0.2, 1], rotate: { type: "tween", duration: 1, ease: "linear", repeat: 1 / 0 } }} />;');
  assert.match(compile(`${core}<View className="animate-out fade-out" />;`),
    /initial=\{false\} exit=\{\{ opacity: 0 \}\}/);
});

test('transition animates the opacity and transforms of variants and conditions', () => {
  assert.equal(compile(`${core}<View focused={f} className="transition bg-black scale-100 focused:scale-110 focused:bg-white" />;`),
    `${motionImport}import { View, Text as T } from "@ps5-react/core";<__ps5Motion.View focused={f} ` +
    'style={[{ backgroundColor: "#000" }, f ? { backgroundColor: "#fff" } : null]} initial={false} ' +
    `animate={f ? { scale: 1.1 } : { scale: 1 }} ${tween} />;`);
  assert.match(compile(`${core}<View pressed={p} focused={f} className="transition pressed:scale-95 focused:opacity-80 focused:scale-105" />;`),
    /animate=\{\{ opacity: 1, scale: 1, \.\.\.\(f \? \{ opacity: 0\.8, scale: 1\.05 \} : null\), \.\.\.\(p \? \{ scale: 0\.95 \} : null\) \}\}/);
  assert.match(compile(`${core}<View className={\`transition opacity-50 \${on ? "scale-110" : "scale-100"}\`} />;`),
    /View initial=\{false\} animate=\{\{ scale: 1, opacity: 0\.5, \.\.\.\(on \? \{ scale: 1\.1 \} : \{ scale: 1 \}\) \}\}/);
});

test('classes that animate nothing leave the element untouched', () => {
  assert.equal(compile(`${core}<View focused={f} className="transition duration-300 focused:bg-white" />;`),
    'import { View, Text as T } from "@ps5-react/core";<View focused={f} style={f ? { backgroundColor: "#fff" } : null} />;');
});

test('animation classes fail outside core primitives and static class lists', () => {
  fails('<View className="animate-spin" />;', /need View, Text or Image from @ps5-react\/core; .*motion\.create/);
  fails('import {View} from "./ui"; <View className="animate-spin" />;', /motion\.create/);
  fails(`${core}<View className={on && "animate-spin"} />;`, /must be static/);
  fails(`${core}<View animate={a} className="animate-spin" />;`, /animate prop conflicts/);
  fails('import {tw} from "@ps5-react/core"; tw`animate-spin`;', /need a JSX element/);
  assert.throws(() => compile(`${core}<View\n  className="p-1 fade-in" />;`),
    error => /add animate-in/.test(error.message) && assert.deepEqual(error.loc, {line: 2, column: 17}) === undefined);
});

test('focusable elements without the prop read focus state through a style function', () => {
  assert.equal(compile('<View focusable className="p-1 focused:bg-white pressed:bg-black" />;'),
    '<View focusable style={(_state) => [{ padding: 4 }, _state.focused ? { backgroundColor: "#fff" } : null, ' +
    '_state.pressed ? { backgroundColor: "#000" } : null]} />;');
  assert.equal(compile(`${core.replace('Text as T', 'Pressable')}<Pressable className="hover:p-1" />;`),
    'import { View, Pressable } from "@ps5-react/core";<Pressable style={(_state) => _state.focused ? { padding: 4 } : null} />;');
  assert.equal(compile('<View onPress={go} className="focus-visible:p-1" />;'),
    '<View onPress={go} style={(_state) => _state.focused ? { padding: 4 } : null} />;');
  assert.match(compile('const focused = 1; <View focusable className={`${focused ? "m-1" : ""} focused:p-1`} />;'),
    /style=\{\(_state\) => \[focused \? \{ margin: 4 \} : null, _state\.focused \? \{ padding: 4 \} : null\]\}/);
  fails('<View focusable={false} className="focused:p-1" />;', /or a focusable element/);
  fails('<View focusable className="selected:p-1" />;', /needs a selected=\{\.\.\.\} prop on this element$/);
});

test('an explicit focus prop keeps reading the prop', () => {
  assert.equal(compile('<View focusable focused={f} className="focused:p-1" />;'),
    '<View focusable focused={f} style={f ? { padding: 4 } : null} />;');
  assert.equal(compile('<View onPress={go} focused={f} className="focused:p-1 pressed:m-1" />;'),
    '<View onPress={go} focused={f} style={(_state) => [f ? { padding: 4 } : null, _state.pressed ? { margin: 4 } : null]} />;');
});

test('the explicit style stays last inside the style function', () => {
  assert.equal(compile('<View focusable style={{ margin: 1 }} className="focused:p-1" />;'),
    '<View focusable style={(_state) => [_state.focused ? { padding: 4 } : null, { margin: 1 }]} />;');
  assert.equal(compile('<View focusable style={s} className="p-1" />;'),
    '<View focusable style={(_state) => [{ padding: 4 }, typeof s === "function" ? s(_state) : s]} />;');
  assert.equal(compile('<View focusable style={({ focused }) => focused && a} className="focused:p-1" />;'),
    '<View focusable style={(_state) => [_state.focused ? { padding: 4 } : null, (({ focused }) => focused && a)(_state)]} />;');
  fails('<View focusable style={make()} className="focused:p-1" />;', /move the expression into a variable/);
});

test('focusable motion elements animate focus state with whileFocus and whilePress', () => {
  assert.equal(compile(`${core}<View focusable className="transition bg-black focused:scale-105 focused:bg-white pressed:opacity-80" />;`),
    `${motionImport}import { View, Text as T } from "@ps5-react/core";<__ps5Motion.View focusable ` +
    'style={(_state) => [{ backgroundColor: "#000" }, _state.focused ? { backgroundColor: "#fff" } : null]} initial={false} ' +
    `animate={{ scale: 1, opacity: 1 }} ${tween} whileFocus={{ scale: 1.05 }} whilePress={{ opacity: 0.8 }} />;`);
  assert.match(compile(`${core}<View onPress={go} selected={s} className="transition selected:scale-110 focused:scale-105" />;`),
    /initial=\{false\} animate=\{s \? \{ scale: 1\.1 \} : \{ scale: 1 \}\} .* whileFocus=\{\{ scale: 1\.05 \}\} \/>/);
  fails(`${core}<View focusable selected={s} className="transition focused:selected:scale-110" />;`,
    /need an explicit focused=\{\.\.\.\}/);
  fails(`${core}<View focusable whileFocus={w} className="transition focused:scale-105" />;`, /whileFocus prop conflicts/);
});
