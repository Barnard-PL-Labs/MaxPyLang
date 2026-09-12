// The catalog is the single object-lookup surface: the Studio's place("…") autocomplete
// today, the patcher's palette and in-box completion next. Two things its callers cannot
// check for themselves are pinned here.
//
// First, coverage and tiering. The table is built lazily so that `tier` can read the
// registry AFTER src/objects has registered everything — get that ordering wrong and the
// whole catalog silently reports Tier A, which would label every object "no sound yet" in
// the palette. So this file imports the bootstrap first, exactly like signature.test.ts,
// and then asserts the tier split against isSupported() object by object.
//
// Second, ranking. "Typing cyc offers cycle~ first" is a UX contract, not an
// implementation detail: alphabetical order would put `cycle` (a stub) above `cycle~` (the
// oscillator everyone means), and that is precisely the tie-break the ranking exists for.

import { describe, expect, it } from 'vitest';
import '../src/objects'; // bootstrap: real objects + Tier-A stubs — MUST precede any catalog call
import { MANIFEST, isSupported } from '../src/engine/registry';
import { matchObjects, objectInfo, objectOptions, objectsByPackage } from '../src/engine/catalog';

const names = (os: { name: string }[]): string[] => os.map((o) => o.name);

describe('objectOptions', () => {
  it('covers every manifest object exactly once, sorted by name', () => {
    const all = objectOptions();
    expect(all.length).toBe(1054);
    expect(all.length).toBe(Object.keys(MANIFEST).length);
    expect(new Set(names([...all])).size).toBe(all.length);

    const sorted = [...names([...all])].sort();
    expect(names([...all])).toEqual(sorted);
  });

  it('presents the manifest metadata each surface renders', () => {
    const cycle = objectInfo('cycle~')!;
    expect(cycle).toMatchObject({
      name: 'cycle~',
      pkg: 'msp',
      maxclass: 'newobj',
      domain: 'signal',
      tier: 'B',
      numInlets: 2,
      numOutlets: 1,
      argSignature: '[frequency] [buffer-name] [sample-offset]',
    });
    // required args are bare, optional ones bracketed — the signature hint in a box
    expect(objectInfo('clocker')!.argSignature).toBe('time-interval');
    expect(objectInfo('bendin')!.argSignature).toBe('port-and-channel channel [port] [midi-device]');
    expect(objectInfo('ezdac~')!.argSignature).toBe('');
  });

  it('reduces outlet domains to the one domain a box reads as', () => {
    expect(objectInfo('cycle~')!.domain).toBe('signal');
    expect(objectInfo('metro')!.domain).toBe('control');
    expect(objectInfo('jit.grab')!.domain).toBe('video'); // video + control outlets
    expect(objectInfo('ezdac~')!.domain).toBe('sink'); // no outlets at all
  });

  it('tiers a hand-checked table of objects correctly', () => {
    // Pinned by hand rather than against isSupported(), which is the expression catalog.ts
    // computes `tier` FROM — comparing the two can only ever agree. Each of these was
    // checked against the source: cycle~/metro/slider have real factories, `cycle` and
    // `borax` are metadata-only stubs, `t` inherits trigger's factory through its alias
    // and mc.cycle~ through the mc.* wrapper (src/objects/index.ts), and vst~ is a stub
    // even though it carries arity rules.
    const expected: Record<string, 'B' | 'A'> = {
      'cycle~': 'B', metro: 'B', slider: 'B', 'ezdac~': 'B', 'jit.grab': 'B',
      t: 'B', trigger: 'B', 'mc.cycle~': 'B',
      cycle: 'A', borax: 'A', print: 'A', 'vst~': 'A', 'jit.cycle': 'A',
    };
    for (const [name, tier] of Object.entries(expected)) {
      expect(objectInfo(name)!.tier, name).toBe(tier);
    }
  });

  it('forwards the registry for every other object, with no table of its own', () => {
    const tierB = objectOptions().filter((o) => o.tier === 'B');
    const supported = Object.keys(MANIFEST).filter((n) => isSupported(n));
    expect(tierB.length).toBe(supported.length);
    expect(names([...tierB]).sort()).toEqual(supported.sort());

    const wrong = objectOptions().filter((o) => (o.tier === 'B') !== isSupported(o.name));
    expect(names(wrong)).toEqual([]);
  });
});

describe('objectInfo', () => {
  it('resolves an alias to its canonical object', () => {
    expect(objectInfo('t')!.aliasOf).toBe('trigger');
    expect(objectInfo('trigger')!.aliases).toContain('t');
    expect(objectInfo('trigger')!.aliasOf).toBeUndefined();
    // the alias entry is a first-class object: same arity, same tier
    expect(objectInfo('t')!.numOutlets).toBe(objectInfo('trigger')!.numOutlets);
    expect(objectInfo('t')!.tier).toBe(objectInfo('trigger')!.tier);
  });

  it('returns undefined for a name the manifest does not know', () => {
    expect(objectInfo('not.an.object~')).toBeUndefined();
    expect(objectInfo('')).toBeUndefined();
  });
});

describe('matchObjects ranking', () => {
  it('offers cycle~ before cycle before mc.cycle~ for "cyc"', () => {
    // cycle~ and cycle both match by prefix; the Tier-B tie-break is what lifts the
    // oscillator above the stub, and substring matches trail both.
    expect(matchObjects('cyc')[0].name).toBe('cycle~');
    expect(names(matchObjects('cyc')).slice(0, 4)).toEqual([
      'cycle~',
      'cycle',
      'mc.cycle~',
      'jit.cycle',
    ]);
  });

  it('ranks exact name, then exact alias, ahead of everything prefixed', () => {
    const hits = names(matchObjects('t'));
    expect(hits.slice(0, 2)).toEqual(['t', 'trigger']);
    expect(hits.indexOf('timer')).toBeGreaterThan(1);
  });

  it('prefers shorter names within a rank once tier ties', () => {
    const hits = names(matchObjects('gat'));
    expect(hits.indexOf('gate')).toBeLessThan(hits.indexOf('gate~'));
  });

  it('falls back to subsequence matching, below every literal match', () => {
    const hits = names(matchObjects('cyl'));
    expect(hits).toContain('cycle~'); // c-y-[c]-l-e
    expect(hits).not.toContain('metro');
  });

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(matchObjects('  CYCLE~ ')[0].name).toBe('cycle~');
  });

  it('returns nothing when no name can be spelled from the query', () => {
    expect(matchObjects('zzzqqq')).toEqual([]);
  });
});

describe('matchObjects filtering', () => {
  it('browses the whole catalog in name order when the query is empty', () => {
    expect(names(matchObjects(''))).toEqual(names([...objectOptions()]));
    expect(matchObjects('', { limit: 3 }).length).toBe(3);
  });

  it("never returns a stub under tier 'B'", () => {
    const playable = matchObjects('', { tier: 'B' });
    // Against the same hand-checked pins as the tier test, so the filter is measured
    // against what the objects ARE and not against the field it filters on.
    expect(names(playable)).toEqual(expect.arrayContaining(['cycle~', 'metro', 'slider']));
    for (const stub of ['cycle', 'borax', 'vst~']) expect(names(playable)).not.toContain(stub);
    expect(playable.length).toBe(objectOptions().filter((o) => o.tier === 'B').length);
    expect(names(playable.filter((o) => !isSupported(o.name)))).toEqual([]);
    // the filter applies to searches too: `cycle` is recognized but has no behavior
    expect(names(matchObjects('cycle', { tier: 'B' }))).not.toContain('cycle');
    expect(names(matchObjects('cycle', { tier: 'B' }))).toContain('cycle~');
  });

  it('scopes to one package and caps the result length', () => {
    const jit = matchObjects('grab', { pkg: 'jit' });
    expect(jit.length).toBeGreaterThan(0);
    expect(jit.every((o) => o.pkg === 'jit')).toBe(true);
    expect(names(jit)).toContain('jit.grab');
    expect(matchObjects('c', { limit: 5 }).length).toBe(5);
  });
});

describe('objectsByPackage', () => {
  it('partitions the whole catalog with no overlap', () => {
    const groups = objectsByPackage();
    const total = groups.max.length + groups.msp.length + groups.jit.length;
    expect(total).toBe(1054);

    const union = new Set([...names(groups.max), ...names(groups.msp), ...names(groups.jit)]);
    expect(union.size).toBe(total);
    expect(union).toEqual(new Set(names([...objectOptions()])));

    for (const pkg of ['max', 'msp', 'jit'] as const) {
      expect(groups[pkg].every((o) => o.pkg === pkg)).toBe(true);
      expect(names(groups[pkg])).toEqual([...names(groups[pkg])].sort());
    }
  });

  it('hands out fresh arrays, so a caller can sort a group in place', () => {
    const first = objectsByPackage();
    const size = first.msp.length;
    first.msp.length = 0;
    expect(objectsByPackage().msp.length).toBe(size);
  });
});
