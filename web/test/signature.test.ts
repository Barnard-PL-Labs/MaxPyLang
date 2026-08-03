// Signature tests — parametric over EVERY object in the manifest (~1000+).
// Guarantees the registry recognizes all of them and that each builds with an I/O
// shape that lets the engine wire it: every signal outlet exposes an audio source,
// and every control outlet exposes an emitter. Catches whole-set wiring regressions.

import { describe, expect, it } from 'vitest';
import '../src/objects'; // bootstrap: real objects + Tier-A stubs
import { MANIFEST, getFactory } from '../src/engine/registry';

const ctx = new (globalThis as unknown as {
  OfflineAudioContext: new (c: number, l: number, s: number) => BaseAudioContext;
}).OfflineAudioContext(2, 128, 44100);

describe('object signatures (all manifest objects)', () => {
  const names = Object.keys(MANIFEST);

  it(`recognizes every manifest object (${names.length})`, () => {
    const missing = names.filter((n) => typeof getFactory(n) !== 'function');
    expect(missing).toEqual([]);
  });

  it('every object builds and exposes the ports its domain requires', () => {
    const failures: string[] = [];
    for (const name of names) {
      const entry = MANIFEST[name];
      let node;
      try {
        node = getFactory(name)!([], { ctx });
      } catch (e) {
        failures.push(`${name}: threw on build — ${(e as Error).message}`);
        continue;
      }
      entry.outletDomains.forEach((d, i) => {
        if (d === 'signal' && !node!.signalOuts[i]) {
          failures.push(`${name}: signal outlet ${i} has no audio source`);
        }
      });
      if (entry.outletDomains.includes('control') && typeof node!.onControlOut !== 'function') {
        failures.push(`${name}: declares a control outlet but has no onControlOut`);
      }
    }
    expect(failures.slice(0, 25), `${failures.length} failures`).toEqual([]);
  });
});
