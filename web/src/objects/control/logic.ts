// Control-domain LOGIC / ROUTING objects: the message-plumbing family that decides
// WHERE a message goes rather than WHAT its numeric value is. These sit next to the
// math/timing objects in control/index.ts and follow the same contract:
//
//   const o = makeOutlets();
//   controlIns[i] receives a Msg; emit results with o.emit(outlet, msg).
//
// Faithful-but-prototype: single-atom / simple-list messages, no attributes.
//
// Batch note honoured here:
//   • trigger / bangbang output right-to-left (rightmost outlet first).
//   • select/route match the FIRST atom; route strips it, routepass keeps it,
//     non-matching messages fall out the rightmost outlet.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { BANG, firstNum, isBang, type Atom, type Msg } from '../../runtime/atoms';

/** Any input that should make a bang-like object fire (bang or a number). */
function isTrigger(m: Msg): boolean {
  return isBang(m) || firstNum(m) !== undefined;
}

/** Atom equality with numeric coercion: 1 === "1", "foo" === "foo". */
function atomEq(a: Atom | undefined, b: Atom | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return false;
}

// ── select / sel ──────────────────────────────────────────────────────────────
// `select v1 v2 ...` : bang out outlet i when the incoming first atom equals vi.
// Non-matching messages pass through the rightmost outlet unchanged. With a single
// selector the right inlet updates it. Outlets = selectors + 1 (manifest default 2).
register('select', (args) => {
  const o = makeOutlets();
  const selectors: Atom[] = [...(args as Atom[])];
  const passOutlet = () => selectors.length; // last outlet
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const a = m[0];
        let matched = false;
        for (let i = 0; i < selectors.length; i++) {
          if (atomEq(a, selectors[i])) {
            o.emit(i, BANG);
            matched = true;
          }
        }
        if (!matched) o.emit(passOutlet(), m);
      },
      // right inlet: with exactly one selector, update the value to match on.
      (m) => {
        if (selectors.length === 1) {
          const n = firstNum(m);
          selectors[0] = n !== undefined ? n : (m[0] ?? selectors[0]);
        }
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── route ───────────────────────────────────────────────────────────────────
// `route s1 s2 ...` : match the first atom; strip it and send the REST out outlet i.
// A message equal to just the selector sends a bang. Non-matches fall out the last
// outlet with the full message. Outlets = selectors + 1.
register('route', (args) => {
  const o = makeOutlets();
  const selectors: Atom[] = [...(args as Atom[])];
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const a = m[0];
        for (let i = 0; i < selectors.length; i++) {
          if (atomEq(a, selectors[i])) {
            const rest = m.slice(1);
            o.emit(i, rest.length ? rest : BANG);
            return;
          }
        }
        o.emit(selectors.length, m);
      },
      (m) => {
        if (selectors.length === 1) {
          const n = firstNum(m);
          selectors[0] = n !== undefined ? n : (m[0] ?? selectors[0]);
        }
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── routepass ─────────────────────────────────────────────────────────────────
// Like route, but the matched outlet receives the WHOLE message (selector kept).
register('routepass', (args) => {
  const o = makeOutlets();
  const selectors: Atom[] = [...(args as Atom[])];
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const a = m[0];
        for (let i = 0; i < selectors.length; i++) {
          if (atomEq(a, selectors[i])) {
            o.emit(i, m);
            return;
          }
        }
        o.emit(selectors.length, m);
      },
      () => {},
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── trigger / t ───────────────────────────────────────────────────────────────
// `trigger f1 f2 ...` : for each format arg emit one message, RIGHT-TO-LEFT (rightmost
// outlet first). Formats: b(ang) i(nt) f(loat) l(ist) s(ymbol); any other atom is a
// constant emitted verbatim. Default (no args) = `t b b` (two outlets).
const TRIGGER_FORMATS = new Set(['b', 'i', 'f', 'l', 's']);
register('trigger', (args) => {
  const o = makeOutlets();
  const formats: Atom[] = (args as Atom[]).length ? [...(args as Atom[])] : ['b', 'b'];
  const emitOne = (i: number, fmt: Atom, m: Msg) => {
    if (typeof fmt === 'string' && TRIGGER_FORMATS.has(fmt)) {
      switch (fmt) {
        case 'b':
          o.emit(i, BANG);
          break;
        case 'i': {
          const n = firstNum(m);
          o.emit(i, [n !== undefined ? Math.trunc(n) : 0]);
          break;
        }
        case 'f': {
          const n = firstNum(m);
          o.emit(i, [n !== undefined ? n : 0]);
          break;
        }
        case 'l':
          o.emit(i, m.length ? m : BANG);
          break;
        case 's':
          o.emit(i, m.length ? m : BANG);
          break;
      }
    } else {
      // constant: emit the literal atom
      o.emit(i, [fmt]);
    }
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        for (let i = formats.length - 1; i >= 0; i--) emitOne(i, formats[i], m);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── bangbang / b ──────────────────────────────────────────────────────────────
// `bangbang N` : on ANY input, bang all N outlets right-to-left. Default N = 2.
register('bangbang', (args) => {
  const o = makeOutlets();
  const n = Math.max(1, Math.trunc(num(args[0], 2)));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (m.length === 0 && !isTrigger(m)) return;
        for (let i = n - 1; i >= 0; i--) o.emit(i, BANG);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── swap ──────────────────────────────────────────────────────────────────────
// Two numbers in, swapped out: left-inlet value -> RIGHT outlet, right-inlet value ->
// LEFT outlet. Left inlet triggers, right inlet stores. Output is right-to-left.
register('swap', (args) => {
  const o = makeOutlets();
  let left = 0;
  let right = num(args[0], 0);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) left = n;
        else if (!isBang(m)) return;
        o.emit(1, [left]); // right outlet gets left value
        o.emit(0, [right]); // left outlet gets right value
      },
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) right = n;
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── gate ──────────────────────────────────────────────────────────────────────
// `gate [outlets] [open]` : left inlet selects which outlet is open (0 = closed,
// n = outlet n); right inlet passes its message to the open outlet. 2 inlets always.
register('gate', (args) => {
  const o = makeOutlets();
  const outlets = Math.max(1, Math.trunc(num(args[0], 1)));
  let open = Math.trunc(num(args[1], 0));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) open = Math.max(0, Math.min(outlets, Math.trunc(n)));
      },
      (m) => {
        if (open > 0) o.emit(open - 1, m);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── switch ────────────────────────────────────────────────────────────────────
// `switch [inlets] [open]` : the opposite of gate. Left inlet selects which data inlet
// (1..N) passes to the single outlet (0 = none). inlets+1 inlets, 1 outlet.
register('switch', (args) => {
  const o = makeOutlets();
  const inlets = Math.max(1, Math.trunc(num(args[0], 2)));
  let open = Math.trunc(num(args[1], 0));
  const controlIns: (((m: Msg) => void) | undefined)[] = [
    (m) => {
      const n = firstNum(m);
      if (n !== undefined) open = Math.max(0, Math.min(inlets, Math.trunc(n)));
    },
  ];
  for (let k = 1; k <= inlets; k++) {
    controlIns[k] = (m) => {
      if (open === k) o.emit(0, m);
    };
  }
  return { signalIns: [], signalOuts: [], controlIns, onControlOut: o.onControlOut } satisfies MaxNode;
});

// ── gswitch ───────────────────────────────────────────────────────────────────
// UI toggle-switch: control inlet (0) picks the active data inlet; a bang toggles it,
// an int sets it (0 -> inlet 1, nonzero -> inlet 2). The active data inlet passes to
// the single outlet. 3 inlets (control + 2 data), 1 outlet.
register('gswitch', () => {
  const o = makeOutlets();
  let active = 0; // 0 => data inlet 1, 1 => data inlet 2
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) active = active ? 0 : 1;
        else {
          const n = firstNum(m);
          if (n !== undefined) active = n !== 0 ? 1 : 0;
        }
      },
      (m) => {
        if (active === 0) o.emit(0, m);
      },
      (m) => {
        if (active === 1) o.emit(0, m);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── onebang ───────────────────────────────────────────────────────────────────
// Lets one bang pass, then closes. Left inlet: a bang passes out the left outlet if
// the gate is open, then closes it and bangs the right outlet (chain/reset signal).
// Right inlet: nonzero/bang opens the gate, 0 closes it. `onebang 1` starts open.
register('onebang', (args) => {
  const o = makeOutlets();
  let open = Math.trunc(num(args[0], 0)) !== 0;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (!isTrigger(m)) return;
        if (open) {
          open = false;
          o.emit(0, BANG);
          o.emit(1, BANG);
        }
      },
      (m) => {
        if (isBang(m)) open = true;
        else {
          const n = firstNum(m);
          if (n !== undefined) open = n !== 0;
        }
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── router ────────────────────────────────────────────────────────────────────
// `router <ins> <outs>` : a matrix patchbay. The admin (leftmost) inlet takes
// "<in> <out> [state]" messages to connect (state nonzero / default) or disconnect
// (state 0, or out 0 clears the inlet). A message into data inlet k is copied to
// every outlet currently connected to it. ins+1 inlets, outs outlets.
register('router', (args) => {
  const o = makeOutlets();
  const ins = Math.max(1, Math.trunc(num(args[0], 1)));
  const outs = Math.max(1, Math.trunc(num(args[1], 1)));
  const conns = new Map<number, Set<number>>(); // data-inlet(1..ins) -> set of outlet(1..outs)
  const controlIns: (((m: Msg) => void) | undefined)[] = [
    // admin inlet
    (m) => {
      const a = m[0];
      const b = m[1];
      if (typeof a !== 'number' || typeof b !== 'number') return;
      const inIdx = Math.trunc(a);
      const outIdx = Math.trunc(b);
      const state = m.length >= 3 ? firstNum([m[2]]) ?? 1 : 1;
      if (inIdx < 1 || inIdx > ins) return;
      if (outIdx === 0 || state === 0) {
        // clear this inlet's connection to outIdx (or all if outIdx 0)
        const set = conns.get(inIdx);
        if (set) {
          if (outIdx === 0) set.clear();
          else set.delete(outIdx);
        }
        return;
      }
      if (outIdx < 1 || outIdx > outs) return;
      const set = conns.get(inIdx) ?? new Set<number>();
      set.add(outIdx);
      conns.set(inIdx, set);
    },
  ];
  for (let k = 1; k <= ins; k++) {
    controlIns[k] = (m) => {
      const set = conns.get(k);
      if (set) for (const out of set) o.emit(out - 1, m);
    };
  }
  return { signalIns: [], signalOuts: [], controlIns, onControlOut: o.onControlOut } satisfies MaxNode;
});

// ── Aliases ───────────────────────────────────────────────────────────────────
// The bootstrap wires manifest aliases, but tests import this module in isolation,
// so register the short names directly (pointing at the same behaviour).
import { getFactory } from '../../engine/registry';
for (const [alias, canonical] of [
  ['sel', 'select'],
  ['t', 'trigger'],
  ['b', 'bangbang'],
] as const) {
  const f = getFactory(canonical);
  if (f) register(alias, f);
}
