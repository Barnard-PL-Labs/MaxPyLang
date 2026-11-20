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
// `router <ins> <outs>` : a message patchbay, per Max's reference. The leftmost inlet
// only takes the matrix messages; the data inlets after it and the outlets are both
// numbered from 0, as Max numbers them (inlet "0" is the box's second inlet):
//   <in> <out> <state>   a list: connect (state nonzero) or disconnect (state 0)
//   connect <in> <out> / disconnect <in> <out>
//   patch <in> <out>     connect, and disconnect every other inlet from that outlet
//   clear                disconnect everything
//   dump                 "<in> <out> 1" out the right (dumpout) outlet per connection
//   print                the connections to the console
// Anything into data inlet k goes out every outlet connected to it. ins+1 inlets,
// outs+1 outlets (the last is dumpout).
register('router', (args) => {
  const o = makeOutlets();
  const ins = Math.max(1, Math.trunc(num(args[0], 1)));
  const outs = Math.max(1, Math.trunc(num(args[1], 1)));
  const conns = new Map<number, Set<number>>(); // data inlet (0..ins-1) -> outlets (0..outs-1)
  const valid = (i: number, j: number) => i >= 0 && i < ins && j >= 0 && j < outs;
  const connect = (i: number, j: number) => {
    if (!valid(i, j)) return;
    const set = conns.get(i) ?? new Set<number>();
    set.add(j);
    conns.set(i, set);
  };
  const disconnect = (i: number, j: number) => { if (valid(i, j)) conns.get(i)?.delete(j); };
  const pairs = (): [number, number][] =>
    [...conns.keys()].sort((x, y) => x - y).flatMap((i) => [...conns.get(i)!].sort((x, y) => x - y).map((j) => [i, j] as [number, number]));
  const controlIns: (((m: Msg) => void) | undefined)[] = [
    // admin inlet
    (m) => {
      const head = m[0];
      const n = m.slice(typeof head === 'string' ? 1 : 0).map((a) => (typeof a === 'number' ? Math.trunc(a) : NaN));
      switch (head) {
        case 'connect': if (n.length >= 2) connect(n[0], n[1]); return;
        case 'disconnect': if (n.length >= 2) disconnect(n[0], n[1]); return;
        case 'patch':
          if (n.length >= 2 && valid(n[0], n[1])) {
            for (const set of conns.values()) set.delete(n[1]);
            connect(n[0], n[1]);
          }
          return;
        case 'clear': conns.clear(); return;
        case 'dump': for (const [i, j] of pairs()) o.emit(outs, [i, j, 1]); return;
        case 'print': console.log(`router: ${pairs().map(([i, j]) => `${i} ${j}`).join(', ') || 'no connections'}`); return;
      }
      if (typeof head !== 'number' || n.length < 2) return;
      const state = n.length >= 3 ? n[2] : 1;
      if (state) connect(n[0], n[1]);
      else disconnect(n[0], n[1]);
    },
  ];
  for (let k = 0; k < ins; k++) {
    controlIns[k + 1] = (m) => {
      const set = conns.get(k);
      if (set) for (const out of [...set].sort((x, y) => y - x)) o.emit(out, m); // right to left
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
