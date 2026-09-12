// Does a cleared patch actually go quiet?
//
// This is the one question in the engine that only a real Web Audio implementation can
// answer, and the answer used to be NO. clear() dropped its cord-teardown thunks unrun,
// on the theory that both ends of every cord were about to be disposed anyway — but no
// audio factory HAD a dispose(): `cycle~` left its OscillatorNode running and `ezdac~`
// left its ChannelMergerNode wired to ctx.destination. So File > New left the previous
// patch playing forever with the document reading "0 boxes · 0 cords", and each Open
// stacked another permanently-audible copy on top until the sum clipped the output.
//
// The headless suite cannot see that: its Web Audio mock connects nothing to anything,
// so "the chain is still wired to the speakers" has no observable consequence there.
// test/engine-incremental.test.ts pins the MECHANISM (the teardown thunk runs, with the
// cord's own destination as its argument); this file pins the CONSEQUENCE, by rendering
// a real OfflineAudioContext and measuring what comes out of it.
//
// Reading the render as "is it silent" rather than as a spectrum is deliberate: the
// failure is not a wrong tone, it is a tone that should not exist at all.

import { describe, expect, it } from 'vitest';
import '../../src/objects'; // real factories, so cycle~ is a real oscillator
import { Engine } from '../../src/engine/engine';
import type { IREdge, IRNode, IRPatch } from '../../src/ir/types';

const SR = 44100;
const FRAMES = 4096;

function node(id: string, className: string, outletDomains: IRNode['outletDomains'], args: IRNode['args'] = []): IRNode {
  return {
    id, className, args, maxclass: 'newobj',
    numInlets: 2, numOutlets: outletDomains.length, outletDomains,
    rect: [0, 0, 40, 20], text: [className, ...args].join(' '),
  };
}

const cord = (from: string, to: string, inlet = 0): IREdge =>
  ({ from: { id: from, outlet: 0 }, to: { id: to, inlet }, domain: 'signal' });

/** cycle~ 440 -> *~ 0.2 -> ezdac~ (both channels): the starter patch, audible. */
function tonePatch(suffix = ''): IRPatch {
  const nodes = [
    node(`osc${suffix}`, 'cycle~', ['signal'], [440]),
    node(`amp${suffix}`, '*~', ['signal'], [0.2]),
    node(`dac${suffix}`, 'ezdac~', []),
  ];
  return {
    nodes,
    edges: [
      cord(`osc${suffix}`, `amp${suffix}`),
      cord(`amp${suffix}`, `dac${suffix}`, 0),
      cord(`amp${suffix}`, `dac${suffix}`, 1),
    ],
    byId: new Map(nodes.map((n) => [n.id, n])),
  };
}

const peakOf = (buf: AudioBuffer): number => {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  }
  return peak;
};

describe('Engine.clear() in real Web Audio', () => {
  it('the patch is audible before clear() — otherwise the test below proves nothing', async () => {
    const ctx = new OfflineAudioContext(2, FRAMES, SR);
    new Engine(ctx).build(tonePatch());
    expect(peakOf(await ctx.startRendering())).toBeGreaterThan(0.15);
  });

  it('silences the patch: nothing reaches the destination afterwards', async () => {
    const ctx = new OfflineAudioContext(2, FRAMES, SR);
    const engine = new Engine(ctx);
    engine.build(tonePatch());

    engine.clear(); // File > New

    // Not "quieter": silent. An ezdac~ still wired to ctx.destination through a cord the
    // document no longer has is not a level problem, it is a patch nobody can stop.
    expect(peakOf(await ctx.startRendering())).toBe(0);
  });

  it('opening the same patch repeatedly does not stack copies of it', async () => {
    const ctx = new OfflineAudioContext(2, FRAMES, SR);
    const engine = new Engine(ctx);
    // build() calls clear() first, so five Opens of the same file must sound like one.
    // Before the fix the peak climbed monotonically with every open (0.20 → 0.39 → …)
    // until the output clipped.
    for (let i = 0; i < 5; i++) engine.build(tonePatch(`-${i}`));

    const peak = peakOf(await ctx.startRendering());
    expect(peak).toBeGreaterThan(0.15); // the LAST patch is playing…
    expect(peak).toBeLessThan(0.3); // …and only it
  });

  it('a patch built after a clear() is still audible', async () => {
    // The guard the fix must not break: clear() keeps the context, so the next patch
    // builds into it and plays.
    const ctx = new OfflineAudioContext(2, FRAMES, SR);
    const engine = new Engine(ctx);
    engine.build(tonePatch('-a'));
    engine.clear();
    engine.build(tonePatch('-b'));

    expect(peakOf(await ctx.startRendering())).toBeGreaterThan(0.15);
  });
});
