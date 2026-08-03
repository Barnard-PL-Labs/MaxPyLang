import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../src/objects/control/match'; // self-registering module under test (no glob bootstrap)
import { getFactory } from '../../src/engine/registry';
import { scheduler } from '../../src/runtime/scheduler';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context

function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const outs: Record<number, Msg[]> = {};
  const cap = (outlet: number) => {
    outs[outlet] = [];
    node.onControlOut?.(outlet, (m) => outs[outlet].push(m));
  };
  for (let i = 0; i < 4; i++) cap(i);
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, outs, send };
}

afterEach(() => {
  vi.useRealTimers();
  scheduler.clear();
});

describe('match', () => {
  it('fires the matched list when the sliding window matches the args', () => {
    const { outs, send } = build('match', 1, 2, 3);
    send([9]); // fills window, no match
    send([1]);
    send([2]);
    expect(outs[0]).toEqual([]);
    send([3]); // window is now [1,2,3]
    expect(outs[0]).toEqual([[1, 2, 3]]);
  });

  it('accepts a whole list at once and resets after a match', () => {
    const { outs, send } = build('match', 5, 6);
    send([5, 6, 5, 6]); // two non-overlapping matches
    expect(outs[0]).toEqual([[5, 6], [5, 6]]);
  });

  it('nn is a wildcard matching any number', () => {
    const { outs, send } = build('match', 1, 'nn', 3);
    send([1, 42, 3]);
    expect(outs[0]).toEqual([[1, 42, 3]]);
  });
});

describe('combine', () => {
  it('concatenates a message into a single symbol', () => {
    const { outs, send } = build('combine');
    send(['foo', 'bar']);
    expect(outs[0]).toEqual([['foobar']]);
  });

  it('prefixes creation args', () => {
    const { outs, send } = build('combine', 'a');
    send(['b', 'c']);
    expect(outs[0]).toEqual([['abc']]);
  });
});

describe('join', () => {
  it('concatenates the stored inlet messages; any inlet triggers', () => {
    const { outs, send } = build('join', 2);
    send([3, 4], 1); // store right inlet -> triggers with left still empty
    expect(outs[0]).toEqual([[3, 4]]);
    send([1, 2], 0); // now left [1,2] + right [3,4]
    expect(outs[0]).toEqual([[3, 4], [1, 2, 3, 4]]);
  });
});

describe('split', () => {
  it('routes in-range to left, out-of-range to right', () => {
    const { outs, send } = build('split', 10, 20);
    send([15]);
    send([5]);
    send([25]);
    expect(outs[0]).toEqual([[15]]);
    expect(outs[1]).toEqual([[5], [25]]);
  });

  it('right inlets update the range', () => {
    const { outs, send } = build('split', 0, 0);
    send([50], 1); // min = 50
    send([100], 2); // max = 100
    send([75]);
    expect(outs[0]).toEqual([[75]]);
  });
});

describe('spell', () => {
  it('converts text to ASCII codes', () => {
    const { outs, send } = build('spell');
    send(['AB']);
    expect(outs[0]).toEqual([[65, 66]]);
  });

  it('pads to size with the pad character', () => {
    const { outs, send } = build('spell', 4, 0);
    send(['A']);
    expect(outs[0]).toEqual([[65, 0, 0, 0]]);
  });
});

describe('listfunnel', () => {
  it('emits [index, value] pairs', () => {
    const { outs, send } = build('listfunnel');
    send([10, 20, 30]);
    expect(outs[0]).toEqual([[0, 10], [1, 20], [2, 30]]);
  });

  it('applies the index offset', () => {
    const { outs, send } = build('listfunnel', 5);
    send([10, 20]);
    expect(outs[0]).toEqual([[5, 10], [6, 20]]);
  });
});

describe('anal', () => {
  it('emits [prev, cur, count] transition statistics', () => {
    const { outs, send } = build('anal');
    send([1, 2, 1, 2]);
    expect(outs[0]).toEqual([[1, 2, 1], [2, 1, 1], [1, 2, 2]]);
  });
});
