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

function entryFor(info: ObjectInfo | undefined, name: string, category: string, color: string): Entry {
  const doc = objdocs[name] ?? objdocs[manifest[name]?.aliasOf ?? ''] ?? {};
  const man = manifest[name] ?? {};
  const outletDomains = man.outletDomains ?? [];
  return {
    name,
    category,
    color,
    playable: info?.tier === 'B',
    known: name in known,
    required: known[name]?.required ?? [],
    stub: stubs[name] ?? null,
    digest: doc.digest || digests[name] || digests[known[name]?.aliasOf ?? ''] || EXTRA_DIGESTS[name] || '',
    description: doc.description ?? '',
    args: (man.args ?? []).map((a) => ({ name: a.name, type: a.type.join('/'), optional: a.optional })),
    inlets: (doc.inlets ?? []).map((p, i) => ({ ...p, domain: doc.inletDomains?.[i] ?? 'control' })),
    outlets: (doc.outlets ?? []).map((p, i) => ({ ...p, domain: outletDomains[i] ?? 'control' })),
    examples: examples.filter((e) => e.object === name).sort((a, b) => a.index - b.index),
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

  const rest = [...infos.values()].filter((o) => !listed.has(o.name) && objdocs[o.name]);
  const byName = (a: ObjectInfo, b: ObjectInfo) => a.name.localeCompare(b.name);
  out.push({
    name: 'Multichannel',
    color: '#b8b8b8',
    blurb: 'mc.* versions of the objects above: one box, many channels.',
    collapsed: true,
    entries: rest.filter((o) => o.tier === 'B' && o.name.startsWith('mc.')).sort(byName)
      .map((o) => entryFor(o, o.name, 'Multichannel', '#b8b8b8')),
  });
  out.push({
    name: 'More objects (Max only)',
    color: '#d9d9d9',
    blurb: 'These work in Max but do not make sound in this browser player yet.',
    collapsed: true,
    entries: rest.filter((o) => o.tier === 'A').sort(byName)
      .map((o) => entryFor(o, o.name, 'More objects (Max only)', '#d9d9d9')),
  });
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
