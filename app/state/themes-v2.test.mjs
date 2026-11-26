import assert from 'node:assert/strict';
import { register } from 'node:module';
import test from 'node:test';

register(new URL('./download-queue-test-loader.mjs', import.meta.url), import.meta.url);
const themes = await import('./themes.js');

// Theme Engine 2.0 (docs/theme-engine-2.md): the v2 layer is opt-in. These tests pin the
// guarantee that matters most: a setup without v2 fields reads exactly as v1 did.

test('the default theme stays a plain v1 palette, and the v2 accessors return the defaults', () => {
  assert.equal(Object.keys(themes.DEFAULT_THEME.colors).length, Object.keys(themes.BASE_COLORS).length);
  assert.deepEqual(themes.themeExtraColors(), themes.EXTRA_COLOR_DEFAULTS);
  assert.deepEqual(themes.themeOverrides(), themes.DEFAULT_OVERRIDES);
  assert.deepEqual(themes.themeSounds(), {});
  assert.deepEqual(themes.themeLightBar(), themes.DEFAULT_LIGHTBAR);
});

test('extra colors are validated and expanded; junk and base keys are dropped', () => {
  const out = themes.normalizeExtraColors({ accent: '#f0f', focus: 'zzz', overlay: '#000000B3', muted: '#123456' });
  assert.equal(out.accent, '#ff00ff');
  assert.equal(out.focus, undefined);
  assert.equal(out.overlay, '#000000b3');
  assert.equal(out.muted, undefined);
  assert.deepEqual(themes.normalizeExtraColors(null), {});
});

test('normalizeOverrides clamps radii and keeps the defaults on junk', () => {
  assert.deepEqual(themes.normalizeOverrides(null), themes.DEFAULT_OVERRIDES);
  const out = themes.normalizeOverrides({ cardRadius: '999', buttonRadius: -12, chipRadius: 12.4, glowSize: 40, glowColor: 'nope' });
  assert.equal(out.cardRadius, 48);
  assert.equal(out.buttonRadius, 0);
  assert.equal(out.chipRadius, 12);
  assert.equal(out.glowSize, 40);
  assert.equal(out.glowColor, '');
});

test('normalizeSounds accepts wav filenames and http urls, rejects traversal and other formats', () => {
  const out = themes.normalizeSounds({
    focus: 'blip.wav',
    confirm: 'https://cdn.example.com/confirm.wav',
    back: 'sub/dir/x.wav',
    error: 'note.mp3',
    notify: '../../etc/passwd.wav',
    page: 'https://cdn.example.com/page.wav?size=full'
  }, '/data/overdrive/themes');
  assert.equal(out.focus, '/data/overdrive/themes/blip.wav');
  assert.equal(out.confirm, 'https://cdn.example.com/confirm.wav');
  assert.equal(out.back, undefined);
  assert.equal(out.error, undefined);
  assert.equal(out.notify, undefined);
  assert.equal(out.page, 'https://cdn.example.com/page.wav?size=full');
});

test('normalizeLightbar validates the mode and the color', () => {
  assert.deepEqual(themes.normalizeLightbar(null), themes.DEFAULT_LIGHTBAR);
  assert.deepEqual(themes.normalizeLightbar({ mode: 'fixed', color: '#b967ff' }), { mode: 'fixed', color: '#b967ff' });
  assert.deepEqual(themes.normalizeLightbar({ mode: 'psychedelic' }), themes.DEFAULT_LIGHTBAR);
  assert.deepEqual(themes.normalizeLightbar({ mode: 'fixed', color: 'nope' }), { mode: 'fixed', color: '' });
});
