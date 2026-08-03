import { describe, expect, it } from 'vitest';
import '../../src/objects/ui/display'; // direct import — isolate from bootstrap/other batches
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

// Headless: no DOM. `el` must therefore stay undefined and the message behavior
// must be reachable purely through controlIns.
const ctx = {} as BaseAudioContext;
const bang: Msg = ['bang'];

function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const events: { outlet: number; m: Msg }[] = [];
  for (let i = 0; i < 4; i++) node.onControlOut?.(i, (m) => events.push({ outlet: i, m }));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, events, send };
}

describe('display batch: led', () => {
  it('builds headless with el === undefined and one control inlet/outlet', () => {
    const { node } = build('led');
    expect(node.el).toBeUndefined();
    expect(node.controlIns).toHaveLength(1);
  });

  it('a number sets the state (clamped to 0/1) and emits it', () => {
    const { events, send } = build('led');
    send([5]); // nonzero -> 1
    send([0]); // zero -> 0
    send([-3]); // nonzero -> 1
    expect(events).toEqual([
      { outlet: 0, m: [1] },
      { outlet: 0, m: [0] },
      { outlet: 0, m: [1] },
    ]);
  });

  it('a bang re-outputs the stored state without changing it', () => {
    const { events, send } = build('led');
    send([7]); // -> 1
    send(bang); // re-emit 1
    send(bang); // still 1
    expect(events).toEqual([
      { outlet: 0, m: [1] },
      { outlet: 0, m: [1] },
      { outlet: 0, m: [1] },
    ]);
  });
});

describe('display batch: passive objects (comment / panel / hint / bgcolor)', () => {
  for (const [name, inlets] of [['comment', 1], ['panel', 1], ['hint', 1], ['bgcolor', 4]] as const) {
    it(`${name} builds headless with el === undefined, matching inlet arity, and emits nothing`, () => {
      const { node, events, send } = build(name, 128, 64, 32, 255);
      expect(node.el).toBeUndefined();
      expect(node.controlIns).toHaveLength(inlets);
      // Sending into any inlet must not crash and must not emit (no outlets).
      for (let i = 0; i < inlets; i++) send([1], i);
      send(bang);
      expect(events).toEqual([]);
    });
  }
});
