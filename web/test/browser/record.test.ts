// record~ on a real OfflineAudioContext. As in Max, it records its input into the
// named buffer~ (which keeps its size): a non-zero number into the left inlet starts,
// 0 stops; it stops at the end point unless loop is on; the inlets after the signal
// inlets set the start and end points in ms; the outlet is a sync signal from 0 to 1
// while recording. What was recorded is read back with groove~ at speed 1, which plays
// the buffer's samples one for one.

import { describe, expect, it } from 'vitest';
import '../../src/objects';
import { getFactory, type MaxNode } from '../../src/engine/registry';
import { preloadWorklets } from '../../src/runtime/worklet';
import type { IRNode } from '../../src/ir/types';

const SR = 44100;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** An AudioBufferSource playing sample i = f(i), started at 0. */
function source(ctx: BaseAudioContext, length: number, f: (i: number) => number) {
  const b = ctx.createBuffer(1, length, SR);
  const d = b.getChannelData(0);
  for (let i = 0; i < length; i++) d[i] = f(i);
  const s = new AudioBufferSourceNode(ctx, { buffer: b });
  s.start();
  return s;
}

/** Play the buffer under `name` with groove~ at speed 1 and return what it outputs. */
async function readBack(name: string, frames: number, channels = 1): Promise<Float32Array[]> {
  const ctx = new OfflineAudioContext(channels, frames, SR);
  await preloadWorklets(ctx);
  const g = getFactory('groove~')!([name], { ctx });
  (g.signalOuts[0] as AudioNode).connect(ctx.destination);
  g.controlIns![0]!([1]);
  const out = await ctx.startRendering();
  g.dispose?.();
  return Array.from({ length: channels }, (_, c) => out.getChannelData(c));
}

/** Build buffer~ <bufArgs> and record~ <recArgs>, with record~'s sync outlet rendered. */
async function setup(bufArgs: (number | string)[], recArgs: (number | string)[], seconds: number) {
  const ctx = new OfflineAudioContext(1, Math.round(SR * seconds), SR);
  await preloadWorklets(ctx);
  const buf = getFactory('buffer~')!(bufArgs, { ctx });
  const rec = getFactory('record~')!(recArgs, { ctx });
  (rec.signalOuts[0] as AudioNode).connect(ctx.destination);
  return { ctx, buf, rec };
}

async function finish(ctx: OfflineAudioContext, nodes: MaxNode[]) {
  await wait(50); // control messages reach the worklet
  const sync = (await ctx.startRendering()).getChannelData(0);
  await wait(200); // captured samples come back and are written into the buffer
  return { sync, done: () => nodes.forEach((n) => n.dispose?.()) };
}

describe('record~', () => {
  it('records its input into the buffer~, and stops when the buffer is full', async () => {
    // a 10 ms buffer is 441 samples; the input is a ramp, sample i = i / 10000
    const { ctx, buf, rec } = await setup(['rec1', 10], ['rec1'], 0.05);
    source(ctx, 2205, (i) => i / 10000).connect(rec.signalIns[0] as AudioNode);
    rec.controlIns![0]!([1]);
    const { sync, done } = await finish(ctx, [rec, buf]);
    const [y] = await readBack('rec1', 1000);
    for (const i of [0, 1, 100, 300, 440]) expect(y[i]).toBeCloseTo(i / 10000, 5);
    // it stopped at the end: the buffer kept its size (441 samples) and nothing wrapped
    // round over the start (2205 samples went in)
    expect(y[441]).toBe(0);
    expect(y[10]).toBeCloseTo(0.001, 5);
    // sync: 0 at the start point rising to 1 at the end, then 0 once it stopped
    expect(sync[0]).toBe(0);
    expect(sync[220]).toBeCloseTo(220 / 441, 4);
    expect(sync[440]).toBeCloseTo(440 / 441, 4);
    expect(sync[441]).toBe(0);
    expect(sync[1500]).toBe(0);
    done();
  });

  it('0 stops recording; what came after is not recorded', async () => {
    const { ctx, buf, rec } = await setup(['rec2', 20], ['rec2'], 0.05); // 882 samples
    const k = new ConstantSourceNode(ctx, { offset: 0.5 });
    k.connect(rec.signalIns[0] as AudioNode);
    k.start();
    rec.controlIns![0]!([1]);
    // stop after 256 samples (suspend lands on a 128-frame boundary)
    ctx.suspend(256 / SR).then(async () => {
      rec.controlIns![0]!([0]);
      await wait(50);
      await ctx.resume();
    });
    const { sync, done } = await finish(ctx, [rec, buf]);
    const [y] = await readBack('rec2', 1000);
    expect(y[0]).toBeCloseTo(0.5, 6);
    expect(y[255]).toBeCloseTo(0.5, 6);
    expect(y[256]).toBe(0);
    expect(y[800]).toBe(0);
    expect(sync[100]).toBeCloseTo(100 / 882, 4);
    expect(sync[300]).toBe(0);
    done();
  });

  it('records between the start and end points (ms, the last two inlets)', async () => {
    const { ctx, buf, rec } = await setup(['rec3', 20], ['rec3'], 0.05);
    const k = new ConstantSourceNode(ctx, { offset: 0.25 });
    k.connect(rec.signalIns[0] as AudioNode);
    k.start();
    rec.controlIns![1]!([5]);  // start point 5 ms = sample 220.5, rounded to 221
    rec.controlIns![2]!([10]); // end point 10 ms = sample 441
    rec.controlIns![0]!([1]);
    const { sync, done } = await finish(ctx, [rec, buf]);
    const [y] = await readBack('rec3', 1000);
    expect(y[100]).toBe(0);
    expect(y[220]).toBe(0);
    expect(y[221]).toBeCloseTo(0.25, 6);
    expect(y[440]).toBeCloseTo(0.25, 6);
    expect(y[441]).toBe(0);
    expect(sync[0]).toBe(0);
    expect(sync[110]).toBeCloseTo(110 / 220, 4);
    expect(sync[300]).toBe(0);
    done();
  });

  it('with loop 1 it goes on at the start point, so the buffer holds the latest pass', async () => {
    const { ctx, buf, rec } = await setup(['rec4', 10], ['rec4'], 0.05); // 441 samples
    source(ctx, 2205, (i) => i / 10000).connect(rec.signalIns[0] as AudioNode);
    rec.controlIns![0]!(['loop', 1]);
    rec.controlIns![0]!([1]);
    const { sync, done } = await finish(ctx, [rec, buf]);
    const [y] = await readBack('rec4', 1000);
    // 2205 input samples is 5 passes of 441: sample 10 was last written by input 4 * 441 + 10
    expect(y[10]).toBeCloseTo((4 * 441 + 10) / 10000, 4);
    expect(sync[441 + 220]).toBeCloseTo(220 / 441, 4); // the sync ramp starts again
    done();
  });

  it('@loop 1 in the box text (an attribute the engine passes on the box) loops too', async () => {
    const ctx = new OfflineAudioContext(1, Math.round(SR * 0.05), SR);
    await preloadWorklets(ctx);
    const buf = getFactory('buffer~')!(['rec7', 10], { ctx });
    const box = { attrs: { loop: ['1'] } } as unknown as IRNode;
    const rec = getFactory('record~')!(['rec7'], { ctx, node: box });
    (rec.signalOuts[0] as AudioNode).connect(ctx.destination);
    source(ctx, 2205, (i) => i / 10000).connect(rec.signalIns[0] as AudioNode);
    rec.controlIns![0]!([1]);
    const { done } = await finish(ctx, [rec, buf]);
    const [y] = await readBack('rec7', 1000);
    expect(y[10]).toBeCloseTo((4 * 441 + 10) / 10000, 4);
    done();
  });

  it('groove~ @loop 1 loops a take record~ made (the attribute comes on the box)', async () => {
    const { ctx, buf, rec } = await setup(['rec8', 5], ['rec8'], 0.02); // 220.5 -> 221 samples
    const k = new ConstantSourceNode(ctx, { offset: 0.4 });
    k.connect(rec.signalIns[0] as AudioNode);
    k.start();
    rec.controlIns![0]!([1]);
    const { done } = await finish(ctx, [rec]);
    const ctx2 = new OfflineAudioContext(1, 1000, SR);
    const g = getFactory('groove~')!(['rec8'], { ctx: ctx2, node: { attrs: { loop: ['1'] } } as unknown as IRNode });
    (g.signalOuts[0] as AudioNode).connect(ctx2.destination);
    g.controlIns![0]!([1]);
    const y = (await ctx2.startRendering()).getChannelData(0);
    expect(y[100]).toBeCloseTo(0.4, 6);
    expect(y[700]).toBeCloseTo(0.4, 6); // third time round
    g.dispose?.(); done(); buf.dispose?.();
  });

  it('record~ name 2 records two channels into a stereo buffer~', async () => {
    const { ctx, buf, rec } = await setup(['rec5', 10, 2], ['rec5', 2], 0.05);
    expect(rec.signalIns.length).toBe(4); // two signal inlets, then start and end
    const a = new ConstantSourceNode(ctx, { offset: 0.3 });
    const b = new ConstantSourceNode(ctx, { offset: -0.6 });
    a.connect(rec.signalIns[0] as AudioNode);
    b.connect(rec.signalIns[1] as AudioNode);
    a.start(); b.start();
    rec.controlIns![0]!([1]);
    const { done } = await finish(ctx, [rec, buf]);
    const [l, r] = await readBack('rec5', 1000, 2);
    expect(l[200]).toBeCloseTo(0.3, 6);
    expect(r[200]).toBeCloseTo(-0.6, 6);
    expect(l[441]).toBe(0);
    done();
  });

  it('a wave~ reading the buffer hears the new recording', async () => {
    const { ctx, buf, rec } = await setup(['rec6', 10], ['rec6'], 0.02);
    const k = new ConstantSourceNode(ctx, { offset: 0.7 });
    k.connect(rec.signalIns[0] as AudioNode);
    k.start();
    rec.controlIns![0]!([1]);
    const { done } = await finish(ctx, [rec]);
    const ctx2 = new OfflineAudioContext(1, 512, SR);
    await preloadWorklets(ctx2);
    const w = getFactory('wave~')!(['rec6'], { ctx: ctx2 });
    const ph = new ConstantSourceNode(ctx2, { offset: 0.5 });
    ph.connect(w.signalIns[0] as AudioNode);
    (w.signalOuts[0] as AudioNode).connect(ctx2.destination);
    ph.start();
    await wait(50);
    const y = (await ctx2.startRendering()).getChannelData(0);
    expect(y[300]).toBeCloseTo(0.7, 6);
    w.dispose?.(); done(); buf.dispose?.();
  });
});
