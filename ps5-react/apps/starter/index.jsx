// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useLayoutEffect, useState} from 'react';
import {AppRegistry, View, Text, FocusScope} from '@ps5-react/core';
import {useInterfaceSounds} from './sounds.js';

const text = 'font-inter text-body text-white';
const BUTTONS = [['Add 1', count => count + 1], ['Add 10', count => count + 10], ['Reset', () => 0]];

// The desktop self-test reads __ps5ReactTestState; `focus` mirrors the focused button, it never drives it.
function App() {
  const [state, setState] = useState({focus: 0, count: 0, detail: false});
  const {focus, count, detail} = state;
  useInterfaceSounds();
  useLayoutEffect(() => {
    globalThis.__ps5ReactTestState = {focus, count, detail: Number(detail)};
  }, [focus, count, detail]);
  const close = () => {
    setState(previous => ({...previous, detail: false}));
    return true;
  };

  // Classes are logical 1280-wide pixels, scaled to render.width at build time.
  return (
    <FocusScope wrap onBack={close}>
      <View className="w-screen h-screen bg-ink items-center justify-center gap-6">
        <Text className={`${text} text-title`}>PS5 React</Text>
        <Text className={text}>Count: {count}</Text>
        {detail ? (
          <View focusable autoFocus onPress={close} className="gap-6 items-center">
            <Text className={text}>Value updated</Text>
            <Text className={`${text} text-accent`}>Circle / Backspace: back</Text>
          </View>
        ) : (
          <View className="flex-row gap-4">
            {BUTTONS.map(([label, update], index) => (
              <View key={label} focusable autoFocus={index === focus}
                onFocus={() => setState(previous => ({...previous, focus: index}))}
                onPress={() => setState(previous => ({...previous, detail: true, count: update(previous.count)}))}
                className="w-[220px] h-[92px] rounded-xl border-[3px] border-edge bg-panel
                  justify-center items-center focused:border-accent focused:bg-panel-focus">
                <Text className={text}>{label}</Text>
              </View>
            ))}
          </View>
        )}
        <Text className={`${text} text-hint text-accent`}>
          D-pad: choose    X / Enter: confirm
        </Text>
      </View>
    </FocusScope>
  );
}
AppRegistry.registerComponent('overdrive-proof', () => App);
