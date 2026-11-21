// A QR code drawn with plain Views: the phone login's approval page, scanned off the TV. Each row's
// dark modules are joined into runs, so a version-4 code (33 modules) takes a few hundred Views, not
// a thousand; the white square carries the four-module quiet zone a phone camera needs.

import { jsx } from 'react/jsx-runtime';
import { useMemo } from 'react';
import { qrcodegen } from '../third_party/qrcodegen.js';
import { View } from '@ps5-react/core';

  // [[start, length], ...] of the dark runs in each row; null when the text does not fit a QR code.
  function qrRuns(text) {
    let code;
    try {
      code = qrcodegen.QrCode.encodeText(String(text || ""), qrcodegen.QrCode.Ecc.MEDIUM);
    } catch {
      return null;
    }
    const rows = [];
    for (let y = 0; y < code.size; y++) {
      const runs = [];
      for (let x = 0; x < code.size;) {
        if (!code.getModule(x, y)) {
          x++;
          continue;
        }
        const start = x;
        while (x < code.size && code.getModule(x, y)) x++;
        runs.push([start, x - start]);
      }
      rows.push(runs);
    }
    return { size: code.size, rows };
  }

  var QUIET = 4;

  function QRCode({ text, size = 360 }) {
    const matrix = (0, useMemo)(() => qrRuns(text), [text]);
    if (!matrix) return /* @__PURE__ */ (0, jsx)(View, { style: { width: size, height: size, borderRadius: 18, backgroundColor: "#ffffff" } });
    // Whole pixels per module, so no row blurs into the next on the TV.
    const module = Math.max(2, Math.floor(size / (matrix.size + QUIET * 2)));
    const side = module * (matrix.size + QUIET * 2);
    return /* @__PURE__ */ (0, jsx)(View, {
      style: { width: side, height: side, borderRadius: 18, backgroundColor: "#ffffff", padding: module * QUIET },
      children: matrix.rows.map((runs, y) => /* @__PURE__ */ (0, jsx)(View, {
        style: { width: module * matrix.size, height: module, flexDirection: "row" },
        children: runs.map(([start, length], index) => /* @__PURE__ */ (0, jsx)(View, {
          style: { position: "absolute", left: start * module, top: 0, width: length * module, height: module, backgroundColor: "#000000" }
        }, index))
      }, y))
    });
  }

export { QRCode, qrRuns };
