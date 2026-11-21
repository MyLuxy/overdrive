// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, motion} from '@ps5-react/core';
import {Page, caption, code} from '../ui.jsx';

const breathe = {duration: 2.8, ease: 'easeInOut', repeat: Infinity, repeatType: 'reverse'};
const spin = {type: 'tween', duration: 1.1, ease: 'linear', repeat: Infinity};

// No transform on these tiles: a looping child inside a scaled node repaints the whole node each frame.
function Tile({title, onPick, note, children}) {
  return (
    <View onPress={() => onPick(title)}
      className="w-60 h-60 p-5 justify-between rounded-2xl bg-panel border-2 border-edge
        focused:border-accent focused:bg-panel-focus">
      <Text style={caption}>{title}</Text>
      <View className="h-28 items-center justify-center">{children}</View>
      <Text style={code}>{note}</Text>
    </View>
  );
}

export function AmbientPage({onPick}) {
  return (
    <Page intro="Idle motion stays small and slow: it should never compete with focus.">
      <View className="flex-row gap-8">
        <Tile title="Breathing glow" onPick={onPick} note="opacity 0.25 to 0.8, 2.8 s, reverse">
          <View className="relative size-24 items-center justify-center">
            <motion.View className="absolute size-24 rounded-full bg-accent/40"
              initial={{opacity: 0.25, scale: 0.92}} animate={{opacity: 0.8, scale: 1.04}} transition={breathe} />
            <View className="size-10 rounded-full bg-accent" />
          </View>
        </Tile>
        <Tile title="Spinner" onPick={onPick} note="rotate 360, linear, loop">
          <motion.View className="size-14 rounded-full border-4 border-edge border-t-accent"
            initial={{rotate: 0}} animate={{rotate: 360}} transition={spin} />
        </Tile>
        <Tile title="Toast" onPick={onPick} note="pop spring in, faster exit">
          <Text className="font-inter text-hint text-white text-center">X / Enter on any card pops a toast</Text>
        </Tile>
      </View>
    </Page>
  );
}
