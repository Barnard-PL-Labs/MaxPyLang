// Everything the page knows about each object, merged from:
//   content/categories.json        which objects to list, under which heading (hand-made)
//   src/generated/examples.json    compiled examples (scripts/build_examples.py)
//   src/generated/stubs.json       Max name -> Python name in maxpylang.objects
//   src/generated/known.json       objects maxpylang can place, with required arguments
//   web/src/generated/objdocs.json description, inlets, outlets (from Max's reference)
//   web/src/generated/manifest.json arguments
//   web/src/engine/catalog.ts      whether the browser engine plays it (tier B)

import '../../web/src/objects'; // tiers are only right once objects are registered
import { objectOptions, type ObjectInfo } from '../../web/src/engine/catalog';
import { isSupported } from '../../web/src/engine/registry';
import categoryFile from '../content/categories.json';
import examplesFile from './generated/examples.json';
import stubsFile from './generated/stubs.json';
import knownFile from './generated/known.json';
import digestsFile from './generated/digests.json';
import objdocsFile from '../../web/src/generated/objdocs.json';
import manifestFile from '../../web/src/generated/manifest.json';

export interface Example {
  object: string;
  index: number;
  title: string;
  note: string;
  code: string;
  objects: string[];
  patch: unknown;
}

export interface Port {
  index: number;
  text: string;
  domain: string;
}

export interface Arg {
  name: string;
  type: string;
  optional: boolean;
}

export interface Entry {
  name: string;
  category: string;
  color: string;
  /** The browser engine makes this object behave (tier B). */
  playable: boolean;
  /** maxpylang has data for it, so place() gives a working object. */
  known: boolean;
  /** Arguments maxpylang insists on; without them place() gives an unknown object. */
  required: string[];
  /** Python name in maxpylang.objects, if there is one. */
  stub: string | null;
  digest: string;
  description: string;
  args: Arg[];
  inlets: Port[];
  outlets: Port[];
  examples: Example[];
  /** Set when the examples are another name's: an alias (/~ is div~, t is trigger). */
  sameAs: string | null;
}

export interface Category {
  name: string;
  color: string;
  blurb: string;
  entries: Entry[];
  /** Collapsed by default: long lists of objects with no examples. */
  collapsed?: boolean;
}

type Doc = {
  digest?: string;
  description?: string;
  inlets?: { index: number; text: string }[];
  outlets?: { index: number; text: string }[];
  inletDomains?: string[];
};
type Manifest = {
  args?: { name: string; type: string[]; optional: boolean }[];
  outletDomains?: string[];
  aliasOf?: string;
};

const objdocs = objdocsFile as Record<string, Doc>;
const manifest = manifestFile as Record<string, Manifest>;
const stubs = stubsFile as Record<string, string>;
const known = knownFile as Record<string, { required: string[]; aliasOf?: string }>;
const examples = examplesFile as Example[];
const digests = digestsFile as Record<string, string>;

// Objects no generated file describes. live.gain~ is added to the engine by hand
// (web/scripts/gen-manifest.mjs) and maxpylang has no data for it; this is the digest
// from Max's reference page (m4l-ref/live.gain~.maxref.xml).
const EXTRA_DIGESTS: Record<string, string> = {
  'live.gain~': 'Decibel volume slider and monitor',
};

// maxpylang's alias table, both ways: '/~' -> 'div~', and 'div~' -> ['/~'].
const aliasOf = (name: string): string | undefined => known[name]?.aliasOf;
const aliasesOf = (name: string): string[] => Object.keys(known).filter((k) => known[k]?.aliasOf === name);
const examplesFor = (name: string) => examples.filter((e) => e.object === name).sort((a, b) => a.index - b.index);

/** An object's examples, or else the examples filed under another name for the same object. */
function sharedExamples(name: string): { examples: Example[]; sameAs: string | null } {
  const own = examplesFor(name);
  if (own.length) return { examples: own, sameAs: null };
  for (const other of [aliasOf(name), ...aliasesOf(name)].filter((n): n is string => !!n)) {
    const theirs = examplesFor(other);
    if (theirs.length) return { examples: theirs, sameAs: other };
  }
  return { examples: [], sameAs: null };
}

function entryFor(info: ObjectInfo | undefined, name: string, category: string, color: string): Entry {
  // An alias (s, del, <~) has no reference page of its own: use the object it names.
  const alias = manifest[name]?.aliasOf ?? known[name]?.aliasOf ?? '';
  const doc = objdocs[name] ?? objdocs[alias] ?? {};
  const man = manifest[name] ?? manifest[alias] ?? {};
  const outletDomains = man.outletDomains ?? [];
  return {
    name,
    category,
    color,
    // The registry, not the catalog: an object can be implemented before its data reaches
    // the generated catalog (live.dial).
    playable: info?.tier === 'B' || isSupported(name),
    known: name in known,
    required: known[name]?.required ?? [],
    stub: stubs[name] ?? null,
    digest: doc.digest || digests[name] || digests[known[name]?.aliasOf ?? ''] || EXTRA_DIGESTS[name] || '',
    description: doc.description ?? '',
    args: (man.args ?? []).map((a) => ({ name: a.name, type: a.type.join('/'), optional: a.optional })),
    inlets: (doc.inlets ?? []).map((p, i) => ({ ...p, domain: doc.inletDomains?.[i] ?? 'control' })),
    outlets: (doc.outlets ?? []).map((p, i) => ({ ...p, domain: outletDomains[i] ?? 'control' })),
    ...sharedExamples(name),
  };
}

let cache: Category[] | null = null;

/** The categories, in display order, each with its entries. */
export function categories(): Category[] {
  if (cache) return cache;
  const infos = new Map(objectOptions().map((o) => [o.name, o]));
  const listed = new Set<string>();
  const out: Category[] = categoryFile.categories.map((c) => ({
    name: c.name,
    color: c.color,
    blurb: c.blurb,
    entries: c.objects.map((n) => {
      listed.add(n);
      return entryFor(infos.get(n), n, c.name, c.color);
    }),
  }));

  // Everything else: every object the browser engine knows, every stub in maxpylang.objects,
  // and every object maxpylang can place by name. test/content.test.ts checks none is left out.
  const restNames = [...new Set([...infos.keys(), ...Object.keys(stubs), ...Object.keys(known)])]
    .filter((n) => !listed.has(n));
  const rest = restNames.map((n) => ({ name: n, info: infos.get(n), plays: infos.get(n)?.tier === 'B' || isSupported(n) }));
  type Rest = (typeof rest)[number];
  const byName = (a: Rest, b: Rest) => a.name.localeCompare(b.name);
  const group = (name: string, color: string, blurb: string, pick: (o: Rest) => boolean): Category => ({
    name, color, blurb, collapsed: true,
    entries: rest.filter(pick).sort(byName).map((o) => entryFor(o.info, o.name, name, color)),
  });
  out.push(group('Multichannel', '#b8b8b8',
    'mc.* versions of the objects above: one box, many channels. The examples are written for Max; this browser player plays each mc.* object as one channel, in the left speaker.',
    (o) => o.plays && o.name.startsWith('mc.')));
  out.push(group('More objects that play here', '#c9c0b8',
    'Objects this browser player runs that have no example here yet.',
    (o) => o.plays && !o.name.startsWith('mc.')));
  out.push(group('More objects (Max only)', '#d9d9d9',
    'These work in Max but do not run in this browser player yet. Some, such as array.* and string.*, maxpylang cannot place yet either; their pages say so.',
    (o) => !o.plays));
  cache = out;
  return out;
}

export function findEntry(name: string): Entry | undefined {
  for (const c of categories()) {
    const e = c.entries.find((x) => x.name === name);
    if (e) return e;
  }
  return undefined;
}

/** A Python-friendly argument name: buffer-name -> buffer_name. */
export const pyArg = (name: string): string => name.replace(/[^A-Za-z0-9_]/g, '_');

type Box = { box: { maxclass?: string; text?: string; patcher?: { boxes?: Box[] } } };

/** The objects in a patch (and in its subpatchers) that this browser player cannot run. */
export function notInBrowser(patch: unknown): string[] {
  const missing = new Set<string>();
  const walk = (boxes: Box[] = []) => {
    for (const { box } of boxes) {
      const name = box.maxclass === 'newobj' ? (box.text ?? '').split(' ')[0] : box.maxclass ?? '';
      if (name && !isSupported(name)) missing.add(name);
      walk(box.patcher?.boxes);
    }
  };
  walk((patch as { patcher?: { boxes?: Box[] } } | null)?.patcher?.boxes);
  return [...missing].sort();
}

/** Why a patch plays nothing in this browser (it uses an object the browser can't run), or null. */
export function silentReason(_object: string, patch: unknown): string | null {
  const missing = notInBrowser(patch);
  if (missing.length) return `This browser player can't run ${missing.join(', ')}, so nothing plays here. In Max it runs.`;
  return null;
}
