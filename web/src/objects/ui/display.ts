// Display-domain UI widgets.
//
// This batch is "display": objects whose job is to SHOW something, with little or
// no message behavior. Two shapes live here:
//
//   • Active display (led): stores a value and EMITS a control message when it
//     changes. A number at the inlet sets the state (0 -> off, nonzero -> on) and
//     outputs it; a bang re-outputs the stored state. This is the testable core.
//
//   • Passive display (comment / panel / hint / bgcolor): no outlets, no message
//     behavior. They exist only to render a DOM element. Their control inlets are
//     no-ops (present so the inlet arity matches the manifest).
//
// DOM IS OPTIONAL. Every document access is guarded by `typeof document !==
// 'undefined'`, so in a headless (Node) test the objects build with `el`
// undefined and the message behavior above is still exercised.

import { register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { firstNum, isBang, type Atom } from '../../runtime/atoms';

const hasDOM = () => typeof document !== 'undefined';

// ── led : an on/off indicator ─────────────────────────────────────────────────
// One control inlet, one control outlet (per manifest). A number sets the state
// (0 -> 0, nonzero -> 1) and outputs it; a bang re-outputs the current state.
// Clicking the widget toggles it.
register('led', () => {
  const o = makeOutlets();
  let state = 0;
  let el: HTMLElement | undefined;

  const paint = () => {
    if (el) el.style.background = state ? '#ee3b30' : '#3a0d0b';
  };
  /** The single value-set path shared by the inlet AND the DOM click handler. */
  const setState = (n: number, emit = true) => {
    state = n !== 0 ? 1 : 0;
    paint();
    if (emit) o.emit(0, [state]);
  };

  if (hasDOM()) {
    el = document.createElement('div');
    el.style.cssText =
      'width:100%;height:100%;box-sizing:border-box;border-radius:50%;' +
      'border:1px solid #000;cursor:pointer;';
    el.addEventListener('click', () => setState(state ? 0 : 1));
    paint();
  }

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) o.emit(0, [state]);
        else {
          const n = firstNum(m);
          if (n !== undefined) setState(n);
        }
      },
    ],
    onControlOut: o.onControlOut,
    el,
  } satisfies MaxNode;
});

// ── Passive display objects ───────────────────────────────────────────────────
// No outlets, no behavior — just a DOM element. Control inlets are no-ops kept
// only to match the manifest inlet arity.
function makePassive(numInlets: number, render: (el: HTMLElement, args: Atom[]) => void) {
  return (args: Atom[]): MaxNode => {
    let el: HTMLElement | undefined;
    if (hasDOM()) {
      el = document.createElement('div');
      render(el, args);
    }
    const controlIns = Array.from({ length: numInlets }, () => () => {});
    return { signalIns: [], signalOuts: [], controlIns, el } satisfies MaxNode;
  };
}

/** Clamp an arg to a 0..255 colour channel (used by bgcolor / panel). */
const chan = (a: Atom | undefined, fallback: number): number => {
  const n = typeof a === 'number' ? a : Number(a);
  return Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(n))) : fallback;
};

// comment : static text label.
register('comment', makePassive(1, (el, args) => {
  el.textContent = args.join(' ');
  el.style.cssText = 'width:100%;height:100%;color:#ddd;font:11px monospace;overflow:hidden;';
}));

// panel : a filled background rectangle.
register('panel', makePassive(1, (el) => {
  el.style.cssText = 'width:100%;height:100%;background:#7c7c7c;border-radius:3px;';
}));

// hint : a small tooltip-style text bubble.
register('hint', makePassive(1, (el, args) => {
  el.textContent = args.join(' ');
  el.style.cssText =
    'display:inline-block;padding:1px 4px;background:#ffffcc;color:#000;' +
    'font:10px sans-serif;border:1px solid #999;border-radius:2px;';
}));

// bgcolor : a background colour swatch. Args are red green blue (0..255); a 4th
// inlet/arg is alpha. No outlets — purely a visual.
register('bgcolor', makePassive(4, (el, args) => {
  const r = chan(args[0], 0);
  const g = chan(args[1], 0);
  const b = chan(args[2], 0);
  el.style.cssText = `width:100%;height:100%;background:rgb(${r},${g},${b});`;
}));
