// TEMPLATE: what a claims test looks like. Each test quotes the claim it checks.
import { describe, expect, it } from 'vitest';
import { run, runVideo, pitch, rms, firsts } from './helpers/measure';

describe('pipe/0: Delaying numbers', () => {
  it('"Each step plays, then a fifth above it plays 200 ms later"', async () => {
    const r = await run('pipe', 0, { seconds: 1.3, listen: [{ box: 'counter' }, { box: 'pipe' }, { box: 'mtof' }] });
    const steps = firsts(r.heard.counter), later = r.heard.pipe;
    expect(steps.slice(0, 3)).toEqual([57, 58, 59]);                 // counter 57 62, one per 400 ms
    expect(later[0].msg[0]).toBe(64);                              // 57 + 7
    expect(later[0].t - r.heard.counter[0].t).toBeCloseTo(0.2, 1);  // 200 ms later
    expect(pitch(r.left, 0.05, 0.18)).toBeCloseTo(220, -1);         // MIDI 57 = 220 Hz
    expect(pitch(r.left, 0.25, 0.38)).toBeCloseTo(329.6, -1);       // MIDI 64 = 329.6 Hz
    expect(rms(r.left, 0.05, 0.18)).toBeCloseTo(0.2 / Math.SQRT2, 2); // *~ 0.2
  });
});

describe('jit.3m/0: A webcam theremin', () => {
  it('"the mean\'s green value ... is scaled to 150..900 Hz"', async () => {
    const { heard } = await runVideo('jit.3m', 0, undefined, { listen: [{ box: 'scale' }] });
    expect(heard.scale.at(-1)!.msg[0]).toBeCloseTo(150 + (100 / 255) * 750, 1); // test picture's green is 100
  });
});
