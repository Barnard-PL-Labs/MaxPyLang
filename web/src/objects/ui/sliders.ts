// UI slider / dial / keyboard widgets.
//
// A UI widget STORES a value and EMITS control messages when that value changes.
// The message contract is identical to any other control object:
//   • a number at the (left) inlet SETS the stored value (clamped/quantized) and emits it,
//   • a bang RE-OUTPUTS the stored value without changing it,
//   • the right inlet (where present) stores a secondary value silently or drives a 2nd outlet.
//
// DOM is OPTIONAL. In the browser each widget also builds a small self-contained `el`
// (mounted by ui/graph.ts via a <foreignObject>) whose input/click handler calls the
// SAME value-set function the inlet uses. In headless tests `document` is undefined, so
// `el` stays undefined and only the message behaviour exists — which is what we unit-test.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { firstNum, isBang, type Atom } from '../../runtime/atoms';

const hasDOM = () => typeof document !== 'undefined';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── Single-value range widget (slider, dial) ──────────────────────────────────
//
// Max sliders/dials have a raw position 0..size-1 mapped to an output value
// `min + raw * mult`. An incoming number is treated as an output value: it is
// quantized to the mult grid and clamped into range before being emitted.
//
// Args (Max uses attributes; we accept them positionally for scripted/test use):
//   [0] size  — number of raw steps (default 128 -> positions 0..127)
//   [1] mult  — value per step       (default 1)
//   [2] min   — output offset         (default 0)
function makeRangeWidget(kind: 'slider' | 'dial') {
  return (args: Atom[]): MaxNode => {
    const size = Math.max(1, num(args[0], 128));
    const mult = num(args[1], 1);
    const min = num(args[2], 0);
    const steps = size - 1; // raw positions 0..steps
    const o = makeOutlets();

    let value = min; // stored OUTPUT value (already on the mult grid)

    const quantize = (n: number): number => {
      const raw = clamp(mult === 0 ? 0 : Math.round((n - min) / mult), 0, steps);
      return min + raw * mult;
    };
    // The single source of truth for changing the value — inlet AND DOM both call this.
    const set = (n: number, emit = true) => {
      value = quantize(n);
      if (emit) o.emit(0, [value]);
    };

    let el: HTMLElement | undefined;
    if (hasDOM()) {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(min + steps * mult);
      input.step = String(mult || 1);
      input.value = String(value);
      input.title = kind;
      if (kind === 'dial') input.classList.add('max-dial');
      input.addEventListener('input', () => set(Number(input.value)));
      el = input;
    }

    return {
      el,
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          if (isBang(m)) o.emit(0, [value]);
          else {
            const n = firstNum(m);
            if (n !== undefined) set(n);
          }
        },
      ],
      onControlOut: o.onControlOut,
    } satisfies MaxNode;
  };
}
register('slider', makeRangeWidget('slider'));
register('dial', makeRangeWidget('dial'));

// ── incdec : an up/down spinner ───────────────────────────────────────────────
//
// A number at the inlet sets the stored value and emits it; a bang re-emits. The DOM
// up/down arrows bump the value by `step` (arg [0], default 1) and emit through the
// same path.
register('incdec', (args: Atom[]) => {
  const step = num(args[0], 1);
  const o = makeOutlets();

  let value = 0;
  const emit = () => o.emit(0, [value]);
  const set = (n: number) => { value = n; emit(); };
  const bump = (dir: number) => { value += dir * step; emit(); };

  let el: HTMLElement | undefined;
  if (hasDOM()) {
    const box = document.createElement('span');
    box.className = 'max-incdec';
    const up = document.createElement('button');
    up.textContent = '▲';
    up.addEventListener('click', () => bump(+1));
    const down = document.createElement('button');
    down.textContent = '▼';
    down.addEventListener('click', () => bump(-1));
    box.appendChild(up);
    box.appendChild(down);
    el = box;
  }

  return {
    el,
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) emit();
        else {
          const n = firstNum(m);
          if (n !== undefined) set(n);
        }
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── Note widgets (kslider keyboard, nslider notation) ─────────────────────────
//
// Two inlets / two outlets. Inlet 0 = MIDI pitch, inlet 1 = velocity. A pitch number
// emits the note: pitch on outlet 0 and the current velocity on outlet 1. Inlet 1
// stores velocity silently (clamped 0..127). A bang re-emits the stored note.
function makeNoteWidget(kind: 'kslider' | 'nslider') {
  return (): MaxNode => {
    const o = makeOutlets();
    let pitch = 0;
    let velocity = kind === 'kslider' ? 100 : 64;

    const emitNote = () => {
      o.emit(0, [pitch]);
      o.emit(1, [velocity]);
    };
    const setPitch = (n: number) => { pitch = clamp(Math.trunc(n), 0, 127); emitNote(); };
    const setVelocity = (n: number) => { velocity = clamp(Math.trunc(n), 0, 127); };

    let el: HTMLElement | undefined;
    if (hasDOM()) {
      // A minimal one-octave clickable keyboard (kslider) / note field (nslider).
      const box = document.createElement('span');
      box.className = `max-${kind}`;
      if (kind === 'kslider') {
        for (let i = 0; i < 12; i++) {
          const key = document.createElement('button');
          key.className = 'max-key';
          key.addEventListener('click', () => setPitch(60 + i));
          box.appendChild(key);
        }
      } else {
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.max = '127';
        input.value = String(pitch);
        input.addEventListener('input', () => setPitch(Number(input.value)));
        box.appendChild(input);
      }
      el = box;
    }

    return {
      el,
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          if (isBang(m)) emitNote();
          else {
            const n = firstNum(m);
            if (n !== undefined) setPitch(n);
          }
        },
        (m) => {
          const n = firstNum(m);
          if (n !== undefined) setVelocity(n);
        },
      ],
      onControlOut: o.onControlOut,
    } satisfies MaxNode;
  };
}
register('kslider', makeNoteWidget('kslider'));
register('nslider', makeNoteWidget('nslider'));

// ── rslider : a range slider (low..high) ──────────────────────────────────────
//
// Two inlets / two outlets. Inlet 0 sets the low bound, inlet 1 sets the high bound;
// both are clamped into [0, size-1] (size = arg [0], default 128). Any change emits
// low on outlet 0 and high on outlet 1. A bang re-emits the current range.
register('rslider', (args: Atom[]) => {
  const size = Math.max(1, num(args[0], 128));
  const max = size - 1;
  const o = makeOutlets();

  let lo = 0;
  let hi = max;

  const emitRange = () => {
    o.emit(0, [lo]);
    o.emit(1, [hi]);
  };
  const setLo = (n: number) => { lo = clamp(n, 0, max); if (lo > hi) hi = lo; emitRange(); };
  const setHi = (n: number) => { hi = clamp(n, 0, max); if (hi < lo) lo = hi; emitRange(); };

  let el: HTMLElement | undefined;
  if (hasDOM()) {
    const box = document.createElement('span');
    box.className = 'max-rslider';
    const loIn = document.createElement('input');
    loIn.type = 'range';
    loIn.min = '0';
    loIn.max = String(max);
    loIn.value = String(lo);
    loIn.addEventListener('input', () => setLo(Number(loIn.value)));
    const hiIn = document.createElement('input');
    hiIn.type = 'range';
    hiIn.min = '0';
    hiIn.max = String(max);
    hiIn.value = String(hi);
    hiIn.addEventListener('input', () => setHi(Number(hiIn.value)));
    box.appendChild(loIn);
    box.appendChild(hiIn);
    el = box;
  }

  return {
    el,
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) emitRange();
        else {
          const n = firstNum(m);
          if (n !== undefined) setLo(n);
        }
      },
      (m) => {
        const n = firstNum(m);
        if (n !== undefined) setHi(n);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
