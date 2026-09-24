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

// counter : Max's counter, all five inlets and four outlets (per its reference page).
//
//   args      one = max; two = min max; three = direction min max. Default 0..2^31-1, up.
//   inlet 0   bang / int / next: output the count, then step. Also set, goto, jam, min,
//             setmin, max, inc, dec, up, down, updown, flags, carrybang, carryint.
//   inlet 1   direction: 0 up, 1 down, 2 up-and-down; bang flips it.
//   inlet 2   int: the next bang outputs this number; bang: the next bang outputs min.
//   inlet 3   int: jump to this number and output it NOW; bang: the same with min.
//   inlet 4   int: set the maximum, silently; bang: jump to max and output it.
//   outlets   count, underflow flag, carry flag, carry count — sent right to left.
//
// The flags are 1 when the count lands on the limit and 0 on the step after (or a bang
// each time, after `carrybang`). A number below min in inlet 2 or 3 is output once and
// the count then carries on up into the range — Max's "temporary minimum" — which is
// how a patch resets a counter to -1 so that its next tick is 0.
register('counter', (args) => {
  const o = makeOutlets();
  const n = args.map((a) => Math.trunc(num(a, 0)));
  let dir = 0;
  let min = 0;
  let max = 2147483647;
  if (args.length === 1) max = n[0];
  else if (args.length === 2) [min, max] = n;
  else if (args.length >= 3) [dir, min, max] = n;
  dir = [0, 1, 2].includes(dir) ? dir : 0;

  let count = dir === 1 ? Math.max(min, max) : min; // what the next bang outputs
  let last: number | undefined; // what the last output was
  let goingDown = dir === 1;
  let carries = 0;
  let atMax = false;
  let atMin = false;
  let carryBang = false;
  const hi = (): number => Math.max(min, max);

  /** Where the count goes after outputting `v`. */
  const after = (v: number): number => {
    if (dir === 0) return v >= hi() ? min : v + 1;
    if (dir === 1) return v <= min ? hi() : v - 1;
    if (hi() === min) return min;
    if (v >= hi()) goingDown = true;
    else if (v <= min) goingDown = false;
    return goingDown ? v - 1 : v + 1;
  };

  const flag = (outlet: number, on: boolean): void => o.emit(outlet, on && carryBang ? ['bang'] : [on ? 1 : 0]);

  /** Output `v` with its flags (right to left), then move the count on from it. */
  const emit = (v: number): void => {
    const carry = v === hi() && dir !== 1;
    const under = v === min && dir !== 0;
    if (carry) {
      carries += 1;
      o.emit(3, [carries]);
      flag(2, true);
    } else if (atMax && !carryBang) flag(2, false);
    if (under) flag(1, true);
    else if (atMin && !carryBang) flag(1, false);
    atMax = carry;
    atMin = under;
    last = v;
    count = after(v);
    o.emit(0, [v]);
  };

  const arg = (m: Msg): number | undefined => {
    const v = firstNum(m.slice(typeof m[0] === 'string' ? 1 : 0));
    return v === undefined ? undefined : Math.trunc(v);
  };

  const left = (m: Msg): void => {
    if (isBang(m) || typeof m[0] === 'number' || m[0] === 'next') return emit(count);
    const v = arg(m);
    switch (m[0]) {
      case 'set':
      case 'goto':
        if (v !== undefined) count = v;
        return;
      case 'jam':
        if (v !== undefined && v >= min && v <= hi()) emit(v);
        return;
      case 'min':
        if (v === undefined) return;
        min = Math.min(v, hi());
        return emit(min);
      case 'setmin':
        if (v !== undefined) min = v;
        return;
      case 'max':
        if (v !== undefined) max = v;
        return;
      case 'inc':
        return emit(last === undefined || last >= hi() ? min : last + 1);
      case 'dec':
        return emit(last === undefined || last <= min ? hi() : last - 1);
      case 'up':
      case 'down':
      case 'updown':
        dir = m[0] === 'up' ? 0 : m[0] === 'down' ? 1 : 2;
        goingDown = dir === 1;
        return;
      case 'carrybang':
        carryBang = true;
        return;
      case 'carryint':
        carryBang = false;
        return;
      case 'flags':
        carryBang = Number(m[1]) === 1;
        return;
    }
  };

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      left,
      (m) => {
        const v = arg(m);
        if (v !== undefined && [0, 1, 2].includes(v)) dir = v;
        else if (isBang(m)) dir = dir === 0 ? 1 : dir === 1 ? 0 : dir;
        if (dir === 2 && isBang(m)) goingDown = !goingDown;
        else goingDown = dir === 1;
      },
      (m) => {
        const v = arg(m);
        if (v !== undefined) count = v;
        else if (isBang(m)) count = min;
      },
      (m) => {
        const v = arg(m);
        if (v !== undefined) emit(v);
        else if (isBang(m)) emit(min);
      },
      (m) => {
        const v = arg(m);
        if (v !== undefined) max = v;
        else if (isBang(m)) emit(hi());
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
//
// THE FIVE CLICK-ME BOXES. `number`, `flonum`, `toggle`, `button`/`bng` and `message`
// are the objects a Max tutorial reaches for first, and every one of them is a thing
// you operate with the mouse. They lived here as message behaviour with no `el`, which
// meant the canvas drew them with a solid border, the status line counted them as
// playable, and clicking one in run mode did nothing at all — the click landed on the
// <text> element rendering the word "toggle". The canonical first patch,
// `toggle -> metro 500 -> button`, could not be started by hand.
//
// They stay in this file rather than moving to objects/ui/ because a second register()
// of the same name in another module would win or lose by import.meta.glob order, which
// is not something to decide a widget on. The DOM half follows objects/ui/'s idiom
// exactly: every document access is guarded, so headless builds still get `el`
// undefined and the message behaviour below is unchanged and still unit-tested.

const hasDOM = () => typeof document !== 'undefined';

/** Shared skin for the click-me boxes: fills its box, and is obviously pressable. */
function widgetDiv(css: string): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText =
    'width:100%;height:100%;box-sizing:border-box;cursor:pointer;' +
    'display:flex;align-items:center;justify-content:center;' + css;
  return el;
}

// int/i, float/f, number, flonum : store a value. A number at the left inlet stores
// AND outputs it; a bang outputs the stored value; the right inlet stores silently.
//
// `widget` separates the two halves of this family: `number`/`flonum` are Max's UI
// boxes and get a field you can type into, while `int`/`float` are ordinary object
// boxes and must NOT — giving them one would put an editable control on a box Max
// draws as text.
function makeStore(coerce: (x: number) => number, widget = false) {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    let val = coerce(num(args[0], 0));
    let field: HTMLInputElement | undefined;

    /** The one value-set path, shared by the inlets and (when present) the field. */
    const setVal = (n: number, emit: boolean) => {
      val = coerce(n);
      if (field && field.value !== String(val)) field.value = String(val);
      if (emit) o.emit(0, [val]);
    };

    if (widget && hasDOM()) {
      field = document.createElement('input');
      field.type = 'number';
      // flonum accepts decimals; number is integer-coerced anyway, but `any` keeps the
      // browser from rejecting a typed "1.5" before coerce() ever sees it.
      field.step = 'any';
      field.value = String(val);
      field.addEventListener('input', () => {
        const n = Number(field!.value);
        if (Number.isFinite(n)) setVal(n, true);
      });
    }

    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          if (isBang(m)) o.emit(0, [val]);
          else { const n = firstNum(m); if (n !== undefined) setVal(n, true); }
        },
        (m) => { const n = firstNum(m); if (n !== undefined) setVal(n, false); },
      ],
      onControlOut: o.onControlOut,
      el: field,
    };
  };
}
register('int', makeStore(Math.trunc));
register('i', makeStore(Math.trunc));
register('float', makeStore((x) => x));
register('f', makeStore((x) => x));
register('number', makeStore(Math.trunc, true));
register('flonum', makeStore((x) => x, true));

// toggle : bang flips its 0/1 state; a number sets it (nonzero -> 1). Outputs state.
// Clicking the widget is the same flip, through the same path.
register('toggle', () => {
  const o = makeOutlets();
  let state = 0;
  let el: HTMLElement | undefined;

  const paint = () => { if (el) el.textContent = state ? '✕' : ''; };
  const setState = (n: number, emit: boolean) => {
    state = n !== 0 ? 1 : 0;
    paint();
    if (emit) o.emit(0, [state]);
  };

  if (hasDOM()) {
    el = widgetDiv('background:#1a1d22;border:1px solid #39404b;border-radius:3px;' +
      'color:#e6e9ef;font:15px ui-monospace,Menlo,monospace;line-height:1;user-select:none;');
    el.addEventListener('click', () => setState(state ? 0 : 1, true));
    paint();
  }

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => {
      if (isBang(m)) setState(state ? 0 : 1, true);
      else { const n = firstNum(m); if (n !== undefined) setState(n, true); }
    }],
    onControlOut: o.onControlOut,
    el,
  } satisfies MaxNode;
});

// button/bng : any input produces a bang. Clicking the widget produces one too, and
// flashes so the bang is visible — a bang with no feedback is indistinguishable from a
// dead patch, which is exactly the confusion this object exists to resolve.
function makeButton(): MaxNode {
  const o = makeOutlets();
  let el: HTMLElement | undefined;
  let fade: ReturnType<typeof setTimeout> | undefined;

  const bang = () => {
    if (el) {
      el.style.background = '#e6e9ef';
      clearTimeout(fade);
      fade = setTimeout(() => { if (el) el.style.background = '#1a1d22'; }, 90);
    }
    o.emit(0, BANG);
  };

  if (hasDOM()) {
    el = widgetDiv('background:#1a1d22;border:1px solid #39404b;border-radius:50%;');
    el.addEventListener('click', bang);
  }

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [bang],
    onControlOut: o.onControlOut,
    // The flash timer outlives the box otherwise, and would write to a detached element.
    dispose: () => { clearTimeout(fade); fade = undefined; },
    el,
  };
}
register('button', makeButton);
register('bng', makeButton);

// message : on any trigger, output its stored content as a message (list of atoms).
// Clicking it does the same, which is what a message box is FOR.
//
// Unlike the controls above, this widget draws the box itself — border, background and
// its own contents — because a message box IS its text. ui/layout.ts sizes it from that
// text and the two renderers suppress their caption for it; see SELF_LABELLED there.
register('message', (args) => {
  const o = makeOutlets();
  let el: HTMLElement | undefined;

  const send = () => o.emit(0, args.length ? (args as Msg) : BANG);

  if (hasDOM()) {
    el = widgetDiv(
      'justify-content:flex-start;padding:0 6px;background:#23272f;' +
      'border:1px solid #3a414c;border-radius:4px;color:#e6e9ef;' +
      'font:11px ui-monospace,Menlo,monospace;white-space:nowrap;overflow:hidden;',
    );
    el.textContent = args.join(' ');
    el.addEventListener('click', send);
  }

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => {
      if (!isTrigger(m) && m.length === 0) return;
      send();
    }],
    onControlOut: o.onControlOut,
    el,
  } satisfies MaxNode;
});
