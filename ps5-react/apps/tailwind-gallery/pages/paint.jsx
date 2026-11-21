// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, tw} from '@ps5-react/core';
import {Card, Page, code} from '../ui.jsx';

const swatches = [tw`bg-rose-500`, tw`bg-orange-400`, tw`bg-amber-300`, tw`bg-lime-400`,
  tw`bg-emerald-500`, tw`bg-sky-500`, tw`bg-indigo-500`, tw`bg-fuchsia-500`];
const alphas = [['/100', tw`bg-sky-400/100`], ['/75', tw`bg-sky-400/75`], ['/50', tw`bg-sky-400/50`],
  ['/25', tw`bg-sky-400/25`], ['/[0.1]', tw`bg-sky-400/[0.1]`]];
const tile = 'flex-1 h-12 rounded-lg bg-white justify-center items-center';
const dark = 'font-inter text-xs text-ink';
const frame = 'h-16 bg-slate-900 justify-center items-center border-slate-300';

export function ColorPage({at}) {
  return (
    <Page intro="The Tailwind v3.4 palette, theme colors, opacity modifiers, and element opacity.">
      <Card {...at(0)} title="palette · theme.extend colors">
        <View className="flex-row flex-wrap gap-2">
          {swatches.map((style, i) => <View key={i} className="size-12 rounded-md" style={style} />)}
        </View>
        <View className="flex-row gap-2">
          <View className="flex-1 h-10 bg-ink border border-slate-600" />
          <View className="flex-1 h-10 bg-panel-focus" />
          <View className="flex-1 h-10 bg-accent" />
          <View className="flex-1 h-10 bg-[#ff6b35]" />
        </View>
        <Text style={code}>bg-ink · bg-panel-focus · bg-accent · bg-[#ff6b35]</Text>
      </Card>
      <Card {...at(1)} title="color/alpha modifiers">
        <View className="bg-amber-400 p-2 gap-2">
          {alphas.map(([label, style]) => (
            <View key={label} className="h-8 justify-center px-2" style={style}>
              <Text className={dark}>{label}</Text>
            </View>
          ))}
        </View>
        <Text className="font-inter text-sm text-white/50">text-white/50 on the panel</Text>
      </Card>
      <Card {...at(2)} title="opacity-*">
        <View className="flex-row gap-2">
          <View className={`${tile} opacity-100`}><Text className={dark}>100</Text></View>
          <View className={`${tile} opacity-75`}><Text className={dark}>75</Text></View>
          <View className={`${tile} opacity-50`}><Text className={dark}>50</Text></View>
          <View className={`${tile} opacity-25`}><Text className={dark}>25</Text></View>
        </View>
        <Text style={code}>whole-element opacity also fades children</Text>
      </Card>
    </Page>
  );
}

export function BorderPage({at}) {
  return (
    <Page intro="Widths and colors per side, line styles, and radii per corner.">
      <Card {...at(0)} title="border-t/r/b/l · border-x/y">
        <View className={`${frame} border-t-4 border-t-rose-400`}><Text style={code}>border-t-4</Text></View>
        <View className={`${frame} border-l-8 border-l-amber-400`}><Text style={code}>border-l-8</Text></View>
        <View className={`${frame} border-x-2 border-y-[6px] border-y-emerald-400`}>
          <Text style={code}>border-x-2 border-y-[6px]</Text>
        </View>
      </Card>
      <Card {...at(1)} title="border-solid · dashed · dotted">
        <View className={`${frame} border-4 border-solid border-sky-400`}><Text style={code}>solid</Text></View>
        <View className={`${frame} border-4 border-dashed border-sky-400`}><Text style={code}>dashed</Text></View>
        <View className={`${frame} border-4 border-dotted border-sky-400`}><Text style={code}>dotted</Text></View>
      </Card>
      <Card {...at(2)} title="rounded-* per corner">
        <View className="flex-row flex-wrap gap-3">
          <View className="size-16 bg-violet-500 rounded-none" />
          <View className="size-16 bg-violet-500 rounded-xl" />
          <View className="size-16 bg-violet-500 rounded-full" />
          <View className="size-16 bg-violet-500 rounded-tl-3xl rounded-br-3xl" />
          <View className="size-16 bg-violet-500 rounded-t-2xl" />
          <View className="size-16 bg-violet-500 rounded-r-[28px]" />
        </View>
        <Text style={code}>none · xl · full · tl/br-3xl · t-2xl · r-[28px]</Text>
      </Card>
    </Page>
  );
}
