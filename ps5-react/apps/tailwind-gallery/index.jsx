// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useState} from 'react';
import {AppRegistry, View, Text, FocusScope, useFocus} from '@ps5-react/core';
import {SpacingPage, FlexPage} from './pages/layout.jsx';
import {ColorPage, BorderPage} from './pages/paint.jsx';
import {TypePage} from './pages/type.jsx';
import {TransformPage} from './pages/motion.jsx';

const PAGES = [
  ['Spacing', SpacingPage], ['Flex', FlexPage], ['Color', ColorPage],
  ['Borders', BorderPage], ['Type', TypePage], ['Transform', TransformPage],
];
const hint = 'font-inter text-xs text-slate-400';

function Tab({label, active, onFocus, onPress}) {
  return (
    <View focusable focusKey={`tab:${label}`} selected={active} onFocus={onFocus} onPress={onPress}
      className="px-5 py-2 rounded-full border-2 border-transparent
        selected:bg-slate-700 focused:border-accent focused:scale-105">
      <Text className={`font-inter text-sm ${active ? 'text-white' : 'text-slate-400'}`}>{label}</Text>
    </View>
  );
}

// Focusing a tab shows its page; picked holds the "page:card" keys toggled with confirm.
function App() {
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState([]);
  const {focusedKey, focus} = useFocus();
  const inTabs = focusedKey?.startsWith('tab:') ?? true;

  const [, Current] = PAGES[page];
  const at = index => {
    const key = `${page}:${index}`;
    return {selected: picked.includes(key),
      onPress: () => setPicked(keys => (keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key]))};
  };

  return (
    <View className="w-screen h-screen bg-ink px-10 py-8 gap-6">
      <View className="flex-row items-end justify-between">
        <View className="gap-1">
          <Text className="font-inter text-xs text-accent tracking-widest">PS5 REACT · CLASSNAME</Text>
          <Text className="font-inter text-xl text-white leading-none">Tailwind Gallery</Text>
        </View>
        <Text className="font-inter text-sm text-slate-500">{page + 1} / {PAGES.length}</Text>
      </View>
      <FocusScope focusKey="tabs" autoFocus wrap>
        <View className={`self-start flex-row gap-2 p-1 rounded-full bg-panel border-2
          ${inTabs ? 'border-slate-600' : 'border-transparent'}`}>
          {PAGES.map(([label], index) => (
            <Tab key={label} label={label} active={index === page}
              onFocus={() => setPage(index)} onPress={() => focus('content')} />
          ))}
        </View>
      </FocusScope>
      <FocusScope focusKey="content" onBack={() => focus('tabs')}>
        <Current key={page} at={at} />
      </FocusScope>
      <View className="flex-row justify-between border-t border-slate-800 pt-3">
        <Text className={hint}>
          {inTabs ? 'D-pad: switch page    X / Enter / Down: explore cards'
            : 'D-pad: move focus    X / Enter: toggle selected    Circle: back to tabs'}
        </Text>
        <Text className={`${hint} italic`}>{picked.length} selected</Text>
      </View>
    </View>
  );
}
AppRegistry.registerComponent('tailwind-gallery', () => App);
