// First-launch language picker — full-screen, matches Overdrive black UI.
// Shown once after Splash. UI chrome follows the PS5 system language;
// the list is every app locale. No "System language" / "Default" rows —
// the console language is pre-selected in the list.

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { chooseLanguage, languageChoice, systemLocale } from '../i18n/index.js';
import { LOCALES } from '../i18n/locales.js';
import { loadList, saveList } from '../state/saved.js';
import { FocusRing } from './FocusRing.jsx';
import { Icon } from './Icon.jsx';
import { colors } from './colors.js';
import { FocusScope, ScrollView, Text, View, useIsFocused } from '@ps5-react/core';

var SETTINGS = 'settings.json';

/** Onboarding chrome in the console's language (fallback: English). */
var COPY = {
  en: {
    title: 'Choose your language',
    subtitle: "Overdrive's interface will use this language. Game titles and descriptions stay as the store lists them.",
    hint: 'You can change the language later in Settings (gear icon).'
  },
  ru: {
    title: 'Выберите язык',
    subtitle: 'Интерфейс Overdrive будет на этом языке. Названия и описания игр остаются как в каталоге.',
    hint: 'Изменить язык позже можно в настройках (шестерёнка).'
  },
  de: {
    title: 'Sprache wählen',
    subtitle: 'Die Oberfläche von Overdrive erscheint in dieser Sprache. Spieltitel und Beschreibungen bleiben wie im Katalog.',
    hint: 'Die Sprache kannst du später in den Einstellungen ändern.'
  },
  es: {
    title: 'Elige el idioma',
    subtitle: 'La interfaz de Overdrive usará este idioma. Los títulos y descripciones siguen como en el catálogo.',
    hint: 'Puedes cambiar el idioma más tarde en Ajustes.'
  },
  fr: {
    title: 'Choisir la langue',
    subtitle: "L'interface d'Overdrive utilisera cette langue. Titres et descriptions restent ceux du catalogue.",
    hint: 'Vous pourrez changer la langue plus tard dans les Réglages.'
  },
  it: {
    title: 'Scegli la lingua',
    subtitle: "L'interfaccia di Overdrive userà questa lingua. Titoli e descrizioni restano quelli del catalogo.",
    hint: 'Puoi cambiare lingua più tardi nelle Impostazioni.'
  },
  'pt-BR': {
    title: 'Escolha o idioma',
    subtitle: 'A interface do Overdrive usará este idioma. Títulos e descrições ficam como no catálogo.',
    hint: 'Você pode mudar o idioma depois em Configurações.'
  },
  ja: {
    title: '言語を選択',
    subtitle: 'Overdriveの表示言語です。ゲームのタイトルと説明はカタログのままです。',
    hint: '言語は後から設定で変更できます。'
  },
  'zh-Hans': {
    title: '选择语言',
    subtitle: 'Overdrive 界面将使用此语言。游戏标题和简介仍与目录一致。',
    hint: '之后可在设置中更改语言。'
  },
  ar: {
    title: 'اختر اللغة',
    subtitle: 'ستستخدم واجهة Overdrive هذه اللغة. تبقى عناوين الألعاب ووصفها كما في المتجر.',
    hint: 'يمكنك تغيير اللغة لاحقاً من الإعدادات.'
  }
};

function markLanguageSetup() {
  const settings = loadList(SETTINGS, 'settings');
  saveList(SETTINGS, 'settings', { ...settings, languageSetup: true });
}

function needsLanguageSetup() {
  try {
    const settings = loadList(SETTINGS, 'settings');
    return !settings.languageSetup;
  } catch {
    return true;
  }
}

function RowFace({ name, checked }) {
  const focused = useIsFocused();
  return /* @__PURE__ */ jsxs(View, {
    style: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 24 },
    children: [
      /* @__PURE__ */ jsx(Text, {
        style: {
          flex: 1,
          fontFamily: 'Inter-Regular',
          fontSize: 26,
          fontWeight: 600,
          color: focused ? colors.fg : '#e8e8ea',
          lineHeight: 34
        },
        children: name
      }),
      checked
        ? /* @__PURE__ */ jsx(Icon, { name: 'check', color: colors.fg })
        : /* @__PURE__ */ jsx(View, { style: { width: 24, height: 24 } })
    ]
  });
}

function LangRow({ focusKey, autoFocus, name, checked, onPress }) {
  return /* @__PURE__ */ jsxs(View, {
    focusKey,
    autoFocus,
    onPress,
    style: (_state) => [
      {
        position: 'relative',
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        paddingHorizontal: 28,
        paddingVertical: 20,
        borderWidth: 2,
        borderColor: 'transparent'
      },
      _state.focused
        ? { backgroundColor: colors.surface2, borderColor: '#3a3a42' }
        : { backgroundColor: 'transparent' }
    ],
    children: [
      /* @__PURE__ */ jsx(FocusRing, {}),
      /* @__PURE__ */ jsx(RowFace, { name, checked })
    ]
  });
}

function LanguageOnboarding({ onDone }) {
  const systemCode = systemLocale();
  const copy = COPY[systemCode] || COPY.en;
  const choice = languageChoice();
  const selected = choice ?? systemCode;

  const finish = (code) => {
    chooseLanguage(code);
    markLanguageSetup();
    onDone();
  };

  return /* @__PURE__ */ jsx(FocusScope, {
    trap: true,
    autoFocus: true,
    children: /* @__PURE__ */ jsxs(View, {
      style: {
        width: 1920,
        height: 1080,
        backgroundColor: colors.canvas,
        alignItems: 'center',
        justifyContent: 'center'
      },
      children: [
        /* @__PURE__ */ jsxs(View, {
          style: {
            width: 920,
            maxHeight: 980,
            gap: 36,
            paddingVertical: 48
          },
          children: [
            /* @__PURE__ */ jsxs(View, {
              style: { gap: 12, paddingHorizontal: 12 },
              children: [
                /* @__PURE__ */ jsx(Text, {
                  style: {
                    fontFamily: 'Inter-Regular',
                    fontSize: 18,
                    fontWeight: 600,
                    color: colors.subtle,
                    letterSpacing: 3,
                    textTransform: 'uppercase'
                  },
                  children: 'Overdrive'
                }),
                /* @__PURE__ */ jsx(Text, {
                  style: {
                    fontFamily: 'Inter-Regular',
                    fontSize: 42,
                    fontWeight: 600,
                    color: colors.fg,
                    lineHeight: 52,
                    letterSpacing: -1
                  },
                  children: copy.title
                }),
                /* @__PURE__ */ jsx(Text, {
                  style: {
                    fontFamily: 'Inter-Regular',
                    fontSize: 22,
                    color: colors.muted,
                    lineHeight: 32
                  },
                  children: copy.subtitle
                })
              ]
            }),
            /* @__PURE__ */ jsx(ScrollView, {
              style: { flexGrow: 1, maxHeight: 720 },
              children: /* @__PURE__ */ jsx(View, {
                style: { gap: 8 },
                children: LOCALES.map(({ code, name }) =>
                  /* @__PURE__ */ jsx(
                    LangRow,
                    {
                      focusKey: `onboard:${code}`,
                      autoFocus: code === selected,
                      name,
                      checked: selected === code,
                      onPress: () => finish(code)
                    },
                    code
                  )
                )
              })
            }),
            /* @__PURE__ */ jsx(Text, {
              style: {
                fontFamily: 'Inter-Regular',
                fontSize: 18,
                color: colors.subtle,
                paddingHorizontal: 12,
                lineHeight: 26
              },
              children: copy.hint
            })
          ]
        })
      ]
    })
  });
}

export { LanguageOnboarding, needsLanguageSetup };
