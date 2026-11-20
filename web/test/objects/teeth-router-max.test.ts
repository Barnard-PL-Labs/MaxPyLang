// teeth~, router, umenu and tab, checked against Max's own reference pages.
// (teeth~'s delay times are checked in test/browser/teeth.test.ts: an impulse
// delayed by N ms lands N * 44.1 samples later.)
import { describe, expect, it } from 'vitest';
import '../../src/objects/audio/filters';
import '../../src/objects/control/logic';
import '../../src/objects/ui/menus';
import { getFactory } from '../../src/engine/registry';
import { parseMaxPat } from '../../src/parser/maxpat';
import type { Atom, Msg } from '../../src/runtime/atoms';

const audio = new (globalThis as any).OfflineAudioContext(2, 128, 44100) as BaseAudioContext;
const ctx = {} as BaseAudioContext;
const val = (p: unknown) => (p as { value: number }).value;

function run(className: string, args: Atom[], node?: ReturnType<typeof parseMaxPat>['nodes'][number]) {
  const obj = getFactory(className)!(args, { ctx, node });
  const events: { outlet: number; m: Msg }[] = [];
  for (let i = 0; i < 8; i++) obj.onControlOut?.(i, (m) => events.push({ outlet: i, m }));
  const send = (m: Msg, inlet = 0) => obj.controlIns?.[inlet]?.(m);
  return { obj, events, send };
}

/** Build a UI box from the exact box dict maxpylang (or Max) writes. */
function fromBox(box: Record<string, unknown>) {
  const patch = parseMaxPat({ patcher: { boxes: [{ box: { id: 'obj-1', ...box } }], lines: [] } });
  const node = patch.nodes[0];
  return run(node.className, node.args as Atom[], node);
}

describe('teeth~ (Max: args are max delay ms, FF ms, FB ms, a, b, c)', () => {
  it('reads the gains from args 4-6, defaulting to 0', () => {
    const t = getFactory('teeth~')!([50, 5, 5, 0.5, 0.3, 0.9], { ctx: audio });
    expect(val(t.signalIns[3])).toBe(0.5);
    expect(val(t.signalIns[4])).toBeCloseTo(0.3, 6);
    expect(val(t.signalIns[5])).toBeCloseTo(0.9, 6);
    const d = getFactory('teeth~')!([], { ctx: audio });
    expect([3, 4, 5].map((i) => val(d.signalIns[i]))).toEqual([0, 0, 0]);
  });

  it('takes all five parameters as a list in the left inlet', () => {
    const t = getFactory('teeth~')!([50], { ctx: audio });
    t.controlIns![0]!([3, 4, 0.25, 0.5, 0.75]);
    expect(val(t.signalIns[3])).toBe(0.25);
    expect(val(t.signalIns[4])).toBe(0.5);
    expect(val(t.signalIns[5])).toBe(0.75);
  });

  it('has six inlets and one signal outlet', () => {
    const t = getFactory('teeth~')!([10, 10, 10, 0.5, 0.5, 0.5], { ctx: audio });
    expect(t.signalIns.length).toBe(6);
    expect(t.signalOuts.length).toBe(1);
  });
});

describe('router (Max numbers data inlets and outlets from 0)', () => {
  it('a list "in out state" connects and disconnects', () => {
    const { events, send } = run('router', [2, 2]);
    send([0, 0, 1]);
    send([1, 1, 1]);
    send(['hello'], 1); // data inlet 0 is the box's second inlet
    send([7], 2); // data inlet 1
    send([1, 1, 0]);
    send([8], 2);
    expect(events).toEqual([
      { outlet: 0, m: ['hello'] },
      { outlet: 1, m: [7] },
    ]);
  });

  it('connect / disconnect / clear', () => {
    const { events, send } = run('router', [1, 3]);
    send(['connect', 0, 2]);
    send(['connect', 0, 0]);
    send([5], 1);
    send(['disconnect', 0, 2]);
    send([6], 1);
    send(['clear']);
    send([7], 1);
    expect(events).toEqual([
      { outlet: 2, m: [5] },
      { outlet: 0, m: [5] },
      { outlet: 0, m: [6] },
    ]);
  });

  it('patch connects exclusively: other inlets lose that outlet', () => {
    const { events, send } = run('router', [2, 1]);
    send(['connect', 0, 0]);
    send(['patch', 1, 0]);
    send([1], 1);
    send([2], 2);
    expect(events).toEqual([{ outlet: 0, m: [2] }]);
  });

  it('dump reports "in out 1" out the right (dumpout) outlet', () => {
    const { events, send } = run('router', [2, 2]);
    send(['connect', 1, 0]);
    send(['connect', 0, 1]);
    send(['dump']);
    expect(events).toEqual([
      { outlet: 2, m: [0, 1, 1] },
      { outlet: 2, m: [1, 0, 1] },
    ]);
  });

  it('ignores numbers past the end (so old 1-based "2 2" does nothing on router 2 2)', () => {
    const { events, send } = run('router', [2, 2]);
    send(['connect', 2, 2]);
    send([1], 1);
    send([1], 2);
    expect(events).toEqual([]);
  });
});

describe('umenu items, read the way maxpylang and Max write them', () => {
  it('maxpylang box: text "umenu @items a , b , c", items "<empty>"', () => {
    // exactly what maxpylang's place('umenu @items a , b , c') writes
    const { events, send } = fromBox({
      items: '<empty>', maxclass: 'umenu', numinlets: 1, numoutlets: 3,
      outlettype: ['int', '', ''], parameter_enable: 0, text: 'umenu @items a , b , c',
    });
    send([1]);
    expect(events).toEqual([{ outlet: 1, m: ['b'] }, { outlet: 0, m: [1] }]);
  });

  it('a Max-saved box: items ["red", ",", "dark", "green"] is two items', () => {
    const { events, send } = fromBox({ maxclass: 'umenu', numinlets: 1, numoutlets: 3, items: ['red', ',', 'dark', 'green'] });
    send([5]); // clamped to the last item
    expect(events).toEqual([{ outlet: 1, m: ['dark', 'green'] }, { outlet: 0, m: [1] }]);
  });

  it('a plain maxpylang umenu has no items until append; numbers come out as numbers', () => {
    const { events, send } = fromBox({ items: '<empty>', maxclass: 'umenu', numinlets: 1, numoutlets: 3, text: 'umenu' });
    send([0]);
    expect(events).toEqual([]); // nothing to choose
    send(['append', 60]);
    send(['append', 64]);
    send(['append', 67]);
    send([2]);
    send(['count']);
    expect(events).toEqual([{ outlet: 1, m: [67] }, { outlet: 0, m: [2] }, { outlet: 2, m: ['count', 3] }]);
  });

  it('clear, insert, setitem, delete, set, symbol, next/prev', () => {
    const { events, send } = run('umenu', ['a', 'b', 'c']);
    send(['clear']);
    send(['append', 'x']);
    send(['append', 'z']);
    send(['insert', 1, 'y']); // x y z
    send(['setitem', 0, 'w']); // w y z
    send(['set', 2]); // no output
    send(['next']); // wraps to 0
    send(['symbol', 'y']);
    send(['delete', 0]); // y z
    send(['prev']); // index 1 -> 0
    expect(events).toEqual([
      { outlet: 1, m: ['w'] }, { outlet: 0, m: [0] },
      { outlet: 1, m: ['y'] }, { outlet: 0, m: [1] },
      { outlet: 1, m: ['y'] }, { outlet: 0, m: [0] },
    ]);
  });
});

describe('tab items (the tabs attribute)', () => {
  it("a maxpylang tab (no tabs attribute) has Max's default tabs one two three", () => {
    const { events, send } = fromBox({ maxclass: 'tab', numinlets: 1, numoutlets: 3, parameter_enable: 0, text: 'tab' });
    send([1]);
    expect(events).toEqual([{ outlet: 1, m: ['two'] }, { outlet: 0, m: [1] }]);
  });

  it('a Max-saved box: tabs ["low", "mid", "high"]', () => {
    const { events, send } = fromBox({ maxclass: 'tab', numinlets: 1, numoutlets: 3, tabs: ['low', 'mid', 'high'] });
    send([2]);
    expect(events).toEqual([{ outlet: 1, m: ['high'] }, { outlet: 0, m: [2] }]);
  });

  it('typed text "tab @tabs a b" and the tabs message', () => {
    const { events, send } = fromBox({ maxclass: 'tab', numinlets: 1, numoutlets: 3, text: 'tab @tabs a b' });
    send([1]);
    send(['tabs', 'p', 'q', 'r']);
    send([2]);
    expect(events).toEqual([
      { outlet: 1, m: ['b'] }, { outlet: 0, m: [1] },
      { outlet: 1, m: ['r'] }, { outlet: 0, m: [2] },
    ]);
  });
});
