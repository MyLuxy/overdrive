// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

const round = (value, digits) => Math.round(value * 10 ** digits) / 10 ** digits;

export function bytes(value) {
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) { value /= 1024; unit++; }
  return `${round(value, unit ? 1 : 0)} ${UNITS[unit]}`;
}

/** Hosts report unknown values as null. */
export const known = (value, format) => (value === null ? 'unknown' : format(value));

export const fixed = value => round(value, 2);
