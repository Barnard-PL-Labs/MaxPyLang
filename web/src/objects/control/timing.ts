// Control-domain TIMING objects (batch "timing"): tempo, clocker, qmetro, pipe,
// line, uzi, speedlim. Same contract as control/index.ts — controlIns[i] takes a
// Msg (Atom[]), results leave via makeOutlets().emit(outlet, msg). Time-driven
// objects register with the shared `scheduler` so ▶/■ start and stop them in sync
// with the audio transport. This module self-registers on import.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { scheduler } from '../../runtime/scheduler';
import { BANG, firstNum, isBang, nums, type Msg } from '../../runtime/atoms';

/** A message that should "fire" a bang-like object (a bang or any number). */
function isTrigger(m: Msg): boolean {
  return isBang(m) || firstNum(m) !== undefined;
}

// ── tempo ─────────────────────────────────────────────────────────────────────
// tempo [bpm] : a tempo-synced metronome that emits an incrementing tick count.
// Inlets: 0 on/off, 1 tempo (BPM), 2 multiplier, 3 division. The report interval is
// one beat (60000/BPM) scaled by multiplier/division. Prototype-level: it just
// counts up on every tick (Max's tempo walks a metrical grid; the count is enough
// to drive a downstream chain).
register('tempo', (args) => {
  const o = makeOutlets();
  let bpm = Math.max(1, num(args[0], 120));
  let mult = Math.max(1, num(args[1], 1));
  let div = Math.max(1, num(args[2], 1));
  let count = 0;
  let cancel: (() => void) | null = null;
  const interval = () => Math.max(1, (60000 / bpm) * (mult / div));
  const off = () => { if (cancel) { cancel(); cancel = null; } };
  const on = () => { if (!cancel) cancel = scheduler.everyMs(interval(), () => o.emit(0, [count++])); };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) on();
        else { const n = firstNum(m); if (n !== undefined) { if (n !== 0) on(); else { off(); count = 0; } } }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) { bpm = Math.max(1, n); if (cancel) { off(); on(); } } },
      (m) => { const n = firstNum(m); if (n !== undefined) { mult = Math.max(1, n); if (cancel) { off(); on(); } } },
      (m) => { const n = firstNum(m); if (n !== undefined) { div = Math.max(1, n); if (cancel) { off(); on(); } } },
    ],
    onControlOut: o.onControlOut,
    dispose: off,
  } satisfies MaxNode;
});

// ── clocker ─────────────────────────────────────────────────────────────────
// clocker [interval] : once started (nonzero/bang at inlet 0), report the elapsed
// time in ms at every `interval`. A 0 stops and resets the clock. Inlet 1 sets the
// interval.
register('clocker', (args) => {
  const o = makeOutlets();
  let interval = Math.max(1, num(args[0], 1000));
  let elapsed = 0;
  let cancel: (() => void) | null = null;
  const off = () => { if (cancel) { cancel(); cancel = null; } };
  const on = () => {
    if (cancel) return;
    elapsed = 0;
    cancel = scheduler.everyMs(interval, () => { elapsed += interval; o.emit(0, [elapsed]); });
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) on();
        else { const n = firstNum(m); if (n !== undefined) (n !== 0 ? on() : (off(), (elapsed = 0))); }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) { interval = Math.max(1, n); if (cancel) { off(); on(); } } },
    ],
    onControlOut: o.onControlOut,
    dispose: off,
  } satisfies MaxNode;
});

// ── qmetro ────────────────────────────────────────────────────────────────────
// qmetro [ms] : like metro, but conceptually on the low-priority queue. For this
// prototype it is a plain interval bang. Inlet 0 on/off, inlet 1 interval. Auto-on
// (the scheduler still gates ticking to the transport, so a patch plays on ▶).
register('qmetro', (args) => {
  const o = makeOutlets();
  let interval = Math.max(1, num(args[0], 500));
  let cancel: (() => void) | null = null;
  const on = () => { if (!cancel) cancel = scheduler.everyMs(interval, () => o.emit(0, BANG)); };
  const off = () => { if (cancel) { cancel(); cancel = null; } };
  on();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) on();
        else { const n = firstNum(m); if (n !== undefined) (n !== 0 ? on() : off()); }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) { interval = Math.max(1, n); if (cancel) { off(); on(); } } },
    ],
    onControlOut: o.onControlOut,
    dispose: off,
  } satisfies MaxNode;
});

// ── pipe ──────────────────────────────────────────────────────────────────────
// pipe [ms] : delay a value. A message at inlet 0 is echoed out `ms` later; several
// pending values can be in flight at once. Inlet 1 sets the delay. The delay comes
// from the last numeric creation arg (e.g. `pipe 500`).
register('pipe', (args) => {
  const o = makeOutlets();
  const argNums = nums(args as Msg);
  let ms = Math.max(0, argNums.length ? argNums[argNums.length - 1] : 0);
  const pending = new Set<() => void>();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (!isTrigger(m)) return;
        const payload: Msg = isBang(m) ? BANG : [...m];
        let cancel: (() => void) | null = null;
        cancel = scheduler.afterMs(ms, () => { if (cancel) pending.delete(cancel); o.emit(0, payload); });
        pending.add(cancel);
      },
      (m) => { const n = firstNum(m); if (n !== undefined) ms = Math.max(0, n); },
    ],
    onControlOut: o.onControlOut,
    dispose: () => { for (const c of pending) c(); pending.clear(); },
  } satisfies MaxNode;
});

// ── line ──────────────────────────────────────────────────────────────────────
// line [initial] [grain] : ramp generator. A `[target, time]` message ramps the
// current value to `target` over `time` ms, emitting intermediate values every
// `grain` ms out outlet 0 and a bang out outlet 1 when the target is reached. A lone
// number jumps immediately. Inlet 1 sets the ramp time; inlet 2 sets the grain.
register('line', (args) => {
  const o = makeOutlets();
  let val = num(args[0], 0);
  let grain = Math.max(1, num(args[1], 20));
  let rampTime = 0;
  let cancel: (() => void) | null = null;
  const stop = () => { if (cancel) { cancel(); cancel = null; } };
  const finish = () => { stop(); o.emit(0, [val]); o.emit(1, BANG); };
  const ramp = (target: number, time: number, g: number) => {
    stop();
    if (time <= 0) { val = target; finish(); return; }
    const steps = Math.max(1, Math.round(time / g));
    const step = (target - val) / steps;
    let i = 0;
    cancel = scheduler.everyMs(g, () => {
      i++;
      if (i >= steps) { val = target; finish(); }
      else { val += step; o.emit(0, [val]); }
    });
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const ns = nums(m);
        if (ns.length >= 2) ramp(ns[0], ns[1], ns[2] !== undefined ? Math.max(1, ns[2]) : grain);
        else if (ns.length === 1) {
          if (rampTime > 0) ramp(ns[0], rampTime, grain);
          else { stop(); val = ns[0]; finish(); }
        }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) rampTime = Math.max(0, n); },
      (m) => { const n = firstNum(m); if (n !== undefined) grain = Math.max(1, n); },
    ],
    onControlOut: o.onControlOut,
    dispose: stop,
  } satisfies MaxNode;
});

// ── uzi ───────────────────────────────────────────────────────────────────────
// uzi [count] [base] : on a bang, fire a synchronous burst of `count` bangs out
// outlet 0. For each, the current 1-based index (offset by `base`) leaves outlet 1;
// when the burst completes a carry-bang leaves outlet 2. A number at inlet 0 sets
// the count and fires; inlet 1 sets the count silently.
register('uzi', (args) => {
  const o = makeOutlets();
  let count = Math.max(0, Math.trunc(num(args[0], 1)));
  const base = Math.trunc(num(args[1], 0));
  const fire = () => {
    for (let i = 1; i <= count; i++) { o.emit(1, [base + i]); o.emit(0, BANG); }
    o.emit(2, BANG);
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) fire();
        else { const n = firstNum(m); if (n !== undefined) { count = Math.max(0, Math.trunc(n)); fire(); } }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) count = Math.max(0, Math.trunc(n)); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── speedlim ──────────────────────────────────────────────────────────────────
// speedlim [ms] : rate-limit messages. The first message passes immediately; further
// messages within `ms` are held, and the most recent held one is emitted once the
// window elapses. Inlet 1 sets the interval.
register('speedlim', (args) => {
  const o = makeOutlets();
  let delta = Math.max(0, num(args[0], 0));
  let lastEmit = -Infinity;
  let pending: Msg | null = null;
  let cancel: (() => void) | null = null;
  const clear = () => { if (cancel) { cancel(); cancel = null; } };
  const emitNow = (m: Msg) => { lastEmit = Date.now(); o.emit(0, m); };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (!isTrigger(m) && m.length === 0) return;
        const now = Date.now();
        const since = now - lastEmit;
        if (since >= delta) { clear(); pending = null; emitNow(m); return; }
        pending = m;
        if (!cancel) {
          cancel = scheduler.afterMs(delta - since, () => {
            cancel = null;
            if (pending) { const p = pending; pending = null; emitNow(p); }
          });
        }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) delta = Math.max(0, n); },
    ],
    onControlOut: o.onControlOut,
    dispose: clear,
  } satisfies MaxNode;
});
