// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, tw} from '@ps5-react/core';

// className consts cannot cross files, so shared text styles travel as compiled tw objects.
export const caption = tw`font-inter text-xs text-slate-400 tracking-wider`;
export const body = tw`font-inter text-sm text-slate-100`;
export const code = tw`font-inter text-xs text-accent`;

/** A focusable demo tile: its own focus and the `selected` prop drive the variants below. */
export function Card({title, selected, onPress, children}) {
  return (
    <View onPress={onPress} selected={selected}
      className="flex-1 p-5 gap-4 rounded-2xl border-2 border-slate-700 bg-panel
        focused:border-accent focused:bg-panel-focus selected:border-amber-400
        focused:selected:border-amber-200">
      <Text style={caption}>{title}</Text>
      {children}
    </View>
  );
}

export function Page({intro, children}) {
  return (
    <View className="flex-1 gap-5">
      <Text style={body}>{intro}</Text>
      <View className="flex-1 flex-row gap-6">{children}</View>
    </View>
  );
}
