// The object catalog: one searchable view over the ~1054 objects in the manifest.
//
// Three surfaces have to answer "which object did you mean?" the same way — the
// Studio's `place("…")` autocomplete, the patcher's palette, and the patcher's
// in-box completion. Ranking that lived in each of them would drift, and the same
// three keystrokes would offer different objects in different panes. So the ranking
// and the presentable shape of an object live here once; callers only render.
//
// ORDERING CONSTRAINT — read before calling: `tier` comes from the registry's
// isSupported(), which is only true once src/objects/index.ts has run its
// registration side effects. This module deliberately does NOT import that
// bootstrap: the catalog is imported by search UI that has no business dragging in
// every object implementation, and objects/index.ts owns registration order (real
// factories, then mc.* wrappers, then stubs) on its own. The table is therefore
// built lazily on the FIRST call and cached from then on, so any entry point that
// wants real tiers must `import './objects'` before it touches the catalog —
// otherwise every object reads as Tier A forever.

import { MANIFEST, isSupported } from './registry';

/** The single domain a box reads as at a glance — what colours its icon and ports. */
export type PrimaryDomain = 'signal' | 'control' | 'video' | 'sink';

/** The three maxpylang object packages; every manifest entry is in exactly one. */
export type Pkg = 'max' | 'msp' | 'jit';

export interface ObjectInfo {
  /** Class name as typed in a box: `cycle~`, `jit.grab`, `*~`. */
  name: string;
  pkg: Pkg;
  /** Max box class — `newobj` for typed boxes, else a UI class (`slider`, `toggle`). */
  maxclass: string;
  domain: PrimaryDomain;
  /** 'B' = real behavior, 'A' = metadata-only stub. See the ordering constraint above. */
  tier: 'B' | 'A';
  numInlets: number;
  numOutlets: number;
  /** Arg names, optional ones bracketed: `[frequency] [buffer-name] [sample-offset]`. */
  argSignature: string;
  /** Other names for this object (`trigger` → `['t']`); empty on the alias entries. */
  aliases: readonly string[];
  /** Set when this entry IS an alias: `t` → `trigger`. */
  aliasOf?: string;
}

export interface MatchOptions {
  /** Cap the result length. Omitted = every match, ranked — the palette wants them all. */
  limit?: number;
  pkg?: Pkg;
  /** 'B' keeps only objects that actually make sound (the palette's "playable only"). */
  tier?: 'B';
}

interface Catalog {
  all: ObjectInfo[];
  byName: Map<string, ObjectInfo>;
}

let cache: Catalog | undefined;

/** Code-unit order, not localeCompare: the sort must be identical in every locale. */
const compareName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const primaryDomain = (e: (typeof MANIFEST)[string]): PrimaryDomain =>
  e.outletDomains.includes('signal') ? 'signal'
  : e.outletDomains.includes('video') ? 'video'
  : e.numOutlets === 0 ? 'sink' : 'control';

function build(): Catalog {
  const all = Object.entries(MANIFEST).map(([name, e]): ObjectInfo => ({
    name,
    // the generator only ever emits max/msp/jit; catalog.test.ts's partition is the guard
    pkg: e.pkg as Pkg,
    maxclass: e.maxclass,
    domain: primaryDomain(e),
    tier: isSupported(name) ? 'B' : 'A',
    numInlets: e.numInlets,
    numOutlets: e.numOutlets,
    argSignature: e.args.map((a) => (a.optional ? `[${a.name}]` : a.name)).join(' '),
    aliases: e.aliases,
    ...(e.aliasOf ? { aliasOf: e.aliasOf } : {}),
  }));
  all.sort((a, b) => compareName(a.name, b.name));
  return { all, byName: new Map(all.map((o) => [o.name, o])) };
}

const catalog = (): Catalog => (cache ??= build());

/** Every known object, sorted by name. Stable identity: the same rows every call. */
export function objectOptions(): readonly ObjectInfo[] {
  return catalog().all;
}

/** Exact lookup by the name as typed in a box. Alias names resolve to their own row. */
export function objectInfo(name: string): ObjectInfo | undefined {
  return catalog().byName.get(name);
}

// Match strength, best first. This order IS the contract: typing "cyc" must offer
// cycle~ (name prefix, Tier B) before cycle (name prefix, Tier A) before mc.cycle~
// (substring) — never plain alphabetical, which would bury the object everyone means.
const EXACT = 0;
const EXACT_ALIAS = 1;
const PREFIX = 2;
const PREFIX_ALIAS = 3;
const SUBSTRING = 4;
const FUZZY = 5;
const NONE = 6;

/** Do q's characters appear in s in order? The last-resort "cy~" → "cycle~" rank. */
function isSubsequence(q: string, s: string): boolean {
  let i = 0;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) i++;
  }
  return i === q.length;
}

function rankOf(o: ObjectInfo, q: string): number {
  if (o.name === q) return EXACT;
  if (o.aliases.includes(q)) return EXACT_ALIAS;
  if (o.name.startsWith(q)) return PREFIX;
  if (o.aliases.some((a) => a.startsWith(q))) return PREFIX_ALIAS;
  if (o.name.includes(q) || o.aliases.some((a) => a.includes(q))) return SUBSTRING;
  return isSubsequence(q, o.name) ? FUZZY : NONE;
}

/**
 * Objects matching a partially typed name, best first: exact name → exact alias →
 * name prefix → alias prefix → substring → subsequence. Within one rank, playable
 * (Tier B) beats stub, then shorter names, then alphabetical — so a query is always
 * answered with the most useful object that is spelled the most like it.
 *
 * An empty query means "browse", not "search": the full list in name order.
 */
export function matchObjects(query: string, opts: MatchOptions = {}): ObjectInfo[] {
  const q = query.trim().toLowerCase(); // manifest names are all lowercase
  const pool = objectOptions().filter(
    (o) => (opts.pkg === undefined || o.pkg === opts.pkg) && (opts.tier === undefined || o.tier === opts.tier)
  );

  let hits = pool;
  if (q) {
    const ranked = pool
      .map((o) => ({ o, rank: rankOf(o, q) }))
      .filter((r) => r.rank !== NONE);
    ranked.sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.o.tier === b.o.tier ? 0 : a.o.tier === 'B' ? -1 : 1) ||
        a.o.name.length - b.o.name.length ||
        compareName(a.o.name, b.o.name)
    );
    hits = ranked.map((r) => r.o);
  }
  return opts.limit === undefined ? hits : hits.slice(0, opts.limit);
}

/**
 * The catalog split into the palette's three groups, each still in name order.
 * Built fresh per call so a caller can sort or splice a group in place without
 * corrupting the shared table.
 */
export function objectsByPackage(): Record<Pkg, ObjectInfo[]> {
  const groups: Record<Pkg, ObjectInfo[]> = { max: [], msp: [], jit: [] };
  for (const o of objectOptions()) groups[o.pkg].push(o);
  return groups;
}
