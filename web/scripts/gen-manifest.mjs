// Build src/generated/{manifest,boxspecs}.json from maxpylang's object-metadata database.
//
// maxpylang ships one JSON per object under maxpylang/data/OBJ_INFO/{max,msp,jit}/,
// each with the object's default box (maxclass, inlet/outlet counts, outlettype[])
// and argument signature. We distill that into a flat manifest the web engine reads
// to (a) auto-register a correct-I/O stub for EVERY object and (b) drive signature
// tests. No Python at runtime — this runs once and commits its output.
//
// One walk, two outputs, because they have opposite cost profiles:
//   • manifest.json is imported EAGERLY by the player (registry.ts), so it stays the
//     minimal distillation it has always been. Do not grow its schema.
//   • boxspecs.json carries the bulky rest — the verbatim default box dict (needed to
//     stamp out byte-faithful new boxes), the argument-dependent arity rules under
//     "in/out", and the attribute list the inspector edits. The patcher `await
//     import()`s it, so none of it reaches the player bundle.
//
// Usage:  node scripts/gen-manifest.mjs

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', 'maxpylang', 'data', 'OBJ_INFO');
const OUT_DIR = join(here, '..', 'src', 'generated');
const OUT = join(OUT_DIR, 'manifest.json');
const OUT_SPECS = join(OUT_DIR, 'boxspecs.json');

/** Objects whose arity depends on their arguments. Logged as a drift check, not enforced. */
const EXPECTED_IO = 46;

/**
 * outlettype token -> engine domain. src/ir/domain.ts is the canonical definition and
 * this is a deliberate copy: the generator runs under plain node, so it cannot import
 * TS. A new token has to be added in both places or the manifest and the parser will
 * disagree about what a cord carries.
 */
function outletDomain(t) {
  if (t === 'signal' || t === 'multichannelsignal') return 'signal';
  if (t === 'jit_matrix') return 'video';
  return 'control';
}

function flattenArgs(argsField) {
  const out = [];
  for (const kind of ['required', 'optional']) {
    for (const a of argsField?.[kind] ?? []) {
      out.push({
        name: a.name ?? '',
        type: Array.isArray(a.type) ? a.type : a.type ? [a.type] : ['any'],
        optional: kind === 'optional',
      });
    }
  }
  return out;
}

/**
 * The default box dict, minus "id" — that id is whatever obj-N the scrape patch
 * happened to assign, and a patcher stamping out a new box must mint its own.
 */
function cleanBox(box) {
  const out = { ...box };
  delete out.id;
  return out;
}

/**
 * Attribute rows, minus the "COMMON" separator. OBJ_INFO interleaves a bare
 * {name: 'COMMON'} row to mark where the object's own attributes end and the
 * inherited Max ones begin; it is a heading, not an attribute, and an inspector
 * rendering it as one would offer a nonexistent @COMMON.
 */
function cleanAttribs(attribs) {
  const out = [];
  for (const a of attribs ?? []) {
    if (a.name === 'COMMON') continue;
    out.push({ name: a.name, type: a.type, size: a.size });
  }
  return out;
}

const manifest = {};
const boxspecs = {};
let ioCount = 0;
const packages = ['max', 'msp', 'jit'];

for (const pkg of packages) {
  const dir = join(DATA, pkg);
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.json') || file === 'obj_aliases.json') continue;
    const className = file.slice(0, -5);
    let d;
    try {
      d = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
    } catch {
      continue;
    }
    const box = d?.default?.box ?? {};
    const numOutlets = box.numoutlets ?? 0;
    const outlettype = Array.isArray(box.outlettype) ? box.outlettype : [];
    manifest[className] = {
      pkg,
      maxclass: box.maxclass ?? 'newobj',
      numInlets: box.numinlets ?? 0,
      numOutlets,
      outletDomains: Array.from({ length: numOutlets }, (_, i) => outletDomain(outlettype[i])),
      args: flattenArgs(d?.args),
      aliases: [],
    };

    // Keyed by canonical name only: alias -> canonical already lives in
    // MANIFEST[alias].aliasOf, so duplicating every spec under `t`, `sel`, … would
    // bloat the file for nothing.
    const spec = { box: cleanBox(box) };
    // Most objects ship "in/out": {} — a fixed-arity object has no rules to state.
    // Only the ~46 whose arity depends on their arguments carry anything.
    const io = d?.['in/out'];
    if (io && Object.keys(io).length > 0) {
      spec.io = io;
      ioCount++;
    }
    spec.attribs = cleanAttribs(d?.attribs);
    boxspecs[className] = spec;
  }
}

// Fold in aliases (t -> trigger, sel -> select, ...). The alias points at the
// canonical object; we record it on the canonical entry AND add a lightweight
// manifest entry for the alias name so patches using either name resolve.
const aliasFile = join(DATA, 'obj_aliases.json');
let aliasCount = 0;
try {
  const aliases = JSON.parse(readFileSync(aliasFile, 'utf-8'));
  for (const [alias, canonical] of Object.entries(aliases)) {
    if (manifest[canonical]) {
      manifest[canonical].aliases.push(alias);
      if (!manifest[alias]) {
        manifest[alias] = { ...manifest[canonical], aliasOf: canonical, aliases: [] };
        aliasCount++;
      }
    }
  }
} catch {
  /* alias file optional */
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(manifest, null, 0) + '\n');
writeFileSync(OUT_SPECS, JSON.stringify(boxspecs, null, 0) + '\n');

const total = Object.keys(manifest).length;
const byDomain = {};
for (const e of Object.values(manifest)) {
  const d = e.outletDomains.includes('signal')
    ? 'signal'
    : e.outletDomains.includes('video')
      ? 'video'
      : e.numOutlets === 0
        ? 'sink/ui'
        : 'control';
  byDomain[d] = (byDomain[d] ?? 0) + 1;
}
console.log(`wrote ${OUT}`);
console.log(`  ${total} objects (${aliasCount} alias entries added)`);
console.log(`  by primary domain:`, byDomain);
console.log(`wrote ${OUT_SPECS}`);
console.log(`  ${Object.keys(boxspecs).length} canonical objects, ${ioCount} with arity rules`);
if (ioCount !== EXPECTED_IO) {
  console.warn(`  ! expected ${EXPECTED_IO} objects with a non-empty "in/out" — the arity`);
  console.warn(`    rule set in src/ir/io-rules.ts is sized against that corpus.`);
}
