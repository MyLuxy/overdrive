// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useState} from 'react';
import {View, Text, motion, transitions, tw} from '@ps5-react/core';
import {Page, caption} from '../ui.jsx';

const items = ['Library', 'Store', 'Media', 'Friends', 'Trophies',
  'Capture', 'Settings', 'Downloads', 'Search', 'Power'];
const swatches = [tw`bg-sky-400`, tw`bg-indigo-400`, tw`bg-violet-400`, tw`bg-fuchsia-400`, tw`bg-rose-400`,
  tw`bg-orange-400`, tw`bg-amber-300`, tw`bg-lime-400`, tw`bg-emerald-400`, tw`bg-teal-400`];

// Cards are 200×140 logical (400×280 physical): small enough for scale on the CPU renderer.
const COLS = 5, W = 200, H = 140, GAP = 24, HALO = 12, LIFT = -6;
const card = {
  hidden: {opacity: 0, y: 24},
  shown: {opacity: 1, y: 0, transition: transitions.panel},
  gone: {opacity: 0, transition: transitions.exit},
};
const lift = {y: LIFT, scale: 1.06};

// `current` only places the halo: it mirrors focus from onFocus/onBlur and never drives it.
export function FocusPage({onPick}) {
  const [current, setCurrent] = useState(-1);
  const col = current % COLS, row = Math.floor(current / COLS);
  return (
    <Page intro="Cards stagger in on enter, lift on focus, and one halo glides between them by translation only.">
      <View className="relative self-start w-[1096px] flex-row flex-wrap gap-6">
        <motion.View className="absolute w-[224px] h-[164px] rounded-[24px] border-4 border-accent bg-accent/10"
          initial={false} transition={transitions.focus}
          animate={{x: col * (W + GAP) - HALO, y: row * (H + GAP) - HALO + LIFT, opacity: current < 0 ? 0 : 1}} />
        {items.map((label, index) => (
          <motion.View key={label} variants={card} whileFocus={lift}
            onFocus={() => setCurrent(index)} onBlur={() => setCurrent(-1)} onPress={() => onPick(label)}
            transition={transitions.focus}
            className="w-[200px] h-[140px] p-4 justify-between rounded-2xl bg-panel border-2 border-edge
              focused:bg-panel-focus">
            <View className="size-8 rounded-lg" style={swatches[index]} />
            <View className="gap-1">
              <Text className="font-inter text-body text-white">{label}</Text>
              <Text style={caption}>{`0${index + 1}`.slice(-2)} · whileFocus</Text>
            </View>
          </motion.View>
        ))}
      </View>
    </Page>
  );
}
