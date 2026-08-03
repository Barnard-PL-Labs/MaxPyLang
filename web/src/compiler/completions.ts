// Autocomplete for MaxPy in the Studio editor.
//
// Two sources, driven off the same object metadata the engine uses:
//   1. inside place("…")  → every Max object class name, with its argument
//      signature and I/O as the completion detail/info (nobody remembers 1000+
//      object names, and this is where they're needed).
//   2. after a dot         → the maxpylang API surface (place/connect/save/…).

import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { MANIFEST } from '../engine/registry';

// Characters that can appear in a Max class name (cycle~, *~, jit.grab, >=, +).
const NAME_CHARS = String.raw`\w.~+\-*/!<>=%&|`;
const IN_PLACE = new RegExp(`place\\(\\s*["'][${NAME_CHARS}]*$`);
const NAME_TAIL = new RegExp(`^[${NAME_CHARS}]*$`);

const primaryDomain = (e: (typeof MANIFEST)[string]): string =>
  e.outletDomains.includes('signal') ? 'signal'
  : e.outletDomains.includes('video') ? 'video'
  : e.numOutlets === 0 ? 'sink' : 'control';

const OBJECT_OPTIONS: Completion[] = Object.entries(MANIFEST)
  .map(([name, e]) => {
    const args = e.args.map((a) => (a.optional ? `[${a.name}]` : a.name)).join(' ');
    const dom = primaryDomain(e);
    return {
      label: name,
      // domain → icon colour: signal reads as a "method", control a "variable".
      type: dom === 'signal' ? 'method' : dom === 'video' ? 'namespace' : 'variable',
      detail: args || undefined,
      info: `${dom} · ${e.numInlets} in / ${e.numOutlets} out`,
    } satisfies Completion;
  });

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
      return { from: inPlace.to - token.length, options: OBJECT_OPTIONS, validFor: NAME_TAIL };
    }
  }
  // 2) after a dot — maxpylang members
  const dot = context.matchBefore(/\.\w*$/);
  if (dot) {
    return { from: dot.from + 1, options: API_OPTIONS, validFor: /^\w*$/ };
  }
  return null;
}
