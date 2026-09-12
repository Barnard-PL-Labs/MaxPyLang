// Autocomplete for MaxPy in the Studio editor.
//
// Two sources, driven off the same object metadata the engine uses:
//   1. inside place("…")  → every Max object class name, with its argument
//      signature and I/O as the completion detail/info (nobody remembers 1000+
//      object names, and this is where they're needed). The rows come from
//      engine/catalog, which the patcher's palette also reads, so the two surfaces
//      can never disagree about what an object is.
//   2. after a dot         → the maxpylang API surface (place/connect/save/…).

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { objectOptions } from '../engine/catalog';

// Characters that can appear in a Max class name (cycle~, *~, jit.grab, >=, +).
const NAME_CHARS = String.raw`\w.~+\-*/!<>=%&|`;
const IN_PLACE = new RegExp(`place\\(\\s*["'][${NAME_CHARS}]*$`);
const NAME_TAIL = new RegExp(`^[${NAME_CHARS}]*$`);

// One-line digests from the generated reference docs. That file is ~645 KB raw / ~130 KB
// gzipped and is produced by a separate generator, so it is pulled in lazily and never
// awaited: if it is missing the completions simply carry no prose. Arriving late
// invalidates the built list rather than mutating options CodeMirror may already be
// showing.
//
// The request is fired from the first completion, NOT from module scope — this module is
// a static import of studio.ts, so a top-level import() would download the whole chunk
// during page boot, competing with the Pyodide runtime and the maxpylang wheel for a
// connection, on behalf of a popup most visitors never open.
let digests: Record<string, { digest?: string }> = {};
let objectOptionsCache: Completion[] | undefined;
let docsRequested = false;

function requestDigests(): void {
  if (docsRequested) return;
  docsRequested = true;
  void import('../generated/objdocs.json')
    .then((m) => {
      digests = m.default as unknown as Record<string, { digest?: string }>;
      objectOptionsCache = undefined;
    })
    .catch(() => {});
}

// Built on first use, not at import: catalog tiers are only accurate once the object
// bootstrap has run, and building 1000+ options costs nothing to defer.
const objectCompletions = (): Completion[] => {
  requestDigests();
  return (objectOptionsCache ??= objectOptions().map((o) => {
    const digest = digests[o.aliasOf ?? o.name]?.digest;
    return {
      label: o.name,
      // domain → icon colour: signal reads as a "method", control a "variable".
      type: o.domain === 'signal' ? 'method' : o.domain === 'video' ? 'namespace' : 'variable',
      detail: o.argSignature || undefined,
      info: `${digest ? `${digest} · ` : ''}${o.domain} · ${o.numInlets} in / ${o.numOutlets} out`,
    } satisfies Completion;
  }));
};

const API_OPTIONS: Completion[] = [
  { label: 'place', type: 'method', detail: '("obj args") → [MaxObject]', info: 'add an object to the patch' },
  { label: 'connect', type: 'method', detail: '([a.outs[i], b.ins[j]])', info: 'wire an outlet to an inlet' },
  { label: 'save', type: 'method', detail: '("name.maxpat")', info: 'the Studio plays whatever you save()' },
  { label: 'move', type: 'method', detail: '(x, y)', info: 'position the object in the graph' },
  { label: 'outs', type: 'property', info: 'object outlets — outs[0], outs[1], …' },
  { label: 'ins', type: 'property', info: 'object inlets — ins[0], ins[1], …' },
  { label: 'get_json', type: 'method', info: 'the .maxpat dict for this patch' },
];

export function maxpyComplete(context: CompletionContext): CompletionResult | null {
  // 1) inside place("…") — the class-name token being typed (bail once past it into args)
  const inPlace = context.matchBefore(IN_PLACE);
  if (inPlace) {
    const quote = Math.max(inPlace.text.lastIndexOf('"'), inPlace.text.lastIndexOf("'"));
    const token = inPlace.text.slice(quote + 1);
    if (!/\s/.test(token)) {
      return { from: inPlace.to - token.length, options: objectCompletions(), validFor: NAME_TAIL };
    }
  }
  // 2) after a dot — maxpylang members
  const dot = context.matchBefore(/\.\w*$/);
  if (dot) {
    return { from: dot.from + 1, options: API_OPTIONS, validFor: /^\w*$/ };
  }
  return null;
}
