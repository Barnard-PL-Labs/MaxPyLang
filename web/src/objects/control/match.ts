// Control-domain sequence / aggregation objects (BATCH "match"):
//   match       — fire when the incoming number sequence matches the args
//   combine     — concatenate a message's atoms into one symbol
//   join        — combine the messages held at each inlet into one list
//   split       — partition a number by a [min, max] threshold window
//   spell       — text/number -> stream of ASCII codes
//   listfunnel  — a list -> a series of [index+offset, value] pairs
//   anal        — pair (transition) statistics over a number stream
//
// This module is self-registering: importing it runs the register(...) calls.
// It touches NO shared file — it only reads the stable contracts (registry,
// outlets, atoms). See control/index.ts and control/math.ts for the reference
// pattern this mirrors.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { firstNum, isBang, nums, type Atom, type Msg } from '../../runtime/atoms';

// ── match ─────────────────────────────────────────────────────────────────────
//
// match <a> <b> ...: watch the stream of incoming numbers through a sliding
// window the width of the argument list. When the last N numbers equal the
// arguments (in order), output the matched list, then reset the window. The
// symbol `nn` is a wildcard that matches any single number.
register('match', (args) => {
  const o = makeOutlets();
  const pattern = args.map((a) => (String(a) === 'nn' ? null : num(a, 0)));
  const width = pattern.length;
  const buf: number[] = [];
  const matches = () => pattern.every((p, i) => p === null || p === buf[i]);
  const feed = (n: number) => {
    if (width === 0) return;
    buf.push(n);
    if (buf.length > width) buf.shift();
    if (buf.length === width && matches()) {
      o.emit(0, buf.slice());
      buf.length = 0;
    }
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        for (const n of nums(m)) feed(n);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── combine ───────────────────────────────────────────────────────────────────
//
// combine: concatenate the atoms of the incoming message (prefixed by any
// creation args) into a single symbol, output from the left outlet. The Max
// object builds one inlet per argument segment; here we model the common
// single-inlet concatenation. The right outlet exists for arity but is unused.
register('combine', (args) => {
  const o = makeOutlets();
  const prefix = args.map((a) => String(a)).join('');
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) {
          if (prefix) o.emit(0, [prefix]);
          return;
        }
        const combined = prefix + m.map((a) => String(a)).join('');
        o.emit(0, [combined]);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── join ──────────────────────────────────────────────────────────────────────
//
// join <inlets>: store the message received at each inlet; any inlet receiving
// input (join's default @triggers = all) outputs the concatenation of every
// stored inlet message as one list.
register('join', (args) => {
  const o = makeOutlets();
  const count = Math.max(2, num(args[0], 2));
  const slots: Msg[] = new Array(count).fill(0).map(() => []);
  const fire = () => o.emit(0, ([] as Atom[]).concat(...slots));
  const controlIns: (((m: Msg) => void) | undefined)[] = [];
  for (let i = 0; i < count; i++) {
    const inlet = i;
    controlIns[i] = (m) => {
      slots[inlet] = isBang(m) ? [] : m.slice();
      fire();
    };
  }
  return { signalIns: [], signalOuts: [], controlIns, onControlOut: o.onControlOut } satisfies MaxNode;
});

// ── split ─────────────────────────────────────────────────────────────────────
//
// split <min> <max>: if the incoming number is within [min, max], pass it out
// the left outlet; otherwise pass it out the right outlet. Inlet 1 sets min,
// inlet 2 sets max.
register('split', (args) => {
  const o = makeOutlets();
  let lo = num(args[0], 0);
  let hi = num(args[1], 127);
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const n = firstNum(m);
        if (n === undefined) return;
        if (n >= lo && n <= hi) o.emit(0, [n]);
        else o.emit(1, [n]);
      },
      (m) => { const n = firstNum(m); if (n !== undefined) lo = n; },
      (m) => { const n = firstNum(m); if (n !== undefined) hi = n; },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── spell ─────────────────────────────────────────────────────────────────────
//
// spell [size] [character]: convert the incoming message's text to a list of
// ASCII codes. If `size` > 0, the output list is padded/truncated to that
// length using `character` (default 0) as the pad code.
register('spell', (args) => {
  const o = makeOutlets();
  const size = Math.max(0, Math.trunc(num(args[0], 0)));
  const pad = Math.trunc(num(args[1], 0));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        const text = m.map((a) => String(a)).join(' ');
        let codes: number[] = [];
        for (let i = 0; i < text.length; i++) codes.push(text.charCodeAt(i));
        if (size > 0) {
          if (codes.length > size) codes = codes.slice(0, size);
          else while (codes.length < size) codes.push(pad);
        }
        o.emit(0, codes);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── listfunnel ────────────────────────────────────────────────────────────────
//
// listfunnel [offset]: turn a list into a series of two-element [index, value]
// messages, where index = position + offset.
register('listfunnel', (args) => {
  const o = makeOutlets();
  const offset = Math.trunc(num(args[0], 0));
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        m.forEach((v, i) => o.emit(0, [i + offset, v]));
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── anal ──────────────────────────────────────────────────────────────────────
//
// anal [input-limit]: analyze a stream of numbers, counting how often each
// value follows another. On each incoming number it emits the transition
// [previous, current, count-so-far] — the running pair statistic. A companion
// to `prob`.
register('anal', (args) => {
  const o = makeOutlets();
  const limit = Math.trunc(num(args[0], 0)); // 0 = unbounded
  const counts = new Map<string, number>();
  let prev: number | undefined;
  const feed = (n: number) => {
    const cur = Math.trunc(n);
    if (limit > 0 && (cur < 0 || cur >= limit)) return; // out of range: ignore
    if (prev !== undefined) {
      const key = `${prev},${cur}`;
      const c = (counts.get(key) ?? 0) + 1;
      counts.set(key, c);
      o.emit(0, [prev, cur, c]);
    }
    prev = cur;
  };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) return;
        for (const n of nums(m)) feed(n);
      },
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});
