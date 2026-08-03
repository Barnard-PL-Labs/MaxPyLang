import { describe, expect, it } from 'vitest';
import '../../src/objects/control/math'; // direct import — isolates from other batches
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext;
const bang: Msg = ['bang'];

// Build a control object; capture messages leaving a chosen outlet (default 0).
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const out: Msg[] = [];
  node.onControlOut?.(0, (m) => out.push(m));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  const vals = () => out.map((m) => m[0]);
  const onOutlet = (outlet: number) => {
    const captured: Msg[] = [];
    node.onControlOut?.(outlet, (m) => captured.push(m));
    return captured;
  };
  return { node, out, vals, send, onOutlet };
}

describe('reverse arithmetic', () => {
  it('!- computes operand - left', () => {
    const { vals, send } = build('!-', 10);
    send([3]);            // 10 - 3
    send([7], 1);         // store new operand
    send([2]);            // 7 - 2
    expect(vals()).toEqual([7, 5]);
  });

  it('!/ computes operand / left, guarding divide-by-zero', () => {
    const { vals, send } = build('!/', 12);
    send([4]);            // 12 / 4
    send([0]);            // guarded -> 0
    expect(vals()).toEqual([3, 0]);
  });
});

describe('comparators output 1/0', () => {
  it('== and != against the stored operand', () => {
    const eq = build('==', 5);
    eq.send([5]); eq.send([6]);
    expect(eq.vals()).toEqual([1, 0]);
    const ne = build('!=', 5);
    ne.send([5]); ne.send([6]);
    expect(ne.vals()).toEqual([0, 1]);
  });

  it('> < >= <=', () => {
    const gt = build('>', 5); gt.send([6]); gt.send([5]);
    expect(gt.vals()).toEqual([1, 0]);
    const lt = build('<', 5); lt.send([4]); lt.send([5]);
    expect(lt.vals()).toEqual([1, 0]);
    const ge = build('>=', 5); ge.send([5]); ge.send([4]);
    expect(ge.vals()).toEqual([1, 0]);
    const le = build('<=', 5); le.send([5]); le.send([6]);
    expect(le.vals()).toEqual([1, 0]);
  });

  it('&& and ||', () => {
    const and = build('&&', 1); and.send([1]); and.send([0]);
    expect(and.vals()).toEqual([1, 0]);
    const or = build('||', 0); or.send([1]); or.send([0]);
    expect(or.vals()).toEqual([1, 0]);
  });
});

describe('pow and round', () => {
  it('pow raises left to the operand', () => {
    const { vals, send } = build('pow', 2);
    send([3]);            // 3^2
    send([3], 1);         // exponent 3
    send([2]);            // 2^3
    expect(vals()).toEqual([9, 8]);
  });

  it('round to nearest integer (default) and to a multiple', () => {
    const dflt = build('round');
    dflt.send([2.4]); dflt.send([2.6]);
    expect(dflt.vals()).toEqual([2, 3]);
    const m = build('round', 5);
    m.send([12]); m.send([13]);
    expect(m.vals()).toEqual([10, 15]);
  });

  it('a bang re-outputs the last binary result', () => {
    const { vals, send } = build('pow', 2);
    send([4]);            // 16
    send(bang);           // re-fire -> 16
    expect(vals()).toEqual([16, 16]);
  });
});

describe('unary functions', () => {
  it('sqrt, abs', () => {
    const s = build('sqrt'); s.send([9]);
    expect(s.vals()).toEqual([3]);
    const a = build('abs'); a.send([-4]); a.send([4]);
    expect(a.vals()).toEqual([4, 4]);
  });

  it('sin/cos/tan in radians, bang re-outputs', () => {
    const c = build('cos'); c.send([0]);
    expect(c.out[0][0]).toBeCloseTo(1, 10);
    const s = build('sin'); s.send([Math.PI / 2]);
    expect(s.out[0][0]).toBeCloseTo(1, 10);
    const t = build('tan'); t.send([0]); t.send(bang);
    expect(t.vals()).toEqual([0, 0]);
  });
});

describe('maximum / minimum', () => {
  it('maximum outputs the larger value (outlet 0) and index (outlet 1)', () => {
    const { vals, send, onOutlet } = build('maximum', 5);
    const idx = onOutlet(1);
    send([8]);            // 8 > 5 -> value 8, index 0
    send([2]);            // 2 < 5 -> value 5, index 1
    expect(vals()).toEqual([8, 5]);
    expect(idx.map((m) => m[0])).toEqual([0, 1]);
  });

  it('minimum outputs the smaller value; right inlet stores', () => {
    const { vals, send } = build('minimum', 5);
    send([8]);            // min(8,5) = 5
    send([2], 1);         // store operand 2
    send([8]);            // min(8,2) = 2
    expect(vals()).toEqual([5, 2]);
  });
});

describe('expr shunting-yard evaluator', () => {
  it('evaluates $f1 * 2 + $f2 with left inlet triggering', () => {
    const node = getFactory('expr')!(['$f1', '*', 2, '+', '$f2'], { ctx });
    const out: Msg[] = [];
    node.onControlOut!(0, (m) => out.push(m));
    node.controlIns![1]!([10]); // store $f2 = 10 (no output)
    node.controlIns![0]!([3]);  // trigger: 3*2 + 10
    expect(out.map((m) => m[0])).toEqual([16]);
  });

  it('respects precedence, parentheses, and unary minus', () => {
    const node = getFactory('expr')!(['(', '$f1', '+', 1, ')', '*', '-2'], { ctx });
    const out: Msg[] = [];
    node.onControlOut!(0, (m) => out.push(m));
    node.controlIns![0]!([4]); // (4+1) * -2 = -10
    expect(out[0][0]).toBe(-10);
  });

  it('$i truncates the stored inlet value', () => {
    const node = getFactory('expr')!(['$i1', '+', 1], { ctx });
    const out: Msg[] = [];
    node.onControlOut!(0, (m) => out.push(m));
    node.controlIns![0]!([2.9]); // trunc(2.9)+1 = 3
    expect(out[0][0]).toBe(3);
  });
});
