// Control (Max message) objects — the non-signal domain: timers, counters,
// math, and value stores. These don't touch the audio graph directly; they push
// ControlValues along control cords, which the engine routes to controlIns
// handlers (e.g. cycle~'s frequency handler).
//
// Fidelity notes are inline. Like the audio objects, the goal is "recognisably
// correct behaviour" for the common cases, not full Max parity (no lists, no
// attributes, single-atom values only).

import { num, register, type ControlValue, type MaxNode } from '../../engine/registry';

/**
 * A fan-out helper for control outlets. `emit(outlet, v)` delivers `v` to every
 * cord connected to that outlet; `onControlOut` is what the engine calls to
 * subscribe each destination. Every control object shares this shape.
 */
function outlets() {
  const listeners = new Map<number, Array<(v: ControlValue) => void>>();
  return {
    onControlOut(outlet: number, cb: (v: ControlValue) => void) {
      const arr = listeners.get(outlet) ?? [];
      arr.push(cb);
      listeners.set(outlet, arr);
    },
    emit(outlet: number, v: ControlValue) {
      const arr = listeners.get(outlet);
      if (arr) for (const cb of arr) cb(v);
    },
  };
}

/** True for anything that should "fire" a bang-like object (a bang or a number). */
function isTrigger(v: ControlValue): boolean {
  return v === 'bang' || typeof v === 'number';
}

// ── Timing ──────────────────────────────────────────────────────────────────

// metro <ms> : bang repeatedly at a fixed interval. inlet 0 turns it on/off
// (nonzero/bang = on, 0 = off); inlet 1 sets the interval. outlet 0 is a bang.
//
// Prototype convenience: a metro also AUTO-STARTS when the transport starts, so
// a loaded patch plays without needing a toggle click. An explicit 0 at inlet 0
// still stops it. (In Max a metro only runs once switched on.)
register('metro', (args) => {
  const o = outlets();
  let interval = Math.max(1, num(args[0], 500));
  let timer: ReturnType<typeof setInterval> | null = null;

  const on = () => {
    if (timer != null) return;
    timer = setInterval(() => o.emit(0, 'bang'), interval);
  };
  const off = () => {
    if (timer != null) { clearInterval(timer); timer = null; }
  };

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (v) => {
        if (v === 'bang') on();
        else if (typeof v === 'number') (v !== 0 ? on() : off());
      },
      (v) => {
        if (typeof v === 'number') {
          interval = Math.max(1, v);
          if (timer != null) { off(); on(); } // restart at the new rate
        }
      },
    ],
    onControlOut: o.onControlOut,
    start: on,   // transport ▶ auto-starts the metro
    stop: off,   // transport ■ / patch reload halts the timer
  } satisfies MaxNode;
});

// delay <ms> : bang in -> bang out, `ms` later. A new bang reschedules.
register('delay', (args) => {
  const o = outlets();
  let ms = Math.max(0, num(args[0], 0));
  let timer: ReturnType<typeof setTimeout> | null = null;
  const cancel = () => { if (timer != null) { clearTimeout(timer); timer = null; } };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (v) => { if (isTrigger(v)) { cancel(); timer = setTimeout(() => o.emit(0, 'bang'), ms); } },
      (v) => { if (typeof v === 'number') ms = Math.max(0, v); },
    ],
    onControlOut: o.onControlOut,
    stop: cancel,
  } satisfies MaxNode;
});

// ── Generators ──────────────────────────────────────────────────────────────

// counter [min] [max] : on each bang, output the current count, then advance,
// wrapping min..max. One arg = max (min 0); two args = min, max.
register('counter', (args) => {
  const o = outlets();
  const min = args.length >= 2 ? num(args[0], 0) : 0;
  const max = args.length >= 2 ? num(args[1], 127) : num(args[0], 127);
  let count = min;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (v) => {
        if (!isTrigger(v)) return;
        o.emit(0, count);
        count = count >= max ? min : count + 1;
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// random <N> : on a bang, output a random int in [0, N). inlet 1 sets N.
register('random', (args) => {
  const o = outlets();
  let n = Math.max(1, num(args[0], 128));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (v) => { if (isTrigger(v)) o.emit(0, Math.floor(Math.random() * n)); },
      (v) => { if (typeof v === 'number') n = Math.max(1, v); },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── Math ────────────────────────────────────────────────────────────────────

// Binary control math (+ - * / %): the left inlet triggers output, the right
// inlet (or the creation arg) stores the operand. A bang re-outputs.
function makeControlMath(op: (a: number, b: number) => number) {
  return (args: (number | string)[]): MaxNode => {
    const o = outlets();
    let operand = num(args[0], 0);
    let left = 0;
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (v) => {
          if (typeof v === 'number') { left = v; o.emit(0, op(left, operand)); }
          else if (v === 'bang') o.emit(0, op(left, operand));
        },
        (v) => { if (typeof v === 'number') operand = v; },
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

// mtof : MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). The classic
// bridge from control ints to a cycle~/saw frequency inlet.
register('mtof', () => {
  const o = outlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(v) => { if (typeof v === 'number') o.emit(0, 440 * Math.pow(2, (v - 69) / 12)); }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// scale <inLo> <inHi> <outLo> <outHi> : linearly remap a number from one range
// to another (default in 0..127, out 0..1).
register('scale', (args) => {
  const o = outlets();
  const inLo = num(args[0], 0);
  const inHi = num(args[1], 127);
  const outLo = num(args[2], 0);
  const outHi = num(args[3], 1);
  const span = inHi - inLo || 1;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(v) => {
      if (typeof v === 'number') o.emit(0, outLo + ((v - inLo) / span) * (outHi - outLo));
    }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── Value stores & UI-ish objects ────────────────────────────────────────────

// int/i, float/f, number, flonum : store a value. A number at the left inlet
// stores AND outputs it; a bang outputs the stored value; the right inlet stores
// without output. (number/flonum are UI boxes here treated as headless stores;
// clickable widgets come with the UI milestone.)
function makeStore(coerce: (x: number) => number) {
  return (args: (number | string)[]): MaxNode => {
    const o = outlets();
    let val = coerce(num(args[0], 0));
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (v) => {
          if (v === 'bang') o.emit(0, val);
          else if (typeof v === 'number') { val = coerce(v); o.emit(0, val); }
        },
        (v) => { if (typeof v === 'number') val = coerce(v); },
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

// toggle : bang flips its 0/1 state; a number sets it (nonzero -> 1). Outputs
// the resulting state.
register('toggle', () => {
  const o = outlets();
  let state = 0;
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(v) => {
      if (v === 'bang') state = state ? 0 : 1;
      else if (typeof v === 'number') state = v !== 0 ? 1 : 0;
      o.emit(0, state);
    }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// button/bng : any input produces a bang.
function makeButton() {
  const o = outlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(_v: ControlValue) => o.emit(0, 'bang')],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
}
register('button', makeButton);
register('bng', makeButton);

// message : on any trigger, output its stored content. Multi-atom messages emit
// each atom in turn (a stand-in for real Max list output).
register('message', (args) => {
  const o = outlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(v) => {
      if (!isTrigger(v) && typeof v !== 'string') return;
      if (args.length === 0) o.emit(0, 'bang');
      else for (const a of args) o.emit(0, a);
    }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
