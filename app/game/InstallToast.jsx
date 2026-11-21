// ../pub-game-store/native/game/InstallToast.jsx
// reconstructed from the esbuild bundle in eboot.bin

import { jsx } from 'react/jsx-runtime';
import { useT } from '../i18n/index.js';
import { Toast } from '../ui/Toast.jsx';

  var TOAST_MS = 4500;
  function InstallToast({ game, started }) {
    const t2 = useT();
    return /* @__PURE__ */ (0, jsx)(
      Toast,
      {
        game,
        icon: started ? "download" : "circleCheck",
        status: t2(started ? "install.added" : "install.complete"),
        title: game.title,
        detail: t2("install.manage"),
        duration: TOAST_MS,
        inPage: true
      }
    );
  }

export { InstallToast, TOAST_MS };
