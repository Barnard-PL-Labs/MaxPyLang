// Argument-dependent inlet/outlet arity — the TypeScript port of maxpylang's
// parse_io_num + parse_io_typing (tools/objfuncs/makexlets.py) and the
// trigger/unpack/vst~ special cases (tools/objfuncs/specialobjs.py).
//
// 46 Max objects change shape with their arguments: `t b f` has two outlets typed
// bang/float, `unpack 1 2 3` has three, `mc.matrix~ 4 4` has six. The rules live as
// data in each object's OBJ_INFO entry under "in/out" and reach us through
// generated/boxspecs.json. Interpreting them in the browser (rather than round-tripping
// through Pyodide) is what lets a box re-shape itself on every keystroke without
// touching Python or the AudioContext.
//
// The port is deliberately literal — the fixture test in test/io-rules.test.ts replays
// ~230 real (text -> box dict) captures taken from the actual maxpylang and demands
// agreement. Three places where it is NOT literal, all recorded in KNOWN_DIVERGENCES
// (which also carries ir/objectspec's separate decision about invalid arguments):
//
//   1. `comparitor` is `eval(str(n) + comparitor)` upstream. There is no eval here, and
//      there never will be — box text is user input. The whole corpus is ">=2", ">1"
//      and ">3", and a regex covers it with room to spare.
//   2. Upstream's remove_xlets shrinks with `del self._outs[-num]` (a missing slice) and
//      is handed a NEGATIVE diff, so shrinking arity lands on the wrong count and
//      sometimes raises IndexError outright. Counts here are simply assigned.
//   3. Upstream recomputes xlet typing only `if diff != 0`, so `t b f` — two args, two
//      default outlets — keeps the default ["",""] instead of ["bang","float"]. Typing
//      here is recomputed whenever a rule applies.

import type { ArgValue } from './types';

/** Which arg to read: a 0-based position, or "all" meaning "how many args are there". */
export type IoIndex = number | 'all';

/** Per-position outlet types: `default` everywhere, overridden at the head and tail. */
export interface IoTypeMap {
  default: string;
  /** [how many leading xlets, their type(s)] — one string means "all the same". */
  first?: [number, string | string[]];
  /** [how many trailing xlets, their type(s)] — indexed from the back, as upstream. */
  last?: [number, string | string[]];
}

/** "signal" / "" / null, the two magic tokens, or a per-position map. */
export type IoTypeSpec = string | IoTypeMap | null;

/** One term of an arity rule. A rule's terms are summed (only sfplay~ has two). */
export interface IoTerm {
  /** "n" = consider numeric args only; anything else = the args exactly as typed. */
  argtype: string;
  index: IoIndex;
  /** Legal values; anything else snaps to the nearest, ties to the first listed. */
  acc_vals?: number[];
  /** e.g. ">=2" — when it fails the whole rule yields the object's default arity. */
  comparitor?: string;
  add_amt?: number;
  type?: IoTypeSpec;
}

/** An object's "in/out" entry. Both keys are optional; most objects have neither. */
export interface IoRules {
  numinlets?: IoTerm[];
  numoutlets?: IoTerm[];
}

/** The three box-dict fields an arity rule can rewrite. */
export interface XletCounts {
  numinlets: number;
  numoutlets: number;
  outlettype: string[];
}

export interface KnownDivergence {
  /** Box text, exactly as it appears in test/fixtures/io-parity.json. */
  text: string;
  reason: 'stale-typing' | 'shrink-arity' | 'python-raises' | 'arg-validity';
  note: string;
  /** What this module produces. The fixture says what maxpylang produced. */
  expect: XletCounts;
}

// Python's int(): truncates toward zero, and on a string accepts an integer literal only.
const INT_LITERAL = /^[+-]?\d+$/;
// Python's float(): the ordinary decimal/exponent forms. Deliberately NOT JS's Number(),
// which also swallows "0x10", "0b1" and "Infinity" — float("0x10") is a ValueError, so
// treating it as numeric here would give a hex-argumented box the wrong arity.
const FLOAT_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
// The only comparison forms the corpus uses are ">=" and ">", but the full set costs
// nothing and keeps a future OBJ_INFO refresh from silently falling back to defaults.
const COMPARITOR = /^(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)$/;

/** maxpylang's tc.check_number, against an already-typed arg. */
function isNumeric(arg: ArgValue): boolean {
  return typeof arg === 'number' ? true : FLOAT_LITERAL.test(arg);
}

/**
 * maxpylang's tc.check_int, against an already-typed arg.
 *
 * Note that it is true for FLOATS: check_int only asks whether `int(x)` raises, and
 * int(1.5) is a perfectly good 1. That is why `t 1.5` types its outlet "int" and not
 * "float" — surprising, but it is what maxpylang and the fixture both say.
 */
function isIntLike(arg: ArgValue): boolean {
  return typeof arg === 'number' ? Number.isFinite(arg) : INT_LITERAL.test(arg);
}

/** Python's int(x), or undefined where Python would raise ValueError. */
function toInt(arg: ArgValue): number | undefined {
  if (typeof arg === 'number') return Number.isFinite(arg) ? Math.trunc(arg) : undefined;
  return INT_LITERAL.test(arg) ? Number(arg) : undefined;
}

/** `[int(float(x)) for x in args if check_number(x)]` — the argtype "n" filter. */
function numericArgs(args: readonly ArgValue[]): number[] {
  const out: number[] = [];
  for (const a of args) if (isNumeric(a)) out.push(Math.trunc(Number(a)));
  return out;
}

/** Nearest accepted value; ties keep the FIRST listed, matching Python's min(). */
function snap(accepted: readonly number[], n: number): number {
  let best = accepted[0];
  let bestDist = Math.abs(best - n);
  for (let i = 1; i < accepted.length; i++) {
    const dist = Math.abs(accepted[i] - n);
    if (dist < bestDist) {
      best = accepted[i];
      bestDist = dist;
    }
  }
  return best;
}

/**
 * `eval(str(n) + comparitor)`, without the eval.
 *
 * An unparseable comparitor fails rather than passes: a failed comparison means "use
 * the object's default arity", which is the safe answer for a rule we don't understand.
 */
function passesComparitor(n: number, comparitor: string): boolean {
  const m = COMPARITOR.exec(comparitor.trim());
  if (!m) return false;
  const rhs = Number(m[2]);
  switch (m[1]) {
    case '>=': return n >= rhs;
    case '<=': return n <= rhs;
    case '==': return n === rhs;
    case '!=': return n !== rhs;
    case '>': return n > rhs;
    default: return n < rhs;
  }
}

/**
 * How many xlets the terms ask for, or `fallback` when the args can't answer.
 *
 * Falling back is immediate and total, exactly as upstream: sfplay~ has two terms, and
 * `sfplay~ 2` bails on the second (there is no third numeric arg) so the first term's
 * contribution is discarded too and the object keeps its default two outlets.
 */
export function xletCount(
  terms: readonly IoTerm[],
  args: readonly ArgValue[],
  fallback: number,
): number {
  let sum = 0;
  for (const term of terms) {
    const pool: readonly ArgValue[] = term.argtype === 'n' ? numericArgs(args) : args;

    let base: number;
    if (term.index === 'all') {
      base = pool.length;
    } else {
      if (pool.length <= term.index) return fallback;
      const n = toInt(pool[term.index]);
      // Upstream's int() raises ValueError on a non-numeric arg and the object never
      // builds. `jit.pack foo` is the live example — there is no arg signature to
      // reject it first. An editor must not throw on half-typed text, so: default arity.
      if (n === undefined) return fallback;
      base = n;
    }

    if (term.acc_vals && term.acc_vals.length > 0) base = snap(term.acc_vals, base);
    if (term.comparitor !== undefined && !passesComparitor(base, term.comparitor)) {
      return fallback;
    }

    sum += base + (term.add_amt ?? 0);
  }
  return sum;
}

/** trigger's outlet types, from its format args (`t b f` -> ["bang","float"]). */
function triggerOutTypes(args: readonly ArgValue[]): string[] {
  return args.map((arg) => {
    if (arg === 'b') return 'bang';
    if (isIntLike(arg) || arg === 'i') return 'int';
    if (isNumeric(arg) || arg === 'f') return 'float';
    if (arg === 's') return '';
    return String(arg);
  });
}

/** unpack's outlet types — like trigger's, but an unrecognised arg is "anything". */
function unpackOutTypes(args: readonly ArgValue[]): string[] {
  return args.map((arg) => {
    if (isIntLike(arg) || arg === 'i') return 'int';
    if (isNumeric(arg) || arg === 'f') return 'float';
    return '';
  });
}

/**
 * maxpylang's update_vst (specialobjs.py:381-389): a vst~'s arguments are appended to its
 * `save` list as well as its text.
 *
 * That list is the only place Max reads a vst~'s channel count and plugin back from, so a
 * box built here without it reopens in Max as an empty 8-outlet vst~ — silently, since
 * the text still looks right. Upstream mutates the box dict in place (remove(';'), += args,
 * append(';')); this returns a new array instead, because the caller's box dict is a
 * shallow copy of the shared boxspecs table and mutating the list would rewrite every
 * later vst~ too. Only the FIRST ';' is dropped, as Python's list.remove does.
 */
export function vstSave(save: readonly ArgValue[], args: readonly ArgValue[]): ArgValue[] {
  const out = [...save];
  const semicolon = out.indexOf(';');
  if (semicolon >= 0) out.splice(semicolon, 1);
  return [...out, ...args, ';'];
}

/**
 * The type token for each of `count` xlets.
 *
 * Always returns exactly `count` entries. The two arg-derived forms (trigger, unpack)
 * produce one per argument, which is the same number in every rule that uses them —
 * both are indexed "all" — but padding keeps `outlettype.length === numoutlets` an
 * invariant the renderer and the writer can rely on.
 */
export function xletTypes(
  spec: IoTypeSpec | undefined,
  count: number,
  args: readonly ArgValue[],
): string[] {
  let types: string[];

  if (spec === undefined || spec === null || typeof spec === 'string') {
    if (spec === 'trigger_out') types = triggerOutTypes(args);
    else if (spec === 'unpack_out') types = unpackOutTypes(args);
    // null is what every numinlets rule carries; inlets have no persisted type, so it
    // only ever reaches an outlettype through a rule that doesn't exist in the corpus.
    else return new Array<string>(count).fill(spec ?? '');
  } else {
    types = new Array<string>(count).fill(spec.default);

    if (spec.first) {
      const [n, t] = spec.first;
      const head = typeof t === 'string' ? new Array<string>(n).fill(t) : t;
      for (let i = 0; i < n && i < count; i++) types[i] = head[i];
    }
    if (spec.last) {
      const [n, t] = spec.last;
      const tail = typeof t === 'string' ? new Array<string>(n).fill(t) : t;
      // Upstream writes new_types[-(i+1)] = last_types[-(i+1)], i.e. both sides counted
      // from the back, so a 6-wide tail lands on the last 6 xlets however many there are.
      for (let i = 0; i < n; i++) {
        const at = count - 1 - i;
        if (at < 0) break;
        types[at] = tail[tail.length - 1 - i];
      }
    }
  }

  if (types.length < count) types = types.concat(new Array<string>(count - types.length).fill(''));
  return types.length > count ? types.slice(0, count) : types;
}

/**
 * Apply an object's "in/out" rules to its arguments.
 *
 * `defaults` are the object's own box-dict values (from generated/boxspecs.json) and are
 * returned untouched whenever a rule doesn't apply — including the early return upstream
 * takes on an empty arg list, which is why a bare `unpack` keeps two outlets and a bare
 * `pack` keeps two inlets rather than collapsing to zero.
 */
export function applyIoRules(
  rules: IoRules | undefined,
  args: readonly ArgValue[],
  defaults: XletCounts,
): XletCounts {
  const result: XletCounts = {
    numinlets: defaults.numinlets,
    numoutlets: defaults.numoutlets,
    outlettype: [...defaults.outlettype],
  };
  if (!rules || args.length === 0) return result;

  if (rules.numinlets && rules.numinlets.length > 0) {
    result.numinlets = Math.max(0, xletCount(rules.numinlets, args, defaults.numinlets));
  }
  if (rules.numoutlets && rules.numoutlets.length > 0) {
    result.numoutlets = Math.max(0, xletCount(rules.numoutlets, args, defaults.numoutlets));
    // Only the FIRST term carries typing upstream (update_xlet_typing reads
    // info[xlet_type][0]['type']), even for sfplay~ whose second term changed the count.
    result.outlettype = xletTypes(rules.numoutlets[0].type, result.numoutlets, args);
  }
  return result;
}

/**
 * Every row of test/fixtures/io-parity.json where this module intentionally disagrees
 * with the maxpylang that produced the fixture. The test asserts each one differs AND
 * differs in exactly this way; anything else diverging is a failure.
 *
 * Four causes, in rough order of how much they matter to a patcher user:
 *
 *   stale-typing — upstream recomputes typing only when the xlet COUNT changed, so an
 *     object whose args reshape its types but not its arity keeps the defaults. This is
 *     the `t b f` bug: 2 args, 2 default outlets, so the outlets stay untyped and every
 *     trigger cord draws as plain control.
 *
 *   shrink-arity — upstream's remove_xlets deletes the wrong slice, so an object that
 *     shrinks by more than one lands on a count between the old and the new one, with an
 *     outlettype array of yet a third length.
 *
 *   python-raises — the same bug, where the damaged list then fails to index at all.
 *     maxpylang cannot construct these objects; the fixture records the exception.
 *
 *   arg-validity — maxpylang replaces an object whose args don't match its documented
 *     signature with unknown_obj_dict: 0 inlets, 0 outlets, no outlettype. Mid-typing
 *     that is hostile (every box is momentarily half-written), so resolveBox keeps the
 *     object and reports the mismatch in `warnings` instead. These rows are about
 *     objectspec's policy, not about the arity port; the counts here are what the rules
 *     say and what the box gets.
 */
export const KNOWN_DIVERGENCES: readonly KnownDivergence[] = [
  // --- stale-typing -----------------------------------------------------------
  {
    text: 't b f',
    reason: 'stale-typing',
    note: 'two args, two default outlets: upstream never recomputes and keeps ["",""]',
    expect: { numinlets: 1, numoutlets: 2, outlettype: ['bang', 'float'] },
  },
  {
    text: 'trigger b f',
    reason: 'stale-typing',
    note: 'same as `t b f`, spelled out',
    expect: { numinlets: 1, numoutlets: 2, outlettype: ['bang', 'float'] },
  },
  {
    text: 'unpack f f',
    reason: 'stale-typing',
    note: 'two float args, two default outlets: upstream keeps ["int","int"]',
    expect: { numinlets: 1, numoutlets: 2, outlettype: ['float', 'float'] },
  },
  // --- shrink-arity -----------------------------------------------------------
  {
    text: 'mpeformat 1',
    reason: 'shrink-arity',
    note: '16 inlets down to 2: upstream deletes _ins[14:] and lands on 14',
    expect: { numinlets: 2, numoutlets: 2, outlettype: ['int', 'mpeevent'] },
  },
  {
    text: 'jit.pack 1',
    reason: 'shrink-arity',
    note: '4 inlets down to 1: upstream deletes _ins[3:] and lands on 3',
    expect: { numinlets: 1, numoutlets: 2, outlettype: ['jit_matrix', ''] },
  },
  {
    text: 'jit.unpack 2',
    reason: 'shrink-arity',
    note: '5 outlets down to 3: upstream deletes the single _outs[2] and lands on 4',
    expect: { numinlets: 1, numoutlets: 3, outlettype: ['jit_matrix', 'jit_matrix', ''] },
  },
  // --- python-raises ----------------------------------------------------------
  {
    text: 'switch 1',
    reason: 'python-raises',
    note: '3 inlets down to 2 leaves upstream with 1 inlet, then typing indexes _ins[1]',
    expect: { numinlets: 2, numoutlets: 1, outlettype: [''] },
  },
  {
    text: 'record~ buf 0',
    reason: 'python-raises',
    note: '3 inlets down to 2 leaves upstream with 1 inlet, then typing indexes _ins[1]',
    expect: { numinlets: 2, numoutlets: 1, outlettype: ['signal'] },
  },
  {
    text: 'jit.pack foo',
    reason: 'python-raises',
    note: 'no arg signature to reject "foo", so upstream reaches int("foo"); we keep the default',
    expect: { numinlets: 4, numoutlets: 2, outlettype: ['jit_matrix', ''] },
  },
  {
    text: 'jit.unpack foo',
    reason: 'python-raises',
    note: 'no arg signature to reject "foo", so upstream reaches int("foo"); we keep the default',
    expect: {
      numinlets: 1,
      numoutlets: 5,
      outlettype: ['jit_matrix', 'jit_matrix', 'jit_matrix', 'jit_matrix', ''],
    },
  },
  // --- arg-validity -----------------------------------------------------------
  {
    text: 'select',
    reason: 'arg-validity',
    note: 'required arg "inlet" missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 2, numoutlets: 2, outlettype: ['bang', ''] },
  },
  {
    text: 'select foo',
    reason: 'arg-validity',
    note: '"foo" is not an int -> upstream returns unknown_obj_dict',
    expect: { numinlets: 2, numoutlets: 2, outlettype: ['bang', ''] },
  },
  {
    text: 'router',
    reason: 'arg-validity',
    note: 'both required args missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 2, numoutlets: 2, outlettype: ['', ''] },
  },
  {
    text: 'unjoin',
    reason: 'arg-validity',
    note: 'required arg "outlets" missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 1, numoutlets: 3, outlettype: ['', '', ''] },
  },
  {
    text: 'mpeformat',
    reason: 'arg-validity',
    note: 'required arg "channels" missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 16, numoutlets: 2, outlettype: ['int', 'mpeevent'] },
  },
  {
    text: 'matrix~',
    reason: 'arg-validity',
    note: 'both required args missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 2, numoutlets: 3, outlettype: ['signal', 'signal', ''] },
  },
  {
    text: 'mc.matrix~',
    reason: 'arg-validity',
    note: 'both required args missing -> upstream returns unknown_obj_dict',
    expect: {
      numinlets: 2,
      numoutlets: 4,
      outlettype: ['multichannelsignal', 'multichannelsignal', '', ''],
    },
  },
  {
    text: 'mc.unpack~',
    reason: 'arg-validity',
    note: 'required arg "size" missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 1, numoutlets: 2, outlettype: ['signal', 'signal'] },
  },
  {
    text: '2d.wave~',
    reason: 'arg-validity',
    note: 'required arg "buffer-name" missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 4, numoutlets: 1, outlettype: ['signal'] },
  },
  {
    text: 'mc.2d.wave~',
    reason: 'arg-validity',
    note: 'required arg "buffer-name" missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 4, numoutlets: 1, outlettype: ['multichannelsignal'] },
  },
  {
    text: 'wave~',
    reason: 'arg-validity',
    note: 'required arg "buffer-name" missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 3, numoutlets: 1, outlettype: ['signal'] },
  },
  {
    text: 'mc.wave~',
    reason: 'arg-validity',
    note: 'required arg "buffer-name" missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 3, numoutlets: 1, outlettype: ['multichannelsignal'] },
  },
  {
    text: 'record~',
    reason: 'arg-validity',
    note: 'required arg "buffer-name" missing -> upstream returns unknown_obj_dict',
    expect: { numinlets: 3, numoutlets: 1, outlettype: ['signal'] },
  },
];
