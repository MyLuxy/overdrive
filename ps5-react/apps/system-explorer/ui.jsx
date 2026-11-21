// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, tw, useIsFocused} from '@ps5-react/core';

export const caption = tw`font-inter text-xs text-slate-400 tracking-wider`;
export const body = tw`font-inter text-sm text-slate-100`;
export const mono = tw`font-inter text-xs text-accent`;

/** Runs a native call, capturing its error message for display instead of throwing. */
export function attempt(call) {
  try {
    return {value: call()};
  } catch (error) {
    return {error: error.message};
  }
}

export function Panel({title, children, grow}) {
  return (
    <View className={`p-5 gap-3 rounded-2xl border-2 border-slate-700 bg-panel ${grow ? 'flex-1' : ''}`}>
      <Text style={caption}>{title}</Text>
      {children}
    </View>
  );
}

export function Field({name, value}) {
  return (
    <View className="flex-row justify-between gap-4">
      <Text className="font-inter text-sm text-slate-400">{name}</Text>
      <Text style={body}>{value}</Text>
    </View>
  );
}

/** Text that brightens while its focusable parent has focus; Text cannot read focus by itself. */
export function Label({children}) {
  const focused = useIsFocused();
  return <Text focused={focused} className="font-inter text-sm text-slate-300 focused:text-white">{children}</Text>;
}

export function Button({label, onPress}) {
  return (
    <View onPress={onPress}
      className="px-5 py-2 rounded-full border-2 border-slate-600 bg-slate-800
        focused:border-accent focused:bg-panel-focus focused:scale-105">
      <Label>{label}</Label>
    </View>
  );
}

/** Shows the last action's result: a string value, or an error in red. */
export function Status({status}) {
  if (!status) return null;
  return (
    <Text className={`font-inter text-sm ${status.error ? 'text-rose-400' : 'text-emerald-300'}`}>
      {status.error ?? status.value}
    </Text>
  );
}
