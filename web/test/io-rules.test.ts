// Parity between src/ir/io-rules.ts and the maxpylang it was ported from.
//
// test/fixtures/io-parity.json is a capture, not a hand-written expectation: every row
// is the box dict a real maxpylang produced for that text (see scripts/gen-io-fixtures.py).
// Re-run the generator and this suite re-pins itself against whatever upstream does now.
//
// The contract is total. Every row either matches the port exactly, or is named in
// KNOWN_DIVERGENCES with the values the port is expected to produce instead — and a
// listed row must genuinely differ, so a divergence upstream fixes stops being allowed
// the moment it is fixed. A divergence that nobody wrote down is a failure.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  applyIoRules,
  vstSave,
  xletCount,
  xletTypes,
  KNOWN_DIVERGENCES,
  type IoRules,
  type XletCounts,
} from '../src/ir/io-rules';
import { parseBoxText } from '../src/ir/objectspec';
import type { ArgValue } from '../src/ir/types';

/** One captured (text -> box dict). Counts are null when maxpylang raised instead. */
interface ParityRow {
  text: string;
  numinlets: number | null;
  numoutlets: number | null;
  outlettype: string[] | null;
  /** Only for the objects that have one; vst~ is the only one whose args reach it. */
  save?: ArgValue[];
  error?: string;
}

interface BoxSpecEntry {
  box: { numinlets?: number; numoutlets?: number; outlettype?: string[]; save?: ArgValue[] };
  io?: IoRules;
}

interface ManifestEntry {
  aliasOf?: string;
}

function load<T>(rel: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf-8')) as T;
}

const FIXTURE = load<ParityRow[]>('./fixtures/io-parity.json');
const BOXSPECS = load<Record<string, BoxSpecEntry>>('../src/generated/boxspecs.json');
const MANIFEST = load<Record<string, ManifestEntry>>('../src/generated/manifest.json');

/** maxpylang's unknown_obj_dict: no such object, so no xlets and no outlettype. */
const UNKNOWN: XletCounts = { numinlets: 0, numoutlets: 0, outlettype: [] };

const divergences = new Map(KNOWN_DIVERGENCES.map((d) => [d.text, d]));

/** The whole pipeline a patcher runs on one line of box text, minus resolveBox's policy. */
function port(text: string): XletCounts {
  const { name, args } = parseBoxText(text);
  const canonical = MANIFEST[name]?.aliasOf ?? name;
  const spec = BOXSPECS[canonical];
  if (!spec) return UNKNOWN;
  return applyIoRules(spec.io, args, {
    numinlets: spec.box.numinlets ?? 0,
    numoutlets: spec.box.numoutlets ?? 0,
    outlettype: spec.box.outlettype ?? [],
  });
}

/**
 * The `save` list a box of this text gets stamped with — the other half of what the args
 * decide, and the half Max reads a vst~'s plugin back from. Mirrors resolveBox.
 */
function portSave(text: string): ArgValue[] | undefined {
  const { name, args } = parseBoxText(text);
  const canonical = MANIFEST[name]?.aliasOf ?? name;
  const save = BOXSPECS[canonical]?.box.save;
  if (!save) return undefined;
  return canonical === 'vst~' && args.length > 0 ? vstSave(save, args) : [...save];
}

/** The fixture row as XletCounts; unknown objects carry no outlettype key at all. */
const asCounts = (row: ParityRow): XletCounts => ({
  numinlets: row.numinlets ?? 0,
  numoutlets: row.numoutlets ?? 0,
  outlettype: row.outlettype ?? [],
});

describe('io-rules parity with maxpylang', () => {
  it('has a fixture covering every object with an arity rule', () => {
    const ruled = Object.keys(BOXSPECS).filter((k) => BOXSPECS[k].io);
    expect(ruled.length).toBe(46);
    const covered = new Set(FIXTURE.map((r) => parseBoxText(r.text).name));
    expect(ruled.filter((name) => !covered.has(name))).toEqual([]);
    expect(FIXTURE.length).toBeGreaterThan(200);
  });

  it.each(FIXTURE.filter((r) => !divergences.has(r.text)).map((r) => [r.text, r] as const))(
    'matches maxpylang for %s',
    (_text, row) => {
      // A row maxpylang could not build at all must be on the allowlist, not here.
      expect(row.error).toBeUndefined();
      expect(port(row.text)).toEqual(asCounts(row));
    },
  );

  it.each(KNOWN_DIVERGENCES.map((d) => [d.text, d] as const))(
    'diverges from maxpylang for %s, exactly as documented',
    (text, divergence) => {
      const row = FIXTURE.find((r) => r.text === text);
      expect(row, `${text} is not in the fixture`).toBeDefined();
      const ours = port(text);
      expect(ours).toEqual(divergence.expect);
      // The point of the allowlist: if upstream ever agrees with us, drop the entry.
      if (!row!.error) expect(ours).not.toEqual(asCounts(row!));
    },
  );

  it.each(FIXTURE.filter((r) => r.save).map((r) => [r.text, r] as const))(
    'matches maxpylang\'s save list for %s',
    (_text, row) => {
      expect(portSave(row.text)).toEqual(row.save);
    },
  );

  it('captures a save list that the arguments actually changed', () => {
    // Guards the guard: if the capture stopped recording `save`, or vst~ left the corpus,
    // the it.each above would silently become zero cases.
    const withSave = FIXTURE.filter((r) => r.save);
    expect(withSave.length).toBeGreaterThan(0);
    const bare = FIXTURE.find((r) => r.text === 'vst~')!;
    const armed = FIXTURE.find((r) => r.text === 'vst~ 2 plug.vst')!;
    expect(armed.save).not.toEqual(bare.save);
    expect(armed.save).toContain('plug.vst');
  });

  it('never diverges silently', () => {
    const unexplained = FIXTURE.filter((row) => {
      if (divergences.has(row.text)) return false;
      if (row.error) return true;
      return JSON.stringify(port(row.text)) !== JSON.stringify(asCounts(row));
    });
    expect(unexplained.map((r) => r.text)).toEqual([]);
  });
});

describe('the rule interpreter itself', () => {
  it('contains no eval', () => {
    // The module quotes upstream's `eval(str(n) + comparitor)` in its header, so match
    // against the code only. The stripper is naive (no `//` hides inside a string or
    // regex literal in this file) and would need rethinking if that changed.
    const code = readFileSync(
      fileURLToPath(new URL('../src/ir/io-rules.ts', import.meta.url)),
      'utf-8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\beval\s*\(/);
    expect(code).not.toMatch(/\bnew\s+Function\b/);
    expect(code).toMatch(/passesComparitor/);
  });

  it('parses every comparitor the corpus actually uses', () => {
    const used = new Set<string>();
    for (const spec of Object.values(BOXSPECS)) {
      for (const terms of Object.values(spec.io ?? {})) {
        for (const term of terms) if (term.comparitor) used.add(term.comparitor);
      }
    }
    expect([...used].sort()).toEqual(['>1', '>3', '>=2']);

    // >=2 gates buddy: below it the rule yields the default, at or above it the arg wins.
    const buddy = [{ argtype: 'a', index: 0, comparitor: '>=2' }];
    expect(xletCount(buddy, [1], 2)).toBe(2);
    expect(xletCount(buddy, [2], 2)).toBe(2);
    expect(xletCount(buddy, [5], 2)).toBe(5);
  });

  it('treats an unparseable comparitor as failing, not as passing', () => {
    const terms = [{ argtype: 'a', index: 0, comparitor: 'os.system("rm -rf /")' }];
    expect(xletCount(terms, [9], 3)).toBe(3);
  });

  it('snaps to the nearest accepted value, ties to the first listed', () => {
    const wave = [{ argtype: 'a', index: 0, acc_vals: [1, 2, 4] }];
    expect(xletCount(wave, [0], 1)).toBe(1);
    expect(xletCount(wave, [3], 1)).toBe(2); // |2-3| == |4-3|, and 2 is listed first
    expect(xletCount(wave, [5], 1)).toBe(4);
    expect(xletCount(wave, [99], 1)).toBe(4);
  });

  it('filters to numeric args for argtype "n" and truncates toward zero', () => {
    const terms = [{ argtype: 'n', index: 0 }];
    expect(xletCount(terms, ['myobj', 3], 1)).toBe(3);
    expect(xletCount(terms, ['myobj'], 1)).toBe(1); // nothing numeric -> fallback
    expect(xletCount(terms, [2.7], 1)).toBe(2);
    expect(xletCount(terms, [-2.7], 1)).toBe(-2);
    // argtype "a" takes the args as they are, so the symbol IS argument 0.
    expect(xletCount([{ argtype: 'a', index: 0 }], ['myobj', 3], 1)).toBe(1);
  });

  it('sums every term, and one failing term discards the others', () => {
    // sfplay~: outlets = channels + 1, plus a second term keyed on a later arg.
    const sfplay = [
      { argtype: 'n', index: 0, add_amt: 1 },
      { argtype: 'n', index: 2, acc_vals: [1, 2] },
    ];
    expect(xletCount(sfplay, [4, 0, 2], 2)).toBe(7);
    expect(xletCount(sfplay, [2], 2)).toBe(2); // no third arg: the first term is discarded too
  });

  it('keeps the defaults when there are no args at all', () => {
    const unpack: IoRules = { numoutlets: [{ argtype: 'a', index: 'all', type: 'unpack_out' }] };
    const defaults = { numinlets: 1, numoutlets: 2, outlettype: ['int', 'int'] };
    expect(applyIoRules(unpack, [], defaults)).toEqual(defaults);
    expect(applyIoRules(unpack, [1, 2, 3], defaults)).toEqual({
      numinlets: 1,
      numoutlets: 3,
      outlettype: ['int', 'int', 'int'],
    });
  });

  it('types trigger outlets from its format args', () => {
    expect(xletTypes('trigger_out', 5, ['b', 'i', 'f', 's', 'l'])).toEqual([
      'bang', 'int', 'float', '', 'l',
    ]);
    // int() accepts a float, so a numeric arg always reads as int — as upstream does.
    expect(xletTypes('trigger_out', 2, [0, 1.5])).toEqual(['int', 'int']);
  });

  it('fills a {default, first, last} map from both ends', () => {
    const vst = {
      default: 'signal',
      last: [6, ['', 'list', 'int', '', '', '']] as [number, string[]],
    };
    expect(xletTypes(vst, 8, [])).toEqual([
      'signal', 'signal', '', 'list', 'int', '', '', '',
    ]);
    expect(xletTypes(vst, 9, [])).toEqual([
      'signal', 'signal', 'signal', '', 'list', 'int', '', '', '',
    ]);
    expect(
      xletTypes({ default: 'signal', first: [1, 'multichannelsignal'], last: [1, 'bang'] }, 4, []),
    ).toEqual(['multichannelsignal', 'signal', 'signal', 'bang']);
  });

  it('always returns one type per xlet', () => {
    for (const row of FIXTURE) {
      const counts = port(row.text);
      expect(counts.outlettype.length, row.text).toBe(counts.numoutlets);
    }
  });
});
