import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMaxPat } from '../src/parser/maxpat';

function loadSample(name: string) {
  const path = fileURLToPath(new URL(`../public/test-patches/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8'));
}

describe('parseMaxPat', () => {
  it('parses hello_world into a typed graph', () => {
    const patch = parseMaxPat(loadSample('hello_world.maxpat'));

    const cycle = patch.nodes.find((n) => n.className === 'cycle~');
    expect(cycle).toBeDefined();
    expect(cycle!.args).toEqual([440]);
    expect(cycle!.outletDomains[0]).toBe('signal');

    // every cord in hello_world is a signal cord
    expect(patch.edges.length).toBeGreaterThan(0);
    expect(patch.edges.every((e) => e.domain === 'signal')).toBe(true);
  });

  it('splits newobj text into class + numeric args', () => {
    const patch = parseMaxPat(loadSample('webcam_pixelated_synth.maxpat'));
    const scale = patch.nodes.find((n) => n.text === '*~ 2');
    expect(scale!.className).toBe('*~');
    expect(scale!.args).toEqual([2]);
  });

  it('reads outlet domains: signal vs control vs video', () => {
    const patch = parseMaxPat(loadSample('webcam_pixelated_synth.maxpat'));
    const grab = patch.nodes.find((n) => n.className === 'jit.grab');
    expect(grab!.outletDomains[0]).toBe('video'); // jit_matrix outlet

    // a message-box outlet is control
    const msg = patch.nodes.find((n) => n.maxclass === 'message');
    expect(msg!.outletDomains[0]).toBe('control');
  });
});
