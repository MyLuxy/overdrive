// First-launch language picker — full-screen, matches Overdrive black UI.
// Shown once after Splash until the player confirms a language (or system).

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { chooseLanguage, languageChoice, systemLocale, useT } from '../i18n/index.js';
import { LOCALES } from '../i18n/locales.js';
import { loadList, saveList } from '../state/saved.js';
import { FocusRing } from './FocusRing.jsx';
import { Icon } from './Icon.jsx';
import { colors } from './colors.js';
import { FocusScope, ScrollView, Text, View, useIsFocused } from '@ps5-react/core';

var SETTINGS = 'settings.json';

function markLanguageSetup() {
  const settings = loadList(SETTINGS, 'settings');
  saveList(SETTINGS, 'settings', { ...settings, languageSetup: true });
}

/** True until the player finishes the first-run language screen. */
function needsLanguageSetup() {
  try {
    const settings = loadList(SETTINGS, 'settings');
    return !settings.languageSetup;
  } catch {
    return true;
  }
}

function RowFace({ name, detail, checked }) {
  const focused = useIsFocused();
  return /* @__PURE__ */ jsxs(View, {
    style: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 24 },
    children: [
      /* @__PURE__ */ jsxs(View, {
        style: { flex: 1, gap: 3 },
        children: [
          /* @__PURE__ */ jsx(Text, {
            style: {
              fontFamily: 'Inter-Regular',
              fontSize: 26,
              fontWeight: 600,
              color: focused ? colors.fg : '#e8e8ea',
              lineHeight: 34
            },
            children: name
          }),
          detail
            ? /* @__PURE__ */ jsx(Text, {
                style: {
                  fontFamily: 'Inter-Regular',
                  fontSize: 20,
                  lineHeight: 28,
                  color: focused ? colors.muted : colors.subtle
                },
                children: detail
              })
            : null
        ]
      }),
      checked
        ? /* @__PURE__ */ jsx(Icon, { name: 'check', color: colors.fg })
        : /* @__PURE__ */ jsx(View, { style: { width: 24, height: 24 } })
    ]
  });
}

function LangRow({ focusKey, autoFocus, name, detail, checked, onPress }) {
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
      /* @__PURE__ */ jsx(RowFace, { name, detail, checked })
    ]
  });
}

function LanguageOnboarding({ onDone }) {
  const t = useT();
  const choice = languageChoice();
  const systemCode = systemLocale();
  const systemName = LOCALES.find((l) => l.code === systemCode)?.name ?? systemCode;

  const title = t('language.setupTitle');
  const subtitle = t('language.setupSubtitle');
  const hint = t('language.setupHint');

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
                  children: title && title !== 'language.setupTitle' ? title : 'Choose your language'
                }),
                /* @__PURE__ */ jsx(Text, {
                  style: {
                    fontFamily: 'Inter-Regular',
                    fontSize: 22,
                    color: colors.muted,
                    lineHeight: 32
                  },
                  children: subtitle && subtitle !== 'language.setupSubtitle'
                    ? subtitle
                    : "Overdrive's interface will use this language. Game titles and descriptions stay as the store lists them."
                })
              ]
            }),
            /* @__PURE__ */ jsx(ScrollView, {
              style: { flexGrow: 1, maxHeight: 720 },
              children: /* @__PURE__ */ jsxs(View, {
                style: { gap: 8 },
                children: [
                  /* @__PURE__ */ jsx(LangRow, {
                    focusKey: 'onboard:system',
                    autoFocus: true,
                    name: t('language.system') || 'System language',
                    detail: systemName,
                    checked: choice === null,
                    onPress: () => finish(null)
                  }),
                  /* @__PURE__ */ jsx(View, {
                    style: {
                      height: 1,
                      backgroundColor: colors.line,
                      marginVertical: 10,
                      marginHorizontal: 12
                    }
                  }),
                  LOCALES.map(({ code, name }) =>
                    /* @__PURE__ */ jsx(
                      LangRow,
                      {
                        focusKey: `onboard:${code}`,
                        name,
                        detail: t(`language.name.${code}`) || name,
                        checked: choice === code,
                        onPress: () => finish(code)
                      },
                      code
                    )
                  )
                ]
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
              children: hint && hint !== 'language.setupHint'
                ? hint
                : 'You can change the language later in Settings (gear icon).'
            })
          ]
        })
      ]
    })
  });
}

export { LanguageOnboarding, needsLanguageSetup };
