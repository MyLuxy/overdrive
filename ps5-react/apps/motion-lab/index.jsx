// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useEffect, useState} from 'react';
import {AppRegistry, View, Text, FocusScope, motion, AnimatePresence, transitions, useFocus} from '@ps5-react/core';
import {FocusPage} from './pages/focus.jsx';
import {ClassesPage} from './pages/classes.jsx';
import {AmbientPage} from './pages/ambient.jsx';
import {Tabs} from './tabs.jsx';
import {Toast} from './toast.jsx';

const PAGES = [
  {label: 'Focus', Page: FocusPage},
  {label: 'Classes', Page: ClassesPage},
  {label: 'Ambient', Page: AmbientPage},
];
const LABELS = PAGES.map(({label}) => label);
const TOAST_MS = 2200;
const hint = 'font-inter text-caption text-slate-400';

// The page container only translates: fading or scaling a full-screen node is the most expensive
// effect on the CPU renderer. Small children fade through the propagated labels instead.
const screen = {
  hidden: {x: 90},
  shown: {x: 0, transition: {...transitions.screen, staggerChildren: 0.05, delayChildren: 0.08}},
  gone: {x: -60, transition: transitions.exit},
};

function App() {
  const [page, setPage] = useState(0);
  const [toast, setToast] = useState(null);
  const {focusedKey, focus} = useFocus();
  const inTabs = focusedKey?.startsWith('tab:') ?? true;
  const {Page} = PAGES[page];
  const pick = text => setToast({id: Date.now(), text});

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <View className="w-screen h-screen bg-ink px-10 py-8 gap-6">
      <View className="flex-row items-end justify-between">
        <View className="gap-1">
          <Text className="font-inter text-caption text-accent tracking-widest">PS5 REACT · MOTION</Text>
          <Text className="font-inter text-title text-white leading-none">Motion Lab</Text>
        </View>
        <Text className="font-inter text-hint text-slate-500">{page + 1} / {PAGES.length}</Text>
      </View>
      <Tabs labels={LABELS} active={page} focused={inTabs} onSelect={setPage} onEnter={() => focus('content')} />
      <FocusScope focusKey="content" onBack={() => focus('tabs')}>
        <View className="flex-1">
          <AnimatePresence mode="wait">
            <motion.View key={page} className="flex-1"
              variants={screen} initial="hidden" animate="shown" exit="gone">
              <Page onPick={pick} />
            </motion.View>
          </AnimatePresence>
        </View>
      </FocusScope>
      <View className="gap-2 border-t border-edge pt-3">
        <Text className={hint}>
          {inTabs ? 'D-pad: switch page    X / Enter / Down: enter the page'
            : 'D-pad: move focus    X / Enter: pop a toast    Circle: back to tabs'}
        </Text>
        <Text className="font-inter text-caption text-amber-300">
          Perf note: translate is cheap at any size · scale and rotate only on boxes up to 256 px ·
          full-screen fades cost the most · frame times print every 2 s as "frame: fps=..."
        </Text>
      </View>
      <AnimatePresence>
        {toast && <Toast key={toast.id} text={toast.text} />}
      </AnimatePresence>
    </View>
  );
}

AppRegistry.registerComponent('motion-lab', () => App);
