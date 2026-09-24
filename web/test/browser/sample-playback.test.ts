// playlist~, live.gain~ and p, heard: rendered on a real OfflineAudioContext.
//
// The Node suite pins what these objects do with messages; only a real render can say
// whether a clip actually comes out of the speakers, whether a live.gain~ at the bottom
// of its range is silent, and whether audio survives a trip through a subpatcher.
// The kit samples are fetched from public/samples exactly as the app fetches them.

import { describe, expect, it } from 'vitest';
import '../../src/objects';
import { Engine } from '../../src/engine/engine';
import { loadSample } from '../../src/objects/audio/samples';
import { parseMaxPat } from '../../src/parser/maxpat';

const SR = 44100;

type Box = Record<string, unknown>;
const box = (id: string, fields: Box) => ({
  box: { id, patching_rect: [0, 0, 150, 30], numinlets: 1, numoutlets: 0, ...fields },
});
const line = (from: string, outlet: number, to: string, inlet: number) => ({
  patchline: { source: [from, outlet], destination: [to, inlet] },
});

/** A mono playlist~ with the drum patch's clip, into live.gain~, into ezdac~. */
function drumChain(levelDb: number) {
  return parseMaxPat({
    patcher: {
      boxes: [
        box('pl', {
          maxclass: 'playlist~', numoutlets: 4, channelcount: 1,
          outlettype: ['signal', 'signal', '', 'dictionary'],
          data: { clips: [{ filename: '00-tr808-clap.wav' }] },
        }),
        box('lg', {
          maxclass: 'live.gain~', numinlets: 2, numoutlets: 5,
          outlettype: ['signal', 'signal', '', 'float', 'list'],
          saved_attribute_attributes: { valueof: { parameter_initial: [levelDb], parameter_initial_enable: 1 } },
        }),
        box('dac', { maxclass: 'ezdac~', numinlets: 2 }),
      ],
      lines: [line('pl', 0, 'lg', 0), line('pl', 0, 'lg', 1), line('lg', 0, 'dac', 0), line('lg', 1, 'dac', 1)],
    },
  });
}

async function render(seconds: number, setup: (engine: Engine, ctx: OfflineAudioContext) => Promise<void>) {
  const ctx = new OfflineAudioContext(2, Math.round(SR * seconds), SR);
  const engine = new Engine(ctx);
  await setup(engine, ctx);
  const out = (await ctx.startRendering()).getChannelData(0);
  engine.clear();
  return out;
}

const rms = (x: Float32Array, from = 0, to = x.length): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / Math.max(1, to - from));
};

/** Where the energy is, in Hz — enough to tell a clap from a kick. */
function centroid(x: Float32Array, n = 4096): number {
  let num = 0;
  let den = 0;
  for (let k = 1; k < n / 2; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const a = (2 * Math.PI * k * t) / n;
      re += x[t] * Math.cos(a);
      im -= x[t] * Math.sin(a);
    }
    const mag = Math.hypot(re, im);
    num += mag * ((k * SR) / n);
    den += mag;
  }
  return num / den;
}

async function playClap(levelDb: number, before?: (engine: Engine) => void) {
  return render(0.5, async (engine, ctx) => {
    engine.build(drumChain(levelDb));
    // The clip starts loading at build; wait for the same cached decode, then trigger.
    await loadSample(ctx, { kind: 'kit', id: 'clap', guessed: true });
    before?.(engine);
    engine.getNode('pl')!.controlIns![0]!([1]);
  });
}

describe('playlist~ → live.gain~ → ezdac~', () => {
  it('plays the built-in clap in place of a missing 00-tr808-clap.wav', async () => {
    const out = await playClap(0);
    expect(rms(out, 0, SR * 0.1)).toBeGreaterThan(0.05);
    const c = centroid(out);
    expect(c).toBeGreaterThan(800);
    expect(c).toBeLessThan(8000);
  });

  it('is silent with live.gain~ at the bottom of its range (the patch saves −70)', async () => {
    const out = await playClap(-70);
    expect(rms(out)).toBeLessThan(1e-4);
  });

  it('−12 dB on the fader is a quarter of the amplitude of 0 dB', async () => {
    const loud = rms(await playClap(0));
    const quiet = rms(await playClap(-12));
    expect(quiet / loud).toBeGreaterThan(0.2);
    expect(quiet / loud).toBeLessThan(0.3);
  });

  it('selectionms cuts the clip to its window', async () => {
    const full = await playClap(0);
    const cut = await playClap(0, (engine) => engine.getNode('pl')!.controlIns![0]!(['selectionms', 5, 60]));
    const tail = [SR * 0.08, SR * 0.2] as const;
    expect(rms(full, ...tail)).toBeGreaterThan(0.01);
    expect(rms(cut, ...tail)).toBeLessThan(1e-4);
  });
});

describe('p', () => {
  it('passes audio from its inlet to its outlet', async () => {
    const through = parseMaxPat({
      patcher: {
        boxes: [
          box('osc', { maxclass: 'newobj', text: 'cycle~ 440', numinlets: 2, numoutlets: 1, outlettype: ['signal'] }),
          box('sub', {
            maxclass: 'newobj', text: 'p thru', numinlets: 1, numoutlets: 1, outlettype: ['signal'],
            patcher: {
              boxes: [
                box('i', { maxclass: 'inlet', numinlets: 0, numoutlets: 1, outlettype: [''] }),
                box('amp', { maxclass: 'newobj', text: '*~ 0.5', numinlets: 2, numoutlets: 1, outlettype: ['signal'] }),
                box('o', { maxclass: 'outlet', numinlets: 1 }),
              ],
              lines: [line('i', 0, 'amp', 0), line('amp', 0, 'o', 0)],
            },
          }),
          box('dac', { maxclass: 'ezdac~', numinlets: 2 }),
        ],
        lines: [line('osc', 0, 'sub', 0), line('sub', 0, 'dac', 0)],
      },
    });
    const out = await render(0.1, async (engine) => void engine.build(through));
    // A 440 Hz sine at 0.5 has an RMS of 0.5/√2.
    expect(rms(out)).toBeGreaterThan(0.3);
    expect(rms(out)).toBeLessThan(0.4);
  });
});
