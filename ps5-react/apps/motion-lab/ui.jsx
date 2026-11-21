// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, tw} from '@ps5-react/core';

// className consts cannot cross files, so shared text styles travel as compiled tw objects.
export const caption = tw`font-inter text-caption text-slate-400 tracking-wider`;
export const body = tw`font-inter text-hint text-slate-100`;
export const code = tw`font-inter text-caption text-accent`;

export function Page({intro, children}) {
  return (
    <View className="flex-1 gap-6">
      <Text style={body}>{intro}</Text>
      {children}
    </View>
  );
}
