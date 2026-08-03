// Build src/generated/manifest.json from maxpylang's object-metadata database.
//
// maxpylang ships one JSON per object under maxpylang/data/OBJ_INFO/{max,msp,jit}/,
// each with the object's default box (maxclass, inlet/outlet counts, outlettype[])
// and argument signature. We distill that into a flat manifest the web engine reads
// to (a) auto-register a correct-I/O stub for EVERY object and (b) drive signature
// tests. No Python at runtime — this runs once and commits its output.
//
// Usage:  node scripts/gen-manifest.mjs

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', 'maxpylang', 'data', 'OBJ_INFO');
const OUT_DIR = join(here, '..', 'src', 'generated');
const OUT = join(OUT_DIR, 'manifest.json');

/** outlettype token -> engine domain (matches parser/maxpat.ts). */
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

const manifest = {};
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
