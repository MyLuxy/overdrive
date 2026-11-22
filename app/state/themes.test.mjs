import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const themes = await import('./themes.js');

const KEYS = Object.keys(themes.BASE_COLORS);

test('the default theme carries the full base palette and no wallpaper', () => {
  const base = themes.DEFAULT_THEME;
  assert.equal(base.id, 'builtin:default');
  assert.ok(base.builtin);
  assert.equal(Object.keys(base.colors).sort().join(','), [...KEYS].sort().join(','));
  for (const value of Object.values(base.colors)) assert.match(value, /^#[0-9a-f]{6}$/);
  assert.equal(base.background, '');
  assert.ok(base.backgroundDim >= 0 && base.backgroundDim <= 1);
});

test('listThemes starts with the default and appends user themes', () => {
  const listed = themes.listThemes();
  assert.equal(listed[0].id, 'builtin:default');
  for (const theme of listed.slice(1)) {
    assert.ok(theme.id.startsWith('user:'));
    assert.ok(!theme.builtin);
  }
});

test('normalizeTheme fills missing and invalid keys from the base palette', () => {
  const palette = themes.normalizeTheme({colors: {canvas: '#0f1122', surface: 'zzz', fg: '#abc'}});
  assert.equal(palette.canvas, '#0f1122');
  assert.equal(palette.surface, themes.BASE_COLORS.surface);
  assert.equal(palette.fg, '#aabbcc');
  for (const key of KEYS) assert.match(palette[key], /^#[0-9a-f]{6,8}$/);
});

test('normalizeTheme keeps alpha colors and rejects junk records', () => {
  const palette = themes.normalizeTheme({colors: {warn: '#fde68acc'}});
  assert.equal(palette.warn, '#fde68acc');
  assert.deepEqual(themes.normalizeTheme(null), themes.BASE_COLORS);
  assert.deepEqual(themes.normalizeTheme({colors: []}), themes.BASE_COLORS);
});

test('safeBackdrop passes http urls and bare image filenames, rejects traversal', () => {
  assert.equal(themes.safeBackdrop('https://example.com/wall.png'), 'https://example.com/wall.png');
  assert.equal(themes.safeBackdrop('http://cdn.example.net/x.jpg?q=1', '/data/overdrive/themes'), 'http://cdn.example.net/x.jpg?q=1');
  assert.equal(themes.safeBackdrop('wall.webp', '/data/overdrive/themes'), '/data/overdrive/themes/wall.webp');
  assert.equal(themes.safeBackdrop('wall.PNG', '/data/overdrive/themes'), '/data/overdrive/themes/wall.PNG');
  assert.equal(themes.safeBackdrop(''), '');
  assert.equal(themes.safeBackdrop('../../etc/passwd'), '');
  assert.equal(themes.safeBackdrop('sub/dir/wall.png'), '');
  assert.equal(themes.safeBackdrop('C:\\wall.png'), '');
  assert.equal(themes.safeBackdrop('note.txt'), '');
  assert.equal(themes.safeBackdrop('ftp://example.com/a.png'), '');
  assert.equal(themes.safeBackdrop(null), '');
  assert.equal(themes.safeBackdrop(`${'a'.repeat(130)}.png`), '');
  assert.equal(themes.safeBackdrop(`https://${'a'.repeat(2100)}.com/x.png`), '');
});

test('normalizeDim clamps to 0..1 and defaults when not a number', () => {
  assert.equal(themes.normalizeDim(0.28), 0.28);
  assert.equal(themes.normalizeDim(0), 0);
  assert.equal(themes.normalizeDim(1), 1);
  assert.equal(themes.normalizeDim(1.7), 1);
  assert.equal(themes.normalizeDim(-3), 0);
  assert.equal(themes.normalizeDim(0.333333), 0.33);
  assert.equal(themes.normalizeDim('0.5'), 0.5);
  assert.equal(themes.normalizeDim('nope'), themes.DEFAULT_THEME.backgroundDim);
  assert.equal(themes.normalizeDim(null), themes.DEFAULT_THEME.backgroundDim);
});

test('safeName strips separators and falls back when empty', () => {
  assert.equal(themes.safeName('My Theme', 'file'), 'My Theme');
  assert.equal(themes.safeName('a/b\\c:d*e?f"g<h>i|j', 'file'), 'abcdefghij');
  assert.equal(themes.safeName('   ', 'file'), 'file');
  assert.equal(themes.safeName(undefined, 'file'), 'file');
  assert.equal(themes.safeName('x'.repeat(80), 'file'), 'x'.repeat(64));
});

test('findTheme falls back to the default for unknown or user ids', () => {
  assert.equal(themes.findTheme('user:missing'), themes.DEFAULT_THEME);
  assert.equal(themes.findTheme('builtin:default'), themes.listThemes()[0]);
});

test('selectTheme applies the palette to the live colors and remembers the id', () => {
  const changed = themes.selectTheme('builtin:default');
  assert.equal(changed.id, 'builtin:default');
  assert.equal(themes.activeThemeId(), 'builtin:default');
  assert.equal(themes.activeTheme().colors.canvas, '#000000');
});
