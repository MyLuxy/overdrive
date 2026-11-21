// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
// Integer PCM WAV files, for the bundler's sound baking and tools/ui_sounds.mjs.
import {readFileSync} from 'node:fs';

/**
 * Reads a 16- or 24-bit integer PCM WAV.
 * @param {string} path
 * @returns {{rate: number, channels: number, bits: number, samples: Int32Array}} interleaved samples
 */
export function readWav(path) {
  const file = readFileSync(path);
  if (file.toString('ascii', 0, 4) !== 'RIFF' || file.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a RIFF/WAVE file');
  }
  let format = null;
  for (let at = 12; at + 8 <= file.length; at += 8 + file.readUInt32LE(at + 4) + (file.readUInt32LE(at + 4) & 1)) {
    const id = file.toString('ascii', at, at + 4);
    if (id === 'fmt ') {
      format = {code: file.readUInt16LE(at + 8), channels: file.readUInt16LE(at + 10),
        rate: file.readUInt32LE(at + 12), bits: file.readUInt16LE(at + 22)};
    } else if (id === 'data' && format) {
      const {code, channels, rate, bits} = format;
      if ((code !== 1 && code !== 0xfffe) || (bits !== 16 && bits !== 24) || channels < 1) {
        throw new Error(`expected 16- or 24-bit integer PCM; got format ${code}, ${bits}-bit, ${channels} channels`);
      }
      const bytes = bits / 8;
      const data = file.subarray(at + 8, at + 8 + file.readUInt32LE(at + 4));
      const count = Math.floor(data.length / (bytes * channels)) * channels;
      return {rate, channels, bits, samples: Int32Array.from({length: count}, (_, i) => data.readIntLE(i * bytes, bytes))};
    }
  }
  throw new Error('no fmt and data chunks');
}

/** @param {ArrayLike<number>} samples mono, -1..1 @param {number} rate @returns {Buffer} a 16-bit WAV */
export function encodeWav(samples, rate) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; ++i) {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
