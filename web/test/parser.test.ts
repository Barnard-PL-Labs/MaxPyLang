import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseMaxPat } from '../src/parser/maxpat';

function loadSample(name: string) {
  const path = fileURLToPath(new URL(`../public/test-patches/${name}`, import.meta.url));
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/** A minimal box dict, for the cases no bundled patch happens to contain. */
function box(id: string, maxclass: string, text: string) {
  return {
    box: { id, maxclass, text, numinlets: 1, numoutlets: 1, outlettype: [''], patching_rect: [0, 0, 60, 22] },
  };
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

  it('splits @attrs out of an object box but not out of a message box', () => {
    const patch = parseMaxPat({
      patcher: {
        boxes: [
          box('obj-1', 'newobj', 'cycle~ @frequency 440'),
          box('obj-2', 'message', '@gain 0.5'),
        ],
        lines: [],
      },
    });

    // The object box: "@frequency" is an attribute, so the engine sees no arg 0 —
    // before this it received the literal string "@frequency" as its frequency.
    const cycle = patch.byId.get('obj-1')!;
    expect(cycle.className).toBe('cycle~');
    expect(cycle.args).toEqual([]);
    expect(cycle.attrs).toEqual({ frequency: ['440'] });

    // The message box: its text is a message to send, so both atoms stay arguments.
    // With them split into attrs the box emits a bang (control/index.ts) and the
    // message is lost.
    const msg = patch.byId.get('obj-2')!;
    expect(msg.args).toEqual(['@gain', 0.5]);
    expect(msg.attrs).toEqual({});
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
