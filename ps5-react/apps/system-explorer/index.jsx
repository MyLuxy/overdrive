// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useState} from 'react';
import {AppRegistry, View, Text, FocusScope, useFocus} from '@ps5-react/core';
import {DevicePage} from './pages/device.jsx';
import {FilesPage} from './pages/files.jsx';
import {ControllerPage} from './pages/controller.jsx';
import {SystemPage} from './pages/system.jsx';

const PAGES = [
  ['Device', DevicePage, 'X / Enter: refresh    Circle: back to tabs'],
  ['Files', FilesPage, 'X / Enter: open    Circle: parent folder, then tabs'],
  ['Controller', ControllerPage, 'X / Enter: run action    Circle: back to tabs'],
  ['System', SystemPage, 'X / Enter: run action    Circle: back to tabs'],
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

// Focusing a tab shows its page. Circle in a page returns to the tabs unless the page's own
// FocusScope.onBack (the Files page climbing folders) consumes it first.
function Explorer() {
  const [page, setPage] = useState(0);
  const {focusedKey, focus} = useFocus();
  const inTabs = focusedKey?.startsWith('tab:') ?? true;

  const [, Current, pageHint] = PAGES[page];

  return (
    <View className="w-screen h-screen bg-ink px-10 py-8 gap-6">
      <View className="gap-1">
        <Text className="font-inter text-xs text-accent tracking-widest">PS5 REACT · NATIVE MODULES</Text>
        <Text className="font-inter text-xl text-white leading-none">System Explorer</Text>
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
        <Current key={page} />
      </FocusScope>
      <View className="border-t border-slate-800 pt-3">
        <Text className={hint}>
          {inTabs ? 'D-pad: switch tab    X / Enter / Down: enter page' : `D-pad: move    ${pageHint}`}
        </Text>
      </View>
    </View>
  );
}

AppRegistry.registerComponent('system-explorer', () => Explorer);
