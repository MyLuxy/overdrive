// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {View, Text, motion, transitions} from '@ps5-react/core';
import {caption} from './ui.jsx';

// 240 logical px wide (480 physical) keeps the pop's scale inside the transform buffer.
export function Toast({text}) {
  return (
    <motion.View className="absolute bottom-20 right-10 w-60 px-4 py-3 gap-1 rounded-2xl
      bg-panel-focus border-2 border-accent"
      initial={{opacity: 0, y: 24, scale: 0.9}} animate={{opacity: 1, y: 0, scale: 1}}
      exit={{opacity: 0, y: 12, transition: transitions.exit}} transition={transitions.pop}>
      <Text style={caption}>PINNED</Text>
      <Text className="font-inter text-hint text-white truncate">{text}</Text>
    </motion.View>
  );
}
