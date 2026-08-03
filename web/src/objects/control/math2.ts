// Control-domain math objects (BATCH "math2"): the inverse/hyperbolic trig family
// (radians), integer bitwise AND/OR, and the canonical binary-math class names
// div/minus/modulo that sit behind the / - % aliases.
//
// This module is self-registering: importing it runs the top-level register(...)
// calls. It touches NO shared file — it only reads the stable contracts (registry,
// outlets, atoms). Mirrors the reference pattern in control/math.ts.
//
// Conventions (identical to control/math.ts):
//   • Unary: a number transforms + outputs; a bang re-outputs the last input.
//   • Binary: the LEFT inlet triggers op(left, operand); the RIGHT inlet (or the
//     creation arg) stores the operand; a bang at the left inlet re-fires.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { firstNum, isBang, type Atom } from '../../runtime/atoms';

// ── Unary functions (1 inlet, 1 outlet) ───────────────────────────────────────

/** A number transforms and outputs; a bang re-outputs the last stored input. */
function makeUnary(fn: (x: number) => number) {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    let last = num(args[0], 0);
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          const n = firstNum(m);
          if (n !== undefined) { last = n; o.emit(0, [fn(last)]); }
          else if (isBang(m)) o.emit(0, [fn(last)]);
        },
      ],
      onControlOut: o.onControlOut,
    };
  };
}

// Inverse trig (result in radians).
register('acos', makeUnary(Math.acos));
register('asin', makeUnary(Math.asin));
register('atan', makeUnary(Math.atan));

// Hyperbolic and inverse-hyperbolic.
register('cosh', makeUnary(Math.cosh));
register('sinh', makeUnary(Math.sinh));
register('tanh', makeUnary(Math.tanh));
register('acosh', makeUnary(Math.acosh));
register('asinh', makeUnary(Math.asinh));
register('atanh', makeUnary(Math.atanh));

// ── Binary ops (2 inlets, 1 outlet) ───────────────────────────────────────────

/** left inlet triggers op(left, operand); right inlet stores operand; bang re-fires. */
function makeBinary(op: (left: number, operand: number) => number, operandDefault = 0) {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    let operand = num(args[0], operandDefault);
    let left = 0;
    const fire = () => o.emit(0, [op(left, operand)]);
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          const n = firstNum(m);
          if (n !== undefined) { left = n; fire(); }
          else if (isBang(m)) fire();
        },
        (m) => { const n = firstNum(m); if (n !== undefined) operand = n; },
      ],
      onControlOut: o.onControlOut,
    };
  };
}

// atan2 : left inlet = y, right inlet (arg) = x. Output = atan2(y, x) in radians.
register('atan2', makeBinary((y, x) => Math.atan2(y, x)));

// Bitwise AND/OR — operands are truncated to integers (JS bitwise coerce to int32).
const bitand = makeBinary((a, b) => (a | 0) & (b | 0));
const bitor = makeBinary((a, b) => (a | 0) | (b | 0));
register('bitand', bitand);
register('&', bitand);
register('bitor', bitor);
register('|', bitor);

// Canonical binary-math class names (the / - % aliases already live in control/index.ts).
// div and modulo guard divide-by-zero exactly like / and % there.
register('minus', makeBinary((a, b) => a - b));
register('div', makeBinary((a, b) => (b === 0 ? 0 : a / b)));
register('modulo', makeBinary((a, b) => (b === 0 ? 0 : a % b)));
