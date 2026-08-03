// Signal-math (MSP) objects — the "sigmath" batch. Each maps a Max ~ math object
// to Web Audio nodes, following the reference pattern in ./index.ts.
//
// Fidelity notes are inline. Goal: "recognisably correct" signal math for the
// prototype, not sample-accurate parity with Max's DSP. Sample-accurate feedback
// (e.g. running accumulators) is deferred to AudioWorklet-backed impls.
//
// WaveShaper curve helpers below map a normalized input range [-1, 1] through a
// pointwise function. That is only exact for inputs inside that range; signals
// outside it fold to the curve endpoints. Fine for the prototype's demo material.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum } from '../../runtime/atoms';

const CURVE_LEN = 2048;

/** Build a WaveShaper curve sampling `fn` across the normalized input range. */
function makeCurve(fn: (x: number) => number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(CURVE_LEN * 4));
  for (let i = 0; i < CURVE_LEN; i++) {
    const x = (i / (CURVE_LEN - 1)) * 2 - 1; // -1..1
    const y = fn(x);
    curve[i] = Number.isFinite(y) ? y : 0;
  }
  return curve;
}

// sig~ : constant signal. inlet 0 (float) sets the output value; outlet 0 is that
// value as a signal. Implemented with a ConstantSourceNode.
register('sig~', (args, { ctx }) => {
  const src = new ConstantSourceNode(ctx, { offset: num(args[0], 0) });
  src.start();
  return {
    signalIns: [src.offset],
    signalOuts: [src],
    controlIns: [(m) => { const n = firstNum(m); if (n !== undefined) src.offset.value = n; }],
    dispose: () => { try { src.stop(); } catch { /* already stopped */ } },
  } satisfies MaxNode;
});

// abs~ : absolute value of the signal, via a WaveShaper.
register('abs~', (_args, { ctx }) => {
  const shaper = new WaveShaperNode(ctx, { curve: makeCurve((x) => Math.abs(x)) });
  return { signalIns: [shaper], signalOuts: [shaper] } satisfies MaxNode;
});

// sqrt~ : square root of the signal (negative inputs -> 0, matching Max), via a
// WaveShaper.
register('sqrt~', (_args, { ctx }) => {
  const shaper = new WaveShaperNode(ctx, { curve: makeCurve((x) => (x > 0 ? Math.sqrt(x) : 0)) });
  return { signalIns: [shaper], signalOuts: [shaper] } satisfies MaxNode;
});

// pow~ : raise the inlet-0 signal to a power (inlet 1 / argument sets the exponent).
// A WaveShaper holds the curve; changing the exponent rebuilds it. Negative inputs
// use an odd extension (sign(x)·|x|^n) so the curve stays finite and defined.
register('pow~', (args, { ctx }) => {
  const shaper = new WaveShaperNode(ctx, {});
  const rebuild = (exp: number) => {
    shaper.curve = makeCurve((x) => (x === 0 ? 0 : Math.sign(x) * Math.pow(Math.abs(x), exp)));
  };
  rebuild(num(args[0], 1));
  return {
    signalIns: [shaper, undefined], // inlet 1 = exponent (control only; no AudioParam target)
    signalOuts: [shaper],
    controlIns: [undefined, (m) => { const n = firstNum(m); if (n !== undefined) rebuild(n); }],
  } satisfies MaxNode;
});

// /~ (div~) : signal divide. inlet 0 = numerator signal, inlet 1 = divisor.
// Division by a constant is multiply-by-reciprocal, so a GainNode carries gain =
// 1/divisor. (True signal-rate division of two signals needs a reciprocal node and
// is out of scope for the prototype, so inlet 1 is control-only.)
function makeDivider() {
  return (args: (number | string)[], { ctx }: { ctx: BaseAudioContext }): MaxNode => {
    const d0 = num(args[0], 1);
    const gain = new GainNode(ctx, { gain: d0 === 0 ? 0 : 1 / d0 });
    return {
      signalIns: [gain, undefined],
      signalOuts: [gain],
      controlIns: [undefined, (m) => { const n = firstNum(m); if (n !== undefined) gain.gain.value = n === 0 ? 0 : 1 / n; }],
    };
  };
}
register('/~', makeDivider());
register('div~', makeDivider());

// !-~ (rminus~) : reverse subtract — outputs (arg - signal). Negate the inlet-0
// signal (gain = -1) and sum a constant offset into a pass-through gain. inlet 1
// sets the constant (the value subtracted from).
function makeReverseSub() {
  return (args: (number | string)[], { ctx }: { ctx: BaseAudioContext }): MaxNode => {
    const neg = new GainNode(ctx, { gain: -1 });
    const pass = new GainNode(ctx, { gain: 1 });
    const offset = new ConstantSourceNode(ctx, { offset: num(args[0], 0) });
    neg.connect(pass);
    offset.connect(pass);
    offset.start();
    return {
      signalIns: [neg, offset.offset],
      signalOuts: [pass],
      controlIns: [undefined, (m) => { const n = firstNum(m); if (n !== undefined) offset.offset.value = n; }],
      dispose: () => { try { offset.stop(); } catch { /* already stopped */ } },
    };
  };
}
register('!-~', makeReverseSub());
register('rminus~', makeReverseSub());

// !/~ (rdiv~) : reverse divide — outputs (arg / signal). Reciprocal-of-a-signal has
// no vanilla Web Audio node, so a WaveShaper holds y = arg / x (guarded near 0).
// inlet 1 sets the constant numerator, rebuilding the curve.
function makeReverseDiv() {
  return (args: (number | string)[], { ctx }: { ctx: BaseAudioContext }): MaxNode => {
    const shaper = new WaveShaperNode(ctx, {});
    const EPS = 1e-4;
    const rebuild = (numer: number) => {
      shaper.curve = makeCurve((x) => (Math.abs(x) < EPS ? 0 : numer / x));
    };
    rebuild(num(args[0], 1));
    return {
      signalIns: [shaper, undefined], // inlet 1 = numerator (control only)
      signalOuts: [shaper],
      controlIns: [undefined, (m) => { const n = firstNum(m); if (n !== undefined) rebuild(n); }],
    };
  };
}
register('!/~', makeReverseDiv());
register('rdiv~', makeReverseDiv());
