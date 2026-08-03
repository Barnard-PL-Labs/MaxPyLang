// Dynamics-batch MSP (signal-domain) objects. Each maps a Max ~ object onto Web
// Audio nodes. Importing this module self-registers the factories below.
//
// Fidelity target is "recognisably correct sound" for the prototype, not
// sample-accurate parity with Max's DSP. Where a memoryless WaveShaper transfer
// function can stand in for a static nonlinearity (bit-crush, rounding) we use one;
// truly stateful DSP (per-sample slope limiting) is left to a later AudioWorklet.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum } from '../../runtime/atoms';

// ── curve helpers ──────────────────────────────────────────────────────────────

const CURVE_LEN = 2048;

// Quantise the [-1,1] input range to `bits` of resolution (a bit-crusher transfer
// function). Higher bits -> finer steps -> closer to identity.
function quantizeCurve(bits: number) {
  const b = Number.isFinite(bits) && bits >= 1 ? bits : 1;
  const levels = Math.max(2, Math.pow(2, b));
  const half = levels / 2;
  const curve = new Float32Array(new ArrayBuffer(CURVE_LEN * 4));
  for (let i = 0; i < CURVE_LEN; i++) {
    const x = (i / (CURVE_LEN - 1)) * 2 - 1;
    curve[i] = Math.round(x * half) / half;
  }
  return curve;
}

// Round the [-1,1] input to the nearest multiple of `factor` (round~ transfer fn).
function roundCurve(factor: number) {
  const f = Number.isFinite(factor) && factor > 0 ? factor : 1;
  const curve = new Float32Array(new ArrayBuffer(CURVE_LEN * 4));
  for (let i = 0; i < CURVE_LEN; i++) {
    const x = (i / (CURVE_LEN - 1)) * 2 - 1;
    const y = Math.round(x / f) * f;
    curve[i] = Math.max(-1, Math.min(1, y));
  }
  return curve;
}

// ── limi~ : lookahead limiter ────────────────────────────────────────────────────
// Approximated by a DynamicsCompressorNode tuned as a brickwall-ish limiter (near-0
// threshold, hard knee, high ratio, fast attack). 1 signal inlet -> 1 signal outlet.
// The channel_count / buffer_size args have no Web Audio analogue; accepted, ignored.
register('limi~', (_args, { ctx }) => {
  const comp = new DynamicsCompressorNode(ctx, {
    threshold: -1,
    knee: 0,
    ratio: 20,
    attack: 0.001,
    release: 0.05,
  });
  return {
    signalIns: [comp],
    signalOuts: [comp],
  } satisfies MaxNode;
});

// ── degrade~ : sample-rate ratio + bit reduction ─────────────────────────────────
// inlet 0 = signal, inlet 1 = resampling frequency ratio, inlet 2 = quantisation bits.
// A WaveShaper models the bit-depth quantisation. Sample-rate reduction is stateful
// (needs a hold across samples) so it is not modelled here; the ratio is stored and
// left to a later worklet. 1 signal outlet.
register('degrade~', (args, { ctx }) => {
  // ratio is stored for a future sample-rate-reduction worklet; unused acoustically now.
  const state = { ratio: num(args[0], 1), bits: num(args[1], 16) };
  const shaper = new WaveShaperNode(ctx, { curve: quantizeCurve(state.bits) });
  return {
    signalIns: [shaper, undefined, undefined],
    signalOuts: [shaper],
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) state.ratio = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) { state.bits = n; shaper.curve = quantizeCurve(state.bits); } },
    ],
  } satisfies MaxNode;
});

// ── gate~ : route a signal through an amplitude gate ──────────────────────────────
// inlet 0 = gate control (int: 0 = closed, >=1 = open), inlet 1 = signal input.
// Modelled as a GainNode whose gain is switched 0/1. With one outlet, any nonzero
// selector opens it. The `initial-open-outlet` arg sets the starting state.
register('gate~', (args, { ctx }) => {
  const open = num(args[1], 0) >= 1 ? 1 : 0; // initial-open-outlet
  const gain = new GainNode(ctx, { gain: open });
  return {
    signalIns: [undefined, gain],
    signalOuts: [gain],
    controlIns: [
      (m) => { const n = firstNum(m); if (n !== undefined) gain.gain.value = n >= 1 ? 1 : 0; },
      undefined,
    ],
  } satisfies MaxNode;
});

// ── round~ : quantise a signal to the nearest multiple of a number ────────────────
// inlet 0 = signal, inlet 1 = rounding factor (float). A WaveShaper holds the
// staircase transfer function; changing the factor rebuilds it. 1 signal outlet.
register('round~', (args, { ctx }) => {
  let factor = num(args[0], 1);
  const shaper = new WaveShaperNode(ctx, { curve: roundCurve(factor) });
  return {
    signalIns: [shaper, undefined],
    signalOuts: [shaper],
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) { factor = n; shaper.curve = roundCurve(factor); } },
    ],
  } satisfies MaxNode;
});

// deltaclip~ is intentionally NOT implemented here — see the batch report's "skipped".
// It limits the slope (delta between consecutive samples), which is inherently
// stateful and cannot be expressed by a memoryless WaveShaper or any stock Web Audio
// node; it needs an AudioWorklet, which the headless offline mock can't load. Left as
// its Tier-A stub until a worklet-backed implementation lands.
