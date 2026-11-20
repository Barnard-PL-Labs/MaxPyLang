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
// 2 inlets, 2 outlets (Max reference, histo.maxref.xml). Arg = histogram size
// (default 128, so values 0-127 are counted; numbers outside are ignored).
//   inlet 0 (left)  : a number is counted, then its count goes out the RIGHT outlet
//                     and the number itself out the LEFT outlet (right-to-left).
//                     bang reports the most recent left-inlet number and its count
//                     (0 and 0 if none yet). `clear` erases the histogram.
//   inlet 1 (right) : a number is reported like the left inlet, but not counted.
//   outlet 0 (left)  : the number.
//   outlet 1 (right) : how many times it has been received.
register('histo', (args) => {
  const o = makeOutlets();
  const size = Math.max(1, Math.trunc(num(args[0], 128)));
  let counts = new Array<number>(size).fill(0);
  let last: number | undefined;
  const report = (n: number) => {
    o.emit(1, [counts[n] ?? 0]); // right-to-left: count first, then the number
    o.emit(0, [n]);
  };
  const inRange = (n: number) => n >= 0 && n < size;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (m[0] === 'clear') { counts = new Array<number>(size).fill(0); last = undefined; return; }
        if (isBang(m)) {
          if (last === undefined) { o.emit(1, [0]); o.emit(0, [0]); } else report(last);
          return;
        }
        const v = firstNum(m);
        if (v === undefined) return;
        const n = Math.trunc(v);
        if (!inRange(n)) return;
        counts[n]++;
        last = n;
        report(n);
      },
      (m) => {
        if (m[0] === 'clear') { counts = new Array<number>(size).fill(0); last = undefined; return; }
        const v = firstNum(m);
        if (v === undefined) return;
        const n = Math.trunc(v);
        if (inRange(n)) report(n);
      },
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

// ── offer : store one-time x/y number pairs ────────────────────────────────────
//
// 2 inlets, 1 outlet (Max reference, offer.maxref.xml).
//   inlet 1 (right) : a number is the y value to pair with the next x.
//   inlet 0 (left)  : a number is an x. If a y is waiting (from the right inlet),
//                     the pair x,y is stored, with NO output. Otherwise the stored
//                     pair with that x is looked up: its y goes out and the pair is
//                     deleted. If no pair matches, nothing happens.
//                     A list "x y" is the same as y to the right inlet then x to the
//                     left (so it stores a pair). bang outputs every stored y
//                     (pairs kept); `clear` deletes all pairs.
register('offer', () => {
  const o = makeOutlets();
  const store = new Map<number, number>();
  let pending: number | undefined;
  const takeX = (x: number) => {
    if (pending !== undefined) {
      store.set(x, pending);
      pending = undefined;
      return;
    }
    if (!store.has(x)) return;
    const y = store.get(x)!;
    store.delete(x);
    o.emit(0, [y]);
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (m[0] === 'clear') { store.clear(); pending = undefined; return; }
        if (isBang(m)) {
          for (const x of [...store.keys()].sort((a, b) => a - b)) o.emit(0, [store.get(x)!]);
          return;
        }
        const ns = nums(m);
        if (ns.length === 0) return;
        if (ns.length >= 2) pending = Math.trunc(ns[1]);
        takeX(Math.trunc(ns[0]));
      },
      (m) => { const n = firstNum(m); if (n !== undefined) pending = Math.trunc(n); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── bondo : synchronise a group of messages ───────────────────────────────────
//
// Max reference (bondo.maxref.xml). Args: [inlets/outlets = 2] [delay ms] [n].
// Each inlet stores its most recent message (0 until something arrives). A message
// in ANY inlet is stored there and then every stored message goes out its matching
// outlet, right-to-left (highest outlet first). With a delay argument, output from a
// message waits that many ms (a newer message restarts the wait); output from a bang
// is always immediate. A list is spread over that inlet and the ones to its right,
// unless the "n" flag is given, in which case the whole list is stored at that inlet.
// `set <msg>` stores without output.
register('bondo', (args) => {
  const o = makeOutlets();
  const numArgs = args.filter((a) => typeof a === 'number' && Number.isFinite(a)) as number[];
  const listMode = args.some((a) => a === 'n');
  const nInlets = Math.min(256, Math.max(1, Math.trunc(numArgs[0] ?? 2)));
  const delayMs = Math.max(0, numArgs[1] ?? 0);
  const stored: Msg[] = new Array(nInlets).fill(0).map(() => [0] as Msg);
  let cancel: (() => void) | null = null;
  const fire = () => {
    if (cancel) { cancel(); cancel = null; }
    for (let i = nInlets - 1; i >= 0; i--) o.emit(i, stored[i]);
  };
  const store = (inlet: number, m: Msg) => {
    if (!listMode && m.length > 1 && m.every((a) => typeof a === 'number')) {
      for (let k = 0; k < m.length && inlet + k < nInlets; k++) stored[inlet + k] = [m[k]];
    } else {
      stored[inlet] = m.slice() as Msg;
    }
  };
  const controlIns: ((m: Msg) => void)[] = [];
  for (let i = 0; i < nInlets; i++) {
    const inlet = i;
    controlIns[i] = (m) => {
      if (isBang(m)) { fire(); return; }
      if (m[0] === 'set') { if (m.length > 1) store(inlet, m.slice(1) as Msg); return; }
      if (m.length === 0) return;
      store(inlet, m as Msg);
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
