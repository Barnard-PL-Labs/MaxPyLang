// The Studio editor's completion source.
//
// Two things are pinned. First the behaviour: which of the two option sets a cursor
// position selects, and that the reference prose is folded into the rows once it loads.
// Second the COST — generated/objdocs.json is ~645 KB raw / ~130 KB gzipped and this
// module is a static import of studio.ts, so an import() at module scope downloads the
// whole chunk during page boot, on the same connection as the Pyodide runtime and the
// maxpylang wheel, for a popup most visitors never open. That has to stay a first-use
// request, and the only way to see the difference headlessly is where the call sits in
// the source — a resolved dynamic import is indistinguishable from an eager one a few
// microtasks later.

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CompletionContext } from '@codemirror/autocomplete';
import '../src/objects'; // bootstrap, exactly as studio.ts does: tiers must be real
import { maxpyComplete } from '../src/compiler/completions';

/**
 * The half of CodeMirror's CompletionContext this source uses: matchBefore(re) matches an
 * end-anchored regex against the text before the cursor. Both regexes in the module carry
 * their own `$`, so matching against the prefix is the same thing.
 */
function contextAt(doc: string): CompletionContext {
  return {
    pos: doc.length,
    matchBefore(re: RegExp) {
      const m = doc.match(re);
      return m ? { from: doc.length - m[0].length, to: doc.length, text: m[0] } : null;
    },
  } as unknown as CompletionContext;
}

const labels = (doc: string): string[] =>
  (maxpyComplete(contextAt(doc))?.options ?? []).map((o) => String(o.label));

const infoOf = (doc: string, label: string): string =>
  String(maxpyComplete(contextAt(doc))!.options.find((o) => o.label === label)!.info);

describe('maxpyComplete', () => {
  it('offers Max object names inside place("…"), replacing just the typed token', () => {
    const result = maxpyComplete(contextAt('osc = patch.place("cyc'))!;
    expect(result).not.toBeNull();
    expect(result.from).toBe('osc = patch.place("cyc'.length - 3);
    expect(result.options.map((o) => String(o.label))).toContain('cycle~');
    expect(result.options.length).toBeGreaterThan(1000);
  });

  it('stops offering objects once the cursor is past the class name', () => {
    // `place("cycle~ 4` is typing an ARGUMENT; a class list there is noise.
    expect(maxpyComplete(contextAt('patch.place("cycle~ 4'))).toBeNull();
  });

  it('offers the maxpylang API after a dot, and nothing in open code', () => {
    expect(labels('patch.pl')).toEqual(
      expect.arrayContaining(['place', 'connect', 'save', 'move', 'outs', 'ins']),
    );
    expect(maxpyComplete(contextAt('x = 1 + 2'))).toBeNull();
  });

  it('describes each object by domain and arity even with no prose loaded', () => {
    // The very first call cannot have the digests: requestDigests() only starts the
    // import, whose .then is a microtask away, and the options are built synchronously.
    expect(infoOf('patch.place("cyc', 'cycle~')).toBe('signal · 2 in / 1 out');
  });

  it('folds the reference digests in once the lazy chunk arrives', async () => {
    await vi.waitFor(() => {
      expect(infoOf('patch.place("cyc', 'cycle~')).toBe(
        'Sinusoidal oscillator · signal · 2 in / 1 out',
      );
    });
    // An alias borrows its canonical object's prose — there is no `t` entry in objdocs.
    expect(infoOf('patch.place("t', 't')).toContain('Send input to many places');
  });
});

describe('the objdocs chunk is paid for by the completion, not by the page load', () => {
  it('imports generated/objdocs.json from inside a function, never at module scope', () => {
    const code = readFileSync(
      fileURLToPath(new URL('../src/compiler/completions.ts', import.meta.url)),
      'utf-8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    const at = code.indexOf("import('../generated/objdocs.json')");
    expect(at, 'the lazy objdocs import has moved or been renamed').toBeGreaterThan(0);
    // Brace depth at that point: 0 means the statement runs when the module is evaluated.
    // Every brace in this file is either a block or a balanced `${…}`, so counting is safe.
    const before = code.slice(0, at);
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(depth, 'objdocs is imported at module scope and downloads on page load').toBeGreaterThan(0);
  });
});
