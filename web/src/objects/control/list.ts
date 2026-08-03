// List / message-plumbing control objects: the zl.* family plus pack/unpack/pak,
// thresh, iter, bag, funnel, spray, mean, bucket. These manipulate messages
// (Atom[]) rather than audio — reordering, splitting, joining, tagging, and
// accumulating atoms.
//
// Follows the REFERENCE PATTERN in control/index.ts:
//   const o = makeOutlets();
//   return { signalIns:[], signalOuts:[], controlIns:[ (m)=>{...; o.emit(0, msg)} ],
//            onControlOut: o.onControlOut, dispose? };
//
// zl.* convention (like the control-math left/right split):
//   • inlet 0 (left)  triggers the operation and produces output.
//   • inlet 1 (right) stores an operand (a list or a number) WITHOUT triggering.
// Outlets emit right-to-left (outlet 1 before outlet 0), matching Max's order.
//
// This module is self-registering: importing it runs the register(...) calls.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { scheduler } from '../../runtime/scheduler';
import { firstNum, isBang, nums, type Atom, type Msg } from '../../runtime/atoms';

// Value-equality for atoms (numbers compared numerically, symbols as strings).
const sameAtom = (a: Atom, b: Atom): boolean => String(a) === String(b);

// A numeric comparator for sort/median that falls back to string order.
const cmp = (a: Atom, b: Atom): number => {
  const na = Number(a), nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

// ── zl.* : no operand (operate on the left list; a bang re-runs the stored list) ──

// Builds a zl object whose left inlet operates on a list and whose right inlet
// stores a list that a bang at the left inlet operates on. `op` returns messages
// for outlet 0 (and optionally outlet 1).
function zlUnary(op: (list: Atom[], o: ReturnType<typeof makeOutlets>) => void) {
  return (): MaxNode => {
    const o = makeOutlets();
    let stored: Atom[] = [];
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => { op(isBang(m) ? stored : m, o); },
        (m) => { stored = isBang(m) ? [] : m.slice(); },
      ],
      onControlOut: o.onControlOut,
    };
  };
}

// zl.rev : reverse a list.
register('zl.rev', zlUnary((list, o) => o.emit(0, list.slice().reverse())));

// zl.len : output the number of atoms in the list.
register('zl.len', zlUnary((list, o) => o.emit(0, [list.length])));

// zl.sum : output the sum of the (numeric) atoms.
register('zl.sum', zlUnary((list, o) => o.emit(0, [nums(list).reduce((a, b) => a + b, 0)])));

// zl.median : output the median of the (numeric) atoms.
register('zl.median', zlUnary((list, o) => {
  const s = nums(list).slice().sort((a, b) => a - b);
  if (!s.length) return;
  const mid = Math.floor(s.length / 2);
  const med = s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  o.emit(0, [med]);
}));

// zl.delace : de-interleave. Even-indexed atoms out outlet 0, odd-indexed out outlet 1.
register('zl.delace', zlUnary((list, o) => {
  const even: Atom[] = [], odd: Atom[] = [];
  list.forEach((a, i) => (i % 2 === 0 ? even : odd).push(a));
  o.emit(1, odd);
  o.emit(0, even);
}));

// zl.sort : sort the list. Outlet 0 = sorted atoms, outlet 1 = the permutation of
// original indices. The (optional) right inlet / arg sets order (>=0 ascending, <0 descending).
register('zl.sort', (args) => {
  const o = makeOutlets();
  let stored: Atom[] = [];
  let order = num(args[0], 1);
  const run = (list: Atom[]) => {
    const idx = list.map((_, i) => i).sort((i, j) => (order < 0 ? -1 : 1) * cmp(list[i], list[j]));
    o.emit(1, idx);
    o.emit(0, idx.map((i) => list[i]));
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => run(isBang(m) ? stored : m),
      (m) => { const n = firstNum(m); if (n !== undefined) order = n; else if (!isBang(m)) stored = m.slice(); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── zl.* : numeric operand (from arg / right inlet) ──

// zl.slice N : outlet 0 = first N atoms, outlet 1 = the remainder.
register('zl.slice', (args) => {
  const o = makeOutlets();
  let n = Math.max(0, num(args[0], 1));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => { if (isBang(m)) return; o.emit(1, m.slice(n)); o.emit(0, m.slice(0, n)); },
      (m) => { const v = firstNum(m); if (v !== undefined) n = Math.max(0, v); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// zl.rot N : rotate the list by N places (positive = toward the end / rightward).
register('zl.rot', (args) => {
  const o = makeOutlets();
  let dist = num(args[0], 1);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m) || m.length === 0) return;
        const k = ((dist % m.length) + m.length) % m.length;
        o.emit(0, m.slice(m.length - k).concat(m.slice(0, m.length - k)));
      },
      (m) => { const v = firstNum(m); if (v !== undefined) dist = v; },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// zl.nth I : outlet 0 = the atom at 1-based index I, outlet 1 = the list without it.
register('zl.nth', (args) => {
  const o = makeOutlets();
  let idx = Math.max(1, num(args[0], 1));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        const i = idx - 1;
        if (i < 0 || i >= m.length) return;
        o.emit(1, m.filter((_, j) => j !== i));
        o.emit(0, [m[i]]);
      },
      (m) => { const v = firstNum(m); if (v !== undefined) idx = Math.max(1, v); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// zl.group N : accumulate incoming atoms; emit a list of N atoms each time enough
// have arrived, keeping any remainder for the next group.
register('zl.group', (args) => {
  const o = makeOutlets();
  let size = Math.max(1, num(args[0], 2));
  let buf: Atom[] = [];
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        buf.push(...m);
        while (buf.length >= size) o.emit(0, buf.splice(0, size));
      },
      (m) => { const v = firstNum(m); if (v !== undefined) { size = Math.max(1, v); buf = []; } },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── zl.* : list operand (from arg / right inlet) ──

// zl.join : append the stored list to the incoming list.
register('zl.join', (args) => {
  const o = makeOutlets();
  let stored: Atom[] = args.slice() as Atom[];
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => { if (isBang(m)) return; o.emit(0, m.concat(stored)); },
      (m) => { stored = isBang(m) ? [] : m.slice(); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// zl.filter : the stored list is a filter set. Outlet 0 = atoms NOT in the set
// (kept), outlet 1 = atoms in the set (removed).
register('zl.filter', (args) => {
  const o = makeOutlets();
  let filter: Atom[] = args.slice() as Atom[];
  const inFilter = (a: Atom) => filter.some((f) => sameAtom(f, a));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        o.emit(1, m.filter(inFilter));
        o.emit(0, m.filter((a) => !inFilter(a)));
      },
      (m) => { filter = isBang(m) ? [] : m.slice(); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// zl.compare : output [1] if the incoming list equals the stored list, else [0].
register('zl.compare', (args) => {
  const o = makeOutlets();
  let stored: Atom[] = args.slice() as Atom[];
  const eq = (a: Atom[], b: Atom[]) => a.length === b.length && a.every((x, i) => sameAtom(x, b[i]));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => { if (isBang(m)) return; o.emit(0, [eq(m, stored) ? 1 : 0]); },
      (m) => { stored = isBang(m) ? [] : m.slice(); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// zl.change : output the incoming list only if it differs from the previous one.
register('zl.change', (args) => {
  const o = makeOutlets();
  let prev: Atom[] = args.slice() as Atom[];
  const eq = (a: Atom[], b: Atom[]) => a.length === b.length && a.every((x, i) => sameAtom(x, b[i]));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => { if (isBang(m)) return; if (!eq(m, prev)) { prev = m.slice(); o.emit(0, m); } },
      () => {},
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── zl.* : buffers ──

// zl.queue : FIFO. A number/list at the left inlet enqueues its atoms; a bang
// dequeues the oldest atom out outlet 0 (outlet 1 emits the remaining count).
register('zl.queue', () => {
  const o = makeOutlets();
  const buf: Atom[] = [];
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { if (buf.length) { const v = buf.shift()!; o.emit(1, [buf.length]); o.emit(0, [v]); } }
        else buf.push(...m);
      },
      () => {},
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// zl.stack : LIFO. Like zl.queue but a bang pops the most recent atom.
register('zl.stack', () => {
  const o = makeOutlets();
  const buf: Atom[] = [];
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { if (buf.length) { const v = buf.pop()!; o.emit(1, [buf.length]); o.emit(0, [v]); } }
        else buf.push(...m);
      },
      () => {},
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── pack / pak / unpack ──

// pack : hold a slot per inlet. Setting inlet 0 (or a bang there) outputs the whole
// list; setting any other inlet stores silently. pak is identical but ANY inlet
// triggers output.
function makePack(triggerAny: boolean) {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    const n = Math.max(2, args.length);
    const slots: Atom[] = [];
    for (let i = 0; i < n; i++) slots[i] = typeof args[i] === 'number' ? args[i] : (args[i] ?? 0);
    const store = (i: number, m: Msg) => {
      if (isBang(m)) return false;
      // A list into inlet 0 distributes across the slots (pack "1 2 3" behaviour).
      if (i === 0 && m.length > 1) { for (let k = 0; k < m.length && k < n; k++) slots[k] = m[k]; return true; }
      slots[i] = m[0];
      return true;
    };
    const controlIns = [];
    for (let i = 0; i < n; i++) {
      controlIns[i] = (m: Msg) => {
        const changed = store(i, m);
        if (isBang(m) || i === 0 || (triggerAny && changed)) o.emit(0, slots.slice());
      };
    }
    return { signalIns: [], signalOuts: [], controlIns, onControlOut: o.onControlOut };
  };
}
register('pack', makePack(false));
register('pak', makePack(true));

// unpack : split an incoming list, sending each atom out its own outlet (right to left).
register('unpack', (args) => {
  const o = makeOutlets();
  const n = Math.max(2, args.length);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        for (let i = n - 1; i >= 0; i--) if (m[i] !== undefined) o.emit(i, [m[i]]);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── thresh : accumulate atoms arriving close together, emit the combined list once
// a gap of `threshold-time` ms passes with no new input. ──
register('thresh', (args) => {
  const o = makeOutlets();
  let ms = Math.max(0, num(args[0], 10));
  let buf: Atom[] = [];
  let cancel: (() => void) | null = null;
  const clear = () => { if (cancel) { cancel(); cancel = null; } };
  const flush = () => { if (buf.length) { const out = buf; buf = []; o.emit(0, out); } };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        buf.push(...m);
        clear();
        cancel = scheduler.afterMs(ms, () => { cancel = null; flush(); });
      },
      (m) => { const v = firstNum(m); if (v !== undefined) ms = Math.max(0, v); },
    ],
    onControlOut: o.onControlOut,
    dispose: clear,
  } satisfies MaxNode;
});

// ── iter : break a list into individual atoms, sent one at a time out outlet 0. ──
register('iter', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => { if (isBang(m)) return; for (const a of m) o.emit(0, [a]); }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── bag : store a collection of numbers. A number at the left inlet adds it; a bang
// dumps every stored value (one message each) out outlet 0. A 0 at the right inlet
// clears the bag. ──
register('bag', () => {
  const o = makeOutlets();
  let buf: number[] = [];
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { for (const v of buf) o.emit(0, [v]); return; }
        const n = firstNum(m);
        if (n !== undefined) buf.push(n);
      },
      (m) => { const v = firstNum(m); if (v !== undefined && v === 0) buf = []; },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── funnel N [offset] : N inlets funnel into one outlet. A value at inlet i emits
// the two-atom message [i + offset, value]. ──
register('funnel', (args) => {
  const o = makeOutlets();
  const n = Math.max(2, num(args[0], 2));
  const offset = num(args[1], 0);
  const controlIns = [];
  for (let i = 0; i < n; i++) {
    controlIns[i] = (m: Msg) => {
      const v = firstNum(m);
      if (v !== undefined) o.emit(0, [i + offset, v]);
      else if (isBang(m)) o.emit(0, [i + offset, 0]);
    };
  }
  return { signalIns: [], signalOuts: [], controlIns, onControlOut: o.onControlOut } satisfies MaxNode;
});

// ── spray N [offset] : receive [index, value] and route `value` out outlet
// (index - offset). The inverse of funnel. ──
register('spray', (args) => {
  const o = makeOutlets();
  const n = Math.max(2, num(args[0], 2));
  const offset = num(args[1], 0);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m) || m.length < 2) return;
        const idx = (firstNum(m) ?? 0) - offset;
        if (idx >= 0 && idx < n) o.emit(idx, m.slice(1));
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── mean : running arithmetic mean. Each incoming number updates it; outlet 0 =
// running mean, outlet 1 = count of numbers seen. A bang re-outputs the current values. ──
register('mean', () => {
  const o = makeOutlets();
  let sum = 0, count = 0;
  const report = () => { o.emit(1, [count]); o.emit(0, [count ? sum / count : 0]); };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { report(); return; }
        for (const v of nums(m)) { sum += v; count++; }
        report();
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── bucket N : a bucket-brigade / shift register of N stages. Each incoming number
// is pushed into stage 0, shifting every stage along; the value falling off the end
// is emitted. With N=1 this is a one-step delay. A bang re-emits the tail. ──
register('bucket', (args) => {
  const o = makeOutlets();
  const n = Math.max(1, num(args[0], 1));
  const stages: number[] = new Array(n).fill(0);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { o.emit(0, [stages[n - 1]]); return; }
        const v = firstNum(m);
        if (v === undefined) return;
        o.emit(0, [stages[n - 1]]);
        stages.pop();
        stages.unshift(v);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
