// Seeded random patch documents, for the generative layer of test/roundtrip.test.ts.
//
// The round-trip property ("a file we write reads back as the patch we wrote") is only
// worth as much as the patches it is tried on. The bundled corpus is 15 hand-built
// patches using perhaps 40 distinct objects; the manifest has 1054, and 46 of them
// change SHAPE with their arguments. Those 46 are exactly where a writer goes wrong —
// `unpack 1 2 3` shrunk to `unpack 1 2` is the case that leaves a phantom outlet behind
// — so they need to be hit with varying arg counts, many times, which is a generator's
// job rather than a fixture's.
//
// Determinism is the whole point of the seed. A property test that fails once in two
// hundred runs and cannot be re-run is worse than no test: nobody can bisect it and
// everybody learns to re-run CI. So there is no Math.random anywhere here — the PRNG is
// mulberry32, thirty lines of arithmetic with no dependency, and the same seed gives the
// same 500 patches on every machine forever. A failure reported as "case 317, seed
// 0xC0FFEE" is reproducible by construction.
//
// Two deliberate restrictions on what gets generated, both because they are what Max
// itself writes rather than to dodge a failing assertion:
//
//   1. Only `newobj`, `message` and `comment` boxes are given text arguments. Those are
//      the three classes whose `text` Max persists as content; a `toggle`'s text is
//      decoration (Max writes none at all), so arguments typed into one cannot survive a
//      save in ANY writer and generating them would only assert that fact 500 times.
//   2. Argument tokens are emitted as STRINGS and joined into a line of box text, never
//      as numbers. That is the only way to control the int/float distinction JS collapses
//      — "2" and "2.0" are one value in JS and two different objects in Max, and `pack 0 0`
//      vs `pack 0. 0.` is the difference between int and float inlets.

import { PatchDoc } from '../../src/doc/patch-doc';
import { boxSpecs } from '../../src/ir/objectspec';
import { objectOptions } from '../../src/engine/catalog';

/**
 * mulberry32: a 32-bit PRNG with a 2^32 period, good enough for choosing among a
 * thousand object names and small enough to read in one sitting.
 *
 * Not cryptographic and not trying to be. What it has to be is EXACTLY reproducible
 * across engines, which it is: every operation is on a uint32 through `>>> 0` and
 * `Math.imul`, so there is no float rounding anywhere in the state update.
 */
export class Rng {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** The next float in [0, 1). */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** An integer in [0, n). Returns 0 for n <= 0 so a caller never has to guard. */
  int(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.next() * n);
  }

  /** An integer in [lo, hi], inclusive at both ends. */
  between(lo: number, hi: number): number {
    return lo + this.int(hi - lo + 1);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/**
 * Argument tokens, as they would be typed into a box.
 *
 * The mix is chosen to exercise the arity rules rather than to look like a real patch:
 * `b`/`f`/`i`/`s`/`l` are trigger's and route's format arguments, the integers drive
 * every `index`-based rule (and 0 and 1 are the values that shrink an object below its
 * default arity — the case upstream's remove_xlets gets wrong), and the float spellings
 * are the ones that must come back with their ".0" intact.
 */
const ARG_TOKENS: readonly string[] = [
  'b', 'f', 'i', 's', 'l',
  '0', '1', '2', '3', '4', '8', '16', '-1',
  '0.', '0.5', '1.0', '2.0', '440.0', '-1.5', '1e3',
  'foo', 'bar', 'buf', 'mysignal',
];

/** In-box `@key val` attributes. Keys are plausible; nothing reads them back. */
const ATTR_KEYS: readonly string[] = ['active', 'gain', 'mode', 'name', 'interp'];

/** The three classes whose `text` Max persists as content. See the module header. */
const TEXT_CLASSES = new Set(['newobj', 'message', 'comment']);

export interface GenOptions {
  /** Boxes per patch, inclusive range. */
  boxes?: [number, number];
  /**
   * How often a box is drawn from the 46 argument-dependent objects rather than from the
   * whole catalog. Deliberately high: they are 4% of the manifest and ~100% of the risk.
   */
  arityRuleBias?: number;
  /** Cord attempts, as a multiple of the box count. Some are refused; that is fine. */
  cordDensity?: number;
}

/**
 * The names whose arity depends on their arguments — the 46 objects carrying an "in/out"
 * rule in generated/boxspecs.json.
 *
 * Read from the table rather than hard-coded, so that a regenerated boxspecs.json with a
 * 47th rule object starts being fuzzed without anyone editing this file. Requires
 * loadBoxSpecs() to have resolved; returns [] before that, which callers treat as "no
 * bias available" rather than as an error.
 */
export function arityRuleNames(): string[] {
  const specs = boxSpecs();
  if (!specs) return [];
  return Object.keys(specs).filter((name) => specs[name].io !== undefined).sort();
}

/** Every catalog name, cached: objectOptions() is stable but the map is not free. */
let allNames: string[] | undefined;
function catalogNames(): string[] {
  return (allNames ??= objectOptions().map((o) => o.name));
}

/** One line of box text: a class name, some arguments, sometimes an @attribute. */
function randomBoxText(rng: Rng, name: string, maxclass: string): string {
  // See restriction (1) in the module header: only these three classes keep their text.
  if (!TEXT_CLASSES.has(maxclass)) return name;

  const parts = [name];
  const argc = rng.int(5); // 0..4 — enough to shrink, match and exceed a default arity
  for (let i = 0; i < argc; i++) parts.push(rng.pick(ARG_TOKENS));

  // Attributes only on object boxes: a message box's `@gain 0.5` is a two-atom message
  // to send, not an attribute, and ir/objectspec deliberately does not split it.
  if (maxclass === 'newobj' && rng.chance(0.25)) {
    parts.push(`@${rng.pick(ATTR_KEYS)}`, rng.pick(ARG_TOKENS));
  }
  return parts.join(' ');
}

/**
 * One random document. `PatchDoc.empty()` rather than `PatchDoc.create()` because the
 * caller has already awaited loadBoxSpecs() once for the whole suite — addBox throws
 * without it, so a missing await fails loudly rather than generating wrong arities.
 */
export function randomDoc(rng: Rng, opts: GenOptions = {}): PatchDoc {
  const [lo, hi] = opts.boxes ?? [2, 9];
  const bias = opts.arityRuleBias ?? 0.45;
  const density = opts.cordDensity ?? 1.75;

  const ruleNames = arityRuleNames();
  const names = catalogNames();
  const doc = PatchDoc.empty();

  const count = rng.between(lo, hi);
  for (let i = 0; i < count; i++) {
    const useRule = ruleNames.length > 0 && rng.chance(bias);
    const name = useRule ? rng.pick(ruleNames) : rng.pick(names);
    const maxclass = boxSpecs()?.[name]?.box.maxclass;
    // A name with no spec (or a spec with no maxclass) is treated as an object box; the
    // resolver will fall back to the manifest and the round trip still has to hold.
    const text = randomBoxText(rng, name, typeof maxclass === 'string' ? maxclass : 'newobj');
    // Grid positions, so a failing case is readable when dumped as a .maxpat.
    doc.addBox(text, 40 + (i % 5) * 160, 40 + Math.floor(i / 5) * 90);
  }

  const nodes = [...doc.nodes()];
  const sources = nodes.filter((n) => n.numOutlets > 0);
  const sinks = nodes.filter((n) => n.numInlets > 0);
  if (sources.length > 0 && sinks.length > 0) {
    const attempts = Math.round(nodes.length * density);
    for (let i = 0; i < attempts; i++) {
      const from = rng.pick(sources);
      const to = rng.pick(sinks);
      if (from.id === to.id) continue; // legal in Max, but it tells us nothing extra
      // Ports are drawn from the box's OWN arity, so every attempt is in range; addEdge
      // still refuses a duplicate, and a refusal is a perfectly good outcome here.
      doc.addEdge(
        { id: from.id, outlet: rng.int(from.numOutlets) },
        { id: to.id, inlet: rng.int(to.numInlets) },
      );
    }
  }

  return doc;
}
