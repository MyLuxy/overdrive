import {useState} from 'react';
import {AppRegistry, View, Text, FocusScope} from '@ps5-react/core';
import {useInterfaceSounds} from './sounds.js';

const items = ['Play', 'Settings', 'About'];
const label = 'font-inter text-body text-white';

function App() {
  const [selected, setSelected] = useState(null);
  useInterfaceSounds();
  const clear = () => {
    setSelected(null);
    return true;
  };

  return (
    <FocusScope autoFocus wrap onBack={clear}>
      <View className="w-screen h-screen bg-ink items-center justify-center gap-8">
        <Text className="font-inter text-title text-white">__TITLE__</Text>
        <View className="flex-row gap-4">
          {items.map(item => (
            <View key={item} onPress={() => setSelected(item)} className="w-[220px] h-[92px] rounded-xl
              border-[3px] border-edge bg-panel items-center justify-center
              focused:border-accent focused:bg-panel-focus focused:scale-105">
              <Text className={label}>{item}</Text>
            </View>
          ))}
        </View>
        <Text className="font-inter text-hint text-accent">
          {selected ? `${selected} selected - Circle / Backspace: back` : 'D-pad: move    X / Enter: select'}
        </Text>
      </View>
    </FocusScope>
  );
}

AppRegistry.registerComponent('__NAME__', () => App);
