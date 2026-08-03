// Control-domain math objects (BATCH "math"): reverse/binary arithmetic, boolean
// comparators, logical AND/OR, unary transcendental/rounding functions, the
// two-outlet maximum/minimum comparators, and a small `expr` evaluator.
//
// This module is self-registering: importing it runs the top-level register(...)
// calls. It intentionally touches NO shared file — it only reads the stable
// contracts (registry, outlets, atoms). See control/index.ts for the reference
// pattern this mirrors.
//
// Binary-op convention (like +,-,*,/ in control/index.ts): the LEFT inlet triggers
// output, the RIGHT inlet (or the creation arg) stores the operand, a bang at the
// left inlet re-outputs with the last left value.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { firstNum, isBang, type Atom, type Msg } from '../../runtime/atoms';

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

// Reverse arithmetic: operand OP left (the operand is on the left of the operator).
const rminus = makeBinary((left, operand) => operand - left);
const rdiv = makeBinary((left, operand) => (left === 0 ? 0 : operand / left));
register('!-', rminus);
register('rminus', rminus);
register('!/', rdiv);
register('rdiv', rdiv);

// Comparators -> 1/0.
const bool = (b: boolean) => (b ? 1 : 0);
const equals = makeBinary((a, b) => bool(a === b));
const notequals = makeBinary((a, b) => bool(a !== b));
const greaterthan = makeBinary((a, b) => bool(a > b));
const lessthan = makeBinary((a, b) => bool(a < b));
const greaterthaneq = makeBinary((a, b) => bool(a >= b));
const lessthaneq = makeBinary((a, b) => bool(a <= b));
register('==', equals);
register('equals', equals);
register('!=', notequals);
register('notequals', notequals);
register('>', greaterthan);
register('greaterthan', greaterthan);
register('<', lessthan);
register('lessthan', lessthan);
register('>=', greaterthaneq);
register('greaterthaneq', greaterthaneq);
register('<=', lessthaneq);
register('lessthaneq', lessthaneq);

// Logical AND/OR (nonzero == true) -> 1/0.
const logand = makeBinary((a, b) => bool(a !== 0 && b !== 0));
const logor = makeBinary((a, b) => bool(a !== 0 || b !== 0));
register('&&', logand);
register('logand', logand);
register('||', logor);
register('logor', logor);

// pow: left^operand (operand is the exponent, default 0 -> anything^0 = 1).
register('pow', makeBinary((base, exp) => Math.pow(base, exp)));

// round: round the left value to the nearest multiple set by the arg / right inlet.
// A multiple of 0 (the default) rounds to the nearest integer.
register('round', makeBinary((x, mult) => (mult === 0 ? Math.round(x) : Math.round(x / mult) * mult), 0));

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
register('sqrt', makeUnary(Math.sqrt));
register('abs', makeUnary(Math.abs));
register('sin', makeUnary(Math.sin));
register('cos', makeUnary(Math.cos));
register('tan', makeUnary(Math.tan));

// ── maximum / minimum (2 inlets, 2 outlets) ───────────────────────────────────

// Left inlet triggers, right inlet stores the comparison value (also the arg).
// Outlet 0: the winning (max/min) value. Outlet 1: its index (0 = left, 1 = stored).
// Faithful to Max's right-to-left firing: outlet 1 fires before outlet 0.
function makeCompare(pick: (left: number, other: number) => boolean) {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    let operand = num(args[0], 0);
    let left = 0;
    const fire = () => {
      const leftWins = pick(left, operand);
      const value = leftWins ? left : operand;
      o.emit(1, [leftWins ? 0 : 1]);
      o.emit(0, [value]);
    };
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
// `>=` so that on a tie the left value is reported as the winner (index 0).
register('maximum', makeCompare((left, other) => left >= other));
register('minimum', makeCompare((left, other) => left <= other));

// ── expr : a small shunting-yard arithmetic evaluator ─────────────────────────
//
// NOTE: the manifest lists expr as 0/0 (its real arity is expression-dependent and
// the generator can't know it). We deviate deliberately and give it as many control
// inlets as the highest $i/$f variable index (min 1) plus one control outlet, which
// is what makes the object actually usable. Supports + - * / % ^, parentheses, unary
// minus, numbers, and $iN/$fN variables ($iN truncates the stored inlet value).

type Tok = { t: 'num'; v: number } | { t: 'var'; kind: 'i' | 'f'; idx: number }
  | { t: 'op'; v: string } | { t: 'lp' } | { t: 'rp' };

function tokenizeExpr(src: string): Tok[] {
  const toks: Tok[] = [];
  const re = /\s*(?:(\d*\.?\d+)|(\$[if]\d+)|([+\-*/%^()]))/y;
  let m: RegExpExecArray | null;
  let pos = 0;
  while (pos < src.length) {
    re.lastIndex = pos;
    m = re.exec(src);
    if (!m) break;
    pos = re.lastIndex;
    if (m[1] !== undefined) toks.push({ t: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) toks.push({ t: 'var', kind: m[2][1] as 'i' | 'f', idx: Number(m[2].slice(2)) - 1 });
    else if (m[3] === '(') toks.push({ t: 'lp' });
    else if (m[3] === ')') toks.push({ t: 'rp' });
    else if (m[3] !== undefined) toks.push({ t: 'op', v: m[3] });
  }
  return toks;
}

const PREC: Record<string, number> = { '+': 2, '-': 2, '*': 3, '/': 3, '%': 3, '^': 4, 'u-': 5 };
const RIGHT = new Set(['^', 'u-']);

/** Evaluate a tokenized expression, resolving variables via `read(idx, kind)`. */
function evalExpr(toks: Tok[], read: (idx: number, kind: 'i' | 'f') => number): number {
  const output: number[] = [];
  const ops: string[] = [];
  const apply = (op: string) => {
    if (op === 'u-') { output.push(-(output.pop() ?? 0)); return; }
    const b = output.pop() ?? 0;
    const a = output.pop() ?? 0;
    switch (op) {
      case '+': output.push(a + b); break;
      case '-': output.push(a - b); break;
      case '*': output.push(a * b); break;
      case '/': output.push(b === 0 ? 0 : a / b); break;
      case '%': output.push(b === 0 ? 0 : a % b); break;
      case '^': output.push(Math.pow(a, b)); break;
    }
  };
  let prevWasValue = false; // to distinguish unary from binary minus
  for (const tk of toks) {
    if (tk.t === 'num') { output.push(tk.v); prevWasValue = true; }
    else if (tk.t === 'var') { output.push(read(tk.idx, tk.kind)); prevWasValue = true; }
    else if (tk.t === 'lp') { ops.push('('); prevWasValue = false; }
    else if (tk.t === 'rp') {
      while (ops.length && ops[ops.length - 1] !== '(') apply(ops.pop()!);
      ops.pop(); // discard '('
      prevWasValue = true;
    } else {
      let op = tk.v;
      if (op === '-' && !prevWasValue) op = 'u-';
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top === '(') break;
        if (PREC[top] > PREC[op] || (PREC[top] === PREC[op] && !RIGHT.has(op))) apply(ops.pop()!);
        else break;
      }
      ops.push(op);
      prevWasValue = false;
    }
  }
  while (ops.length) apply(ops.pop()!);
  return output.pop() ?? 0;
}

register('expr', (args) => {
  const o = makeOutlets();
  const src = args.map((a) => String(a)).join(' ');
  const toks = tokenizeExpr(src);
  const maxIdx = toks.reduce((mx, tk) => (tk.t === 'var' ? Math.max(mx, tk.idx) : mx), 0);
  const numInlets = Math.max(1, maxIdx + 1);
  const stored: number[] = new Array(numInlets).fill(0);
  const read = (idx: number, kind: 'i' | 'f') => {
    const v = stored[idx] ?? 0;
    return kind === 'i' ? Math.trunc(v) : v;
  };
  const fire = () => o.emit(0, [evalExpr(toks, read)]);
  const controlIns: (((m: Msg) => void) | undefined)[] = [];
  for (let i = 0; i < numInlets; i++) {
    const inlet = i;
    controlIns[i] = (m) => {
      const n = firstNum(m);
      if (n !== undefined) { stored[inlet] = n; if (inlet === 0) fire(); }
      else if (isBang(m) && inlet === 0) fire();
    };
  }
  return {
    signalIns: [],
    signalOuts: [],
    controlIns,
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
