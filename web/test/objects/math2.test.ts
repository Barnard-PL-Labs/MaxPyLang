import { describe, expect, it } from 'vitest';
import '../../src/objects/control/math2'; // direct import — isolates from other batches
import { getFactory } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';

const ctx = {} as BaseAudioContext;
const bang: Msg = ['bang'];

// Build a control object; capture messages leaving outlet 0.
function build(className: string, ...args: (number | string)[]) {
  const node = getFactory(className)!(args, { ctx });
  const out: Msg[] = [];
  node.onControlOut?.(0, (m) => out.push(m));
  const send = (m: Msg, inlet = 0) => node.controlIns?.[inlet]?.(m);
  const vals = () => out.map((m) => m[0] as number);
  return { node, out, vals, send };
}

describe('inverse trig (radians)', () => {
  it('acos(1)=0, acos(0)=PI/2', () => {
    const a = build('acos'); a.send([1]); a.send([0]);
    expect(a.out[0][0]).toBeCloseTo(0, 10);
    expect(a.out[1][0]).toBeCloseTo(Math.PI / 2, 10);
  });

  it('asin(1)=PI/2', () => {
    const a = build('asin'); a.send([1]);
    expect(a.out[0][0]).toBeCloseTo(Math.PI / 2, 10);
  });

  it('atan(1)=PI/4, bang re-outputs', () => {
    const a = build('atan'); a.send([1]); a.send(bang);
    expect(a.out[0][0]).toBeCloseTo(Math.PI / 4, 10);
    expect(a.out[1][0]).toBeCloseTo(Math.PI / 4, 10);
  });
});

describe('hyperbolic functions', () => {
  it('cosh(0)=1, sinh(0)=0, tanh(0)=0', () => {
    const c = build('cosh'); c.send([0]);
    expect(c.out[0][0]).toBeCloseTo(1, 10);
    const s = build('sinh'); s.send([0]);
    expect(s.out[0][0]).toBeCloseTo(0, 10);
    const t = build('tanh'); t.send([0]);
    expect(t.out[0][0]).toBeCloseTo(0, 10);
  });

  it('inverse hyperbolic invert their partners', () => {
    const ac = build('acosh'); ac.send([Math.cosh(1.5)]);
    expect(ac.out[0][0]).toBeCloseTo(1.5, 10);
    const as = build('asinh'); as.send([Math.sinh(0.7)]);
    expect(as.out[0][0]).toBeCloseTo(0.7, 10);
    const at = build('atanh'); at.send([Math.tanh(0.3)]);
    expect(at.out[0][0]).toBeCloseTo(0.3, 10);
  });
});

describe('atan2', () => {
  it('left inlet = y, right inlet (arg) = x', () => {
    const a = build('atan2', 1); // x = 1
    a.send([1]);                 // atan2(1, 1) = PI/4
    a.send([0], 1);              // store x = 0
    a.send([1]);                 // atan2(1, 0) = PI/2
    expect(a.out[0][0]).toBeCloseTo(Math.PI / 4, 10);
    expect(a.out[1][0]).toBeCloseTo(Math.PI / 2, 10);
  });
});

describe('bitwise', () => {
  it('bitand / & computes integer AND', () => {
    const b = build('bitand', 6); // 0b110
    b.send([5]);                  // 0b101 & 0b110 = 0b100 = 4
    expect(b.vals()).toEqual([4]);
    const amp = build('&', 3);
    amp.send([6]);                // 6 & 3 = 2
    expect(amp.vals()).toEqual([2]);
  });

  it('bitor / | computes integer OR; truncates floats', () => {
    const b = build('bitor', 1);
    b.send([4]);                  // 4 | 1 = 5
    b.send([2.9]);                // trunc -> 2 | 1 = 3
    expect(b.vals()).toEqual([5, 3]);
    const pipe = build('|', 8);
    pipe.send([1]);               // 1 | 8 = 9
    expect(pipe.vals()).toEqual([9]);
  });
});

describe('canonical binary math (div/minus/modulo)', () => {
  it('minus subtracts the stored operand', () => {
    const m = build('minus', 3);
    m.send([10]);                 // 10 - 3
    m.send([5], 1);               // store operand 5
    m.send([10]);                 // 10 - 5
    expect(m.vals()).toEqual([7, 5]);
  });

  it('div divides, guarding divide-by-zero, bang re-fires', () => {
    const d = build('div', 4);
    d.send([12]);                 // 12 / 4 = 3
    d.send([0], 1);               // store 0
    d.send([9]);                  // guarded -> 0
    d.send(bang);                 // re-fire -> 0
    expect(d.vals()).toEqual([3, 0, 0]);
  });

  it('modulo takes remainder, guarding zero', () => {
    const m = build('modulo', 3);
    m.send([7]);                  // 7 % 3 = 1
    m.send([0], 1);               // store 0
    m.send([7]);                  // guarded -> 0
    expect(m.vals()).toEqual([1, 0]);
  });
});
