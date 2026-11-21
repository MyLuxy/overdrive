// ../pub-game-store/native/downloads/SpeedChart.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx, jsxs } from 'react/jsx-runtime';
import { Path, Svg } from '@ps5-react/core';
import { SAMPLES } from './useThroughput.js';
import { px } from '../ui/scale.js';

  function SpeedChart({ samples, max, width, height, color }) {
    if (samples.length < 2 || max <= 0) return /* @__PURE__ */ (0, jsx)(Svg, { width: px(width), height: px(height), viewBox: `0 0 ${width} ${height}` });
    const step = width / (SAMPLES - 1);
    const start = width - (samples.length - 1) * step;
    const points = samples.map((value, i) => `${(start + i * step).toFixed(1)},${(height - 2 - value / max * (height - 4)).toFixed(1)}`);
    const line = `M${points.join("L")}`;
    return /* @__PURE__ */ (0, jsxs)(Svg, { width: px(width), height: px(height), viewBox: `0 0 ${width} ${height}`, children: [
      /* @__PURE__ */ (0, jsx)(Path, { d: `${line}L${width},${height}L${start.toFixed(1)},${height}Z`, fill: `${color}1f` }),
      /* @__PURE__ */ (0, jsx)(Path, { d: line, fill: "none", stroke: color, strokeWidth: 1.5 })
    ] });
  }

export { SpeedChart };
