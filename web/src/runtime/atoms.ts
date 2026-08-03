// The control-domain value type.
//
// A Max "message" is a list of atoms, where an atom is a number or a symbol
// (string). A bang is the symbol `bang`; an int/float is a one-atom list `[5]`;
// a list "1 2 3" is `[1, 2, 3]`. Modelling messages as Atom[] (not a bare scalar)
// is what makes pack/unpack, zl.*, route, and multi-atom messages expressible.
//
// This is the STABLE CONTRACT that every control object codes against:
//   controlIns[i]  receives a Msg
//   emit(outlet, msg) / onControlOut deliver a Msg

export type Atom = number | string;
export type Msg = Atom[];

export const BANG: Msg = ['bang'];

/** A one-atom message carrying a single number. */
export const int = (n: number): Msg => [Math.trunc(n)];
export const float = (n: number): Msg => [n];

/** Is this message a bang (the symbol `bang`, or an empty message)? */
export function isBang(m: Msg): boolean {
  return m.length === 0 || (m.length === 1 && m[0] === 'bang');
}

/** First atom as a number, or undefined if the message isn't numeric. */
export function firstNum(m: Msg): number | undefined {
  const a = m[0];
  if (typeof a === 'number') return a;
  if (typeof a === 'string' && a !== 'bang') {
    const n = Number(a);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Every atom as a number where possible (non-numeric atoms dropped). */
export function nums(m: Msg): number[] {
  const out: number[] = [];
  for (const a of m) {
    if (typeof a === 'number') out.push(a);
    else {
      const n = Number(a);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  return out;
}

/** Coerce loose JS values (from args, tests, or scalars) into a Msg. */
export function asMsg(v: Atom | Msg | 'bang'): Msg {
  return Array.isArray(v) ? v : [v];
}

/** Human-readable form, for debugging / message boxes. */
export function msgToText(m: Msg): string {
  return m.join(' ');
}
