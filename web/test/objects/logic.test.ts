import { describe, expect, it } from 'vitest';
import '../../src/objects/control/logic'; // direct import — isolate from other batches
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext;
const bang: Msg = ['bang'];

// Build an object and capture every outlet it emits on, in emission order.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const events: { outlet: number; m: Msg }[] = [];
  // subscribe generously to outlets 0..7
  for (let i = 0; i < 8; i++) node.onControlOut?.(i, (m) => events.push({ outlet: i, m }));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  return { node, events, send };
}

describe('logic batch: select / route', () => {
  it('select bangs the matching outlet and passes non-matches through the last', () => {
    const { events, send } = build('select', 1, 2, 3);
    send([2]);
    send([9]);
    expect(events[0]).toEqual({ outlet: 1, m: bang }); // matched selector "2" -> outlet 1
    expect(events[1]).toEqual({ outlet: 3, m: [9] }); // no match -> passthrough (outlet = 3)
  });

  it('select with one selector: right inlet updates the value to match', () => {
    const { events, send } = build('select', 5);
    send([5]);
    send([7], 1); // change selector to 7
    send([7]);
    send([5]);
    expect(events[0]).toEqual({ outlet: 0, m: bang }); // 5 matched initially
    expect(events[1]).toEqual({ outlet: 0, m: bang }); // 7 now matches
    expect(events[2]).toEqual({ outlet: 1, m: [5] }); // 5 no longer matches -> passthrough
  });

  it('sel alias resolves to select', () => {
    expect(getFactory('sel')).toBe(getFactory('select'));
  });

  it('route strips the matched selector and sends the rest', () => {
    const { events, send } = build('route', 'freq', 'amp');
    send(['freq', 440]);
    send(['amp', 0.5]);
    send(['other', 1]);
    expect(events[0]).toEqual({ outlet: 0, m: [440] });
    expect(events[1]).toEqual({ outlet: 1, m: [0.5] });
    expect(events[2]).toEqual({ outlet: 2, m: ['other', 1] }); // non-match -> last outlet, full msg
  });

  it('route sends a bang when only the selector arrives', () => {
    const { events, send } = build('route', 'go');
    send(['go']);
    expect(events[0]).toEqual({ outlet: 0, m: bang });
  });

  it('routepass keeps the selector on the matched outlet', () => {
    const { events, send } = build('routepass', 'freq');
    send(['freq', 440]);
    send(['x', 1]);
    expect(events[0]).toEqual({ outlet: 0, m: ['freq', 440] });
    expect(events[1]).toEqual({ outlet: 1, m: ['x', 1] });
  });
});

describe('logic batch: trigger / bangbang', () => {
  it('trigger fires right-to-left with per-format conversion', () => {
    const { events, send } = build('trigger', 'i', 'b', 'f');
    send([3.7]);
    // rightmost first: outlet 2 (f), outlet 1 (b), outlet 0 (i)
    expect(events.map((e) => e.outlet)).toEqual([2, 1, 0]);
    expect(events[0]).toEqual({ outlet: 2, m: [3.7] }); // float
    expect(events[1]).toEqual({ outlet: 1, m: bang }); // bang
    expect(events[2]).toEqual({ outlet: 0, m: [3] }); // int (truncated)
  });

  it('trigger emits constants verbatim', () => {
    const { events, send } = build('trigger', 'hello', 42);
    send(bang);
    expect(events[0]).toEqual({ outlet: 1, m: [42] });
    expect(events[1]).toEqual({ outlet: 0, m: ['hello'] });
  });

  it('t alias resolves to trigger', () => {
    expect(getFactory('t')).toBe(getFactory('trigger'));
  });

  it('bangbang bangs every outlet right-to-left on any input', () => {
    const { events, send } = build('bangbang', 3);
    send([99]);
    expect(events.map((e) => e.outlet)).toEqual([2, 1, 0]);
    expect(events.every((e) => e.m[0] === 'bang')).toBe(true);
  });
});

describe('logic batch: swap', () => {
  it('swaps left/right values, right-to-left', () => {
    const { events, send } = build('swap', 100);
    send([7]); // left = 7, stored right = 100
    // right outlet (1) gets left value 7 first, then left outlet (0) gets right value 100
    expect(events[0]).toEqual({ outlet: 1, m: [7] });
    expect(events[1]).toEqual({ outlet: 0, m: [100] });
  });

  it('right inlet updates the stored value', () => {
    const { events, send } = build('swap');
    send([2], 1); // store right = 2
    send([9]);
    expect(events[0]).toEqual({ outlet: 1, m: [9] });
    expect(events[1]).toEqual({ outlet: 0, m: [2] });
  });
});

describe('logic batch: gate / switch / gswitch', () => {
  it('gate routes the data inlet to the open outlet', () => {
    const { events, send } = build('gate', 3, 0);
    send([5], 1); // closed -> nothing
    send([2], 0); // open outlet 2
    send([5], 1);
    send([0], 0); // close
    send([5], 1);
    expect(events).toEqual([{ outlet: 1, m: [5] }]); // only while open on outlet 2 (index 1)
  });

  it('switch passes only the selected data inlet', () => {
    const { events, send } = build('switch', 2, 0);
    send([1], 1); // inlet 1 blocked (none selected)
    send([2], 0); // select inlet 2
    send([1], 1); // inlet 1 blocked
    send([9], 2); // inlet 2 passes
    expect(events).toEqual([{ outlet: 0, m: [9] }]);
  });

  it('gswitch toggles active data inlet on bang', () => {
    const { events, send } = build('gswitch');
    send([10], 1); // active 0 -> inlet 1 passes
    send([20], 2); // blocked
    send(bang, 0); // toggle -> active 1
    send([30], 1); // blocked
    send([40], 2); // passes
    expect(events).toEqual([
      { outlet: 0, m: [10] },
      { outlet: 0, m: [40] },
    ]);
  });
});

describe('logic batch: onebang', () => {
  it('passes one bang then closes until re-armed', () => {
    const { events, send } = build('onebang', 1); // start open
    send(bang, 0); // passes -> outlet 0 + reset outlet 1
    send(bang, 0); // closed -> nothing
    send([1], 1); // re-arm
    send(bang, 0); // passes again
    expect(events).toEqual([
      { outlet: 0, m: bang },
      { outlet: 1, m: bang },
      { outlet: 0, m: bang },
      { outlet: 1, m: bang },
    ]);
  });

  it('starts closed by default', () => {
    const { events, send } = build('onebang');
    send(bang, 0);
    expect(events).toEqual([]);
  });
});

describe('logic batch: router', () => {
  it('copies a data inlet to its connected outlets', () => {
    const { events, send } = build('router', 2, 2);
    send([1, 2], 0); // connect data inlet 1 -> outlet 2
    send([42], 1); // inlet 1 data -> outlet 2 (index 1)
    send([99], 2); // inlet 2 unconnected -> nothing
    send([1, 2, 0], 0); // disconnect
    send([42], 1);
    expect(events).toEqual([{ outlet: 1, m: [42] }]);
  });
});
