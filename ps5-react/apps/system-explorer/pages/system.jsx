// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useEffect, useState} from 'react';
import {View, Text, Notifications, Linking, BackHandler, Display} from '@ps5-react/core';
import {Panel, Field, Button, Status, attempt, body} from '../ui.jsx';

const REPO = 'https://github.com/half144/ps5-react';

const ACTIONS = [
  ['Send notification', () => Notifications.show('Hello from System Explorer', 'Sent with PS5 React')
    ? 'Notification sent' : 'The host could not show the notification'],
  ['Open GitHub', () => (Linking.openURL(REPO) ? `Opened ${REPO}` : 'The host could not open the browser')],
  ['Exit app', () => { BackHandler.exitApp(); return 'Exiting…'; }],
];

// The switch happens after the frame, and the PS5 knows the accepted mode a frame later, so the rate is polled.
function useRefreshRate() {
  const [rate, setRate] = useState(() => Display.refreshRate());
  useEffect(() => {
    const timer = setInterval(() => setRate(Display.refreshRate()), 500);
    return () => clearInterval(timer);
  }, []);
  return rate;
}

export function SystemPage() {
  const [status, setStatus] = useState(null);
  const [displayStatus, setDisplayStatus] = useState(null);
  const rate = useRefreshRate();

  return (
    <View className="flex-1 gap-5">
      <Panel title="SYSTEM SERVICES">
        <Text style={body}>Notifications.show, Linking.openURL, and BackHandler.exitApp.</Text>
        <View className="flex-row gap-3">
          {ACTIONS.map(([label, run]) => (
            <Button key={label} label={label} onPress={() => setStatus(attempt(run))} />
          ))}
        </View>
        <Status status={status} />
      </Panel>
      <Panel title="DISPLAY">
        <Text style={body}>Display.refreshRate and Display.setRefreshRate, between the app.json refreshRates.</Text>
        <Field name="Refresh rate" value={`${rate} Hz`} />
        <View className="flex-row gap-3">
          {[60, 120].map(hz => (
            <Button key={hz} label={`${hz} Hz`}
              onPress={() => setDisplayStatus(attempt(() => { Display.setRefreshRate(hz); return `Switching to ${hz} Hz`; }))} />
          ))}
        </View>
        <Status status={displayStatus} />
      </Panel>
    </View>
  );
}
