// The control-outlet fan-out helper every control object uses. `emit(outlet, msg)`
// delivers a message to each cord on that outlet; `onControlOut` is what the engine
// calls to subscribe each destination. One shared helper = one wiring convention.

import type { Msg } from './atoms';

export interface Outlets {
  onControlOut(outlet: number, cb: (m: Msg) => void): void;
  emit(outlet: number, m: Msg): void;
}

export function makeOutlets(): Outlets {
  const listeners = new Map<number, Array<(m: Msg) => void>>();
  return {
    onControlOut(outlet, cb) {
      const arr = listeners.get(outlet) ?? [];
      arr.push(cb);
      listeners.set(outlet, arr);
    },
    emit(outlet, m) {
      const arr = listeners.get(outlet);
      if (arr) for (const cb of arr) cb(m);
    },
  };
}
