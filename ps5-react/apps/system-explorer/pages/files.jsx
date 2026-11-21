// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {useState} from 'react';
import {View, Text, ScrollView, FileSystem, FocusScope} from '@ps5-react/core';
import {Panel, Field, Button, Label, Status, attempt, body, mono} from '../ui.jsx';
import {bytes} from '../format.js';

const ROOTS = [FileSystem.dataDir, FileSystem.appDir, FileSystem.tempDir, '/'];
const TEST_FILE = `${FileSystem.dataDir}/system-explorer.txt`;
const PREVIEW_BYTES = 4096;

const join = (dir, name) => (dir === '/' ? `/${name}` : `${dir}/${name}`);
const parent = dir => dir.slice(0, dir.lastIndexOf('/')) || '/';
const printable = text => text.slice(0, 240).replace(/[^\x20-\x7e\n]/g, '?');

function list(dir) {
  return FileSystem.readDir(dir).sort((a, b) =>
    a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name < b.name ? -1 : 1);
}

function writeTestFile() {
  FileSystem.writeFile(TEST_FILE, `Written by System Explorer at ${Date.now()} ms\n`);
  FileSystem.appendFile(TEST_FILE, 'Appended a second line.\n');
  return `Read back: ${FileSystem.readFile(TEST_FILE)}`;
}

function describe(path, entry) {
  if (entry.size > PREVIEW_BYTES) return `${path}: ${bytes(entry.size)}, too large to preview`;
  return `${path}: ${bytes(entry.size)}\n${printable(FileSystem.readFile(path))}`;
}

function Entry({entry, onPress}) {
  return (
    <View onPress={onPress} className="flex-row justify-between px-3 py-1 rounded-md focused:bg-panel-focus">
      <Label>{entry.isDirectory ? `${entry.name}/` : entry.name}</Label>
      <Text style={mono}>{entry.isDirectory ? 'dir' : bytes(entry.size)}</Text>
    </View>
  );
}

export function FilesPage() {
  const [dir, setDir] = useState(FileSystem.dataDir);
  const [listing, setListing] = useState(() => attempt(() => list(FileSystem.dataDir)));
  const [status, setStatus] = useState(null);
  const [usage, setUsage] = useState(() => attempt(() => FileSystem.diskUsage(FileSystem.dataDir)));
  const [mounts, setMounts] = useState(() => attempt(FileSystem.mounts));
  const entries = listing.value ?? [];

  const refresh = path => {
    setListing(attempt(() => list(path)));
    setUsage(attempt(() => FileSystem.diskUsage(path)));
    setMounts(attempt(FileSystem.mounts));
  };

  const open = path => {
    setDir(path);
    refresh(path);
    setStatus(null);
  };
  const write = () => {
    setStatus(attempt(writeTestFile));
    refresh(dir);
  };
  const select = entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory) open(path);
    else setStatus(attempt(() => describe(path, entry)));
  };
  // Circle climbs to the parent folder; at the root it falls through to the enclosing scope.
  const up = () => {
    if (dir === '/') return false;
    open(parent(dir));
    return true;
  };

  return (
    <FocusScope onBack={up}>
      <View className="flex-1 flex-row gap-6">
        <Panel title={`${dir} · ${entries.length} entries`} grow>
          <View className="flex-row flex-wrap gap-2">
            {ROOTS.map(root => <Button key={root} label={root} onPress={() => open(root)} />)}
            <Button label="Write test file" onPress={write} />
            <Button label="Refresh" onPress={() => refresh(dir)} />
          </View>
          <Status status={listing.error ? listing : null} />
          {entries.length === 0 && !listing.error && <Text style={body}>Empty, or not listable here.</Text>}
          <ScrollView className="flex-1 gap-1">
            {entries.map(entry => (
              <Entry key={join(dir, entry.name)} entry={entry} onPress={() => select(entry)} />
            ))}
          </ScrollView>
        </Panel>
        <View className="w-96 gap-5">
          <Panel title="DISK USAGE">
            {usage.error ? <Status status={usage} /> : (
              <View className="gap-3">
                <Field name="Free" value={bytes(usage.value.free)} />
                <Field name="Total" value={bytes(usage.value.total)} />
              </View>
            )}
          </Panel>
          <Panel title="MOUNTS">
            {mounts.error ? <Status status={mounts} /> : mounts.value.slice(0, 6).map(mount => (
              <Text key={mount.path} className="font-inter text-xs text-accent truncate">{mount.path} · {mount.type}</Text>
            ))}
          </Panel>
          <Panel title="RESULT"><Status status={status} /></Panel>
        </View>
      </View>
    </FocusScope>
  );
}
