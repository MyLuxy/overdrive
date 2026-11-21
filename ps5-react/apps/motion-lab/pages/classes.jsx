// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, useIsFocused} from '@ps5-react/core';
import {Page, caption, code} from '../ui.jsx';

const bar = 'h-5 rounded-full bg-sky-400';
const dot = 'size-6 rounded-full bg-accent';

// w-60 (240 logical, 480 physical) keeps focused:scale-105 within the transform buffer. The looping
// tile lifts by translation instead: inside a scaled node, every frame of a loop repaints the whole node.
// The two variants are separate elements because focus classes inside a conditional cannot animate.
const tile = `w-60 h-60 p-5 justify-between rounded-2xl bg-panel border-2 border-edge transition duration-200
  focused:border-accent focused:bg-panel-focus`;

function Tile({title, scale, onPick, children, note}) {
  const content = (
    <>
      <Text style={caption}>{title}</Text>
      {children}
      <Text style={code}>{note}</Text>
    </>
  );
  return scale
    ? <View onPress={() => onPick(title)} className={`${tile} focused:scale-105`}>{content}</View>
    : <View onPress={() => onPick(title)} className={`${tile} focused:-translate-y-2`}>{content}</View>;
}

// The dot follows its tile's focus; it is not focusable itself.
function Slider() {
  const focused = useIsFocused();
  return (
    <View className="h-10 justify-center rounded-full bg-ink px-2">
      <View focused={focused} className={`${dot} transition duration-300 focused:translate-x-24`} />
    </View>
  );
}

export function ClassesPage({onPick}) {
  return (
    <Page intro="The same motion props, written as Tailwind classes and compiled at build time.">
      <View className="flex-row gap-8">
        <Tile title="animate-in" scale onPick={onPick} note="fade-in slide-in-from-bottom-4">
          <View className="gap-3">
            <View className={`${bar} w-full animate-in fade-in slide-in-from-bottom-4 duration-300`} />
            <View className={`${bar} w-3/4 animate-in fade-in slide-in-from-bottom-4 duration-300 delay-75`} />
            <View className={`${bar} w-1/2 animate-in fade-in slide-in-from-bottom-4 duration-300 delay-150`} />
          </View>
        </Tile>
        <Tile title="focused:scale-105" scale onPick={onPick} note="transition focused:translate-x-24">
          <Slider />
        </Tile>
        <Tile title="animate-spin · pulse" onPick={onPick} note="spin · pulse · bounce · ping">
          <View className="flex-row justify-between items-center h-16">
            <View className="size-10 rounded-full border-4 border-edge border-t-accent animate-spin" />
            <View className={`${dot} animate-pulse`} />
            <View className={`${dot} animate-bounce`} />
            <View className="relative size-6">
              <View className={`absolute ${dot} animate-ping`} />
              <View className={dot} />
            </View>
          </View>
        </Tile>
      </View>
    </Page>
  );
}
