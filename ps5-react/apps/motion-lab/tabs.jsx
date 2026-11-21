// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, FocusScope, motion, transitions} from '@ps5-react/core';

// Tabs share one fixed width (w-36) so the pill can glide by pure translation.
const STEP = 144 + 8;

/** Tab row whose single highlight pill slides to the active tab; focusing a tab selects it. */
export function Tabs({labels, active, focused, onSelect, onEnter}) {
  return (
    <FocusScope focusKey="tabs" autoFocus wrap>
      <View className="self-start relative flex-row gap-2 p-1 rounded-full bg-panel">
        <motion.View className="absolute top-1 left-1 w-36 h-10 rounded-full bg-panel-focus border-2 border-accent"
          initial={false} animate={{x: active * STEP, opacity: focused ? 1 : 0.4}} transition={transitions.focus} />
        {labels.map((label, index) => (
          <View key={label} focusKey={`tab:${label}`} onFocus={() => onSelect(index)} onPress={onEnter}
            className="w-36 h-10 items-center justify-center">
            <Text className={`font-inter text-hint ${index === active ? 'text-white' : 'text-slate-400'}`}>{label}</Text>
          </View>
        ))}
      </View>
    </FocusScope>
  );
}
