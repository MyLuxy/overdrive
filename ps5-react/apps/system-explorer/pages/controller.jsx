// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useState} from 'react';
import {View, Text, Controller, useControllerEvents, useGamepad} from '@ps5-react/core';
import {Panel, Button, Status, attempt, mono} from '../ui.jsx';
import {fixed} from '../format.js';

const BUTTONS = ['up', 'down', 'left', 'right', 'cross', 'circle', 'triangle', 'square',
  'l1', 'r1', 'l2', 'r2', 'l3', 'r3', 'options', 'touchpad'];
const COLORS = [['sky', '#38bdf8'], ['rose', '#f43f5e'], ['lime', '#84cc16'], ['amber', '#f59e0b']];
const EFFECTS = [
  {type: 'resistance', from: 0.3, strength: 0.6},
  {type: 'weapon', start: 0.25, end: 0.75, strength: 0.75},
  {type: 'vibration', from: 0.2, amplitude: 0.6, frequency: 30},
  {type: 'off'},
];
const EVENT_LINES = 6;

const describe = event => (event.type === 'trigger' ? `${event.trigger} at ${fixed(event.value)}`
  : event.type === 'release' ? `release ${event.button} after ${Math.round(event.heldMs)} ms` : `press ${event.button}`);

// The dot is 15% of the box, so its left/top inset spans 0..85%.
const offset = axis => `${(axis + 1) * 42.5}%`;

function Stick({name, x, y}) {
  return (
    <View className="items-center gap-2">
      <View className="relative size-40 rounded-xl border-2 border-slate-600 bg-ink">
        <View className="absolute size-6 rounded-full bg-accent" style={{left: offset(x), top: offset(y)}} />
      </View>
      <Text style={mono}>{name} {fixed(x)}, {fixed(y)}</Text>
    </View>
  );
}

function Trigger({name, value}) {
  return (
    <View className="gap-1">
      <Text style={mono}>{name} {fixed(value)}</Text>
      <View className="w-40 h-4 rounded-full bg-slate-800 overflow-hidden">
        <View className="h-full bg-accent" style={{width: `${value * 100}%`}} />
      </View>
    </View>
  );
}

export function ControllerPage() {
  const pad = useGamepad();
  const [color, setColor] = useState(-1);
  const [status, setStatus] = useState(null);
  const [effect, setEffect] = useState(-1);
  const [events, setEvents] = useState([]);
  useControllerEvents(event => {
    // Travel changes every frame a trigger moves: one line per trigger, logged per tenth.
    if (event.type !== 'trigger' || Math.floor(event.value * 10) !== Math.floor(event.previous * 10))
      console.log(`[controller] ${describe(event)}`);
    setEvents(lines => {
      const same = event.type === 'trigger' && lines[0]?.startsWith(event.trigger);
      return [describe(event), ...lines.slice(same ? 1 : 0, EVENT_LINES - (same ? 0 : 1))];
    });
  });
  const actions = [
    ['Cycle light bar', () => {
      const next = (color + 1) % COLORS.length;
      Controller.setLightBar(COLORS[next][1]);
      setColor(next);
      return `Light bar: ${COLORS[next][0]}`;
    }],
    ['Vibrate', () => { Controller.vibrate(0.8, 300); return 'Vibrating for 300 ms'; }],
    ['Reset light bar', () => { Controller.resetLightBar(); return 'Light bar reset'; }],
    ['Cycle trigger effect', () => {
      const next = (effect + 1) % EFFECTS.length;
      Controller.setTriggerEffect('both', EFFECTS[next]);
      setEffect(next);
      return `Triggers: ${JSON.stringify(EFFECTS[next])}`;
    }],
  ];

  return (
    <View className="flex-1 gap-5">
      <View className="flex-row gap-6">
        <Panel title={pad.connected ? 'STICKS' : 'STICKS · NO CONTROLLER'}>
          <View className="flex-row gap-8">
            <Stick name="left" x={pad.leftX} y={pad.leftY} />
            <Stick name="right" x={pad.rightX} y={pad.rightY} />
          </View>
        </Panel>
        <Panel title="TRIGGERS AND BUTTONS" grow>
          <View className="flex-row gap-6">
            <Trigger name="L2" value={pad.l2} />
            <Trigger name="R2" value={pad.r2} />
          </View>
          <View className="flex-row flex-wrap gap-2">
            {BUTTONS.map(button => {
              const held = pad.buttons.includes(button);
              return (
                <View key={button} selected={held}
                  className="px-3 py-1 rounded-full border border-slate-600 selected:bg-accent selected:border-accent">
                  <Text selected={held} className="font-inter text-xs text-slate-400 selected:text-ink">{button}</Text>
                </View>
              );
            })}
          </View>
        </Panel>
        <Panel title="EVENTS">
          <View className="w-72 gap-1">
            {events.length ? events.map((line, index) => <Text key={index} style={mono}>{line}</Text>)
              : <Text style={mono}>press, hold or squeeze something</Text>}
          </View>
        </Panel>
      </View>
      <View className="flex-row gap-3">
        {actions.map(([label, run]) => <Button key={label} label={label} onPress={() => setStatus(attempt(run))} />)}
      </View>
      <Status status={status} />
    </View>
  );
}
