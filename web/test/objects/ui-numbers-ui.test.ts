import { describe, expect, it } from 'vitest';
import '../../src/objects/ui/numbers-ui'; // self-registering module (NOT the bootstrap)
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // UI/control objects ignore the audio context
const bang: Msg = ['bang'];

// Build a widget and capture messages leaving a given outlet.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs: Record<number, Msg[]> = {};
  const capture = (outlet: number) => {
    outs[outlet] = [];
    node.onControlOut?.(outlet, (m) => outs[outlet].push(m));
  };
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  const vals = (outlet: number) => (outs[outlet] ?? []).map((m) => m[0]);
  return { node, capture, send, vals };
}

describe('ui numbers/sliders', () => {
  it('pictslider builds headless with el === undefined', () => {
    const { node } = build('pictslider');
    expect(node.el).toBeUndefined(); // no `document` in Node -> no DOM widget
    expect(node.controlIns?.length).toBe(2); // matches manifest inlet arity
  });

  it('pictslider: a number on inlet 0 sets X and emits on outlet 0', () => {
    const { capture, send, vals } = build('pictslider');
    capture(0);
    capture(1);
    send([42], 0);
    expect(vals(0)).toEqual([42]);
    expect(vals(1)).toEqual([]); // inlet 0 does not touch the Y outlet
  });

  it('pictslider: a number on inlet 1 sets Y and emits on outlet 1', () => {
    const { capture, send, vals } = build('pictslider');
    capture(0);
    capture(1);
    send([99], 1);
    expect(vals(1)).toEqual([99]);
    expect(vals(0)).toEqual([]);
  });

  it('pictslider: clamps values to the default 0..127 range', () => {
    const { capture, send, vals } = build('pictslider');
    capture(0);
    capture(1);
    send([200], 0); // above max
    send([-5], 1); // below min
    expect(vals(0)).toEqual([127]);
    expect(vals(1)).toEqual([0]);
  });

  it('pictslider: truncates floats to integers', () => {
    const { capture, send, vals } = build('pictslider');
    capture(0);
    send([12.9], 0);
    expect(vals(0)).toEqual([12]);
  });

  it('pictslider: bang on inlet 0 re-outputs both stored X and Y', () => {
    const { capture, send, vals } = build('pictslider');
    send([10], 0);
    send([20], 1);
    capture(0);
    capture(1); // start capturing only the bang-triggered output
    send(bang, 0);
    expect(vals(0)).toEqual([10]);
    expect(vals(1)).toEqual([20]);
  });

  it('pictslider: bang on inlet 1 re-outputs Y only', () => {
    const { capture, send, vals } = build('pictslider');
    send([20], 1);
    capture(0);
    capture(1);
    send(bang, 1);
    expect(vals(1)).toEqual([20]);
    expect(vals(0)).toEqual([]);
  });
});
