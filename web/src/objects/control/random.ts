// Random-domain control objects: bounded random walks and sampling.
// Self-registering module — importing it calls register(...) for each class.
// Follows the reference pattern in control/index.ts: makeOutlets() for fan-out,
// controlIns[i] receives a Msg, emit(outlet, msg) sends results.
//
// Manifest arity (must match exactly):
//   drunk  : 3 inlets, 1 outlet  [control]
//   urn    : 2 inlets, 2 outlets [control, control]
//   decide : 2 inlets, 1 outlet  [control]
// (coin is not in the manifest, so it is not implemented here.)

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { BANG, firstNum, isBang, type Atom } from '../../runtime/atoms';

/** A bang or any number should "fire" a generator. */
function isTrigger(m: Atom[]): boolean {
  return isBang(m) || firstNum(m) !== undefined;
}

// ── drunk [max] [step] ────────────────────────────────────────────────────────
// A bounded random walk. On a bang, take a random step in [-step, step] from the
// current value, clamp into [0, max), and output the new value. Inlet 1 sets the
// range (max), inlet 2 sets the step size. A number into inlet 0 sets the current
// value (and outputs it), like Max's drunk.
register('drunk', (args) => {
  const o = makeOutlets();
  let max = Math.max(1, Math.trunc(num(args[0], 128)));
  let step = Math.max(1, Math.trunc(num(args[1], 2)));
  let value = 0;
  const clamp = (v: number) => Math.min(max - 1, Math.max(0, v));
  const walk = () => {
    const delta = Math.floor(Math.random() * (2 * step + 1)) - step; // [-step, step]
    value = clamp(value + delta);
    o.emit(0, [value]);
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { walk(); return; }
        const n = firstNum(m);
        if (n !== undefined) { value = clamp(Math.trunc(n)); o.emit(0, [value]); }
      },
      (m) => { const n = firstNum(m); if (n !== undefined) max = Math.max(1, Math.trunc(n)); },
      (m) => { const n = firstNum(m); if (n !== undefined) step = Math.max(1, Math.trunc(n)); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── urn [limit] [seed] ────────────────────────────────────────────────────────
// Random numbers without replacement. On a bang, output a random unused value in
// [0, limit) out the left outlet and mark it used. When every value has been drawn,
// a bang produces nothing on the left and a bang on the right (exhausted) outlet.
// A `clear` message (or inlet 1 setting the limit) refills the urn. The seed arg is
// accepted for compatibility but ignored (Math.random has no seeding).
register('urn', (args) => {
  const o = makeOutlets();
  let limit = Math.max(1, Math.trunc(num(args[0], 128)));
  let remaining: number[] = [];
  const refill = () => { remaining = Array.from({ length: limit }, (_, i) => i); };
  refill();
  const draw = () => {
    if (remaining.length === 0) { o.emit(1, BANG); return; }
    const i = Math.floor(Math.random() * remaining.length);
    const [picked] = remaining.splice(i, 1);
    o.emit(0, [picked]);
    if (remaining.length === 0) o.emit(1, BANG);
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (m.length === 1 && m[0] === 'clear') { refill(); return; }
        if (isTrigger(m)) draw();
      },
      (m) => { const n = firstNum(m); if (n !== undefined) { limit = Math.max(1, Math.trunc(n)); refill(); } },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── decide [seed] ─────────────────────────────────────────────────────────────
// On a bang (or any number), output 0 or 1 with equal probability. The seed arg /
// inlet 1 are accepted for compatibility but ignored.
register('decide', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => { if (isTrigger(m)) o.emit(0, [Math.random() < 0.5 ? 0 : 1]); },
      () => {},
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
