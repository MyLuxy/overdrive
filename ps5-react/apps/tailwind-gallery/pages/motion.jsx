// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, useIsFocused} from '@ps5-react/core';
import {Card, Page, code} from '../ui.jsx';

const block = 'size-14 rounded-lg bg-fuchsia-500 border-2 border-fuchsia-200';
const ghost = 'absolute size-14 rounded-lg border-2 border-dashed border-slate-500';
const layer = 'absolute w-24 h-16 rounded-lg border-2 border-ink justify-center items-center';
const label = 'font-inter text-xs text-ink';

// Reads the enclosing Card's focus: these blocks are not focusable themselves.
function Spinners() {
  const focused = useIsFocused();
  return (
    <View className="flex-1 flex-row justify-around items-center">
      <View focused={focused}
        className={`${block} bg-sky-500 border-sky-200 focused:scale-125 focused:rotate-45`} />
      <View focused={focused}
        className={`${block} origin-top-left focused:rotate-[30deg] focused:bg-amber-400`} />
    </View>
  );
}

export function TransformPage({at}) {
  const stack = at(2);
  return (
    <Page intro="Transforms with origins, focus-driven variants, absolute insets, z-index, and conditional classes.">
      <Card {...at(0)} title="scale · rotate · translate">
        <View className="flex-row justify-around h-24 items-center">
          <View className="relative size-14">
            <View className={ghost} /><View className={`${block} scale-75`} />
          </View>
          <View className="relative size-14">
            <View className={ghost} /><View className={`${block} -rotate-12`} />
          </View>
          <View className="relative size-14">
            <View className={ghost} /><View className={`${block} translate-x-3 -translate-y-2`} />
          </View>
        </View>
        <Text style={code}>scale-75 · -rotate-12 · translate-x-3 -translate-y-2</Text>
        <View className="h-10 justify-center">
          <View className="w-32 h-3 bg-amber-400 origin-left rotate-6" />
        </View>
        <Text style={code}>origin-left rotate-6</Text>
      </Card>
      <Card {...at(1)} title="focused:scale-125 focused:rotate-45">
        <Spinners />
        <Text style={code}>focus this card; the second pivots on origin-top-left</Text>
      </Card>
      <Card {...stack} title="absolute · inset · z-* · conditional">
        <View className="relative h-36 overflow-hidden rounded-lg bg-slate-900">
          <View className={`${layer} top-3 left-3 z-10 bg-rose-400`}><Text className={label}>z-10</Text></View>
          <View className={`${layer} top-8 left-16 z-30 bg-amber-300`}><Text className={label}>z-30</Text></View>
          <View className={`${layer} top-12 left-28 z-20 bg-emerald-400`}><Text className={label}>z-20</Text></View>
          <View className="absolute inset-x-0 bottom-0 h-6 bg-black/60 justify-center px-3">
            <Text style={code}>inset-x-0 bottom-0</Text>
          </View>
          <View className={`absolute -top-2 -right-2 size-12 rounded-full bg-amber-400
            ${stack.selected ? 'flex' : 'hidden'}`} />
        </View>
        <Text className={`font-inter text-xs ${stack.selected ? 'text-amber-300' : 'text-slate-400'}`}>
          {stack.selected ? 'selected: badge shown' : 'X / Enter on this card shows a badge'}
        </Text>
      </Card>
    </Page>
  );
}
