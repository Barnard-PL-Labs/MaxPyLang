// AudioWorklet-backed MSP objects — the DSP that no stock Web Audio node can express.
// Each maps a Max ~ object onto an AudioWorkletProcessor (see runtime/worklet.ts),
// whose per-sample math mirrors the reference kernels in src/dsp/kernels.ts.
//
// These objects are registered here for the first time (earlier waves left them as
// Tier-A stubs, explicitly deferred as "needs a worklet"): biquad~, +=~, rampsmooth~,
// deltaclip~, allpass~. Importing this module self-registers them.
//
// FALLBACK CONTRACT: a worklet node can only be built after preloadWorklets(ctx) has
// loaded the module (main.ts awaits it before loadPatch). When it hasn't — the Node
// signature/fuzz tests, the headless mock, or a browser where preload was skipped —
// tryWorkletNode() returns undefined and the factory returns a plain gain pass-through
// (inlet 0 -> outlet 0) instead of throwing. Real DSP correctness is proven by the
// kernel unit tests (test/dsp/); the browser E2E layer exercises the worklet path.

import { num, register, type MaxNode } from '../../engine/registry';
import { firstNum, type Msg } from '../../runtime/atoms';
import { PROCESSORS, tryWorkletNode } from '../../runtime/worklet';

// A gain node passing inlet 0 straight to outlet 0 — the universal fallback.
function passthrough(ctx: BaseAudioContext) {
  return new GainNode(ctx, { gain: 1 });
}

// Read an AudioWorkletNode k-rate parameter by name (undefined-safe).
function param(node: AudioWorkletNode, name: string): AudioParam | undefined {
  return node.parameters.get(name) ?? undefined;
}

// biquad~ : direct-form-I biquad with five mutable coefficient inlets
//   y = a0*x + a1*x1 + a2*x2 - b1*y1 - b2*y2   (Max sign convention)
// Inlets: 0 signal, 1..5 = a0 a1 a2 b1 b2 (signal or float). Default a0=1 -> unity.
register('biquad~', (args, { ctx }) => {
  const names = ['a0', 'a1', 'a2', 'b1', 'b2'] as const;
  const defaults = [num(args[0], 1), num(args[1], 0), num(args[2], 0), num(args[3], 0), num(args[4], 0)];
  const node = tryWorkletNode(ctx, PROCESSORS.biquad);
  if (!node) {
    const pass = passthrough(ctx);
    return {
      signalIns: [pass, undefined, undefined, undefined, undefined, undefined],
      signalOuts: [pass],
      controlIns: [undefined, undefined, undefined, undefined, undefined, undefined],
    } satisfies MaxNode;
  }
  const params = names.map((n, i) => {
    const p = param(node, n);
    if (p) p.value = defaults[i];
    return p;
  });
  return {
    signalIns: [node, ...params],
    signalOuts: [node],
    controlIns: [
      undefined,
      ...names.map((_n, i) => (m: Msg) => { const v = firstNum(m); if (v !== undefined && params[i]) params[i]!.value = v; }),
    ],
  } satisfies MaxNode;
});

// +=~ : running accumulator  y[n] = y[n-1] + x[n]. Inlet 1 sets/resets the sum.
register('+=~', (args, { ctx }) => {
  const initial = num(args[0], 0);
  const node = tryWorkletNode(ctx, PROCESSORS.accum, { processorOptions: { initial } });
  if (!node) {
    const pass = passthrough(ctx);
    return { signalIns: [pass, undefined], signalOuts: [pass], controlIns: [undefined, undefined] } satisfies MaxNode;
  }
  return {
    signalIns: [node, undefined],
    signalOuts: [node],
    controlIns: [
      undefined,
      (m) => { const v = firstNum(m); if (v !== undefined) node.port.postMessage({ sum: v }); },
    ],
  } satisfies MaxNode;
});

// rampsmooth~ : linear slew limiter. Inlets: 0 signal, 1 ramp-up samples, 2 ramp-down.
register('rampsmooth~', (args, { ctx }) => {
  const up = Math.max(1, num(args[0], 1));
  const down = Math.max(1, num(args[1], up));
  const node = tryWorkletNode(ctx, PROCESSORS.rampsmooth);
  if (!node) {
    const pass = passthrough(ctx);
    return { signalIns: [pass, undefined, undefined], signalOuts: [pass], controlIns: [undefined, undefined, undefined] } satisfies MaxNode;
  }
  const pUp = param(node, 'up'); const pDown = param(node, 'down');
  if (pUp) pUp.value = up;
  if (pDown) pDown.value = down;
  return {
    signalIns: [node, pUp, pDown],
    signalOuts: [node],
    controlIns: [
      undefined,
      (m) => { const v = firstNum(m); if (v !== undefined && pUp) pUp.value = Math.max(1, v); },
      (m) => { const v = firstNum(m); if (v !== undefined && pDown) pDown.value = Math.max(1, v); },
    ],
  } satisfies MaxNode;
});

// deltaclip~ : slope limiter — bounds sample-to-sample delta to [lo, hi].
// Inlets: 0 signal, 1 min slope (lo), 2 max slope (hi). Wide defaults => pass-through.
register('deltaclip~', (args, { ctx }) => {
  const lo = num(args[0], -1e9);
  const hi = num(args[1], 1e9);
  const node = tryWorkletNode(ctx, PROCESSORS.deltaclip);
  if (!node) {
    const pass = passthrough(ctx);
    return { signalIns: [pass, undefined, undefined], signalOuts: [pass], controlIns: [undefined, undefined, undefined] } satisfies MaxNode;
  }
  const pLo = param(node, 'lo'); const pHi = param(node, 'hi');
  if (pLo) pLo.value = lo;
  if (pHi) pHi.value = hi;
  return {
    signalIns: [node, pLo, pHi],
    signalOuts: [node],
    controlIns: [
      undefined,
      (m) => { const v = firstNum(m); if (v !== undefined && pLo) pLo.value = v; },
      (m) => { const v = firstNum(m); if (v !== undefined && pHi) pHi.value = v; },
    ],
  } satisfies MaxNode;
});

// allpass~ : delaying allpass filter  y = -g*x + x[n-D] + g*y[n-D] (flat magnitude).
// Inlets: 0 signal, 1 delay time (ms), 2 gain. Args: max-delay(ms), init-delay(ms), gain.
// The worklet param `delay` is in SAMPLES; control messages convert ms -> samples.
register('allpass~', (args, { ctx }) => {
  const sr = ctx.sampleRate || 44100;
  const ms2samp = (ms: number) => Math.max(1, Math.round((ms / 1000) * sr));
  const maxDelay = ms2samp(num(args[0], 100));
  const initDelay = Math.min(maxDelay, ms2samp(num(args[1], 0)));
  const g = num(args[2], 0);
  const node = tryWorkletNode(ctx, PROCESSORS.allpass, { processorOptions: { maxDelay } });
  if (!node) {
    const pass = passthrough(ctx);
    return { signalIns: [pass, undefined, undefined], signalOuts: [pass], controlIns: [undefined, undefined, undefined] } satisfies MaxNode;
  }
  const pDelay = param(node, 'delay'); const pG = param(node, 'g');
  if (pDelay) pDelay.value = initDelay;
  if (pG) pG.value = g;
  return {
    signalIns: [node, pDelay, pG],
    signalOuts: [node],
    controlIns: [
      undefined,
      (m) => { const v = firstNum(m); if (v !== undefined && pDelay) pDelay.value = Math.min(maxDelay, ms2samp(v)); },
      (m) => { const v = firstNum(m); if (v !== undefined && pG) pG.value = v; },
    ],
  } satisfies MaxNode;
});
