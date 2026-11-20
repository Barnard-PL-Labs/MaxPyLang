// The reference's content agrees with the engine: every listed object really plays in
// the browser, and every example only uses objects that do.
import { describe, expect, it } from 'vitest';
import '../../web/src/objects';
import { isSupported } from '../../web/src/engine/registry';
import categoryFile from '../content/categories.json';
import examples from '../src/generated/examples.json';
import { categories, findEntry, notInBrowser } from '../src/entries';
import known from '../src/generated/known.json';
import notesFile from '../content/notes.json';

const graphOnly = (notesFile as { graphOnly?: Record<string, string> }).graphOnly ?? {};

const listed = categoryFile.categories.flatMap((c) => c.objects);

describe('categories', () => {
  it('lists each object once', () => {
    const dupes = listed.filter((n, i) => listed.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it.each(listed)('%s plays in the browser engine', (name) => {
    expect(isSupported(name), `${name} has no implementation in the browser engine`).toBe(true);
  });
});

describe('examples', () => {
  // An example may be graph-only (it shows its patch but plays nothing) only when the
  // object it documents is one the browser can't run. Then nothing silent hides among the
  // examples that should play.
  const alias = (n: string) => (known as Record<string, { aliasOf?: string }>)[n]?.aliasOf ?? n;
  it.each(examples.map((e) => [`${e.object}/${e.index}`, e] as const))('%s plays, or is for an object the browser cannot run', (_, ex) => {
    const missing = notInBrowser(ex.patch);
    if (missing.length === 0) return;
    if (graphOnly[ex.object]) return; // a stated reason (content/notes.json)
    expect(missing.map(alias), `${ex.object} plays in the browser, so its example must too`).toContain(alias(ex.object));
  });

  it('every example belongs to an object with a page', () => {
    const orphans = examples.map((e) => e.object).filter((o) => !findEntry(o));
    expect(orphans).toEqual([]);
  });
});

describe('entries', () => {
  it('every listed entry has a description from Max', () => {
    const missing = categories().flatMap((c) => c.entries).filter((e) => listed.includes(e.name) && !e.digest).map((e) => e.name);
    expect(missing).toEqual([]);
  });
});

describe('coverage', () => {
  it('every listed object has an example, or a reason it has none', async () => {
    const notes = (await import('../content/notes.json')).default as { noExample: Record<string, string> };
    const gaps = categories().flatMap((c) => c.entries)
      .filter((e) => listed.includes(e.name) && e.examples.length === 0 && !notes.noExample[e.name])
      .map((e) => e.name);
    expect(gaps).toEqual([]);
  });
});

describe('completeness', () => {
  it('every object in maxpylang.objects, or that maxpylang can place, has a page', async () => {
    const stubs = (await import('../src/generated/stubs.json')).default as Record<string, string>;
    const known = (await import('../src/generated/known.json')).default as Record<string, unknown>;
    const onPage = new Set(categories().flatMap((c) => c.entries.map((e) => e.name)));
    const missing = [...new Set([...Object.keys(stubs), ...Object.keys(known)])].filter((n) => !onPage.has(n));
    expect(missing).toEqual([]);
  });

  it('no object is listed twice', () => {
    const names = categories().flatMap((c) => c.entries.map((e) => e.name));
    expect(names.filter((n, i) => names.indexOf(n) !== i)).toEqual([]);
  });
});
