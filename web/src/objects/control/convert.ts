// Control-domain conversion objects: unit/format converters that take a message on
// an inlet and emit a transformed message. Same contract as control/index.ts —
// self-registering via top-level register(...) calls, one makeOutlets() per object,
// controlIns[i] handlers receiving a Msg, and an onControlOut fan-out.
//
// Batch "convert": ftom atodb dbtoa itoa atoi tosymbol fromsymbol zmap
// (sprintf and regexp are intentionally left as Tier-A stubs — see notes below).

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { firstNum, isBang, type Atom, type Msg } from '../../runtime/atoms';

// ── Simple unary number → number converters ──────────────────────────────────

/** Build a 1-in/1-out object that maps a single incoming number through `fn`. */
function makeUnary(fn: (n: number) => number) {
  return (): MaxNode => {
    const o = makeOutlets();
    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [(m) => { const n = firstNum(m); if (n !== undefined) o.emit(0, [fn(n)]); }],
      onControlOut: o.onControlOut,
    };
  };
}

// ftom : frequency (Hz) → MIDI note number. Inverse of mtof (A4 = 440 Hz = 69).
// Max rounds to the nearest integer note by default.
register('ftom', makeUnary((f) => (f <= 0 ? 0 : Math.round(69 + 12 * Math.log2(f / 440)))));

// atodb : linear amplitude → decibels. 1.0 → 0 dB. Zero/negative amplitude clamps
// to a large negative floor instead of -Infinity.
register('atodb', makeUnary((a) => (a <= 0 ? -180 : 20 * Math.log10(a))));

// dbtoa : decibels → linear amplitude. 0 dB → 1.0. Inverse of atodb.
register('dbtoa', makeUnary((db) => Math.pow(10, db / 20)));

// ── ASCII ⟷ integer ──────────────────────────────────────────────────────────

// itoa : list of integer char codes → a symbol of the corresponding characters.
// e.g. [72 73] → "HI". 3 inlets in the manifest (inlets 1/2 tune buffer size in
// Max); the prototype only acts on the left inlet.
register('itoa', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const codes: number[] = [];
        for (const a of m) {
          const n = typeof a === 'number' ? a : Number(a);
          if (Number.isFinite(n)) codes.push(n & 0xff);
        }
        o.emit(0, [String.fromCharCode(...codes)]);
      },
      () => {},
      () => {},
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// atoi : a symbol → the list of ASCII char codes of its characters.
// e.g. "HI" → [72 73]. Inverse of itoa. 3 inlets to match the manifest.
register('atoi', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        const s = m.map((a) => (typeof a === 'number' ? String(a) : a)).join(' ');
        const codes: Atom[] = [];
        for (let i = 0; i < s.length; i++) codes.push(s.charCodeAt(i));
        o.emit(0, codes);
      },
      () => {},
      () => {},
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── symbol ⟷ message ──────────────────────────────────────────────────────────

// tosymbol : collapse a whole message into a single symbol (atoms joined by spaces).
// e.g. [1 2 3] → "1 2 3", [5] → "5". A bang passes through as the symbol "bang".
register('tosymbol', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => {
      if (m.length === 0) return;
      o.emit(0, [m.join(' ')]);
    }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// fromsymbol : parse a symbol into a message, splitting on whitespace and turning
// numeric tokens into numbers. e.g. "1 2 foo" → [1, 2, "foo"].
register('fromsymbol', () => {
  const o = makeOutlets();
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [(m) => {
      const s = m.map((a) => String(a)).join(' ').trim();
      if (s === '') return;
      const out: Atom[] = s.split(/\s+/).map((tok) => {
        const n = Number(tok);
        return tok !== '' && Number.isFinite(n) ? n : tok;
      });
      o.emit(0, out);
    }],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// ── zmap ──────────────────────────────────────────────────────────────────────

// zmap <inLo> <inHi> <outLo> <outHi> : like scale, but the input is first CLAMPED to
// the input range before the linear remap (values outside the range map to the
// endpoints, never beyond). Inlets 1..4 set the four range bounds live.
register('zmap', (args) => {
  const o = makeOutlets();
  let inLo = num(args[0], 0);
  let inHi = num(args[1], 127);
  let outLo = num(args[2], 0);
  let outHi = num(args[3], 1);
  const map = (n: number): number => {
    const lo = Math.min(inLo, inHi);
    const hi = Math.max(inLo, inHi);
    const clamped = n < lo ? lo : n > hi ? hi : n;
    const span = inHi - inLo || 1;
    return outLo + ((clamped - inLo) / span) * (outHi - outLo);
  };
  let last = 0;
  const set = (store: (v: number) => void) => (m: Msg) => { const v = firstNum(m); if (v !== undefined) store(v); };
  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { o.emit(0, [map(last)]); return; }
        const n = firstNum(m);
        if (n !== undefined) { last = n; o.emit(0, [map(n)]); }
      },
      set((v) => { inLo = v; }),
      set((v) => { inHi = v; }),
      set((v) => { outLo = v; }),
      set((v) => { outHi = v; }),
    ],
    onControlOut: o.onControlOut,
  } satisfies MaxNode;
});

// sprintf and regexp are left as Tier-A stubs on purpose:
//   • sprintf — the manifest lists it with 0 inlets and 0 outlets, so there is no
//     port to bind a format-string implementation to.
//   • regexp — faithful behaviour needs a substitution engine driving 5 distinct
//     outlets (match / prefix / suffix / groups); out of scope for this prototype.
