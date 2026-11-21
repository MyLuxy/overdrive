// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, tw} from '@ps5-react/core';
import {Card, Page, code} from '../ui.jsx';

const bar = 'h-3 rounded-full bg-emerald-400';
const dot = 'size-6 rounded-full bg-sky-400';
const justify = [
  ['justify-between', tw`justify-between`],
  ['justify-around', tw`justify-around`],
  ['justify-evenly', tw`justify-evenly`],
];
const chip = 'px-3 py-1 rounded-full bg-violet-500/30 border border-violet-400';

export function SpacingPage({at}) {
  return (
    <Page intro="Padding, margin, gap, fixed and fractional sizes. Values are logical 1280-wide pixels.">
      <Card {...at(0)} title="p-* · px/py · mt/ml · -m">
        <View className="bg-sky-500/20 p-6"><View className="h-4 bg-sky-400" /></View>
        <View className="bg-sky-500/20 px-12 py-1"><View className="h-4 bg-sky-400" /></View>
        <View className="bg-sky-500/20 pb-2">
          <View className="mt-2 ml-18 h-4 bg-sky-400" />
          <View className="-mt-1 mx-4 h-4 bg-rose-400/80" />
        </View>
        <Text style={code}>p-6 · px-12 py-1 · ml-18 (theme.extend) · -mt-1</Text>
      </Card>
      <Card {...at(1)} title="w-1/4 · w-1/2 · w-2/3 · w-full">
        <View className="gap-3">
          <View className={`${bar} w-1/4`} />
          <View className={`${bar} w-1/2`} />
          <View className={`${bar} w-2/3`} />
          <View className={`${bar} w-full bg-emerald-600`} />
        </View>
        <View className="flex-row h-10 gap-1">
          <View className="basis-1/3 bg-amber-400" />
          <View className="grow bg-amber-600" />
        </View>
        <Text style={code}>basis-1/3 + grow</Text>
      </Card>
      <Card {...at(2)} title="size-* · aspect-* · min/max">
        <View className="flex-row items-end gap-3">
          <View className="size-6 bg-pink-400" />
          <View className="size-10 bg-pink-500" />
          <View className="size-14 bg-pink-600" />
          <View className="w-24 aspect-video bg-indigo-500" />
        </View>
        <View className="w-full max-w-[160px] min-h-8 bg-teal-500/60 justify-center px-2">
          <Text style={code}>max-w-[160px]</Text>
        </View>
        <Text style={code}>size-6/10/14 · w-24 aspect-video</Text>
      </Card>
    </Page>
  );
}

export function FlexPage({at}) {
  return (
    <Page intro="Direction, justification, alignment, wrapping, and gaps; the engine is flexbox only.">
      <Card {...at(0)} title="justify-between · around · evenly">
        {justify.map(([name, style]) => (
          <View key={name} className="gap-1">
            <Text style={code}>{name}</Text>
            <View className="flex-row bg-slate-900 py-1" style={style}>
              <View className={dot} /><View className={dot} /><View className={dot} />
            </View>
          </View>
        ))}
      </Card>
      <Card {...at(1)} title="items-* · self-* · flex-row-reverse">
        <View className="flex-row items-center gap-2 h-20 bg-slate-900 px-2">
          <View className="w-8 h-6 bg-lime-400" />
          <View className="w-8 h-14 bg-lime-500" />
          <View className="w-8 h-6 bg-lime-300 self-start" />
          <View className="w-8 h-6 bg-lime-600 self-end" />
        </View>
        <View className="flex-row-reverse gap-2">
          <View className="size-8 rounded bg-orange-300" />
          <View className="size-8 rounded bg-orange-400" />
          <View className="size-8 rounded bg-orange-600" />
        </View>
        <Text style={code}>items-center · self-start/end</Text>
      </Card>
      <Card {...at(2)} title="flex-wrap · gap-x-* · gap-y-*">
        <View className="flex-row flex-wrap gap-x-2 gap-y-3">
          {['View', 'Text', 'gap', 'wrap', 'React', 'QuickJS', 'PS5', 'flex'].map(label => (
            <View key={label} className={chip}><Text style={code}>{label}</Text></View>
          ))}
        </View>
        <View className="flex-row gap-2">
          <View className="flex-none w-16 h-8 bg-cyan-700" />
          <View className="flex-1 h-8 bg-cyan-500" />
          <View className="flex-[2] h-8 bg-cyan-300" />
        </View>
        <Text style={code}>flex-none · flex-1 · flex-[2]</Text>
      </Card>
    </Page>
  );
}
