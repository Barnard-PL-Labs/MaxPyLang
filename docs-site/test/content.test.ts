// The reference's content agrees with the engine: every listed object really plays in
// the browser, and every example only uses objects that do.
import { describe, expect, it } from 'vitest';
import '../../web/src/objects';
import { objectInfo } from '../../web/src/engine/catalog';
import categoryFile from '../content/categories.json';
import examples from '../src/generated/examples.json';
import { categories, findEntry } from '../src/entries';

const listed = categoryFile.categories.flatMap((c) => c.objects);

describe('categories', () => {
  it('lists each object once', () => {
    const dupes = listed.filter((n, i) => listed.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it.each(listed)('%s plays in the browser engine', (name) => {
    expect(objectInfo(name)?.tier, `${name} is not a playable (tier B) object`).toBe('B');
  });
});

describe('examples', () => {
  it.each(examples.map((e) => [`${e.object}/${e.index}`, e] as const))('%s uses only playable objects', (_, ex) => {
    const silent = ex.objects.filter((n) => objectInfo(n)?.tier !== 'B');
    expect(silent).toEqual([]);
  });

  it('every example belongs to a listed object', () => {
    const orphans = examples.map((e) => e.object).filter((o) => !findEntry(o) || !listed.includes(o));
    expect(orphans).toEqual([]);
  });
});

describe('entries', () => {
  it('every listed entry has a description from Max', () => {
    const missing = categories().flatMap((c) => c.entries).filter((e) => listed.includes(e.name) && !e.digest).map((e) => e.name);
    expect(missing).toEqual([]);
  });
});
