// buffer~ and the objects that read it (wave~, play~, groove~), heard on a real
// OfflineAudioContext. A buffer~ loads the file it names, and each reader must read it
// the way Max does: wave~ at a phase from 0 to 1, play~ at a position in ms, groove~ at
// the speed of its input signal.

import { describe, expect, it } from 'vitest';
import '../../src/objects';
import { getFactory } from '../../src/engine/registry';
import { addSampleFile, resetSamples } from '../../src/objects/audio/samples';
import { preloadWorklets } from '../../src/runtime/worklet';

const SR = 44100;

/** A mono 16-bit WAV whose sample i is f(i). */
function wav(length: number, f: (i: number) => number): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + length * 2);
  const v = new DataView(bytes);
  const text = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + length * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, SR, true); v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) v.setInt16(44 + i * 2, Math.round(f(i) * 32767), true);
  return bytes;
}

/** Build buffer~ (loading `file`) and a reader, feed the reader `input`, render. */
async function render(file: string, reader: string, readerArgs: (number | string)[], input: number, seconds = 0.05) {
  const ctx = new OfflineAudioContext(1, Math.round(SR * seconds), SR);
  await preloadWorklets(ctx);
  const buf = getFactory('buffer~')!(['b', file], { ctx });
  await new Promise((r) => setTimeout(r, 300)); // fetch and decode
  const node = getFactory(reader)!(['b', ...readerArgs], { ctx });
  const src = new ConstantSourceNode(ctx, { offset: input });
  src.connect(node.signalIns[0] as AudioNode);
  (node.signalOuts[0] as AudioNode).connect(ctx.destination);
  src.start();
  await new Promise((r) => setTimeout(r, 50)); // the samples reach the worklet
  const y = (await ctx.startRendering()).getChannelData(0);
  node.dispose?.();
  buf.dispose?.();
  return y;
}

describe('buffer~ and its readers', () => {
  // 1000 samples rising from 0 to 0.999: sample i holds i / 1000.
  const ramp = wav(1000, (i) => i / 1000);

  it('wave~ at phase 0.5 reads the middle of the buffer', async () => {
    resetSamples();
    addSampleFile('ramp.wav', ramp);
    const y = await render('ramp.wav', 'wave~', [], 0.5);
    expect(y[1000]).toBeCloseTo(0.4995, 2);
  });

  it('wave~ reads within its start and end (ms)', async () => {
    resetSamples();
    addSampleFile('ramp.wav', ramp);
    // 1000 samples at 44.1 kHz last 22.68 ms; the region 0..11.34 ms is the first half.
    const y = await render('ramp.wav', 'wave~', [0, 500 / SR * 1000], 0.5);
    expect(y[1000]).toBeCloseTo(0.25, 2);
  });

  it('play~ reads the sample at the position in ms', async () => {
    resetSamples();
    addSampleFile('ramp.wav', ramp);
    const y = await render('ramp.wav', 'play~', [], 750 / SR * 1000); // sample 750
    expect(y[1000]).toBeCloseTo(0.75, 2);
  });

  it('groove~ plays the buffer at the speed of its input signal, once', async () => {
    resetSamples();
    addSampleFile('ramp.wav', ramp);
    const y = await render('ramp.wav', 'groove~', [], 1);
    expect(y[500]).toBeGreaterThan(0.3);   // playing: the ramp rises
    expect(y[1500]).toBe(0);               // played once, then stopped (no loop)
  });

  it('groove~ with nothing driving it stays silent, as in Max', async () => {
    resetSamples();
    addSampleFile('ramp.wav', ramp);
    const y = await render('ramp.wav', 'groove~', [], 0);
    expect(Math.max(...y.subarray(0, 2000).map(Math.abs))).toBe(0);
  });

  it('buffer~ drumLoop.aif loads the bundled drums clip (a file that ships with Max)', async () => {
    resetSamples();
    const y = await render('drumLoop.aif', 'groove~', [], 1, 1);
    let sum = 0;
    for (const v of y) sum += v * v;
    expect(Math.sqrt(sum / y.length)).toBeGreaterThan(0.01);
  });
});
