// Every example must make sound, without clipping. Examples driven by a clock (metro,
// delay, pipe) must also change over time: the pitch moves or the level swings, which
// shows the clock runs instead of leaving one stuck tone.
//
// How: each example renders OFFLINE (OfflineAudioContext), so the test needs no sound
// card and gives the same answer on every machine. The engine's clock (metro, delay…)
// runs on setInterval/setTimeout, which offline rendering would race past, so the timers
// are faked and advanced in step with the audio: every 10 ms of audio, rendering pauses
// (ctx.suspend), the fake clock moves 10 ms (metros fire, setting values at that moment
// in the audio), and rendering resumes.
//
// A real-time check is not possible here: in a headless browser the audio clock stalls
// (currentTime stays near 0), so a live AnalyserNode keeps returning its first buffer.

import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../web/src/objects';
import { Engine } from '../../../web/src/engine/engine';
import { parseMaxPat } from '../../../web/src/parser/maxpat';
import { preloadWorklets } from '../../../web/src/runtime/worklet';
import examples from '../../src/generated/examples.json';

const SR = 44100;
const SECONDS = 2.5;
const STEP = 0.01; // seconds of audio per clock step
const WINDOW = 0.1; // seconds per analysis window

async function render(patch: unknown): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(2, Math.round(SR * SECONDS), SR);
  const engine = new Engine(ctx);
  await preloadWorklets(ctx);
  engine.build(parseMaxPat(patch));
  await engine.start(); // arms the scheduler: timed objects fire on the (fake) clock
  for (let t = STEP; t < SECONDS; t += STEP) {
    const at = Math.round(t * SR / 128) * 128 / SR; // suspend on a render-quantum boundary
    ctx.suspend(at).then(() => {
      vi.advanceTimersByTime(STEP * 1000);
      void ctx.resume();
    });
  }
  try {
    const buffer = await ctx.startRendering();
    return buffer.getChannelData(0).slice();
  } finally {
    await engine.stop();
    engine.clear();
  }
}

/** Per-window RMS and zero-crossing rate (a rough pitch), skipping the first window. */
function analyse(x: Float32Array) {
  const n = Math.round(WINDOW * SR);
  const rms: number[] = [], zcr: number[] = [];
  let peak = 0;
  for (let w = 1; (w + 1) * n <= x.length; w++) {
    let sum = 0, cross = 0;
    for (let i = w * n; i < (w + 1) * n; i++) {
      sum += x[i] * x[i];
      peak = Math.max(peak, Math.abs(x[i]));
      if (i > w * n && (x[i - 1] < 0) !== (x[i] < 0)) cross++;
    }
    rms.push(Math.sqrt(sum / n));
    zcr.push(cross / (2 * WINDOW)); // ≈ Hz for a simple tone
  }
  return { rms, zcr, peak };
}

const TIMED = ['metro', 'delay', 'pipe'];

// Steady sine examples and the pitch they must play (Hz, from the zero-crossing rate).
// This catches an inlet that ADDS a signal to its argument instead of replacing it, as
// Max does: cycle~ with no argument starts at 440 Hz in the browser engine, so a
// signal-driven cycle~ without an explicit 0 plays 440 Hz too high.
const PITCH: Record<string, number> = {
  'cycle~/0': 440,
  'cycle~/1': 330,
  'sig~/0': 262,
  'loadbang/0': 392,
  'send~/0': 294,
  '*~/0': 330,
};

afterEach(() => { vi.useRealTimers(); });

describe('every reference example plays', () => {
  for (const ex of examples as { object: string; index: number; title: string; objects: string[]; patch: unknown }[]) {
    it(`${ex.object}/${ex.index}: ${ex.title}`, async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
      if (ex.objects.includes('jit.grab')) return; // needs a camera; build_examples checks it compiles
      const { rms, zcr, peak } = analyse(await render(ex.patch));

      const loudest = Math.max(...rms);
      expect(loudest, 'makes sound').toBeGreaterThan(0.005);
      expect(peak, 'does not clip').toBeLessThanOrEqual(1);

      const want = PITCH[`${ex.object}/${ex.index}`];
      if (want) {
        const heard = zcr.reduce((a, b) => a + b, 0) / zcr.length;
        expect(Math.abs(heard - want) / want, `plays ${want} Hz (heard ${heard.toFixed(0)} Hz)`).toBeLessThan(0.05);
      }

      if (ex.objects.some((o) => TIMED.includes(o))) {
        const sounding = zcr.filter((_, i) => rms[i] > 0.01);
        const pitchSpread = Math.max(...sounding) / Math.max(Math.min(...sounding), 1);
        const levelSwing = loudest / Math.max(Math.min(...rms), 1e-4);
        expect(pitchSpread > 1.08 || levelSwing > 2,
          `changes over time (pitch spread ${pitchSpread.toFixed(2)}, level swing ${levelSwing.toFixed(1)})`).toBe(true);
      }
    });
  }
});
