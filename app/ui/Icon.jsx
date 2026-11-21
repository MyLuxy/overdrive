// ../pub-game-store/native/ui/Icon.jsx
// reconstructed from the esbuild bundle in eboot.bin
// MODIFIED: settings, languages and info icons.

import { jsx } from 'react/jsx-runtime';
import { Path, Svg } from '@ps5-react/core';
import { useLocale } from '../i18n/index.js';
import { px } from './scale.js';

  var ring = (cx, cy, r) => `M${cx + r} ${cy}a${r} ${r} 0 1 1-${2 * r} 0a${r} ${r} 0 1 1 ${2 * r} 0`;
  var ICONS = {
    search: [ring(11, 11, 8), "m21 21-4.3-4.3"],
    // The header's tab icons (lucide 0.462, as the rest).
    compass: [ring(12, 12, 10), "m16.2 7.8-2.5 5.9-5.9 2.5 2.5-5.9 5.9-2.5Z"],
    controller: ["M6.8 8h10.4a4 4 0 0 1 3.8 2.8l1.1 5.3a2.8 2.8 0 0 1-4.5 2.8l-2.5-2.1H8.9l-2.5 2.1a2.8 2.8 0 0 1-4.5-2.8L3 10.8A4 4 0 0 1 6.8 8Z", "M8 11v4", "M6 13h4", "M16 12h.01", "M18 14h.01"],
    homebrew: ["M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"],
    searchX: [ring(11, 11, 8), "m21 21-4.3-4.3", "m13.5 8.5-5 5", "m8.5 8.5 5 5"],
    chevronDown: ["m6 9 6 6 6-6"],
    chevronUp: ["m18 15-6-6-6 6"],
    chevronRight: ["m9 18 6-6-6-6"],
    chevronLeft: ["m15 18-6-6 6-6"],
    arrowLeft: ["m12 19-7-7 7-7", "M19 12H5"],
    arrowRight: ["m12 5 7 7-7 7", "M5 12h14"],
    heart: ["M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"],
    check: ["M20 6 9 17l-5-5"],
    x: ["M18 6 6 18", "m6 6 12 12"],
    download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "m7 10 5 5 5-5", "M12 15V3"],
    play: ["M6 3 20 12 6 21Z"],
    pause: [
      "M7 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z",
      "M15 4h2a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"
    ],
    circleCheck: [ring(12, 12, 10), "m9 12 2 2 4-4"],
    alert: [ring(12, 12, 10), "M12 8v4", "M12 16h.01"],
    // lucide 0.462 info, for the download row's game page.
    info: [ring(12, 12, 10), "M12 16v-4", "M12 8h.01"],
    restart: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
    trash: ["M3 6h18", "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6", "M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"],
    list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
    external: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
    star: ["M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"],
    delete: [
      "M10 5a2 2 0 0 0-1.344.519l-6.328 5.74a1 1 0 0 0 0 1.481l6.328 5.741A2 2 0 0 0 10 19h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z",
      "m12 9 6 6",
      "m18 9-6 6"
    ],
    space: ["M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1"],
    globe: [ring(12, 12, 10), "M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20"],
    // A chain of two links: "From a link" carries this rather than a globe.
    link: ["M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71", "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"],
    // lucide 0.462 "settings" and "languages", the set the rest of these come from.
    settings: [
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      ring(12, 12, 3)
    ],
    languages: ["m5 8 6 6", "m4 14 6-6 2-3", "M2 5h12", "M7 2h1", "m22 22-5-10-5 10", "M14 18h6"],
    package: [
      "M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z",
      "M12 22V12",
      "m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7",
      "m7.5 4.27 9 5.15"
    ],
    disc: [ring(12, 12, 10), ring(12, 12, 2)],
    // lucide 0.462 gauge, for the speed limit's tile.
    gauge: ["m12 14 4-4", "M3.34 19a10 10 0 1 1 17.32 0"],
    // lucide 0.462 cpu, lightbulb and file-minus, for the download tips.
    cpu: ["M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z", "M10 9h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1z", "M15 2v2", "M15 20v2", "M2 15h2", "M2 9h2", "M20 15h2", "M20 9h2", "M9 2v2", "M9 20v2"],
    lightbulb: ["M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5", "M9 18h6", "M10 22h4"],
    fileMinus: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4", "M9 15h6"],
    archive: ["M3 3h18a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8", "M10 12h4"],
    folder: ["M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"],
    file: ["M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z", "M14 2v4a2 2 0 0 0 2 2h4"],
    hardDrive: [
      "M22 12H2",
      "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z",
      "M6 16h.01",
      "M10 16h.01"
    ],
    layers: [
      "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z",
      "m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65",
      "m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"
    ]
  };
  var MIRRORED = { chevronLeft: "chevronRight", chevronRight: "chevronLeft", arrowLeft: "arrowRight" };
  // The download services' own marks (issues #89, #20): filled shapes in their own colours, as their
  // owners draw them, rather than the outline set above. TorBox's is torbox.app's own logo
  // (torbox.app/assets/logo-bb7a9579.svg); the torrent one is qBittorrent's, the client the
  // torrent card sets up (qBittorrent's src/icons/qbittorrent-tray.svg, its gradient as one
  // colour). Both are drawn at `size`, in the box that fits their proportions.
  var BRANDS = {
    torbox: {
      viewBox: "367 308 766 884",
      paths: [
        { d: "M749.99 749.99 749.99 1191.96 367.25 970.97 367.25 529.01Z", fill: "#00444d" },
        { d: "M1132.75 529.01 1132.75 970.97 749.99 1191.96 749.99 749.99 872.87 679.05 956.71 630.66Z", fill: "#34ba90" },
        { d: "M1132.75 529.01 749.99 749.99 367.25 529.01 749.99 308.04Z", fill: "#52a153" },
        { d: "M1043.04 739.36 958.66 1057.08 952.4 851.84 839.71 915.39 872.87 679.05 956.71 630.66 931.81 799.21Z", fill: "#ffffff" }
      ]
    },
    qbittorrent: {
      // qBittorrent's own mark (src/icons/qbittorrent-tray.svg): the pale rim, the blue disc, then
      // the two letters. Its gradient is drawn as one colour a brand icon can hold.
      viewBox: "0 0 1024 1024",
      paths: [
        { d: "M512 0a512 512 0 1 0 0 1024a512 512 0 1 0 0-1024Z", fill: "#daefff" },
        { d: "M512 16a496 496 0 1 0 0 992a496 496 0 1 0 0-992Z", fill: "#4f8ed4" },
        { d: "m712.898 332.399q66.657 0 103.38 45.671 37.03 45.364 37.03 128.684 0 83.32-37.34 129.61-37.03 45.98-103.07 45.98-33.02 0-60.484-12.035-27.156-12.344-45.672-37.649h-3.703l-10.8 43.512h-36.724v-480.172h51.227v116.65q0 39.191-2.469 70.359h2.47q35.796-50.61 106.155-50.61zm-7.406 42.894q-52.46 0-75.605 30.242-23.145 29.934-23.145 101.219 0 71.285 23.762 102.145 23.761 30.55 76.222 30.55 47.215 0 70.36-34.254 23.144-34.562 23.144-99.058 0-66.04-23.144-98.442-23.145-32.402-71.594-32.402z", fill: "#ffffff" },
        { d: "m317.273 639.45q51.227 0 74.68-27.466 23.453-27.464 24.996-92.578v-11.418q0-70.976-24.07-102.144-24.07-31.168-76.223-31.168-45.055 0-69.125 35.18-23.762 34.87-23.762 98.75 0 63.879 23.454 97.515 23.761 33.328 70.05 33.328zm-7.715 42.894q-65.421 0-102.144-45.98-36.723-45.981-36.723-128.376 0-83.011 37.032-129.609 37.03-46.598 103.07-46.598 69.433 0 106.773 52.461h2.778l7.406-46.289h40.426v490.047h-51.227v-144.73q0-30.86 3.395-52.461h-4.012q-35.488 51.535-106.774 51.535z", fill: "#c8e8ff" }
      ]
    },
    realdebrid: {
      // Real-Debrid's own mark (fcdn.real-debrid.com/0840/images/logo.svg): a ring of two arcs, each
      // with its darker face, drawn verbatim.
      viewBox: "0 0 264 264",
      paths: [
        { d: "M229.9,113.8l-3.7,13c-1-23.3-10.7-37-10.7-37c0.3,39.4-5.6,57.2-14.6,74.8c-0.7,1.4-1.4,2.7-2.1,4.1 c-0.1,0.1-0.1,0.2-0.2,0.3c0.1-0.1,0.1-0.2,0.2-0.3c-13,23.3-37.8,39.1-66.3,39.1c-35.4,0-65.3-24.4-73.5-57.4 c4.3,19.2,11,36.7,36.1,66.8c0,0-16.1-4.4-31.7-21.9l5.4,12.4c0,0-26.8-16-35.9-56.5c9,46.8,50.3,82.2,99.7,82.2 c39,0,72.8-22.1,89.9-54.3C240.3,142.6,229.9,113.8,229.9,113.8z", fill: "#9FD1EB" },
        { d: "M68.8,207.8l-5.4-12.4c15.6,17.4,31.7,21.9,31.7,21.9C70,187.1,63.3,169.6,59,150.4 c-1.5-5.9-2.3-12.1-2.3-18.4c0-41.8,34-75.8,75.8-75.8c1.8,0,3.6,0.1,5.3,0.2c0,0-0.1,0-0.1,0c0,0,0.1,0,0.1,0 c1.5,0.1,3,0.3,4.5,0.4c19.8,2.2,38,6.8,71,28.8c0,0-6.1-15.6-25.1-29.2l12.9,4.1c0,0-18.7-24.9-59.7-29.7 c-2.9-0.3-5.9-0.4-8.9-0.4C76.6,30.5,31.1,76,31.1,132c0,6.6,0.6,13,1.8,19.3C42,191.8,68.8,207.8,68.8,207.8z", fill: "#B8D995" },
        { d: "M229.9,116.8c0,0,2.8,7.8,3,20.4c0.3-14.3-3-23.4-3-23.4l-3.7,13c-1-23.3-10.7-37-10.7-37c0,1,0,2,0,3 c0.2,0.3,9.7,13.9,10.7,37L229.9,116.8z", fill: "#88B3C9" },
        { d: "M132.6,210.8c28.5,0,53.3-15.8,66.3-39.1c0.7-1.3,1.5-2.7,2.1-4.1c8.8-17.4,14.7-35,14.6-73.3 c-0.2,36.3-6,53.4-14.6,70.3c-0.7,1.4-1.4,2.7-2.1,4.1c-0.1,0.1-0.1,0.2-0.2,0.3c0.1-0.1,0.1-0.2,0.2-0.3 c-13,23.3-37.8,39.1-66.3,39.1c-35.4,0-65.3-24.4-73.5-57.4c1.1,5.1,2.5,10.1,4.2,15.3C75.1,192.2,101.7,210.8,132.6,210.8z", fill: "#88B3C9" },
        { d: "M132.6,33.5c3,0,5.9,0.1,8.9,0.4c30.5,3.6,48.6,18.2,55.9,25.5l3.8,1.2c0,0-18.7-24.9-59.7-29.7 c-2.9-0.3-5.9-0.4-8.9-0.4C76.6,30.5,31.1,76,31.1,132c0,0.5,0,1,0,1.5C31.9,78.2,77.1,33.5,132.6,33.5z", fill: "#A0BD82" },
        { d: "M67,206.5c1.2,0.8,1.9,1.2,1.9,1.2l-2.9-6.7c-0.8-0.8-1.6-1.7-2.5-2.6L67,206.5z", fill: "#A0BD82" },
        { d: "M211.1,84.2c0.8,0.5,1.5,1,2.3,1.5c0,0-4.7-12-18.8-24.2l-6.3-2C200.9,68.6,207.9,78.6,211.1,84.2z", fill: "#A0BD82" },
        { d: "M59,153.4c4.1,18.3,10.4,35,32.6,62.6c2.2,0.9,3.5,1.3,3.5,1.3C70,187.1,63.3,169.6,59,150.4 c-1.3-5.3-2.1-10.9-2.3-16.6c0,0.4,0,0.8,0,1.1C56.8,141.4,57.6,147.5,59,153.4z", fill: "#A0BD82" }
      ]
    },
    premiumize: {
      // premiumize.me's own icon (premiumize.me/icon_normal.svg): the red figure with its yellow
      // check, its circle written as a path like the rest.
      viewBox: "0 0 240 240",
      paths: [
        { d: "M76.5-0.138a47.5 47.5 0 1 0 95 0a47.5 47.5 0 1 0-95 0z", fill: "#aa0000" },
        { d: "M125,64.831A65,62.532 0 0 0 60,127.362v65h130v-65A65,62.532 0 0 0 125,64.831Z", fill: "#aa0000" },
        { d: "m5,97.362l110,25l130,-130c-33.227,57.785-74.464,116.996-120,185z", fill: "#ffcc00" }
      ]
    }
  };
  function Icon({ name, size = 16, color = "#f2f2f3", fill: fill2 = "none", strokeWidth = 2, fixed = false }) {
    const { rtl } = useLocale();
    const drawn = rtl && !fixed ? MIRRORED[name] ?? name : name;
    const brand = BRANDS[drawn];
    if (brand) {
      const boxWidth = Number(brand.viewBox.split(" ")[2]);
      const boxHeight = Number(brand.viewBox.split(" ")[3]);
      const width = boxWidth > boxHeight ? size : Math.round(size * boxWidth / boxHeight * 100) / 100;
      const height = boxWidth > boxHeight ? Math.round(size * boxHeight / boxWidth * 100) / 100 : size;
      return /* @__PURE__ */ (0, jsx)(Svg, { width: px(width), height: px(height), viewBox: brand.viewBox, children: brand.paths.map((path) => /* @__PURE__ */ (0, jsx)(
        Path,
        {
          d: path.d,
          fill: path.fill,
          stroke: "none",
          fillRule: path.fillRule
        },
        path.d
      )) });
    }
    return /* @__PURE__ */ (0, jsx)(Svg, { width: px(size), height: px(size), viewBox: "0 0 24 24", children: ICONS[drawn].map((d) => /* @__PURE__ */ (0, jsx)(
      Path,
      {
        d,
        fill: fill2,
        stroke: color,
        strokeWidth,
        strokeLinecap: "round",
        strokeLinejoin: "round"
      },
      d
    )) });
  }

export { Icon };
