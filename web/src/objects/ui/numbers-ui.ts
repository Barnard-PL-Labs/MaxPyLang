// UI widget objects (number/slider family) for the Web Audio engine.
//
// A widget STORES a value and EMITS a control message when it changes. Receiving a
// number on an inlet sets the value (and emits); a bang re-outputs the stored value.
// The optional DOM element (`el`) is a thin skin over the SAME value-set functions
// the inlets use, so the message behavior is identical with or without a browser.
//
// DOM is OPTIONAL: every DOM call is guarded by `if (typeof document !== 'undefined')`.
// In headless tests `document` is undefined, so `el` stays undefined and the object
// still builds and behaves — the message logic is what the unit tests exercise.

import { register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { firstNum, isBang, type Msg } from '../../runtime/atoms';

const hasDOM = () => typeof document !== 'undefined';

const clamp = (n: number, lo: number, hi: number) => (n < lo ? lo : n > hi ? hi : n);

// pictslider : a two-dimensional slider (XY pad). Manifest: 2 inlets, 2 control
// outlets. Inlet 0 sets X (emits on outlet 0), inlet 1 sets Y (emits on outlet 1).
// Values are integers in the default Max range 0..127. A bang at inlet 0 re-outputs
// BOTH stored values (X on 0, Y on 1); a bang at inlet 1 re-outputs Y.
register('pictslider', () => {
  const o = makeOutlets();
  const MIN = 0;
  const MAX = 127;
  let x = MIN;
  let y = MIN;

  // The single source of truth for changing a dimension — shared by inlets AND
  // (when present) the DOM widget's 'input' events.
  const setX = (n: number, emit = true) => {
    x = clamp(Math.trunc(n), MIN, MAX);
    if (rangeX && rangeX.valueAsNumber !== x) rangeX.value = String(x);
    if (emit) o.emit(0, [x]);
  };
  const setY = (n: number, emit = true) => {
    y = clamp(Math.trunc(n), MIN, MAX);
    if (rangeY && rangeY.valueAsNumber !== y) rangeY.value = String(y);
    if (emit) o.emit(1, [y]);
  };

  let el: HTMLElement | undefined;
  let rangeX: HTMLInputElement | undefined;
  let rangeY: HTMLInputElement | undefined;
  if (hasDOM()) {
    const container = document.createElement('div');
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.width = '100%';
    container.style.height = '100%';
    const mkRange = (onInput: (v: number) => void) => {
      const r = document.createElement('input');
      r.type = 'range';
      r.min = String(MIN);
      r.max = String(MAX);
      r.step = '1';
      r.value = String(MIN);
      r.style.width = '100%';
      r.addEventListener('input', () => onInput(r.valueAsNumber));
      return r;
    };
    rangeX = mkRange((v) => setX(v));
    rangeY = mkRange((v) => setY(v));
    container.appendChild(rangeX);
    container.appendChild(rangeY);
    el = container;
  }

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m: Msg) => {
        if (isBang(m)) { o.emit(0, [x]); o.emit(1, [y]); return; }
        const n = firstNum(m);
        if (n !== undefined) setX(n);
      },
      (m: Msg) => {
        if (isBang(m)) { o.emit(1, [y]); return; }
        const n = firstNum(m);
        if (n !== undefined) setY(n);
      },
    ],
    onControlOut: o.onControlOut,
    el,
  } satisfies MaxNode;
});
