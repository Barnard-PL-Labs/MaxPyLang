// From a line of box text to a fully-specified box — the patcher's central question.
//
// Typing `unpack 1 2 3` into a box has to produce, without asking Python anything: the
// class name, its arguments, its in-box @attributes, the Max maxclass to save it as,
// three outlets, the type token on each of them, a cord colour per outlet, and a
// rectangle to draw. This module is that pipeline. It is the TS side of maxpylang's
// build_from_specs (tools/objfuncs/instantiation.py): parse_text -> reference lookup ->
// alias resolution -> update_ins_outs, reading the same metadata via the generated
// manifest.json and boxspecs.json.
//
// One deliberate departure from maxpylang, and it is a user-facing one. When the typed
// args don't match an object's documented signature, maxpylang throws the whole object
// away and substitutes unknown_obj_dict — 0 inlets, 0 outlets, no behaviour. In a batch
// script that is a loud, useful error. In an editor it fires on every keystroke of
// `select 1 2` (at `select` alone the required arg is missing, at `select 1` it isn't
// yet what you meant), so the box would flicker between 0 and 3 outlets and drop cords
// as it went. resolveBox keeps the object, computes its arity from the rules, and puts
// the complaint in `warnings` for the inspector to show. test/io-rules.test.ts pins
// every case where that choice makes us disagree with maxpylang.

import { outletDomain } from './domain';
import { applyIoRules, vstSave, type IoRules, type XletCounts } from './io-rules';
import type { ArgValue, Domain, IRNode } from './types';
import manifest from '../generated/manifest.json';

/**
 * Schema of generated/manifest.json. Read straight from the generated file rather than
 * through engine/registry: ir/ is the layer the engine is built ON, and importing the
 * registry here would make the parser depend on every object implementation's registry.
 */
interface ManifestEntry {
  pkg: string;
  maxclass: string;
  numInlets: number;
  numOutlets: number;
  outletDomains: Domain[];
  args: { name: string; type: string[]; optional: boolean }[];
  aliases: string[];
  aliasOf?: string;
}

/** Schema of generated/boxspecs.json — see scripts/gen-manifest.mjs. */
export interface RawBoxSpec {
  /** The object's default box dict with `id` stripped: ready to stamp out a new box. */
  box: Record<string, unknown>;
  /** Present only for the 46 objects whose arity depends on their args. */
  io?: IoRules;
  attribs: { name: string; type?: string; size?: string }[];
  /**
   * Set on the few objects the web engine plays that maxpylang's OBJ_INFO does not
   * describe (live.gain~) — the generator's SUPPLEMENT table. maxpylang cannot build
   * these from their text, so codegen/maxpy.ts declares them instead of naming them.
   */
  webOnly?: true;
  /** Aliases Max accepts that maxpylang does not (`p` for `patcher`); same reason. */
  webAliases?: string[];
}

export type BoxSpecTable = Record<string, RawBoxSpec>;

const MANIFEST = manifest as unknown as Record<string, ManifestEntry>;

/** Box text split the way maxpylang's parse_text splits it. */
export interface ParsedBoxText {
  /** First token — or the class you passed in, for a UI box whose text has no name. */
  name: string;
  args: ArgValue[];
  /**
   * Which args came from a FLOAT literal, aligned one-to-one with `args`.
   *
   * Python has two numeric types and JS has one, so `0` and `0.` both parse to the same
   * JS `0` and only this flag remembers which was typed. It is not cosmetic: Max gives
   * `pack 0. 0.` float inlets and `pack 0 0` int ones, and `scale 0 127 0. 1.` maps onto
   * a 0-to-1 float range where `scale 0 127 0 1` truncates to 0 or 1. Dropping the flag
   * would let one inspector edit silently change what the object does.
   */
  argIsFloat: boolean[];
  /** `@key v1 v2` collected in order; a valueless `@key` maps to []. */
  attrs: Record<string, string[]>;
}

/** Everything needed to draw, wire, play and save one box. */
export interface BoxSpec extends ParsedBoxText {
  /** The object the name resolves to: `t` -> `trigger`. Same as `name` when not an alias. */
  canonical: string;
  maxclass: string;
  numInlets: number;
  numOutlets: number;
  /** Raw Max outlettype tokens, recomputed from the args where a rule applies. */
  outletTypes: string[];
  outletDomains: Domain[];
  rect: [number, number, number, number];
  /** False for a name no object has — 0 in, 0 out, drawn as broken. */
  known: boolean;
  /** Argument-signature complaints. Advisory: the box is built regardless. */
  warnings: string[];
  /** The default box dict to stamp a new .maxpat box from, if boxspecs are loaded. */
  box: Record<string, unknown>;
  /** Normalized in-box text (what formatBoxText would write). */
  text: string;
}

// Max's own newobj metrics. Height is 22 in every default box in OBJ_INFO, and the
// width tracks the text: unknown_obj_dict's 3-character "UNK" box is 34 wide. The
// per-character advance mirrors ui/layout.ts's textWidth so a box the patcher draws and
// the box it saves are about the same size — ir/ cannot import ui/, hence the constant.
const CHAR_W = 6.7;
const BOX_PAD = 13;
const BOX_H = 22;
const MIN_BOX_W = 24;
/** Where maxpylang's unknown_obj_dict puts a box it could not identify. */
const DEFAULT_AT: readonly [number, number] = [234, 81];

let cache: BoxSpecTable | undefined;
let inflight: Promise<BoxSpecTable> | undefined;

/**
 * Pull in generated/boxspecs.json (~170 KB).
 *
 * Deliberately lazy and deliberately not imported at module scope: the player never
 * needs arity rules or default box dicts, and this module is on the parser's import
 * path. Idempotent — every call after the first resolves to the same table. resolveBox
 * works without it, at reduced fidelity; see `resolveBox`.
 */
export function loadBoxSpecs(): Promise<BoxSpecTable> {
  if (cache) return Promise.resolve(cache);
  inflight ??= import('../generated/boxspecs.json')
    .then((m) => (cache = m.default as unknown as BoxSpecTable))
    .catch((err) => {
      inflight = undefined; // a transient chunk-load failure should be retryable
      throw err;
    });
  return inflight;
}

/** The loaded table, or undefined before loadBoxSpecs() has resolved. */
export function boxSpecs(): BoxSpecTable | undefined {
  return cache;
}

/** The object a class name resolves to (`t` -> `trigger`); itself when not an alias or unknown. */
export function canonicalName(name: string): string {
  return MANIFEST[name]?.aliasOf ?? name;
}

/** Every class name the manifest knows, aliases included. Ranking lives in engine/catalog. */
export function objectNames(): string[] {
  return Object.keys(MANIFEST);
}

// Python's int()/float() literal forms — see the same pair in io-rules.ts. Number() is
// not usable here: it accepts "0x10" and "", which Max treats as symbols.
const INT_LITERAL = /^[+-]?\d+$/;
const FLOAT_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * maxpylang's get_typed_args: a token that reads as a number becomes one — an int
 * literal an int, anything else numeric a float, everything else a symbol.
 *
 * JS collapses the first two, so the int/float half of the answer is returned separately
 * and carried in ParsedBoxText.argIsFloat rather than lost.
 */
function typeArg(token: string): { value: ArgValue; isFloat: boolean } {
  if (INT_LITERAL.test(token)) return { value: Number(token), isFloat: false };
  if (FLOAT_LITERAL.test(token)) return { value: Number(token), isFloat: true };
  return { value: token, isFloat: false };
}

/**
 * str(arg), with the float-ness JS cannot hold put back.
 *
 * Python's str() always shows that a float is one ("0.0", "0.5", "1e+30"); JS drops the
 * fraction for an integral value, so the ".0" is appended when — and only when — nothing
 * in the rendered form already marks it. Normalization still happens, exactly as upstream:
 * both round-trip through the number, so "0.50" comes back as "0.5".
 */
function formatArg(arg: ArgValue, isFloat: boolean): string {
  const s = String(arg);
  return isFloat && typeof arg === 'number' && !/[.e]/i.test(s) ? `${s}.0` : s;
}

/**
 * Float-ness of a value written into a slot that was `wasFloat`.
 *
 * A float slot stays float: `scale 0 127 0. 1.` maps onto a float range, and retyping one
 * end as 2 must not quietly turn it into the int range `scale 0 127 0 2`. A symbol has no
 * int/float split at all, and a new value is a float only if it carries a fraction — JS
 * cannot tell `setArg(p, i, 1.0)` from `setArg(p, i, 1)`, so a caller that needs "1.0" in
 * a fresh slot passes the string.
 */
function slotIsFloat(value: ArgValue, wasFloat: boolean): boolean {
  if (typeof value !== 'number') return false;
  return wasFloat || !Number.isInteger(value);
}

/**
 * Split box text into name, args and in-box attributes — the port of
 * maxpylang's tools/objfuncs/text.py:parse_text.
 *
 * Args run until the first token starting with `@`; from there every `@key` collects
 * the tokens after it. `cycle~ @frequency 440` is therefore a cycle~ with NO arguments
 * and one attribute, which is the bug this replaced in parser/maxpat.ts — the engine
 * was receiving the literal string "@frequency" as argument 0.
 *
 * Pass `className` for a UI box (maxclass slider, message, number, …): Max stores those
 * without a class name in the text, so every token is an argument — including one
 * starting with `@`. Attribute syntax belongs to object boxes alone: a message box's
 * text is a message to SEND and a comment's is prose, so `@gain 0.5` in a message box
 * is a two-atom message, not an attribute. Splitting it would leave the box with no
 * arguments at all, and the engine's `message` factory emits a bang when its args are
 * empty — the message would silently disappear.
 *
 * Whitespace is collapsed rather than split on single spaces, so a double space is
 * harmless here. Upstream indexes `text[i][0]` on the empty string a `" ".split(" ")`
 * leaves behind and raises IndexError.
 */
export function parseBoxText(text: string, className?: string): ParsedBoxText {
  const tokens = (text ?? '').trim().split(/\s+/).filter((t) => t.length > 0);
  let i = 0;
  const name = className ?? tokens[i++] ?? '';

  // Only a box that names itself in its own text carries attributes; see above.
  const splitsAttrs = className === undefined;

  const args: ArgValue[] = [];
  const argIsFloat: boolean[] = [];
  while (i < tokens.length && !(splitsAttrs && tokens[i][0] === '@')) {
    const { value, isFloat } = typeArg(tokens[i++]);
    args.push(value);
    argIsFloat.push(isFloat);
  }

  const attrs: Record<string, string[]> = {};
  while (splitsAttrs && i < tokens.length && tokens[i][0] === '@') {
    const key = tokens[i++].slice(1);
    const vals: string[] = [];
    while (i < tokens.length && tokens[i][0] !== '@') vals.push(tokens[i++]);
    attrs[key] = vals;
  }

  return { name, args, argIsFloat, attrs };
}

/**
 * The inverse of parseBoxText — the port of text.py:get_text.
 *
 * Pass the same `className` you passed to parseBoxText, and the two are exact inverses:
 * a class supplied from the outside is not written back into the text.
 *
 * The one case that needs no flag is Max's own: a `message` box's text is its contents
 * with no class name, so `{name: 'message', args: [1, 2]}` writes "1 2" either way. That
 * asymmetry is upstream's too — it is the single `if self._name != "message"` in get_text
 * — and it is why generated MaxPy says `place("message 1 2")` for a box reading "1 2".
 */
export function formatBoxText(parsed: ParsedBoxText, className?: string): string {
  const parts: string[] = [];
  if (className === undefined && parsed.name !== 'message' && parsed.name !== '') {
    parts.push(parsed.name);
  }
  parsed.args.forEach((arg, i) => parts.push(formatArg(arg, parsed.argIsFloat[i] ?? false)));
  for (const [key, vals] of Object.entries(parsed.attrs)) {
    parts.push(`@${key}`, ...vals);
  }
  return parts.join(' ');
}

/**
 * Set, append or delete one positional argument, returning a new ParsedBoxText.
 *
 * `value === null` removes the argument and shifts the rest down. An index past the end
 * appends: Max arguments are positional with no way to skip one, so "set argument 3 of a
 * box that has 1" can only mean "make it argument 2".
 */
export function setArg(parsed: ParsedBoxText, index: number, value: ArgValue | null): ParsedBoxText {
  const args = [...parsed.args];
  const argIsFloat = [...parsed.argIsFloat];
  const at = Math.max(0, Math.min(index, args.length));
  if (value === null) {
    args.splice(at, 1);
    argIsFloat.splice(at, 1);
  } else if (at === args.length) {
    args.push(value);
    argIsFloat.push(slotIsFloat(value, false));
  } else {
    args[at] = value;
    argIsFloat[at] = slotIsFloat(value, argIsFloat[at] ?? false);
  }
  return { ...parsed, args, argIsFloat };
}

/**
 * Set or delete one in-box attribute, returning a new ParsedBoxText.
 *
 * `null` deletes. A bare string is a single value; `[]` writes a valueless `@key`, which
 * Max accepts and get_text also emits.
 */
export function setAttrib(
  parsed: ParsedBoxText,
  name: string,
  value: string | string[] | null,
): ParsedBoxText {
  const attrs = { ...parsed.attrs };
  if (value === null) delete attrs[name];
  else attrs[name] = typeof value === 'string' ? [value] : [...value];
  return { ...parsed, attrs };
}

/**
 * Re-split a UI box's text once its class is known: everything after the class name is
 * content, `@` included, and the name stays what the user actually typed.
 *
 * Safe to slice by length because parseBoxText took `name` from the front of the same
 * trimmed text, so the remainder is whatever followed it.
 */
function uiContent(text: string, name: string, maxclass: string): ParsedBoxText {
  const rest = text.trim().slice(name.length);
  return { ...parseBoxText(rest, maxclass), name };
}

/** unknown_obj_dict, as a BoxSpec: keep the text, claim nothing about the object. */
function unknownSpec(parsed: ParsedBoxText, text: string, at: readonly [number, number]): BoxSpec {
  return {
    ...parsed,
    canonical: parsed.name,
    maxclass: 'newobj',
    numInlets: 0,
    numOutlets: 0,
    outletTypes: [],
    outletDomains: [],
    rect: [at[0], at[1], boxWidth(text), BOX_H],
    known: false,
    warnings: [`unknown Max object: '${parsed.name}'`],
    box: { maxclass: 'newobj', numinlets: 0, numoutlets: 0, text },
    text,
  };
}

function boxWidth(text: string): number {
  return Math.max(Math.round(CHAR_W * text.length) + BOX_PAD, MIN_BOX_W);
}

/**
 * maxpylang's args_valid, reported instead of enforced.
 *
 * Same two checks (enough required args, and each arg matching its slot's type) and the
 * same lenient type table: only int/float/number slots reject anything, since symbol,
 * list and any accept every token. Extra arguments beyond the signature are not a
 * complaint — plenty of objects take a variadic tail the metadata doesn't spell out.
 */
function signatureWarnings(entry: ManifestEntry, args: readonly ArgValue[]): string[] {
  const warnings: string[] = [];
  const required = entry.args.filter((a) => !a.optional);
  if (args.length < required.length) {
    const missing = required.slice(args.length).map((a) => a.name).join(', ');
    warnings.push(`missing required argument(s): ${missing}`);
  }
  for (let i = 0; i < entry.args.length && i < args.length; i++) {
    const slot = entry.args[i];
    const numericOnly = slot.type.every((t) => t === 'int' || t === 'float' || t === 'number');
    if (numericOnly && typeof args[i] !== 'number') {
      warnings.push(`argument ${i + 1} (${slot.name}) should be ${slot.type.join('/')}`);
    }
  }
  return warnings;
}

/**
 * Resolve a line of box text into everything needed to place, wire and save the box.
 *
 * `at` is the top-left corner in patch coordinates; the size comes from the text for an
 * object box and from the object's own default box for a UI class (a toggle is square,
 * whatever you typed to make it).
 *
 * Full fidelity needs loadBoxSpecs() to have resolved. Before that the manifest still
 * gives the right class, arity and outlet DOMAINS for every object — only the exact
 * outlettype tokens, the argument-dependent arity and the stampable default box dict
 * are missing, so a box resolved early draws and wires correctly and is merely
 * conservative about arity.
 */
export function resolveBox(text: string, at?: readonly [number, number]): BoxSpec {
  const origin = at ?? DEFAULT_AT;
  const typed = parseBoxText(text);
  const entry = MANIFEST[typed.name];
  if (!entry) return unknownSpec(typed, text, origin);

  const canonical = entry.aliasOf ?? typed.name;
  const spec = cache?.[canonical];

  // A UI class (slider, toggle, message, …) IS its maxclass; only `newobj` boxes name
  // their class in the text. None of the 46 arity-rule objects is a UI class, so the
  // rules below only ever run on newobj boxes — objectspec.test.ts asserts that.
  const isUi = entry.maxclass !== 'newobj';

  // Identifying the box needed the first token read as a class name, which is exactly the
  // split parseBoxText's className parameter exists to avoid for a UI box — so redo it
  // now that the class is known. `message @interp 1` is a two-atom message; parsed as an
  // attribute it leaves the box with no args, and the engine's message factory emits a
  // bare bang when its args are empty (objects/control/index.ts).
  const parsed = isUi ? uiContent(text, typed.name, entry.maxclass) : typed;

  const defaults: XletCounts = {
    numinlets: entry.numInlets,
    numoutlets: entry.numOutlets,
    outlettype: spec
      ? ((spec.box.outlettype as string[] | undefined) ?? [])
      // No boxspecs yet: rebuild the coarsest outlettype that yields the right domains.
      // "bang"/"int"/"list" all collapse to "", which is honest — we don't know them.
      : entry.outletDomains.map((d) =>
          d === 'signal' ? 'signal' : d === 'video' ? 'jit_matrix' : '',
        ),
  };

  const counts = applyIoRules(spec?.io, parsed.args, defaults);
  // A deep copy, not a spread: a default box can carry nested dicts — `patcher` embeds
  // a whole (empty) patch, live.gain~ its parameter block — and a box that edits its own
  // copy (opening a new subpatcher and adding to it) must not edit every future one.
  const box = spec ? structuredClone(spec.box) : {};
  const uiRect = spec?.box.patching_rect as [number, number, number, number] | undefined;

  // The one box dict maxpylang rewrites from the args as well as from the arity rules.
  // Guarded by args.length because update_ins_outs returns before reaching it on an
  // empty arg list, so a bare `vst~` keeps the stock save — as it does upstream.
  if (canonical === 'vst~' && parsed.args.length > 0 && Array.isArray(box.save)) {
    box.save = vstSave(box.save as ArgValue[], parsed.args);
  }

  return {
    ...parsed,
    canonical,
    maxclass: entry.maxclass,
    numInlets: counts.numinlets,
    numOutlets: counts.numoutlets,
    outletTypes: counts.outlettype,
    outletDomains: Array.from({ length: counts.numoutlets }, (_, i) =>
      outletDomain(counts.outlettype[i]),
    ),
    rect:
      isUi && uiRect
        ? [origin[0], origin[1], uiRect[2], uiRect[3]]
        : [origin[0], origin[1], boxWidth(text), BOX_H],
    known: true,
    warnings: signatureWarnings(entry, parsed.args),
    box,
    text,
  };
}

/** A resolved spec as a graph node. `id` is the patch-unique box id ("obj-7"). */
export function specToNode(spec: BoxSpec, id: string): IRNode {
  return {
    id,
    className: spec.name,
    args: [...spec.args],
    maxclass: spec.maxclass,
    numInlets: spec.numInlets,
    numOutlets: spec.numOutlets,
    outletDomains: [...spec.outletDomains],
    rect: [...spec.rect] as [number, number, number, number],
    text: spec.text,
    outletTypes: [...spec.outletTypes],
    attrs: { ...spec.attrs },
    known: spec.known,
  };
}
