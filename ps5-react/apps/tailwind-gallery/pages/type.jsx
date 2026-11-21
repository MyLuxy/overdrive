// Copyright (C) 2026 half144 and PS5 React contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Additional attribution term: see LICENSE-ATTRIBUTION.
import {Text} from '@ps5-react/core';
import {Card, Page, code} from '../ui.jsx';

const t = 'font-inter text-slate-100';
const prose = 'The renderer receives plain style objects; every class here was compiled at build time.';

export function TypePage({at}) {
  return (
    <Page intro="A six-step type scale from theme.fontSize, plus weight, style, decoration, and text layout.">
      <Card {...at(0)} title="text-xs … text-2xl">
        <Text className={`${t} text-xs`}>text-xs 14px</Text>
        <Text className={`${t} text-sm`}>text-sm 16px</Text>
        <Text className={`${t} text-base`}>text-base 20px</Text>
        <Text className={`${t} text-lg`}>text-lg 24px</Text>
        <Text className={`${t} text-xl`}>text-xl 32px</Text>
        <Text className={`${t} text-2xl text-accent`}>2xl</Text>
      </Card>
      <Card {...at(1)} title="weight · italic · decoration · tracking">
        <Text className={`${t} text-base font-light`}>font-light</Text>
        <Text className={`${t} text-base font-bold`}>font-bold</Text>
        <Text className={`${t} text-base italic`}>italic</Text>
        <Text className={`${t} text-base underline`}>underline</Text>
        <Text className={`${t} text-base line-through text-rose-300`}>line-through</Text>
        <Text className={`${t} text-base tracking-tighter`}>tracking-tighter</Text>
        <Text className={`${t} text-base tracking-widest`}>tracking-widest</Text>
      </Card>
      <Card {...at(2)} title="leading · align · truncate · line-clamp">
        <Text className={`${t} text-sm leading-tight`}>{prose}</Text>
        <Text className={`${t} text-sm leading-loose text-right`}>{prose}</Text>
        <Text className={`${t} text-sm text-center truncate`}>{prose}</Text>
        <Text className={`${t} text-sm line-clamp-2 text-slate-400`}>{prose} {prose}</Text>
        <Text style={code}>tight · loose right · truncate · line-clamp-2</Text>
      </Card>
    </Page>
  );
}
