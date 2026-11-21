// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useState} from 'react';
import {View, Platform, DeviceInfo, Users} from '@ps5-react/core';
import {Panel, Field, Button, Status, attempt} from '../ui.jsx';
import {bytes, known, fixed} from '../format.js';

const celsius = value => `${value} °C`;
const user = entry => `${entry.name} (${entry.id})`;
const offset = minutes => `UTC${minutes < 0 ? '-' : '+'}${Math.floor(Math.abs(minutes) / 60)}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;

function read() {
  return {
    platform: Platform.OS,
    target: Platform.select({ps5: 'Console title', desktop: 'macOS preview'}),
    device: DeviceInfo.get(),
    utcOffset: DeviceInfo.utcOffset(),
    foreground: Users.getForeground(),
    users: Users.getLoggedIn(),
  };
}

export function DevicePage() {
  const [info, setInfo] = useState(() => attempt(read));
  if (info.error) return <Status status={info} />;
  const {platform, target, device, utcOffset, foreground, users} = info.value;

  return (
    <View className="flex-1 gap-5">
      <View className="flex-row gap-6">
        <Panel title="PLATFORM" grow>
          <Field name="Platform.OS" value={platform} />
          <Field name="Platform.select" value={target} />
          <Field name="Model" value={known(device.model, String)} />
          <Field name="Firmware" value={known(device.firmware, String)} />
          <Field name="Time zone" value={offset(utcOffset)} />
        </Panel>
        <Panel title="USERS" grow>
          <Field name="Foreground" value={foreground ? user(foreground) : 'none'} />
          <Field name="Logged in" value={users.length ? users.map(user).join(', ') : 'none'} />
        </Panel>
      </View>
      <Panel title="HARDWARE">
        <Field name="CPU temperature" value={known(device.cpuTemperature, celsius)} />
        <Field name="SoC temperature" value={known(device.socTemperature, celsius)} />
        <Field name="CPU frequency" value={known(device.cpuFrequency, hz => `${Math.round(hz / 1e6)} MHz`)} />
        <Field name="Free memory" value={known(device.freeMemory, bytes)} />
        <Field name="Process CPU time" value={known(device.processTime, us => `${fixed(us / 1e6)} s`)} />
      </Panel>
      <View className="self-start"><Button label="Refresh" onPress={() => setInfo(attempt(read))} /></View>
    </View>
  );
}
