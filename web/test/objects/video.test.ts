// Video (Jitter) subset — structural tests, run HEADLESS in Node (no DOM, no camera).
//
// We assert: (1) each jit.* object builds without throwing and exposes video ports of
// the right arity; (2) the engine wires jit_matrix cords between video ports; and
// (3) the real webcam_pixelated_synth demo parses, builds, and its
// jit.grab → jit.matrix → jit.window video cords are recognized and wired.
//
// Real webcam rendering (getUserMedia → canvas pixels) is only verifiable in a browser
// and is checked manually in-app — see the module note. Node has no navigator.camera.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import '../../src/objects'; // bootstrap: registers real objects + Tier-A stubs
import { getFactory, isSupported } from '../../src/engine/registry';
import { Engine } from '../../src/engine/engine';
import { parseMaxPat } from '../../src/parser/maxpat';
import type { IRNode, IRPatch } from '../../src/ir/types';

const OfflineCtx = (globalThis as unknown as {
  OfflineAudioContext: new (c: number, l: number, s: number) => BaseAudioContext;
}).OfflineAudioContext;
const newCtx = () => new OfflineCtx(2, 128, 44100);

function loadSample(name: string) {
  const path = fileURLToPath(new URL(`../../public/test-patches/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** A tiny helper to synthesise an IRNode. */
function node(id: string, className: string, outletDomains: IRNode['outletDomains'], args: IRNode['args'] = []): IRNode {
  return {
    id, className, args, maxclass: 'newobj',
    numInlets: 1, numOutlets: outletDomains.length, outletDomains,
    rect: [0, 0, 40, 20], text: className,
  };
}

describe('video: jit.* build headlessly with video ports', () => {
  it('the real subset is implemented (Tier B), not stubbed', () => {
    for (const name of ['jit.grab', 'jit.matrix', 'jit.window', 'jit.pwindow', 'jit.brcosa', 'jit.scalebias']) {
      expect(isSupported(name), name).toBe(true);
    }
  });

  it('jit.grab exposes a video source outlet and never throws headless', () => {
    const n = getFactory('jit.grab')!([], { ctx: newCtx() });
    expect(n.videoOuts?.[0]).toBeDefined();
    // No camera in Node → getFrame() yields undefined rather than throwing.
    expect(n.videoOuts![0]!.getFrame()).toBeUndefined();
  });

  it('jit.matrix has a video sink inlet and a video source outlet', () => {
    const n = getFactory('jit.matrix')!([160, 120, 4, 'char'], { ctx: newCtx() });
    expect(typeof n.videoIns?.[0]).toBe('function');
    expect(n.videoOuts?.[0]).toBeDefined();
    expect(n.videoOuts![0]!.getFrame()).toBeUndefined(); // no frame pushed yet
  });

  it('jit.window / jit.pwindow have a video sink inlet', () => {
    const win = getFactory('jit.window')!([], { ctx: newCtx() });
    const pwin = getFactory('jit.pwindow')!([], { ctx: newCtx() });
    expect(typeof win.videoIns?.[0]).toBe('function');
    expect(typeof pwin.videoIns?.[0]).toBe('function');
    expect(pwin.videoOuts?.[0]).toBeDefined(); // pwindow passes frames through
  });

  it('pushing a frame into a sink does not throw when there is no DOM', () => {
    const n = getFactory('jit.window')!([], { ctx: newCtx() });
    expect(() => n.videoIns![0]!({ source: {} as CanvasImageSource, width: 2, height: 2 })).not.toThrow();
  });
});

describe('video: engine wires jit_matrix cords between video ports', () => {
  it('counts a video cord between two jit objects', () => {
    const grab = node('a', 'jit.grab', ['video', 'control']);
    const matrix = node('b', 'jit.matrix', ['video', 'control']);
    const nodes = [grab, matrix];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const patch: IRPatch = {
      nodes,
      edges: [{ from: { id: 'a', outlet: 0 }, to: { id: 'b', inlet: 0 }, domain: 'video' }],
      byId,
    };
    const report = new Engine(newCtx()).build(patch);
    expect(report.videoCords).toBe(1);
    expect(report.unknown).toEqual([]);
  });
});

describe('video: webcam_pixelated_synth demo', () => {
  it('parses, builds, and wires its jit.grab → jit.matrix → jit.window video cords', () => {
    const patch = parseMaxPat(loadSample('webcam_pixelated_synth.maxpat'));

    // grab → matrix and matrix → window are the two jit_matrix (video) cords.
    const videoEdges = patch.edges.filter((e) => e.domain === 'video');
    expect(videoEdges.length).toBe(2);

    const report = new Engine(newCtx()).build(patch);
    expect(report.videoCords).toBe(2);
    expect(report.unknown).toEqual([]);
    // the whole video chain is Tier-B implemented, and audio still builds too
    for (const cls of ['jit.grab', 'jit.matrix', 'jit.window', 'phasor~']) {
      expect(report.implemented).toContain(cls);
    }
  });
});
