// The control-outlet fan-out helper every control object uses. `emit(outlet, msg)`
// delivers a message to each cord on that outlet; `onControlOut` is what the engine
// calls to subscribe each destination. One shared helper = one wiring convention.
//
// Subscribing hands back an unsubscribe thunk, and that thunk is the whole reason a
// control cord can be cut from a LIVE patch: without it the only way to drop a cord
// is to rebuild the engine, which tears down the AudioContext and stops the sound.
// A thunk removes exactly the one registration it came from — subscribe the same
// callback twice and one thunk leaves the other delivery intact.

import type { Msg } from './atoms';

export interface Outlets {
  /** Subscribe to outlet `outlet`; the returned thunk removes just this subscription. */
  onControlOut(outlet: number, cb: (m: Msg) => void): () => void;
  emit(outlet: number, m: Msg): void;
}

export function makeOutlets(): Outlets {
  const listeners = new Map<number, Array<(m: Msg) => void>>();
  return {
    onControlOut(outlet, cb) {
      const arr = listeners.get(outlet) ?? [];
      arr.push(cb);
      listeners.set(outlet, arr);
      // indexOf + splice, not a filter by identity: two cords may legitimately share
      // one callback, and unsubscribing one of them must remove one delivery, not both.
      return () => {
        const i = arr.indexOf(cb);
        if (i >= 0) arr.splice(i, 1);
      };
    },
    emit(outlet, m) {
      const arr = listeners.get(outlet);
      if (arr) for (const cb of arr) cb(m);
    },
  };
}
