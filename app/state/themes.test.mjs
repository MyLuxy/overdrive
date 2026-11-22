import assert from 'node:assert/strict';
import {register} from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const themes = await import('./themes.js');

const KEYS = Object.keys(themes.BASE_COLORS);

test('builtin presets cover every color the app reads', () => {
  assert.ok(themes.PRESETS.length >= 2);
  const ids = themes.PRESETS.map((theme) => theme.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const theme of themes.PRESETS) {
    assert.equal(Object.keys(theme.colors).sort().join(','), [...KEYS].sort().join(','));
    for (const value of Object.values(theme.colors)) assert.match(value, /^#[0-9a-f]{6}$/);
  }
});

test('normalizeTheme fills missing and invalid keys from the base palette', () => {
  const palette = themes.normalizeTheme({colors: {canvas: '#0f1122', surface: 'zzz', fg: '#abc'}});
  assert.equal(palette.canvas, '#0f1122');
  assert.equal(palette.surface, themes.BASE_COLORS.surface);
  assert.equal(palette.fg, '#aabbcc');
  for (const key of KEYS) assert.match(palette[key], /^#[0-9a-f]{6}$/);
});

test('normalizeTheme keeps alpha colors and rejects junk records', () => {
  const palette = themes.normalizeTheme({colors: {warn: '#fde68acc'}});
  assert.equal(palette.warn, '#fde68acc');
  assert.deepEqual(themes.normalizeTheme(null), themes.BASE_COLORS);
  assert.deepEqual(themes.normalizeTheme({colors: []}), themes.BASE_COLORS);
});

test('safeName strips separators and falls back when empty', () => {
  assert.equal(themes.safeName('My Theme', 'file'), 'My Theme');
  assert.equal(themes.safeName('a/b\\c:d*e?f"g<h>i|j', 'file'), 'abcdefghij');
  assert.equal(themes.safeName('   ', 'file'), 'file');
  assert.equal(themes.safeName(undefined, 'file'), 'file');
  assert.equal(themes.safeName('x'.repeat(80), 'file'), 'x'.repeat(64));
});

test('listThemes always starts with the builtins, chosen stays first preset', () => {
  const listed = themes.listThemes();
  assert.ok(listed.length >= themes.PRESETS.length);
  assert.equal(listed[0].id, 'builtin:default');
  assert.deepEqual(theme(themes.activeThemeId()), themes.listThemes()[0].colors ?? null);
});

function theme(id) {
  const found = themes.listThemes().find((entry) => entry.id === id);
  return found ? found.colors : null;
}

test('selectTheme applies the palette to the live colors and remembers the id', () => {
  const changed = themes.selectTheme('builtin:sakura');
  assert.match(changed.id, /^builtin:/);
  assert.equal(themes.activeThemeId(), 'builtin:sakura');
  const sakura = themes.listThemes().find((entry) => entry.id === 'builtin:sakura');
  assert.equal(changed.colors.canvas, sakura.colors.canvas);
  themes.selectTheme('builtin:default');
  assert.equal(themes.activeThemeId(), 'builtin:default');
  assert.equal(theme('builtin:default').canvas, '#000000');
});
