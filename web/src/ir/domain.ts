// One definition of "what kind of cord is this?".
//
// Max records each outlet's type as a free-form token in the box's `outlettype[]`
// ("signal", "bang", "jit_matrix", "", "list", "mpeevent", …). The engine only cares
// about three transports, and the mapping from token to transport was previously
// written out twice — in parser/maxpat.ts and again in scripts/gen-manifest.mjs — so a
// new token (multichannelsignal was exactly that case) had to be remembered in two
// places or a cord would silently be built as control and carry nothing.
//
// This module is the one place that decision is made for code; the generator keeps its
// own copy only because it runs under plain node with no TS build step.

import type { Domain } from './types';

/**
 * The transport an outlet carries, from its Max `outlettype` token.
 *
 * Anything that isn't audio or a Jitter matrix is control — including "" (the
 * "anything" outlet), which is by far the most common token in the corpus.
 */
export function outletDomain(t?: string): Domain {
  if (t === 'signal' || t === 'multichannelsignal') return 'signal';
  if (t === 'jit_matrix') return 'video';
  return 'control';
}

/** Domains for a whole `outlettype[]`, padded to `count` (a missing entry is control). */
export function outletDomains(outlettype: readonly string[], count: number): Domain[] {
  return Array.from({ length: count }, (_, i) => outletDomain(outlettype[i]));
}
