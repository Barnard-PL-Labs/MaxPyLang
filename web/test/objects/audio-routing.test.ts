import { describe, expect, it } from 'vitest';
import '../../src/objects/audio/routing'; // register the routing batch only
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = new (globalThis as unknown as {
  OfflineAudioContext: new (c: number, l: number, s: number) => BaseAudioContext;
}).OfflineAudioContext(2, 128, 44100);

function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs: Record<number, Msg[]> = {};
  const capture = (outlet: number) => {
    outs[outlet] = [];
    node.onControlOut?.(outlet, (m) => outs[outlet].push(m));
  };
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, outs, capture, send };
}

// A gain node whose .gain.value we can inspect headlessly.
const gainOf = (n: unknown) => (n as { gain: { value: number } }).gain.value;

describe('routing batch', () => {
  it('all four objects are registered as real factories', () => {
    for (const name of ['matrix~', 'selector~', 'send~', 'receive~']) {
      expect(typeof getFactory(name)).toBe('function');
    }
  });

  describe('selector~', () => {
    it('builds with a single signal outlet and one gain per signal inlet', () => {
      const { node } = build('selector~', 3);
      expect(node.signalOuts[0]).toBeTruthy();
      // inlet 0 is the selector int (no signal target); inlets 1..3 are signals.
      expect(node.signalIns[0]).toBeUndefined();
      expect(node.signalIns[1]).toBeTruthy();
      expect(node.signalIns[3]).toBeTruthy();
    });

    it('honours initially-open-inlet arg', () => {
      const { node } = build('selector~', 3, 2); // inlet 2 open
      expect(gainOf(node.signalIns[1])).toBe(0);
      expect(gainOf(node.signalIns[2])).toBe(1);
      expect(gainOf(node.signalIns[3])).toBe(0);
    });

    it('an int on inlet 0 opens exactly that inlet and closes the rest', () => {
      const { node, send } = build('selector~', 3);
      send([2]);
      expect(gainOf(node.signalIns[1])).toBe(0);
      expect(gainOf(node.signalIns[2])).toBe(1);
      expect(gainOf(node.signalIns[3])).toBe(0);
      send([0]); // 0 = close all
      expect(gainOf(node.signalIns[1])).toBe(0);
      expect(gainOf(node.signalIns[2])).toBe(0);
    });
  });

  describe('send~ / receive~', () => {
    it('send~ exposes a signal inlet and no outlets', () => {
      const { node } = build('send~', 'busA');
      expect(node.signalIns[0]).toBeTruthy();
      expect(node.signalOuts.length).toBe(0);
    });

    it('receive~ exposes a signal outlet fed by the named bus', () => {
      const { node } = build('receive~', 'busA');
      expect(node.signalOuts[0]).toBeTruthy();
    });

    it('send~ and receive~ on the same name share one bus node', () => {
      // The bus node send~ writes into is the same node that feeds receive~: both
      // resolve getBus(name), so send~.signalIns[0] is that shared node.
      const s = build('send~', 'shared');
      const r = build('receive~', 'shared');
      expect(s.node.signalIns[0]).toBeTruthy();
      expect(r.node.signalOuts[0]).toBeTruthy();
      // A second send~ on the same name targets the identical bus node.
      const s2 = build('send~', 'shared');
      expect(s2.node.signalIns[0]).toBe(s.node.signalIns[0]);
      // A different name yields a different bus node.
      const s3 = build('send~', 'other');
      expect(s3.node.signalIns[0]).not.toBe(s.node.signalIns[0]);
    });
  });

  describe('matrix~', () => {
    it('builds inlets×outlets signal ports plus a control dumpout', () => {
      const { node } = build('matrix~', 3, 2);
      expect(node.signalIns[0]).toBeTruthy();
      expect(node.signalIns[2]).toBeTruthy();
      expect(node.signalOuts[0]).toBeTruthy();
      expect(node.signalOuts[1]).toBeTruthy();
      expect(node.signalOuts[2]).toBeUndefined(); // last outlet is the control dump
      expect(typeof node.onControlOut).toBe('function');
    });

    it('defaults to a 2×2 matrix when built with no args (matches manifest)', () => {
      const { node } = build('matrix~');
      expect(node.signalIns[1]).toBeTruthy();
      expect(node.signalOuts[1]).toBeTruthy();
      expect(node.signalOuts[2]).toBeUndefined();
    });

    it('a `dump` message emits every cell on the dump outlet', () => {
      const { send, capture, outs } = build('matrix~', 2, 2, 1);
      capture(2); // the dump (control) outlet
      send(['dump']);
      expect(outs[2].length).toBe(4); // 2×2 cells
      // default-connect-gain arg was 1, so every cell reports gain 1.
      expect(outs[2]).toContainEqual([0, 0, 1]);
      expect(outs[2]).toContainEqual([1, 1, 1]);
    });

    it('a `in out value` message updates that cell, visible via dump', () => {
      const { send, capture, outs } = build('matrix~', 2, 2, 0);
      send([0, 1, 0.5]);
      capture(2);
      send(['dump']);
      expect(outs[2]).toContainEqual([0, 1, 0.5]);
      expect(outs[2]).toContainEqual([0, 0, 0]); // untouched cell stays at default 0
    });

    it('`clear` zeroes every cell', () => {
      const { send, capture, outs } = build('matrix~', 2, 2, 1);
      send(['clear']);
      capture(2);
      send(['dump']);
      for (const m of outs[2]) expect(m[2]).toBe(0);
    });
  });
});
