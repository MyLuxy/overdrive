import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateModule } from '../test-support/hooks.mjs';

const jsx = (type, props, key) => ({ type, props, key });
const chosen = [];
const { SettingsScreen, SpeedLimit, DeletePackages, VibrationLevel } = evaluateModule(new URL('./SettingsScreen.jsx', import.meta.url), {
  jsx, jsxs: jsx, Fragment: 'fragment',
  useT: () => (key) => key,
  languageChoice: () => 'de',
  systemLocale: () => 'en',
  chooseLanguage: (code) => chosen.push(code),
  LOCALES: [{ code: 'en', name: 'English' }, { code: 'de', name: 'Deutsch' }],
  useIsFocused: () => false,
  FocusRing: 'ring', Icon: 'icon', Text: 'text', View: 'view', ScrollView: 'scroll', FocusScope: 'scope',
  colors: { fg: '#fff', muted: '#888', accentFg: '#000', surface2: '#222' },
  formatPercent2: (n) => String(n),
  LEVELS: [0, 30, 60, 100], LIMITS: [0, 10, 20],
  useSpeedLimit: () => 0, setSpeedLimit() {},
  useDeletePackages: () => true, setDeletePackages() {},
  useVibrationLevel: () => 0, setVibrationLevel() {},
}, ['SettingsScreen', 'SpeedLimit', 'DeletePackages', 'VibrationLevel']);

test('Settings is a full screen with all four former popout groups', () => {
  let backs = 0;
  const tree = SettingsScreen({ onBack: () => backs++ });
  assert.equal(tree.type, 'scope');
  assert.equal(tree.props.autoFocus, true);
  assert.equal(tree.props.children.type, 'view');
  const [heading, columns] = tree.props.children.props.children;
  assert.equal(heading.type, 'text');
  assert.equal(heading.props.children, 'settings.title');
  assert.equal(columns.type, 'view', 'outer settings container must not scroll');
  assert.equal(columns.props.style.flexDirection, 'row');
  assert.equal(columns.props.style.gap, 104);
  const [left, right] = columns.props.children;
  assert.equal(left.type, 'view', 'left column remains stationary');
  assert.equal(left.props.style.width, 830);
  assert.equal(right.type, 'view', 'language header must not scroll');
  assert.equal(right.props.style.width, 650);
  const [languageTitle, languageScroll] = right.props.children;
  assert.equal(languageTitle.props.title, 'language.title');
  assert.equal(languageScroll.type, 'scroll', 'only language options should scroll');
  assert.equal(languageScroll.props.style.flex, 1);
  const content = left.props.children;
  const languages = languageScroll.props.children.props.children;
  const components = content.filter((item) => item?.type).map((item) => item.type.name);
  for (const name of ['SpeedLimit', 'DeletePackages', 'VibrationLevel']) {
    assert.ok(components.includes(name), 'Settings lost ' + name);
  }
  const languageItems = languages.filter((item) => Array.isArray(item)).flat();
  assert.equal(languageItems.length, 2);
  const systemOption = languages.find((item) => item?.props?.code === 'system');
  assert.ok(systemOption, 'System language option missing');
  assert.doesNotThrow(() => systemOption.props.onPress());
  assert.deepEqual(chosen, [null]);
  const german = languageItems.find((item) => item.props.code === 'de');
  german.props.onPress();
  assert.deepEqual(chosen, [null, 'de']);
  assert.equal(tree.props.onBack(), true);
  assert.equal(backs, 1);
});

test('Settings headings show no redundant status text; button selections remain visible', () => {
  for (const [component, expectedTitle, expectedOptions] of [
    [SpeedLimit, 'settings.speedLimit', 3],
    [DeletePackages, 'settings.deletePackages', 2],
    [VibrationLevel, 'settings.vibration', 4],
  ]) {
    const root = component();
    const [description, options] = root.props.children;
    const [heading, subtitle] = description.props.children;
    assert.equal(heading.props.children.length, 1, expectedTitle + ' shows a redundant status');
    assert.equal(heading.props.children[0].props.children, expectedTitle);
    assert.equal(subtitle.type, 'text');
    assert.equal(options.props.children.length, expectedOptions);
    assert.ok(options.props.children.every((option) => { const button = option.type(option.props); return button.props.focusKey && button.props.onPress; }));
  }
});
