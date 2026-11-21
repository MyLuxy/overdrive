// ../pub-game-store/native/downloads/RowProgress.jsx
// reconstructed from the esbuild bundle in eboot.bin
// MODIFIED: progress track width derived from the text row width, so the bar ends where the
// right-aligned size does (the download row's info button narrowed the column).

import '../assets/Inter-Regular.ttf';
import { jsx, jsxs } from 'react/jsx-runtime';
import { formatTimeLeft } from './format.js';
import { fractionOf, useProgress } from './useQueue.js';
import { SPAN_MAX, fitBytes } from '../i18n/fit.js';
import { useT } from '../i18n/index.js';
import { formatBytes } from '../state/size.js';
import { ProgressBar } from '../ui/ProgressBar.jsx';
import { ShimmerText } from '../ui/ShimmerText.jsx';
import { colors } from '../ui/colors.js';
import { logical } from '../ui/scale.js';
import { Text, View } from '@ps5-react/core';

  // ProgressBar scales what it is given by px(); the rows below are drawn in raw pixels. Passing the
  // logical width makes the track end exactly on the rows' right edge at any screen size.
  var ROW = 830;
  var TRACK2 = logical(ROW);
  // `open`: work with no known total (an extraction past its size estimate), drawn as a full, dimmed bar.
  var LABEL = { fontFamily: "Inter-Regular", fontSize: 21, lineHeight: 30 };
  function RowProgress({ id, label, moving, waiting: waiting2, complete, open, detail: detail2 }) {
    const t2 = useT();
    const progress = useProgress(id);
    const { written = 0, total = null, bytesPerSecond = 0 } = progress ?? {};
    const left = moving && total && bytesPerSecond ? formatTimeLeft((total - written) / bytesPerSecond) : "";
    const size = detail2 ?? (complete ? formatBytes(total || written) : total ? t2("download.status.progress", { done: formatBytes(written), total: formatBytes(total) }) : written ? t2("download.soFar", { size: formatBytes(written) }) : "");
    return /* @__PURE__ */ (0, jsxs)(View, { style: { gap: 12 }, children: [
      /* @__PURE__ */ (0, jsx)(ProgressBar, { fraction: complete || open ? 1 : fractionOf(progress), width: TRACK2, active: (moving && !open) || complete }),
      /* @__PURE__ */ (0, jsxs)(View, { style: { width: ROW, flexDirection: "row", justifyContent: "space-between" }, children: [
        waiting2 ? /* @__PURE__ */ (0, jsx)(View, { style: { width: 505 }, children: /* @__PURE__ */ (0, jsx)(ShimmerText, { textStyle: LABEL, background: colors.surface, children: label }) }) : /* @__PURE__ */ (0, jsxs)(Text, { style: { width: 505, fontFamily: "Inter-Regular", fontSize: 21, color: "#f2f2f3", numberOfLines: 1, ellipsizeMode: "tail", lineHeight: 30 }, children: [
          fitBytes(label, SPAN_MAX),
          /* @__PURE__ */ (0, jsx)(Text, { style: { color: "#a3a3ab" }, children: left ? fitBytes(`  ${left}`, SPAN_MAX) : "" })
        ] }),
        /* @__PURE__ */ (0, jsx)(Text, { style: { width: 315, textAlign: "end", fontFamily: "Inter-Regular", fontSize: 21, color: "#a3a3ab", lineHeight: 30 }, children: size })
      ] })
    ] });
  }

export { RowProgress, ROW };
