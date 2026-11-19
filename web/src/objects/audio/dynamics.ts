// Dynamics-batch MSP (signal-domain) objects. Each maps a Max ~ object onto Web
// Audio nodes. Importing this module self-registers the factories below.
//
// Fidelity target is "recognisably correct sound" for the prototype, not
// sample-accurate parity with Max's DSP. Where a memoryless WaveShaper transfer
// function can stand in for a static nonlinearity (bit-crush, rounding) we use one;
// truly stateful DSP (per-sample slope limiting) is left to a later AudioWorklet.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum } from '../../runtime/atoms';
import { PROCESSORS, tryWorkletNode } from '../../runtime/worklet';

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
    curve[i] = Math.floor(x * half) / half; // Max rounds down
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
// inlet 0 = signal, inlet 1 = resampling frequency ratio (1 = untouched), inlet 2 =
// quantisation bits. Both halves are stateful together (the held sample is the one that
// gets quantised), so the real thing is a worklet. Where no worklet is available (Node,
// or a context nobody preloaded) a WaveShaper still models the bit depth, and the ratio
// is stored but inaudible.
register('degrade~', (args, { ctx }) => {
  const state = { ratio: num(args[0], 1), bits: num(args[1], 24) };
  const node = tryWorkletNode(ctx, PROCESSORS.degrade);
  if (node) {
    const pRatio = node.parameters.get('ratio');
    const pBits = node.parameters.get('bits');
    if (pRatio) pRatio.value = Math.min(1, Math.max(0, state.ratio));
    if (pBits) pBits.value = Math.min(32, Math.max(1, state.bits));
    return {
      signalIns: [node, undefined, undefined],
      signalOuts: [node],
      controlIns: [
        undefined,
        (m) => { const n = firstNum(m); if (n !== undefined && pRatio) pRatio.value = Math.min(1, Math.max(0, n)); },
        (m) => { const n = firstNum(m); if (n !== undefined && pBits) pBits.value = Math.min(32, Math.max(1, n)); },
      ],
      dispose: () => { try { node.disconnect(); } catch { /* nothing connected */ } },
    } satisfies MaxNode;
  }
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

// ── overdrive~ : soft-clipping distortion ─────────────────────────────────────────
// inlet 0 = signal, inlet 1 = drive factor (1 = clean, 10 = as far as it goes).
//
// The curve is Max's own, read off a ramp rendered through overdrive~ in Max 9:
//   y = sign(x) * (1 - (1 - |x|) ^ drive), and flat past full scale.
// A worklet evaluates it per sample, with no oversampling because Max has none. Without
// a worklet a WaveShaper holds the same curve as a table.
const overdriveCurveAt = (x: number, drive: number): number => {
  const a = Math.min(1, Math.abs(x));
  const y = 1 - Math.pow(1 - a, Math.max(0, drive));
  return x < 0 ? -y : y;
};

function overdriveCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(CURVE_LEN * 4));
  for (let i = 0; i < CURVE_LEN; i++) curve[i] = overdriveCurveAt((i / (CURVE_LEN - 1)) * 2 - 1, drive);
  return curve;
}

register('overdrive~', (args, { ctx }) => {
  const drive = num(args[0], 1);
  const node = tryWorkletNode(ctx, PROCESSORS.shaper, { processorOptions: { mode: 'overdrive' } });
  const pDrive = node?.parameters.get('drive');
  if (node && pDrive) {
    pDrive.value = drive;
    return {
      signalIns: [node, pDrive],
      signalOuts: [node],
      controlIns: [
        undefined,
        (m) => { const n = firstNum(m); if (n !== undefined) pDrive.value = n; },
      ],
      dispose: () => { try { node.disconnect(); } catch { /* nothing connected */ } },
    } satisfies MaxNode;
  }
  const shaper = new WaveShaperNode(ctx, { curve: overdriveCurve(drive) });
  return {
    signalIns: [shaper, undefined],
    signalOuts: [shaper],
    controlIns: [
      undefined,
      (m) => { const n = firstNum(m); if (n !== undefined) shaper.curve = overdriveCurve(n); },
    ],
  } satisfies MaxNode;
});

// ── tanh~ : hyperbolic tangent of a signal ────────────────────────────────────────
// The smooth clipper: straight through for quiet signals, levelling off at +/- 1.
// A WaveShaper only reads inputs between -1 and 1, so the fallback scales the input down
// by 8 and stores tanh(8x): anything past +/- 8 is within a millionth of the limit.
const TANH_REACH = 8;
register('tanh~', (_args, { ctx }) => {
  const node = tryWorkletNode(ctx, PROCESSORS.shaper, { processorOptions: { mode: 'tanh' } });
  if (node) {
    return {
      signalIns: [node],
      signalOuts: [node],
      dispose: () => { try { node.disconnect(); } catch { /* nothing connected */ } },
    } satisfies MaxNode;
  }
  const curve = new Float32Array(new ArrayBuffer(CURVE_LEN * 4));
  for (let i = 0; i < CURVE_LEN; i++) curve[i] = Math.tanh(((i / (CURVE_LEN - 1)) * 2 - 1) * TANH_REACH);
  const input = new GainNode(ctx, { gain: 1 / TANH_REACH });
  const shaper = new WaveShaperNode(ctx, { curve });
  input.connect(shaper);
  return { signalIns: [input], signalOuts: [shaper] } satisfies MaxNode;
});

// ── pong~ : fold, wrap or clip a signal between two limits ────────────────────────
// args: mode (0 fold, 1 wrap, 2 clip), low, high. inlets: signal, low, high.
// With one limit given Max treats it as the low one and leaves the high at 1.
// Folding has no stock Web Audio equivalent, so without a worklet this clips.
const PONG_MODES = ['fold', 'wrap', 'clip'] as const;
register('pong~', (args, { ctx }) => {
  const mode = PONG_MODES[Math.min(2, Math.max(0, Math.trunc(num(args[0], 0))))];
  const lo = num(args[1], 0);
  const hi = num(args[2], 1);
  const node = tryWorkletNode(ctx, PROCESSORS.shaper, { processorOptions: { mode } });
  const pLo = node?.parameters.get('lo');
  const pHi = node?.parameters.get('hi');
  if (node && pLo && pHi) {
    pLo.value = lo;
    pHi.value = hi;
    return {
      signalIns: [node, pLo, pHi],
      signalOuts: [node],
      controlIns: [
        undefined,
        (m) => { const n = firstNum(m); if (n !== undefined) pLo.value = n; },
        (m) => { const n = firstNum(m); if (n !== undefined) pHi.value = n; },
      ],
      dispose: () => { try { node.disconnect(); } catch { /* nothing connected */ } },
    } satisfies MaxNode;
  }
  const curve = new Float32Array(new ArrayBuffer(CURVE_LEN * 4));
  for (let i = 0; i < CURVE_LEN; i++) curve[i] = Math.max(lo, Math.min(hi, (i / (CURVE_LEN - 1)) * 2 - 1));
  const shaper = new WaveShaperNode(ctx, { curve });
  return { signalIns: [shaper, undefined, undefined], signalOuts: [shaper], controlIns: [undefined, undefined, undefined] } satisfies MaxNode;
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
