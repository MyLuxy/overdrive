// ../pub-game-store/native/downloads/StatsStrip.jsx
// reconstructed from the esbuild bundle in eboot.bin

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { SpeedChart } from './SpeedChart.jsx';
import { formatSpeed } from './format.js';
import { useThroughput } from './useThroughput.js';
import { useLocale, useT } from '../i18n/index.js';
import { colors } from '../ui/colors.js';
import { Text, View } from '@ps5-react/core';

  var CHART = { width: 260, height: 44 };
  function Stat({ label, value, chart, first }) {
    const { rtl } = useLocale();
    return /* @__PURE__ */ (0, jsxs)(View, { style: [
      { height: 108, flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
      rtl ? { paddingRight: 30, paddingLeft: 24 } : { paddingLeft: 30, paddingRight: 24 },
      first ? null : rtl ? { borderRightWidth: 2, borderColor: "#2a2a2f" } : { borderLeftWidth: 2, borderColor: "#2a2a2f" }
    ], children: [
      /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 3 }, children: [
        /* @__PURE__ */ (0, jsx)(Text, { style: { fontFamily: "Inter-Regular", fontSize: 21, fontWeight: 600, color: "#f2f2f3", lineHeight: 30 }, children: label }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { width: 210, fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: value })
      ] }),
      chart
    ] });
  }
  var latest = (samples) => samples[samples.length - 1] ?? 0;
  function StatsStrip({ id }) {
    const t2 = useT();
    const { network, disk } = useThroughput(id);
    const max = Math.max(...network, ...disk, 1);
    return /* @__PURE__ */ (0, jsxs)(View, { style: { flexDirection: "row", borderTopWidth: 2, borderColor: "#2a2a2f" }, children: [
      /* @__PURE__ */ (0, jsx)(
        Stat,
        {
          first: true,
          label: t2("downloads.stats.download"),
          value: formatSpeed(latest(network)),
          chart: /* @__PURE__ */ (0, jsx)(SpeedChart, { samples: network, max, color: colors.fg, ...CHART })
        }
      ),
      /* @__PURE__ */ (0, jsx)(
        Stat,
        {
          label: t2("downloads.stats.write"),
          value: formatSpeed(latest(disk)),
          chart: /* @__PURE__ */ (0, jsx)(SpeedChart, { samples: disk, max, color: colors.muted, ...CHART })
        }
      )
    ] });
  }

export { StatsStrip };
