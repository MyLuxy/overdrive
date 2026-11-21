// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {test} from 'node:test';
import {ClassError, createCompiler} from './compile.mjs';

const appDir = '/apps/demo';
const compiler = (config = {}, renderWidth = 1280, renderHeight = renderWidth * 9 / 16) =>
  createCompiler({config, renderWidth, renderHeight, appDir});

function style(classes, ...options) {
  const c = compiler(...options);
  const {base} = c.parse(classes);
  return c.finalize(base, base);
}

const cases = {
  spacing: [
    ['p-4', {padding: 16}], ['px-2.5', {paddingHorizontal: 10}], ['py-px', {paddingVertical: 1}],
    ['pt-1 pr-2 pb-3 pl-0.5', {paddingTop: 4, paddingRight: 8, paddingBottom: 12, paddingLeft: 2}],
    ['ps-1 pe-2', {paddingLeft: 4, paddingRight: 8}], ['m-96', {margin: 384}],
    ['-mt-4 -mx-px', {marginTop: -16, marginHorizontal: -1}], ['ms-2 -me-2', {marginLeft: 8, marginRight: -8}],
    ['m-[13px] p-[1.5rem]', {margin: 13, padding: 24}], ['-m-[3px]', {margin: -3}],
    ['gap-3 gap-x-[5px] gap-y-0', {gap: 12, columnGap: 5, rowGap: 0}],
  ],
  sizes: [
    ['w-64 h-1/2', {width: 256, height: '50%'}], ['w-full h-full', {width: '100%', height: '100%'}],
    ['w-2/3', {width: '66.666667%'}], ['w-[37%] h-[10rem]', {width: '37%', height: 160}],
    ['w-screen h-screen', {width: 1280, height: 720}], ['size-8', {width: 32, height: 32}],
    ['size-1/4', {width: '25%', height: '25%'}], ['min-w-4 min-h-screen', {minWidth: 16, minHeight: 720}],
    ['max-w-md max-h-[100px]', {maxWidth: 448, maxHeight: 100}], ['max-w-7xl', {maxWidth: 1280}],
    ['max-w-12', {maxWidth: 48}], ['basis-1/3', {flexBasis: '33.333333%'}], ['basis-8', {flexBasis: 32}],
  ],
  insets: [
    ['inset-0', {top: 0, right: 0, bottom: 0, left: 0}], ['inset-x-4', {left: 16, right: 16}],
    ['inset-y-1/2', {top: '50%', bottom: '50%'}], ['-top-2 left-full', {top: -8, left: '100%'}],
    ['-left-1/2 start-1 end-[7px]', {left: 4, right: 7}], ['-bottom-1/4', {bottom: '-25%'}],
    ['right-[12px]', {right: 12}],
  ],
  colors: [
    ['bg-sky-500', {backgroundColor: '#0ea5e9'}], ['text-white', {color: '#fff'}],
    ['bg-transparent', {backgroundColor: 'transparent'}], ['bg-black/50', {backgroundColor: '#00000080'}],
    ['bg-red-500/[0.25]', {backgroundColor: '#ef444440'}], ['bg-white/[10%]', {backgroundColor: '#ffffff1a'}],
    ['bg-[#123456]', {backgroundColor: '#123456'}], ['text-[#abc]/50', {color: '#aabbcc80'}],
    ['bg-[rgb(10,20,30)]/100', {backgroundColor: '#0a141eff'}], ['bg-[rgba(0,0,0,0.5)]/50', {backgroundColor: '#00000040'}],
    ['tint-emerald-400', {tintColor: '#34d399'}], ['caret-rose-600', {cursorColor: '#e11d48'}],
  ],
  borders: [
    ['border', {borderWidth: 1}], ['border-2 border-red-500', {borderWidth: 2, borderColor: '#ef4444'}],
    ['border-x-4', {borderLeftWidth: 4, borderRightWidth: 4}], ['border-y', {borderTopWidth: 1, borderBottomWidth: 1}],
    ['border-t-8 border-r-0', {borderTopWidth: 8, borderRightWidth: 0}],
    ['border-b-[3px] border-l-white/50', {borderBottomWidth: 3, borderLeftColor: '#ffffff80'}],
    ['border-x-teal-500', {borderLeftColor: '#14b8a6', borderRightColor: '#14b8a6'}],
    ['border-dashed', {borderStyle: 'dashed'}],
    ['rounded', {borderRadius: 4}], ['rounded-full', {borderRadius: 9999}], ['rounded-[10px]', {borderRadius: 10}],
    ['rounded-t-lg', {borderTopLeftRadius: 8, borderTopRightRadius: 8}],
    ['rounded-bl-xl rounded-r', {borderBottomLeftRadius: 12, borderTopRightRadius: 4, borderBottomRightRadius: 4}],
  ],
  text: [
    ['text-sm', {fontSize: 14, lineHeight: 20}], ['text-5xl', {fontSize: 48, lineHeight: 48}],
    ['text-[22px]', {fontSize: 22}], ['text-lg/7', {fontSize: 18, lineHeight: 28}],
    ['text-base/loose', {fontSize: 16, lineHeight: 32}], ['text-xl/[30px]', {fontSize: 20, lineHeight: 30}],
    ['text-2xl leading-none', {fontSize: 24, lineHeight: 24}], ['leading-none text-2xl', {fontSize: 24, lineHeight: 24}],
    ['text-5xl leading-7', {fontSize: 48, lineHeight: 28}], ['leading-7 text-5xl', {fontSize: 48, lineHeight: 28}],
    ['text-sm leading-[3px]', {fontSize: 14, lineHeight: 3}], ['text-sm leading-[1.5]', {fontSize: 14, lineHeight: 21}],
    ['text-xl tracking-wide', {fontSize: 20, lineHeight: 28, letterSpacing: 0.5}],
    ['text-xl -tracking-wider', {fontSize: 20, lineHeight: 28, letterSpacing: -1}],
    ['tracking-[2px]', {letterSpacing: 2}], ['text-xl tracking-[0.1em]', {fontSize: 20, lineHeight: 28, letterSpacing: 2}],
    ['text-xl tracking-wide tracking-[3px]', {fontSize: 20, lineHeight: 28, letterSpacing: 3}],
    ['text-center italic underline', {textAlign: 'center', fontStyle: 'italic', textDecorationLine: 'underline'}],
    ['text-end not-italic line-through', {textAlign: 'end', fontStyle: 'normal', textDecorationLine: 'line-through'}],
    ['font-thin', {fontWeight: 100}], ['font-black', {fontWeight: 900}], ['font-[550]', {fontWeight: 550}],
    ['font-[Inter]', {fontFamily: 'Inter'}],
    ['line-clamp-3', {numberOfLines: 3, ellipsizeMode: 'tail'}], ['truncate', {numberOfLines: 1, ellipsizeMode: 'tail'}],
    ['line-clamp-none text-clip', {numberOfLines: 0, ellipsizeMode: 'clip'}],
  ],
  transforms: [
    ['scale-50', {transform: [{scale: 0.5}]}], ['-scale-x-100', {transform: [{scaleX: -1}]}],
    ['scale-x-50 scale-y-[1.5]', {transform: [{scaleX: 0.5}, {scaleY: 1.5}]}],
    ['rotate-45', {transform: [{rotate: '45deg'}]}], ['-rotate-[0.5rad]', {transform: [{rotate: '-0.5rad'}]}],
    ['translate-x-4 -translate-y-[10px]', {transform: [{translateX: 16}, {translateY: -10}]}],
    ['scale-110 rotate-3 translate-x-1', {transform: [{translateX: 4}, {rotate: '3deg'}, {scale: 1.1}]}],
    ['origin-top-left', {transformOrigin: [0, 0]}], ['origin-bottom', {transformOrigin: [0.5, 1]}],
    ['transform-none', {transform: []}],
  ],
  layout: [
    ['flex flex-row flex-wrap', {display: 'flex', flexDirection: 'row', flexWrap: 'wrap'}],
    ['flex-col-reverse flex-nowrap', {flexDirection: 'column-reverse', flexWrap: 'nowrap'}],
    ['flex-1', {flex: 1}], ['flex-[2]', {flex: 2}], ['flex-auto', {flexGrow: 1, flexShrink: 1}],
    ['flex-initial', {flexGrow: 0, flexShrink: 1}], ['flex-none', {flexGrow: 0, flexShrink: 0}],
    ['grow shrink-0', {flexGrow: 1, flexShrink: 0}], ['flex-grow-0 flex-shrink', {flexGrow: 0, flexShrink: 1}],
    ['grow-[3]', {flexGrow: 3}],
    ['justify-between items-center self-end content-around',
      {justifyContent: 'space-between', alignItems: 'center', alignSelf: 'flex-end', alignContent: 'space-around'}],
    ['justify-evenly self-auto', {justifyContent: 'space-evenly', alignSelf: 'auto'}],
    ['absolute hidden overflow-hidden', {position: 'absolute', display: 'none', overflow: 'hidden'}],
    ['aspect-square', {aspectRatio: 1}], ['aspect-video', {aspectRatio: 16 / 9}], ['aspect-[4/3]', {aspectRatio: 4 / 3}],
    ['z-10', {zIndex: 10}], ['-z-50', {zIndex: -50}], ['z-[7]', {zIndex: 7}],
    ['opacity-0', {opacity: 0}], ['opacity-35', {opacity: 0.35}], ['opacity-[.8]', {opacity: 0.8}],
    ['object-cover', {resizeMode: 'cover'}], ['object-fill', {resizeMode: 'stretch'}],
    ['object-none', {resizeMode: 'center'}], ['pointer-events-none', {pointerEvents: 'none'}],
  ],
  gradients: [
    ['bg-gradient-to-r from-sky-500 to-indigo-500', {backgroundGradient: {type: 'linear', to: 'right',
      stops: [{color: '#0ea5e9', offset: 0}, {color: '#6366f1', offset: 1}]}}],
    ['bg-gradient-to-t from-black via-black/80 to-transparent', {backgroundGradient: {type: 'linear', to: 'top',
      stops: [{color: '#000', offset: 0}, {color: '#000000cc', offset: 0.5}, {color: 'transparent', offset: 1}]}}],
    ['bg-gradient-to-br from-[#123]', {backgroundGradient: {type: 'linear', to: 'bottom right',
      stops: [{color: '#123', offset: 0}, {color: '#11223300', offset: 1}]}}],
    ['bg-gradient-to-tl from-red-500 from-10% via-[35%] via-white to-75% to-blue-500/50', {backgroundGradient: {
      type: 'linear', to: 'top left', stops: [{color: '#ef4444', offset: 0.1}, {color: '#fff', offset: 0.35},
        {color: '#3b82f680', offset: 0.75}]}}],
    ['to-white from-black bg-gradient-to-l bg-gradient-to-b', {backgroundGradient: {type: 'linear', to: 'bottom',
      stops: [{color: '#000', offset: 0}, {color: '#fff', offset: 1}]}}],
  ],
  'later class wins': [
    ['p-4 p-2', {padding: 8}], ['bg-red-500 bg-blue-500', {backgroundColor: '#3b82f6'}],
    ['text-sm text-lg', {fontSize: 18, lineHeight: 28}], ['leading-7 text-xl leading-none', {fontSize: 20, lineHeight: 20}],
    ['rotate-45 rotate-90 scale-50', {transform: [{rotate: '90deg'}, {scale: 0.5}]}],
  ],
};

for (const [family, rows] of Object.entries(cases)) {
  test(`utilities: ${family}`, () => {
    for (const [classes, expected] of rows) assert.deepEqual(style(classes), expected, classes);
  });
}

test('scales logical pixels to the render width', () => {
  for (const [width, base, expected] of [
    [1280, undefined, {padding: 16, borderRadius: 8, fontSize: 14, lineHeight: 20, width: 1280}],
    [1920, undefined, {padding: 24, borderRadius: 12, fontSize: 21, lineHeight: 30, width: 1920}],
    [2560, undefined, {padding: 32, borderRadius: 16, fontSize: 28, lineHeight: 40, width: 2560}],
    [1920, 1920, {padding: 16, borderRadius: 8, fontSize: 14, lineHeight: 20, width: 1920}],
  ]) {
    assert.deepEqual(style('p-4 rounded-lg text-sm w-screen', {baseWidth: base}, width), expected, `${width}/${base}`);
  }
  assert.deepEqual(style('text-xl tracking-wider leading-none border', {}, 1920),
    {fontSize: 30, lineHeight: 30, letterSpacing: 1.5, borderWidth: 2});
  assert.deepEqual(style('tracking-[2px] w-1/2', {}, 1920), {letterSpacing: 3, width: '50%'});
});

test('theme overrides replace a scale; extend deep-merges into it', () => {
  const override = {theme: {colors: {brand: '#102030'}, spacing: {sm: 6}}};
  assert.deepEqual(style('bg-brand p-sm', override), {backgroundColor: '#102030', padding: 6});
  assert.throws(() => style('bg-red-500', override), ClassError);
  assert.throws(() => style('p-4', override), ClassError);

  const extend = {theme: {extend: {
    colors: {brand: {DEFAULT: '#ff0000', dark: '#550000'}, red: {1000: '#110000'}},
    spacing: {18: '4.5rem'}, fontSize: {huge: ['5rem', '1.1']}, borderRadius: {card: '20px'},
    fontFamily: {display: './fonts/Display-Bold.ttf', body: ['Inter', 'sans-serif']},
  }}};
  assert.deepEqual(style('bg-brand text-brand-dark border-red-1000 bg-red-500 p-18 rounded-card', extend),
    {backgroundColor: '#ef4444', color: '#550000', borderColor: '#110000', padding: 72, borderRadius: 20});
  assert.deepEqual(style('text-huge', extend), {fontSize: 80, lineHeight: 88});
  assert.deepEqual(style('font-body', extend), {fontFamily: 'Inter'});

  const c = compiler(extend);
  const {base, imports} = c.parse('font-display font-bold');
  assert.deepEqual(c.finalize(base, base), {fontFamily: 'Display-Bold', fontWeight: 700});
  assert.deepEqual(imports, [resolve(appDir, 'fonts/Display-Bold.ttf')]);
  assert.deepEqual(c.parse('p-1').imports, []);
  assert.throws(() => compiler({theme: {screens: {}}}), /unsupported theme key "screens"/);
});

test('variants group by prop set and compose with the base', () => {
  const c = compiler();
  const {base, variants} = c.parse(
    'scale-100 rotate-3 text-5xl leading-7 tracking-wide focused:scale-110 focused:bg-white ' +
    'selected:focused:text-sm disabled:opacity-50 focused:selected:border-[#f00]');
  assert.deepEqual(variants.map(v => v.props), [['focused'], ['focused', 'selected'], ['disabled']]);
  const [focused, both, disabled] = variants.map(v => c.finalize(v.fragment, base));
  assert.deepEqual(focused, {backgroundColor: '#fff', transform: [{rotate: '3deg'}, {scale: 1.1}]});
  assert.deepEqual(both, {fontSize: 14, lineHeight: 28, letterSpacing: 0.35, borderColor: '#f00'});
  assert.deepEqual(disabled, {opacity: 0.5});
  assert.deepEqual(c.finalize(base, base),
    {fontSize: 48, lineHeight: 28, letterSpacing: 1.2, transform: [{rotate: '3deg'}, {scale: 1}]});
  assert.deepEqual(c.parse('active:checked:pressed:p-1').variants[0].props, ['active', 'checked', 'pressed']);
});

test('gradient variants compose with the base stops and direction', () => {
  const c = compiler();
  const {base, variants} = c.parse('bg-gradient-to-r from-black to-white focused:from-sky-500 selected:bg-gradient-to-b');
  const [focused, selected] = variants.map(v => c.finalize(v.fragment, base));
  assert.deepEqual(focused.backgroundGradient,
    {type: 'linear', to: 'right', stops: [{color: '#0ea5e9', offset: 0}, {color: '#fff', offset: 1}]});
  assert.equal(selected.backgroundGradient.to, 'bottom');
});

test('rejected utilities and variants raise ClassError with guidance', () => {
  for (const [classes, message] of [
    ['shadow-lg', /shadows are disabled/], ['drop-shadow', /shadows are disabled/],
    ['space-x-4', /gap-x/], ['divide-y', /borders on the children/], ['grid-cols-3', /flexbox only/],
    ['block', /only flex/], ['fixed', /relative and absolute/], ['uppercase', /JavaScript/],
    ['ring-2', /border/], ['animate-wiggle', /ANIMATION.md/], ['bg-gradient-radial', /bg-gradient-to-/],
    ['bg-gradient-to-r', /needs a from-\* color/], ['from-red-500', /need a bg-gradient-to-\* direction/],
    ['bg-gradient-to-r from-red-500 via-[12px]', /percentages from 0% to 100%/], ['bg-none', /bg-gradient-to/],
    ['blur-sm', /filters/], ['bg-opacity-50', /bg-black\/50/], ['skew-x-3', /skew/],
    ['invisible', /opacity-0/], ['overflow-auto', /overflow-hidden/], ['items-baseline', /alignment/],
    ['order-1', /layout engine/], ['cursor-pointer', /browser-only/], ['w-auto', /default/],
    ['w-fit', /fixed size/], ['m-auto', /auto margins/], ['mx-auto', /self-center/],
    ['font-sans', /theme.fontFamily/], ['ml-1/2', /percentages only for width/],
    ['translate-x-1/2', /pixels only/], ['translate-x-[10%]', /pixels only/],
    ['focus-within:p-1', /focused:/], ['dark:p-1', /color-scheme/],
    ['first:p-1', /structural/], ['md:p-4', /responsive/], ['group-hover:p-1', /unknown variant "group-hover:"/],
    ['!p-4', /! modifier/], ['p-13', /unknown utility/], ['-p-4', /unknown utility/], ['bogus', /unknown utility/],
    ['bg-red-500/[2]', /unknown utility/], ['text-red', /unknown utility/], ['z-[1.5]', /unknown utility/],
    ['leading-none', /needs a text-\* size/], ['tracking-wide', /needs a text-\* size/],
  ]) {
    assert.throws(() => style(`p-1 ${classes}`), error => {
      assert.ok(error instanceof ClassError, `${classes}: ${error}`);
      assert.match(error.message, message, classes);
      return true;
    }, classes);
  }
  assert.throws(() => compiler().parse('p-1 focused:shadow-md'),
    {name: 'Error', token: 'focused:shadow-md', message: /^focused:shadow-md: shadows/});
});
