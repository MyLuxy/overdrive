// ../pub-game-store/native/ui/sounds.js
// reconstructed from the esbuild bundle in eboot.bin

import back from '../assets/sounds/back.wav';
import confirm from '../assets/sounds/confirm.wav';
import error from '../assets/sounds/error.wav';
import focus from '../assets/sounds/focus.wav';
import notify from '../assets/sounds/notify.wav';
import page from '../assets/sounds/page.wav';
import { Sound, useNavigationEvents } from '@ps5-react/core';

  var PAGE_PAN = { l1: -0.4, l2: -0.4, r1: 0.4, r2: 0.4 };
  function useInterfaceSounds() {
    useNavigationEvents((event) => {
      if (event.type === "move") Sound.play(focus);
      else if (event.type === "blocked") Sound.play(error);
      else if (event.type === "press") Sound.play(event.handled ? confirm : error);
      else if (event.handled && event.type === "back") Sound.play(back);
      else if (event.handled && event.action in PAGE_PAN) Sound.play(page, { pan: PAGE_PAN[event.action] });
      else if (event.handled) Sound.play(confirm);
    });
  }
  var playNotify = () => Sound.play(notify);

export { playNotify, useInterfaceSounds };
