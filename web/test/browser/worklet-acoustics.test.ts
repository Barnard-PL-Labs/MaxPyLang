// Browser-mode acoustic E2E — runs in real headless Chromium (npm run test:browser),
// where OfflineAudioContext + AudioWorklet are genuine. It builds a patch containing a
// worklet-backed DSP object, renders it offline, and asserts the ACOUSTICS — proving
// the worklet path (not just the kernel) produces correct sound end to end.
//
// This is intentionally NOT part of the default `npm test` (Node): it needs a Chromium
// download and is the one layer that can't run headless-mock. If Chromium is
// unavailable the Node kernel tests (test/dsp/) remain the source of truth.

import { describe, expect, it, beforeAll } from 'vitest';
import '../../src/objects/audio/worklet-dsp'; // self-registers biquad~, +=~, etc.
import '../../src/objects/audio/sigmath'; // pow~
import '../../src/objects/audio'; // phasor~
import { getFactory } from '../../src/engine/registry';
import { preloadWorklets, workletsReady } from '../../src/runtime/worklet';
import { lowpassCoeffs } from '../../src/dsp/kernels';

const SR = 44100;

function energyInBand(x: Float32Array, f0: number, f1: number): number {
  const N = x.length;
  const k0 = Math.max(1, Math.floor((f0 * N) / SR));
  const k1 = Math.min(N / 2 - 1, Math.ceil((f1 * N) / SR));
  let total = 0;
  for (let k = k0; k <= k1; k++) {
    let re = 0, im = 0;
    const w = (-2 * Math.PI * k) / N;
    for (let n = 0; n < N; n++) { re += x[n] * Math.cos(w * n); im += x[n] * Math.sin(w * n); }
    total += re * re + im * im;
  }
  return total;
}

describe('worklet acoustics (real Chromium OfflineAudioContext)', () => {
  beforeAll(async () => {
    // Sanity: the module must load in a real browser, else these tests are meaningless.
    const probe = new OfflineAudioContext(1, 128, SR);
    await preloadWorklets(probe);
    expect(workletsReady(probe)).toBe(true);
  });

  // Max: pow~ raises the base (right inlet, or the argument) to the exponent (left inlet).
  async function renderPow(arg: number, exponentSignal: number, msgs: [number, number][] = []) {
    const ctx = new OfflineAudioContext(1, 256, SR);
    await preloadWorklets(ctx);
    const node = getFactory('pow~')!([arg], { ctx });
    for (const [value, inlet] of msgs) node.controlIns?.[inlet]?.([value]);
    const src = new ConstantSourceNode(ctx, { offset: exponentSignal });
    src.connect(node.signalIns[0] as AudioNode);
    (node.signalOuts[0] as AudioNode).connect(ctx.destination);
    src.start();
    return (await ctx.startRendering()).getChannelData(0);
  }

  it('pow~ 2 raises the base 2 to the exponent signal (2^3 = 8), past the -1..1 range', async () => {
    const y = await renderPow(2, 3);
    expect(y[200]).toBeCloseTo(8, 4);
  });

  it('pow~ : a number in the right inlet sets the base (10^2 = 100)', async () => {
    const y = await renderPow(2, 2, [[10, 1]]);
    expect(y[200]).toBeCloseTo(100, 3);
  });

  it('pow~ : a negative base to a fractional power gives 0, not NaN', async () => {
    const y = await renderPow(-2, 0.5);
    expect(y[200]).toBe(0);
  });

  it('phasor~ 0.5 ramps from 0 to 1 over two seconds, starting at 0, as in Max', async () => {
    const ctx = new OfflineAudioContext(1, Math.round(2.5 * SR), SR);
    await preloadWorklets(ctx);
    const node = getFactory('phasor~')!([0.5], { ctx });
    (node.signalOuts[0] as AudioNode).connect(ctx.destination);
    const y = (await ctx.startRendering()).getChannelData(0);
    expect(y[0]).toBeCloseTo(0, 4);
    expect(y[Math.round(1.0 * SR)]).toBeCloseTo(0.5, 3);
    expect(y[Math.round(1.99 * SR)]).toBeCloseTo(0.995, 3);
    expect(y[Math.round(2.1 * SR)]).toBeCloseTo(0.05, 3);   // wrapped at 2 s
    let lo = Infinity, hi = -Infinity;
    for (const v of y) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeLessThan(1);
  });

  it('+=~ integrates a constant into a rising ramp', async () => {
    const N = 1024;
    const ctx = new OfflineAudioContext(1, N, SR);
    await preloadWorklets(ctx);
    const node = getFactory('+=~')!([0], { ctx });
    const src = new ConstantSourceNode(ctx, { offset: 1 });
    src.connect(node.signalIns[0] as AudioNode);
    (node.signalOuts[0] as AudioNode).connect(ctx.destination);
    src.start();
    const y = (await ctx.startRendering()).getChannelData(0);
    // Running sum of a stream of 1s => y[n] ≈ n+1 (a straight ramp).
    expect(y[0]).toBeCloseTo(1, 3);
    expect(y[127]).toBeGreaterThan(y[0]);
    expect(y[N - 1]).toBeGreaterThan(y[127]);
    expect(y[N - 1]).toBeGreaterThan(900); // ~1024 after N samples of +1
  });

  it('biquad~ lowpass attenuates the high band far more than the low band', async () => {
    const N = 8192;
    const ctx = new OfflineAudioContext(1, N, SR);
    await preloadWorklets(ctx);

    // White-noise source buffer.
    const noise = ctx.createBuffer(1, N, SR);
    const nd = noise.getChannelData(0);
    let s = 22222 >>> 0;
    for (let i = 0; i < N; i++) { s = (1103515245 * s + 12345) >>> 0; nd[i] = (s / 0xffffffff) * 2 - 1; }
    const src = new AudioBufferSourceNode(ctx, { buffer: noise });

    const c = lowpassCoeffs(800, 0.707, SR);
    const node = getFactory('biquad~')!([c.a0, c.a1, c.a2, c.b1, c.b2], { ctx });
    src.connect(node.signalIns[0] as AudioNode);
    (node.signalOuts[0] as AudioNode).connect(ctx.destination);
    src.start();

    const y = (await ctx.startRendering()).getChannelData(0);
    const lowRatio = energyInBand(y, 100, 400) / energyInBand(nd, 100, 400);
    const highRatio = energyInBand(y, 6000, 14000) / energyInBand(nd, 6000, 14000);
    expect(highRatio).toBeLessThan(lowRatio * 0.1); // stopband far below passband
    expect(highRatio).toBeLessThan(0.05);
  });
});
