// Control (Max message) objects — the non-signal domain: timers, counters, math,
// and value stores. They push messages (Atom lists) along control cords, which the
// engine routes into controlIns handlers (e.g. cycle~'s frequency handler).
//
// REFERENCE PATTERN for new control objects:
//   const o = makeOutlets();                       // fan-out helper
//   return {
//     signalIns: [], signalOuts: [],
//     controlIns: [ (m) => { ...; o.emit(0, [result]); } ],
//     onControlOut: o.onControlOut,
//     dispose: () => {...},                         // cancel timers / unsubscribe
//   };
// Messages are Atom[] (see runtime/atoms): a bang is BANG, a number is [n], a list
// is [a, b, c]. Use firstNum(m)/nums(m)/isBang(m) to read them. Time-driven objects
// use the shared `scheduler` so ▶/■ start and stop them in sync with audio.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { scheduler } from '../../runtime/scheduler';
import { BANG, firstNum, isBang, type Atom, type Msg } from '../../runtime/atoms';

/** A message that should "fire" a bang-like object (a bang or any number). */
function isTrigger(m: Msg): boolean {
  return isBang(m) || firstNum(m) !== undefined;
}

// ── Timing ──────────────────────────────────────────────────────────────────

// metro <ms> : bang repeatedly at a fixed interval. inlet 0 turns it on/off
// (nonzero/bang = on, 0 = off); inlet 1 sets the interval.
//
// Prototype convenience: on by default, and the shared scheduler only lets it tick
// while the transport is running — so a loaded patch plays on ▶ without a toggle
// click. An explicit 0 into inlet 0 still stops it.
register('metro', (args) => {
  const o = makeOutlets();
  let interval = Math.max(1, num(args[0], 500));
  let cancel: (() => void) | null = null;
  const on = () => { if (!cancel) cancel = scheduler.everyMs(interval, () => o.emit(0, BANG)); };
  const off = () => { if (cancel) { cancel(); cancel = null; } };
  on(); // auto-start (scheduler gates actual ticking to the transport)
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

// delay <ms> : bang in -> bang out, `ms` later. A new bang reschedules.
register('delay', (args) => {
  const o = makeOutlets();
  let ms = Math.max(0, num(args[0], 0));
  let cancel: (() => void) | null = null;
  const clear = () => { if (cancel) { cancel(); cancel = null; } };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => { if (isTrigger(m)) { clear(); cancel = scheduler.afterMs(ms, () => o.emit(0, BANG)); } },
      (m) => { const n = firstNum(m); if (n !== undefined) ms = Math.max(0, n); },
    ],
    onControlOut: o.onControlOut,
    dispose: clear,
  } satisfies MaxNode;
});

// ── Generators ──────────────────────────────────────────────────────────────

// counter [min] [max] : on each bang, output the current count, then advance,
// wrapping min..max. One arg = max (min 0); two args = min, max.
register('counter', (args) => {
  const o = makeOutlets();
  const min = args.length >= 2 ? num(args[0], 0) : 0;
  const max = args.length >= 2 ? num(args[1], 127) : num(args[0], 127);
  let count = min;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (!isTrigger(m)) return;
        o.emit(0, [count]);
        count = count >= max ? min : count + 1;
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// random <N> : on a bang, output a random int in [0, N). inlet 1 sets N.
register('random', (args) => {
  const o = makeOutlets();
  let n = Math.max(1, num(args[0], 128));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => { if (isTrigger(m)) o.emit(0, [Math.floor(Math.random() * n)]); },
      (m) => { const v = firstNum(m); if (v !== undefined) n = Math.max(1, v); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── Math ────────────────────────────────────────────────────────────────────

// Binary control math (+ - * / %): the left inlet triggers output, the right inlet
// (or the creation arg) stores the operand. A bang re-outputs.
function makeControlMath(op: (a: number, b: number) => number) {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    let operand = num(args[0], 0);
    let left = 0;
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          const n = firstNum(m);
          if (n !== undefined) { left = n; o.emit(0, [op(left, operand)]); }
          else if (isBang(m)) o.emit(0, [op(left, operand)]);
        },
        (m) => { const n = firstNum(m); if (n !== undefined) operand = n; },
      ],
      onControlOut: o.onControlOut,
    };
  };
}
register('+', makeControlMath((a, b) => a + b));
register('-', makeControlMath((a, b) => a - b));
register('*', makeControlMath((a, b) => a * b));
register('/', makeControlMath((a, b) => (b === 0 ? 0 : a / b)));
register('%', makeControlMath((a, b) => (b === 0 ? 0 : a % b)));

// mtof : MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). The classic bridge
// from control ints to a cycle~/saw frequency inlet.
register('mtof', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => { const n = firstNum(m); if (n !== undefined) o.emit(0, [440 * Math.pow(2, (n - 69) / 12)]); }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// scale <inLo> <inHi> <outLo> <outHi> : linearly remap a number between ranges
// (default in 0..127, out 0..1).
register('scale', (args) => {
  const o = makeOutlets();
  const inLo = num(args[0], 0);
  const inHi = num(args[1], 127);
  const outLo = num(args[2], 0);
  const outHi = num(args[3], 1);
  const span = inHi - inLo || 1;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => { const n = firstNum(m); if (n !== undefined) o.emit(0, [outLo + ((n - inLo) / span) * (outHi - outLo)]); }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── Value stores & UI-ish objects ────────────────────────────────────────────

// int/i, float/f, number, flonum : store a value. A number at the left inlet stores
// AND outputs it; a bang outputs the stored value; the right inlet stores silently.
function makeStore(coerce: (x: number) => number) {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    let val = coerce(num(args[0], 0));
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          if (isBang(m)) o.emit(0, [val]);
          else { const n = firstNum(m); if (n !== undefined) { val = coerce(n); o.emit(0, [val]); } }
        },
        (m) => { const n = firstNum(m); if (n !== undefined) val = coerce(n); },
      ],
      onControlOut: o.onControlOut,
    };
  };
}
register('int', makeStore(Math.trunc));
register('i', makeStore(Math.trunc));
register('float', makeStore((x) => x));
register('f', makeStore((x) => x));
register('number', makeStore(Math.trunc));
register('flonum', makeStore((x) => x));

// toggle : bang flips its 0/1 state; a number sets it (nonzero -> 1). Outputs state.
register('toggle', () => {
  const o = makeOutlets();
  let state = 0;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => {
      if (isBang(m)) state = state ? 0 : 1;
      else { const n = firstNum(m); if (n !== undefined) state = n !== 0 ? 1 : 0; }
      o.emit(0, [state]);
    }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// button/bng : any input produces a bang.
function makeButton(): MaxNode {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [() => o.emit(0, BANG)],
    onControlOut: o.onControlOut,
  };
}
register('button', makeButton);
register('bng', makeButton);

// message : on any trigger, output its stored content as a message (list of atoms).
register('message', (args) => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => {
      if (!isTrigger(m) && m.length === 0) return;
      o.emit(0, args.length ? (args as Msg) : BANG);
    }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
