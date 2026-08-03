// Control-domain DATA objects: named value stores and message/collection helpers.
//
// Same contract as control/index.ts (the reference pattern):
//   const o = makeOutlets();
//   return { signalIns: [], signalOuts: [], controlIns: [ (m) => { … o.emit(0, msg) } ],
//            onControlOut: o.onControlOut, dispose?() };
//
// Messages are Atom[] (see runtime/atoms): a bang is BANG, a number is [n], a list
// is [a, b, c]. Read them with isBang(m)/firstNum(m)/nums(m).
//
// This module is self-registering: importing it runs the register(...) calls below.
// It touches only NEW code — no shared file is edited.

import { register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { buses } from '../../runtime/buses';
import { BANG, firstNum, isBang, nums, type Atom, type Msg } from '../../runtime/atoms';

// ── Named value stores: value / v / pv ────────────────────────────────────────
//
// `value name [initial]` (alias `v`) and `pv name [message]` share one named cell
// across the whole patch via runtime/buses (getValue/setValue). Semantics:
//   • a number or list at the inlet SETS the shared cell silently (all peers see it);
//   • a bang OUTPUTS the currently stored message.
// This is the classic Max `value` behaviour (store-on-input, emit-on-bang), distinct
// from int/float which also emit on input.
//
// NOTE ON ARITY: manifest.json lists value/pv as 0-inlet/0-outlet (a data-only
// extraction artifact — real Max `value` is 1-in/1-out). A 0/0 node has no ports to
// store against and cannot be exercised by golden input→output tests, so — following
// this batch's explicit spec ("value/v share named storage via getValue/setValue") —
// these are implemented as functional 1-inlet/1-outlet stores. See the return notes.
function makeNamedStore() {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    const name = String(args[0] ?? '');
    // Seed the shared cell from the initial arg, but never clobber a value a peer
    // (constructed earlier, same name) has already written.
    if (args.length >= 2 && buses.getValue(name).length === 0) {
      buses.setValue(name, args.slice(1) as Msg);
    }
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          if (isBang(m)) o.emit(0, buses.getValue(name));
          else if (m.length > 0) buses.setValue(name, m);
        },
      ],
      onControlOut: o.onControlOut,
    };
  };
}
register('value', makeNamedStore());
register('v', makeNamedStore());
register('pv', makeNamedStore());

// ── funbuff : a function buffer of (x → y) integer pairs ───────────────────────
//
// manifest: 2 inlets, 3 outlets (all control).
//   left inlet  : list [x y] stores the pair; int x recalls the y stored at x.
//   right inlet : int sets a "pending y"; the next int at the left inlet then STORES
//                 (x, pendingY) instead of recalling (Max's two-inlet store form).
//   outlet 0    : the recalled y value.
//   outlet 1    : the difference between this y and the previously recalled y (delta).
//   outlet 2    : a bang when a recall misses (no pair stored at that x).
register('funbuff', () => {
  const o = makeOutlets();
  const table = new Map<number, number>();
  let pendingY: number | undefined;
  let lastY = 0;
  const store = (x: number, y: number) => { table.set(x, y); };
  const recall = (x: number) => {
    if (table.has(x)) {
      const y = table.get(x)!;
      o.emit(0, [y]);
      o.emit(1, [y - lastY]);
      lastY = y;
    } else {
      o.emit(2, BANG);
    }
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        if (typeof m[0] === 'string' && m[0] === 'clear') { table.clear(); return; }
        const n = nums(m);
        if (n.length >= 2) { store(n[0], n[1]); return; } // list "x y" stores
        if (n.length === 1) {
          if (pendingY !== undefined) { store(n[0], pendingY); pendingY = undefined; }
          else recall(n[0]);
        }
      },
      (m) => { const y = firstNum(m); if (y !== undefined) pendingY = y; },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── bag : a store (multiset) of numbers ────────────────────────────────────────
//
// manifest: 2 inlets, 1 outlet (control). Optional arg = a duplicate flag (any symbol)
// that lets the same number be stored more than once.
//   left inlet  : int is added (add mode) or removed (remove mode); bang dumps every
//                 stored number out the outlet, one message each; `clear` empties.
//   right inlet : int sets the mode — nonzero = add, 0 = remove.
register('bag', (args) => {
  const o = makeOutlets();
  const allowDupes = args.length >= 1 && args[0] !== undefined && args[0] !== '';
  const counts = new Map<number, number>();
  let addMode = true;
  const add = (n: number) => counts.set(n, allowDupes ? (counts.get(n) ?? 0) + 1 : 1);
  const remove = (n: number) => counts.delete(n);
  const dump = () => {
    for (const [n, c] of counts) for (let i = 0; i < c; i++) o.emit(0, [n]);
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { dump(); return; }
        if (typeof m[0] === 'string' && m[0] === 'clear') { counts.clear(); return; }
        const n = firstNum(m);
        if (n !== undefined) (addMode ? add(n) : remove(n));
      },
      (m) => { const n = firstNum(m); if (n !== undefined) addMode = n !== 0; },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── prepend / append : glue extra atoms onto every message ─────────────────────
//
// manifest: 1 inlet, 1 outlet (control) each. The creation args are the atoms glued on.
// A bang carries no content, so it emits the glued atoms alone (e.g. `prepend set` +
// bang → "set"); a number/list is concatenated (`prepend set` + "1 2" → "set 1 2").
function makeGlue(where: 'front' | 'back') {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    const extra = args.slice() as Msg;
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          const body: Msg = isBang(m) ? [] : m;
          const out: Msg = where === 'front' ? [...extra, ...body] : [...body, ...extra];
          o.emit(0, out.length ? out : BANG);
        },
      ],
      onControlOut: o.onControlOut,
    };
  };
}
register('prepend', makeGlue('front'));
register('append', makeGlue('back'));
