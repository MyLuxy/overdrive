// ../pub-game-store/native/i18n/index.js
// reconstructed from the esbuild bundle in eboot.bin

import { createContext, createElement, useContext, useEffect, useState } from 'react';
import { configure, getLocale, setLocale, subscribe, t } from './core.js';
import { SOURCE_LOCALE, isRTL, matchLocale } from './locales.js';
import en from './locales/en.json';
import { loadList, saveList } from '../state/saved.js';
import { DeviceInfo, FileSystem, Fonts } from '@ps5-react/core';

  configure((code) => JSON.parse(FileSystem.readFile(`${FileSystem.appDir}/i18n/locales/${code}.json`)), en);
  var SETTINGS = "settings.json";
  var systemLanguage = () => {
    try {
      return DeviceInfo.get().language;
    } catch {
      return null;
    }
  };
  var systemLocale = () => matchLocale(systemLanguage()) ?? SOURCE_LOCALE;
  var choice = loadList(SETTINGS, "settings").language ?? null;
  function applyLocale() {
    setLocale(choice ?? systemLocale());
    Fonts.setLanguage(choice ?? systemLanguage() ?? getLocale());
  }
  applyLocale();
  var languageChoice = () => choice;
  function chooseLanguage(code) {
    choice = code;
    const { language, ...settings } = loadList(SETTINGS, "settings");
    saveList(SETTINGS, "settings", code ? { ...settings, language: code } : settings);
    applyLocale();
  }
  var LocaleContext = (0, createContext)(getLocale());
  function LocaleProvider({ children }) {
    const [locale2, setActive] = (0, useState)(getLocale);
    (0, useEffect)(() => subscribe(setActive), []);
    return (0, createElement)(LocaleContext.Provider, { value: locale2 }, children);
  }
  function useT() {
    (0, useContext)(LocaleContext);
    return t;
  }
  function useLocale() {
    const locale2 = (0, useContext)(LocaleContext);
    return { locale: locale2, rtl: isRTL(locale2) };
  }
  var LATIN_IN_RTL = { writingDirection: "ltr", textAlign: "right" };
  var latin = (rtl, text) => rtl && text ? `${text}\u200E` : text;
  var focusEnd = (rtl, key) => ({ [rtl ? "nextFocusLeft" : "nextFocusRight"]: key });
  var focusStart = (rtl, key) => ({ [rtl ? "nextFocusRight" : "nextFocusLeft"]: key });

export { LATIN_IN_RTL, LocaleProvider, chooseLanguage, focusEnd, focusStart, languageChoice, latin, systemLocale, useLocale, useT };
