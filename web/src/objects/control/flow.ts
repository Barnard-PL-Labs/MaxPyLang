// Control-domain "flow" objects (BATCH "flow"): value-change detection, running
// accumulation, histograms, threshold/peak/trough tracking, key/value offering,
// and message synchronisation (bondo).
//
// This module is self-registering: importing it runs the top-level register(...)
// calls. It touches NO shared file — it only reads the stable contracts (registry,
// outlets, atoms, scheduler). See control/index.ts and control/math.ts for the
// reference patterns this mirrors.
//
// Convention: controlIns[i] receives a Msg (Atom[]); emit with o.emit(outlet, msg).
// Max fires outlets right-to-left, so multi-outlet objects emit the higher-indexed
// outlet first.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { scheduler } from '../../runtime/scheduler';
import { BANG, firstNum, isBang, nums, type Atom, type Msg } from '../../runtime/atoms';

// ── change : report a value only when it differs from the previous ─────────────
//
// 1 inlet, 3 outlets.
//   outlet 0 : the number, emitted only when it differs from the last one seen.
//   outlet 1 : 1 when the value increased vs. the previous input, else 0.
//   outlet 2 : 1 when the value decreased vs. the previous input, else 0.
// A bang re-emits the stored value out outlet 0. `set N` stores N without output.
register('change', (args) => {
  const o = makeOutlets();
  let last = num(args[0], 0);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { o.emit(0, [last]); return; }
        if (m[0] === 'set') { const n = firstNum(m.slice(1)); if (n !== undefined) last = n; return; }
        const n = firstNum(m);
        if (n === undefined) return;
        const prev = last;
        // right-to-left: direction outlets first, then the value.
        o.emit(2, [n < prev ? 1 : 0]);
        o.emit(1, [n > prev ? 1 : 0]);
        if (n !== prev) o.emit(0, [n]);
        last = n;
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── accum : store, add to, and multiply a value ───────────────────────────────
//
// 3 inlets, 1 outlet.
//   inlet 0 (left)   : a number stores AND outputs it; a bang outputs the stored value.
//   inlet 1 (middle) : the number is added to the stored value (stored, not output).
//   inlet 2 (right)  : the stored value is multiplied by the number (stored, not output).
register('accum', (args) => {
  const o = makeOutlets();
  let val = num(args[0], 0);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { o.emit(0, [val]); return; }
        const n = firstNum(m);
        if (n !== undefined) { val = n; o.emit(0, [val]); }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) val += n; },
      (m) => { const n = firstNum(m); if (n !== undefined) val *= n; },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── histo : tabulate a histogram of received numbers ──────────────────────────
//
// 2 inlets, 2 outlets.
//   inlet 0 (left)  : an int increments that value's bin, then outputs the value
//                     (outlet 1) and its running count (outlet 0). A bang dumps the
//                     whole histogram as value/count pairs, ascending.
//   inlet 1 (right) : `clear` resets all bins to 0.
//   outlet 0 (left)  : the count.
//   outlet 1 (right) : the value.
register('histo', () => {
  const o = makeOutlets();
  const counts = new Map<number, number>();
  const emitBin = (value: number, count: number) => {
    o.emit(1, [value]); // right-to-left: value first, then count
    o.emit(0, [count]);
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) {
          for (const value of [...counts.keys()].sort((a, b) => a - b)) emitBin(value, counts.get(value)!);
          return;
        }
        const n = firstNum(m);
        if (n === undefined) return;
        const c = (counts.get(n) ?? 0) + 1;
        counts.set(n, c);
        emitBin(n, c);
      },
      (m) => { if (m[0] === 'clear' || isBang(m)) counts.clear(); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── past : bang when the input passes above a threshold ───────────────────────
//
// 1 inlet, 1 outlet. Args are the threshold value(s). The object sends a bang when
// an incoming number crosses from below a threshold to at/above it. Each threshold
// re-arms once the input drops back below it (tracked via the previous input).
register('past', (args) => {
  const o = makeOutlets();
  const thresholds = nums(args);
  let prev = -Infinity;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const n = firstNum(m);
        if (n === undefined) return;
        const crossed = thresholds.some((t) => prev < t && n >= t);
        prev = n;
        if (crossed) o.emit(0, BANG);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── peak / trough : track a running maximum / minimum ─────────────────────────
//
// 2 inlets, 3 outlets.
//   inlet 0 (left)  : a number is compared against the stored extreme; a bang
//                     re-emits the current extreme out outlet 0.
//   inlet 1 (right) : a number resets the stored extreme to it (no output).
//   outlet 0 (left)   : the extreme value, emitted when the input sets a new one.
//   outlet 1 (middle) : 1 when this input set a new extreme, else 0.
//   outlet 2 (right)  : every input value, passed through.
function makeExtreme(seedFrom: number, isNewExtreme: (input: number, current: number) => boolean) {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    // The `format`/`value` arg seeds the starting extreme (default = the neutral seed).
    let current = args.length >= 1 ? num(args[0], seedFrom) : seedFrom;
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          if (isBang(m)) { o.emit(0, [current]); return; }
          const n = firstNum(m);
          if (n === undefined) return;
          const isNew = isNewExtreme(n, current);
          // right-to-left: pass-through, flag, then the new extreme.
          o.emit(2, [n]);
          o.emit(1, [isNew ? 1 : 0]);
          if (isNew) { current = n; o.emit(0, [n]); }
        },
        (m) => { const n = firstNum(m); if (n !== undefined) current = n; },
      ],
      onControlOut: o.onControlOut,
    };
  };
}
register('peak', makeExtreme(-Infinity, (input, current) => input > current));
register('trough', makeExtreme(Infinity, (input, current) => input < current));

// ── offer : store a value at an address and recall it (funbuff-style) ──────────
//
// 2 inlets, 1 outlet.
//   inlet 0 (left)  : a list [address value] stores value at address and outputs it.
//                     A lone number is an address: if a value is pending from the
//                     right inlet, it is stored there and output; otherwise the value
//                     currently stored at that address is recalled (0 if none).
//   inlet 1 (right) : a number becomes the value to store at the next address.
register('offer', () => {
  const o = makeOutlets();
  const store = new Map<number, number>();
  let pending: number | undefined;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const ns = nums(m);
        if (ns.length >= 2) {
          store.set(ns[0], ns[1]);
          pending = undefined;
          o.emit(0, [ns[1]]);
          return;
        }
        const addr = firstNum(m);
        if (addr === undefined) return;
        if (pending !== undefined) {
          store.set(addr, pending);
          const v = pending;
          pending = undefined;
          o.emit(0, [v]);
        } else {
          o.emit(0, [store.get(addr) ?? 0]);
        }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) pending = n; },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── bondo : synchronise a group of messages ───────────────────────────────────
//
// 2 inlets, 2 outlets (per manifest). Each inlet stores its most recent value. Input
// to the left inlet triggers output: after the (optional) delay, every stored value
// is emitted out its corresponding outlet, right-to-left. Non-left inlets store only.
register('bondo', (args) => {
  const o = makeOutlets();
  const nInlets = 2;
  const delayMs = Math.max(0, num(args[1], 0));
  const stored: Msg[] = new Array(nInlets).fill(0).map(() => BANG);
  let cancel: (() => void) | null = null;
  const fire = () => {
    for (let i = nInlets - 1; i >= 0; i--) o.emit(i, stored[i]);
  };
  const controlIns: (((m: Msg) => void) | undefined)[] = [];
  for (let i = 0; i < nInlets; i++) {
    const inlet = i;
    controlIns[i] = (m) => {
      stored[inlet] = m.length ? (m as Msg) : BANG;
      if (inlet !== 0) return; // only the left inlet triggers output
      if (delayMs <= 0) { fire(); return; }
      if (cancel) cancel();
      cancel = scheduler.afterMs(delayMs, () => { cancel = null; fire(); });
    };
  }
  return {
    signalIns: [],
    signalOuts: [],
    controlIns,
    onControlOut: o.onControlOut,
    dispose: () => { if (cancel) { cancel(); cancel = null; } },
  } satisfies MaxNode;
});
