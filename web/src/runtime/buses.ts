// Named message buses for send/receive (`send`/`s` -> `receive`/`r`), and the
// shared named-value store behind `value`/`v` and `pv`. These let objects
// communicate by name across the patch without a cord.

import type { Msg } from './atoms';

class Buses {
  private receivers = new Map<string, Set<(m: Msg) => void>>();
  private values = new Map<string, Msg>();

  /** `receive name` subscribes; returns an unsubscribe fn. */
  subscribe(name: string, cb: (m: Msg) => void): () => void {
    const set = this.receivers.get(name) ?? new Set();
    set.add(cb);
    this.receivers.set(name, set);
    return () => set.delete(cb);
  }

  /** `send name msg` delivers to every matching `receive`. */
  send(name: string, m: Msg): void {
    const set = this.receivers.get(name);
    if (set) for (const cb of set) cb(m);
  }

  /** `value`/`v` shared storage: last value wins, read on bang. */
  setValue(name: string, m: Msg): void {
    this.values.set(name, m);
  }
  getValue(name: string): Msg {
    return this.values.get(name) ?? [];
  }

  /** Patch reload. */
  clear(): void {
    this.receivers.clear();
    this.values.clear();
  }
}

export const buses = new Buses();
