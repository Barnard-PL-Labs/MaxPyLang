// Integration test over the bundled demo patches: each must parse, build through
// the full engine, contain ONLY implemented objects (no stubs, no unknowns), and
// wire all its cords. This is the "the demos actually work" guarantee.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../src/objects'; // full bootstrap
import { parseMaxPat } from '../../src/parser/maxpat';
import { Engine } from '../../src/engine/engine';

const DEMOS = [
  'hello_world',
  'arpeggiator',
  'subtractive_synth',
  'fm_synth',
  'tremolo',
  'random_melody',
  'detuned_chord',
  'interactive_synth',
  'theremin',
  'ring_mod',
  'overdrive',
  'detune_drone',
  'webcam_theremin',
];

const OfflineCtx = (globalThis as unknown as {
  OfflineAudioContext: new (c: number, l: number, s: number) => BaseAudioContext;
}).OfflineAudioContext;

function load(name: string) {
  const p = fileURLToPath(new URL(`../../public/test-patches/${name}.maxpat`, import.meta.url));
  return JSON.parse(readFileSync(p, 'utf-8'));
}

describe('bundled demo patches build with only implemented objects', () => {
  for (const name of DEMOS) {
    it(`${name}: no unknown/stub objects, all cords wired`, () => {
      const patch = parseMaxPat(load(name));
      const engine = new Engine(new OfflineCtx(2, 128, 44100));
      const report = engine.build(patch);
      expect(report.unknown, `unknown in ${name}`).toEqual([]);
      expect(report.stubbed, `stubbed (unimplemented) in ${name}`).toEqual([]);
      // every node built
      expect(report.built.size).toBe(patch.nodes.length);
      // patch is non-trivial and has an output
      expect(patch.edges.length).toBeGreaterThan(0);
      expect(patch.nodes.some((n) => n.className === 'ezdac~')).toBe(true);
    });
  }
});
