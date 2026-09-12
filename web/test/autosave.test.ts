// src/ui/autosave.ts — the copy of your patch you never asked for.
//
// Autosave is only ever noticed twice: when it saves your afternoon, and when it breaks
// something. So the tests here are about the second case at least as much as the first.
//
//   THE DEBOUNCE is a cost control, not a nicety. `read()` serializes the whole document,
//     so the property that matters is not "it eventually writes" but "twenty edits cost
//     ONE read and ONE write". That is asserted by counting calls, not by checking the
//     slot's contents.
//
//   THE FLUSH is the half that makes it true: a 1.5s debounce loses the last 1.5s of
//     work on every tab close unless something forces the pending write out. Both hooks
//     are checked — `pagehide` for a navigation, `visibilitychange` for the far more
//     common "switched apps and never came back" — as is the rule that a tab becoming
//     VISIBLE flushes nothing.
//
//   THE QUOTA GUARD is the one that would ruin the app. localStorage throws
//     synchronously once an origin is full, a patch with buffer~ data gets there, and an
//     autosave that let that escape would raise on every single edit for the rest of the
//     session. The assertion is therefore not just "it does not throw" but "it gives up,
//     says so exactly once, and stops touching storage at all".
//
// Everything runs in the node suite with no DOM and no real localStorage: the storage is
// a Map behind the three-method interface the module declares, and the page lifecycle is
// four hooks on globalThis, installed only when there is no real document to use (see
// HEADLESS). Nothing here needs jsdom.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AUTOSAVE_KEY,
  type AutosaveStorage,
  clearAutosave,
  installAutosave,
  loadAutosave,
} from '../src/ui/autosave';

// ─────────────────────────────────────────────────────────────────────────────
// doubles
// ─────────────────────────────────────────────────────────────────────────────

/** localStorage's three relevant methods over a Map, plus a way to make it fail. */
class MemoryStorage implements AutosaveStorage {
  readonly data = new Map<string, string>();
  /** Every ATTEMPTED write, successful or not — the count the quota test reads. */
  writes = 0;
  failWith: Error | null = null;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.writes++;
    if (this.failWith) throw this.failWith;
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  slot(key = AUTOSAVE_KEY): Record<string, unknown> | null {
    const raw = this.data.get(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }
}

function quotaError(): Error {
  // What every engine throws when the origin is full, in the shape the module sniffs for.
  const err = new Error('The quota has been exceeded.');
  err.name = 'QuotaExceededError';
  return err;
}

/** The listener bookkeeping of an EventTarget, and nothing else. */
class FakeEvents {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener = (type: string, fn: () => void): void => {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
  };

  removeEventListener = (type: string, fn: () => void): void => {
    this.listeners.get(type)?.delete(fn);
  };

  emit(type: string): void {
    for (const fn of [...(this.listeners.get(type) ?? [])]) fn();
  }

  count(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

/** No real document in the node suite — see the module header. */
const HEADLESS = typeof document === 'undefined';

interface FakeDom {
  win: FakeEvents;
  doc: FakeEvents;
  setVisibility(state: 'visible' | 'hidden'): void;
  restore(): void;
}

/**
 * The four globals src/ui/autosave.ts reaches for: window-level add/removeEventListener,
 * and a `document` with a visibilityState and the same two methods. Deliberately minimal
 * — this is the module's contact surface with the page, written out so a change to it is
 * visible here rather than silently untested.
 */
function installFakeDom(): FakeDom {
  const global = globalThis as unknown as Record<string, unknown>;
  const before = {
    add: global.addEventListener,
    remove: global.removeEventListener,
    document: global.document,
  };
  const win = new FakeEvents();
  const doc = new FakeEvents();
  const documentLike = {
    visibilityState: 'visible' as 'visible' | 'hidden',
    addEventListener: doc.addEventListener,
    removeEventListener: doc.removeEventListener,
  };
  global.addEventListener = win.addEventListener;
  global.removeEventListener = win.removeEventListener;
  global.document = documentLike;
  return {
    win,
    doc,
    setVisibility: (state) => {
      documentLike.visibilityState = state;
      doc.emit('visibilitychange');
    },
    restore: () => {
      global.addEventListener = before.add;
      global.removeEventListener = before.remove;
      global.document = before.document;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────

const PATCH = { patcher: { boxes: [{ box: { text: 'cycle~ 440' } }], lines: [] } };
const AT = 1_700_000_000_000;

let storage: MemoryStorage;
let errors: string[];
/** The trigger the module hands to `subscribe`, captured so a test can fire it. */
let changed: () => void;
let unsubscribed: number;
let reads: number;

function install(overrides: Parameters<typeof installAutosave>[1] = {}): () => void {
  reads = 0;
  return installAutosave(
    () => {
      reads++;
      return PATCH;
    },
    {
      storage,
      now: () => AT,
      onError: (msg) => errors.push(msg),
      subscribe: (fn) => {
        changed = fn;
        return () => unsubscribed++;
      },
      ...overrides,
    }
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  storage = new MemoryStorage();
  errors = [];
  unsubscribed = 0;
  reads = 0;
  changed = () => {
    throw new Error('subscribe() was never called');
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the debounce', () => {
  it('writes once, 1.5s after the LAST of a burst of edits', () => {
    const stop = install();
    changed();
    vi.advanceTimersByTime(1000);
    changed();
    vi.advanceTimersByTime(1000); // 1s after the second edit: still nothing
    expect(storage.writes).toBe(0);

    vi.advanceTimersByTime(499);
    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(storage.writes).toBe(1);
    stop();
  });

  it('serializes the document once per write, not once per edit', () => {
    const stop = install();
    for (let i = 0; i < 20; i++) changed(); // a 20-frame drag
    vi.advanceTimersByTime(1500);
    // The whole reason read() is a thunk: 20 edits, one serialization.
    expect(reads).toBe(1);
    expect(storage.writes).toBe(1);
    stop();
  });

  it('stores the patch, the time and the name', () => {
    const stop = install({ name: () => 'fm_synth.maxpat' });
    changed();
    vi.advanceTimersByTime(1500);
    expect(storage.slot()).toEqual({ v: 1, savedAt: AT, name: 'fm_synth.maxpat', json: PATCH });
    stop();
  });

  it('writes nothing at all until something changes', () => {
    const stop = install();
    vi.advanceTimersByTime(60_000);
    expect(storage.writes).toBe(0);
    expect(reads).toBe(0);
    stop();
  });

  it('saves again after the next burst', () => {
    const stop = install();
    changed();
    vi.advanceTimersByTime(1500);
    changed();
    vi.advanceTimersByTime(1500);
    expect(storage.writes).toBe(2);
    stop();
  });

  it('honours a custom delay', () => {
    const stop = install({ delay: 10 });
    changed();
    vi.advanceTimersByTime(9);
    expect(storage.writes).toBe(0);
    vi.advanceTimersByTime(1);
    expect(storage.writes).toBe(1);
    stop();
  });
});

describe.skipIf(!HEADLESS)('the flush', () => {
  let dom: FakeDom;

  beforeEach(() => {
    dom = installFakeDom();
  });

  afterEach(() => {
    dom.restore();
  });

  it('writes the pending patch immediately on pagehide', () => {
    const stop = install();
    changed();
    expect(storage.writes).toBe(0);
    dom.win.emit('pagehide');
    expect(storage.writes).toBe(1);
    // And the timer is gone, so the flush is not followed by a duplicate write.
    vi.advanceTimersByTime(5000);
    expect(storage.writes).toBe(1);
    stop();
  });

  it('writes when the tab is hidden, and not when it is shown', () => {
    const stop = install();
    changed();
    dom.setVisibility('visible');
    expect(storage.writes).toBe(0);
    dom.setVisibility('hidden');
    expect(storage.writes).toBe(1);
    stop();
  });

  it('does nothing when there is nothing pending', () => {
    const stop = install();
    dom.win.emit('pagehide');
    dom.setVisibility('hidden');
    expect(storage.writes).toBe(0);
    expect(reads).toBe(0);
    stop();
  });

  it('removes both page listeners on uninstall', () => {
    const stop = install();
    expect(dom.win.count('pagehide')).toBe(1);
    expect(dom.doc.count('visibilitychange')).toBe(1);
    stop();
    expect(dom.win.count('pagehide')).toBe(0);
    expect(dom.doc.count('visibilitychange')).toBe(0);
  });
});

describe('failure never reaches the editor', () => {
  it('gives up on the quota, reports once, and stops writing', () => {
    const stop = install();
    storage.failWith = quotaError();

    changed();
    vi.advanceTimersByTime(1500);
    expect(storage.writes).toBe(1); // it tried
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/too large/i);
    expect(errors[0]).toMatch(/\.maxpat/); // and says what to do instead

    // Everything after this is the actual requirement: no throw, no repeat report, and
    // no further attempts — an app that retried would hit the same wall 200 times a drag.
    for (let i = 0; i < 5; i++) {
      changed();
      vi.advanceTimersByTime(1500);
    }
    expect(storage.writes).toBe(1);
    expect(errors).toHaveLength(1);
    stop();
  });

  it('gives up on any other storage failure too, with a different message', () => {
    const stop = install();
    storage.failWith = new Error('SecurityError: storage is disabled');
    changed();
    vi.advanceTimersByTime(1500);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/refused the write/);
    expect(errors[0]).not.toMatch(/too large/i);
    stop();
  });

  it('gives up when the document cannot be serialized', () => {
    const stop = installAutosave(
      () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        return cyclic;
      },
      {
        storage,
        onError: (msg) => errors.push(msg),
        subscribe: (fn) => {
          changed = fn;
        },
      }
    );
    changed();
    vi.advanceTimersByTime(1500);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/serialized/);
    expect(storage.writes).toBe(0);
    stop();
  });

  it('reports once and installs nothing when there is no storage at all', () => {
    const dom = HEADLESS ? installFakeDom() : null;
    try {
      const stop = install({ storage: null });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/not allowing local storage/);
      // No listeners, and no subscription: nothing to tear down, and the teardown thunk
      // it returns is safe to call anyway.
      expect(dom?.win.count('pagehide') ?? 0).toBe(0);
      expect(() => stop()).not.toThrow();
    } finally {
      dom?.restore();
    }
  });
});

describe('uninstall', () => {
  it('drops the pending write instead of flushing it', () => {
    // Uninstall means the DOCUMENT was replaced (Open/New). Flushing here would write
    // the patch the user just navigated away from, and a reload would then restore the
    // one they closed rather than the one they are looking at.
    const stop = install();
    changed();
    stop();
    vi.advanceTimersByTime(5000);
    expect(storage.writes).toBe(0);
  });

  it('unsubscribes exactly once, however often it is called', () => {
    const stop = install();
    stop();
    stop();
    stop();
    expect(unsubscribed).toBe(1);
  });

  it('ignores changes that arrive after it', () => {
    const stop = install();
    stop();
    changed();
    vi.advanceTimersByTime(5000);
    expect(storage.writes).toBe(0);
  });
});

describe('reading the slot back', () => {
  it('round-trips what installAutosave wrote', () => {
    const stop = install({ name: () => 'theremin.maxpat' });
    changed();
    vi.advanceTimersByTime(1500);
    stop();

    const snapshot = loadAutosave(AUTOSAVE_KEY, storage);
    expect(snapshot).toEqual({ json: PATCH, savedAt: AT, name: 'theremin.maxpat' });
  });

  it('omits the name when none was given', () => {
    const stop = install();
    changed();
    vi.advanceTimersByTime(1500);
    stop();
    expect(loadAutosave(AUTOSAVE_KEY, storage)).toEqual({ json: PATCH, savedAt: AT });
  });

  it('is null for anything it cannot trust', () => {
    expect(loadAutosave(AUTOSAVE_KEY, storage)).toBeNull(); // empty
    for (const bad of [
      'not json at all',
      '{}',
      JSON.stringify({ v: 99, savedAt: AT, json: PATCH }), // a future format
      JSON.stringify({ v: 1, savedAt: AT }), // no patch in it
      JSON.stringify({ v: 1, savedAt: AT, json: null }),
    ]) {
      storage.data.set(AUTOSAVE_KEY, bad);
      expect(loadAutosave(AUTOSAVE_KEY, storage), bad).toBeNull();
    }
  });

  it('leaves an unreadable slot in place rather than deleting the only copy', () => {
    storage.data.set(AUTOSAVE_KEY, 'not json at all');
    loadAutosave(AUTOSAVE_KEY, storage);
    expect(storage.data.has(AUTOSAVE_KEY)).toBe(true);
  });

  it('survives a storage that throws on read', () => {
    const hostile: AutosaveStorage = {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {},
      removeItem() {},
    };
    expect(loadAutosave(AUTOSAVE_KEY, hostile)).toBeNull();
  });

  it('clears on request, and never throws doing it', () => {
    storage.data.set(AUTOSAVE_KEY, JSON.stringify({ v: 1, savedAt: AT, json: PATCH }));
    clearAutosave(AUTOSAVE_KEY, storage);
    expect(storage.data.has(AUTOSAVE_KEY)).toBe(false);

    const hostile: AutosaveStorage = {
      getItem: () => null,
      setItem() {},
      removeItem() {
        throw new Error('SecurityError');
      },
    };
    expect(() => clearAutosave(AUTOSAVE_KEY, hostile)).not.toThrow();
  });
});

describe('the default storage', () => {
  it('is localStorage, resolved per call so it can appear after import', () => {
    const global = globalThis as unknown as Record<string, unknown>;
    const before = global.localStorage;
    const fake = new MemoryStorage();
    global.localStorage = fake;
    try {
      // No `storage` option anywhere in this block: this is the path the patcher takes.
      const stop = installAutosave(() => PATCH, {
        now: () => AT,
        subscribe: (fn) => {
          changed = fn;
        },
      });
      changed();
      vi.advanceTimersByTime(1500);
      stop();

      expect(fake.data.has(AUTOSAVE_KEY)).toBe(true);
      expect(loadAutosave()).toEqual({ json: PATCH, savedAt: AT });
      clearAutosave();
      expect(fake.data.has(AUTOSAVE_KEY)).toBe(false);
      expect(loadAutosave()).toBeNull();
    } finally {
      if (before === undefined) delete global.localStorage;
      else global.localStorage = before;
    }
  });

  it('is simply absent off-DOM: nothing is written and nothing throws', () => {
    expect(typeof localStorage).toBe('undefined'); // the node suite, by construction
    expect(loadAutosave()).toBeNull();
    expect(() => clearAutosave()).not.toThrow();
    const stop = installAutosave(() => PATCH, { onError: (msg) => errors.push(msg) });
    expect(errors).toHaveLength(1);
    stop();
  });
});
