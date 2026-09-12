// The catalog's laziness, from the one angle catalog.test.ts cannot see.
//
// engine/catalog.ts builds its table on FIRST CALL and caches it, because `tier` reads
// the registry and the registry is only populated once src/objects has run its
// registration side effects. Build the table at module evaluation instead and every
// object reads as Tier A forever — the palette would label the whole of Max "no sound
// yet" and the Studio's completions would rank a stub above the object everyone means.
//
// catalog.test.ts cannot catch that regression: it imports the bootstrap first, so the
// table tiers correctly whether it is built eagerly or lazily. Import order is per module
// graph and vitest gives each test file its own, so the reversed order has to live in a
// file of its own — this one. Nothing here may import '../src/objects' above the catalog.

import { describe, expect, it } from 'vitest';
// Deliberately first: this module must be evaluated BEFORE anything registers an object.
import { matchObjects, objectInfo, objectOptions } from '../src/engine/catalog';
import '../src/objects';

describe('the catalog is built on first use, not at import', () => {
  it('tiers objects correctly even when it was imported before the bootstrap', () => {
    // Same hand-checked pins as catalog.test.ts. Under an eager build every one of these
    // would be 'A', because at catalog-evaluation time nothing was registered yet.
    expect(objectInfo('cycle~')!.tier).toBe('B');
    expect(objectInfo('metro')!.tier).toBe('B');
    expect(objectInfo('mc.cycle~')!.tier).toBe('B');
    expect(objectInfo('cycle')!.tier).toBe('A');
    expect(objectOptions().filter((o) => o.tier === 'B').length).toBeGreaterThan(100);
  });

  it('still ranks the playable object first, which is what the tier is for', () => {
    // The user-visible consequence of the ordering bug: with every tier 'A' the Tier-B
    // tie-break goes dead and `cyc` offers the stub `cycle` ahead of the oscillator.
    expect(matchObjects('cyc')[0].name).toBe('cycle~');
    expect(matchObjects('', { tier: 'B' }).length).toBeGreaterThan(100);
  });
});
