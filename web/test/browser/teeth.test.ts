// teeth~ rendered in real Chromium: its delay times are milliseconds, as in Max.
//   y[n] = a*x[n] + b*x[n - FF] + c*y[n - FB]
import { beforeAll, describe, expect, it } from 'vitest';
import '../../src/objects/audio/filters';
import { getFactory } from '../../src/engine/registry';
import { preloadWorklets, workletsReady } from '../../src/runtime/worklet';

const SR = 44100;

async function impulseThrough(args: number[], len = 4096, msgs: [number, number][] = []): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, len, SR);
  await preloadWorklets(ctx);
  expect(workletsReady(ctx)).toBe(true);
  const node = getFactory('teeth~')!(args, { ctx });
  for (const [value, inlet] of msgs) node.controlIns![inlet]!([value]);
  const buf = ctx.createBuffer(1, len, SR);
  buf.getChannelData(0)[0] = 1;
  const src = new AudioBufferSourceNode(ctx, { buffer: buf });
  src.connect(node.signalIns[0] as AudioNode);
  (node.signalOuts[0] as AudioNode).connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

const peaks = (y: Float32Array) =>
  Array.from(y).flatMap((v, i) => (Math.abs(v) > 1e-6 ? [[i, Math.round(v * 1e4) / 1e4]] : []));

describe('teeth~ (real Chromium OfflineAudioContext)', () => {
  beforeAll(async () => {
    const probe = new OfflineAudioContext(1, 128, SR);
    await preloadWorklets(probe);
    expect(workletsReady(probe)).toBe(true);
  });

  it('feedforward: a 10 ms delay puts the echo 441 samples (10 * 44.1) after the impulse', async () => {
    const y = await impulseThrough([20, 10, 10, 1, 0.5, 0]);
    expect(peaks(y)).toEqual([[0, 1], [441, 0.5]]);
  });

  it('feedback: 5 ms repeats every 220 samples (220.5, cut to whole samples), each times c', async () => {
    const y = await impulseThrough([20, 0, 5, 1, 0, 0.5], 1000);
    expect(peaks(y)).toEqual([[0, 1], [220, 0.5], [440, 0.25], [660, 0.125], [880, 0.0625]]);
  });

  it('both paths: y = a x + b x[n-FF] + c y[n-FB] with FF 2 ms, FB 3 ms', async () => {
    const a = 0.5, b = 0.25, c = 0.5;
    const N = 600;
    const y = await impulseThrough([10, 2, 3, a, b, c], N);
    const ff = 88, fb = 132; // 2 ms = 88.2, 3 ms = 132.3 samples, cut to whole samples
    const ref = new Float32Array(N);
    for (let n = 0; n < N; n++) {
      const x = n === 0 ? 1 : 0;
      const xd = n === ff ? 1 : 0;
      ref[n] = a * x + b * xd + (n >= fb ? c * ref[n - fb] : 0);
    }
    for (let n = 0; n < N; n++) expect(y[n]).toBeCloseTo(ref[n], 5);
  });

  it('delays clamp to the max delay (10 ms when the arg is 0)', async () => {
    const y = await impulseThrough([0, 50, 10, 0, 1, 0]);
    expect(peaks(y)).toEqual([[441, 1]]);
  });

  it('a float in inlet 1 sets the feedforward delay in ms (20 ms -> 882 samples)', async () => {
    const y = await impulseThrough([30, 1, 1, 0, 1, 0], 2048, [[20, 1]]);
    expect(peaks(y)).toEqual([[882, 1]]);
  });
});
