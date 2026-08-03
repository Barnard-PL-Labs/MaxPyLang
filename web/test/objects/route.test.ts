import { afterEach, describe, expect, it } from 'vitest';
import '../../src/objects/control/route'; // register the "route" batch only
import { getFactory } from '../../src/engine/registry';
import { buses } from '../../src/runtime/buses';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext; // control objects ignore the audio context

// Build a route object and capture the messages leaving each outlet it emits on.
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
const bang: Msg = ['bang'];

afterEach(() => buses.clear()); // isolate bus state between tests

describe('route batch', () => {
  it('send broadcasts to every receive on the same name', () => {
    const r1 = build('receive', 'foo');
    r1.capture(0);
    const r2 = build('r', 'foo'); // alias
    r2.capture(0);
    const rOther = build('receive', 'bar');
    rOther.capture(0);

    const s = build('send', 'foo');
    s.send([1, 2, 3]);

    expect(r1.outs[0]).toEqual([[1, 2, 3]]);
    expect(r2.outs[0]).toEqual([[1, 2, 3]]); // alias `r` also received
    expect(rOther.outs[0]).toEqual([]); // different name, untouched
  });

  it('`s` alias broadcasts too, and a bang carries through', () => {
    const r = build('receive', 'ping');
    r.capture(0);
    const s = build('s', 'ping');
    s.send(bang);
    expect(r.outs[0]).toEqual([bang]);
  });

  it('receive re-targets on a `set <name>` message', () => {
    const r = build('receive', 'a');
    r.capture(0);

    build('send', 'a').send([10]);
    expect(r.outs[0]).toEqual([[10]]);

    r.send(['set', 'b']); // now listen to `b` instead of `a`
    build('send', 'a').send([20]); // old name: ignored
    build('send', 'b').send([30]); // new name: received
    expect(r.outs[0]).toEqual([[10], [30]]);
  });

  it('receive.dispose unsubscribes from the bus', () => {
    const r = build('receive', 'gone');
    r.capture(0);
    r.node.dispose?.();
    build('send', 'gone').send([1]);
    expect(r.outs[0]).toEqual([]);
  });

  it('forward routes to its arg target and re-targets on a `send <name>` message', () => {
    const toX = build('receive', 'x');
    toX.capture(0);
    const toY = build('receive', 'y');
    toY.capture(0);

    const f = build('forward', 'x');
    f.send([1, 2]); // forwarded to `x`
    expect(toX.outs[0]).toEqual([[1, 2]]);

    f.send(['send', 'y', 9, 9]); // switch target to `y`, forwarding [9,9]
    expect(toY.outs[0]).toEqual([[9, 9]]);

    f.send([7]); // now goes to `y`
    expect(toY.outs[0]).toEqual([[9, 9], [7]]);
    expect(toX.outs[0]).toEqual([[1, 2]]); // x saw nothing more
  });

  it('buddy holds each inlet until all have fired, then releases together', () => {
    const b = build('buddy'); // default 2 inlets
    b.capture(0);
    b.capture(1);

    b.send([11], 0); // only inlet 0 so far -> nothing out
    expect(b.outs[0]).toEqual([]);
    expect(b.outs[1]).toEqual([]);

    b.send([22], 1); // both inlets ready -> release both
    expect(b.outs[0]).toEqual([[11]]);
    expect(b.outs[1]).toEqual([[22]]);

    // re-arms: a lone inlet again produces nothing until its partner fires
    b.send([33], 1);
    expect(b.outs[1]).toEqual([[22]]);
    b.send([44], 0);
    expect(b.outs[0]).toEqual([[11], [44]]);
    expect(b.outs[1]).toEqual([[22], [33]]);
  });
});
