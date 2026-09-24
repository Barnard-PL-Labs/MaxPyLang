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

/**
 * Objects maxpylang's OBJ_INFO does not describe, but that the web engine really plays
 * and a user can therefore TYPE into a box. Web-only on purpose — see below.
 *
 * OBJ_INFO is not hand-maintained: maxpylang/importobjs.py regenerates every file in it
 * by scripting Max itself, and maxpylang's own instantiation reads the same folder
 * (tools/objfuncs/reffile.py: get_ref walks OBJ_INFO/{pkg}, check_aliases reads
 * obj_aliases.json). Dropping a live.gain~.json or a "p" alias in there would change
 * what `MaxObject("p foo")` builds in Python — today an UnknownObjectWarning and a 0/0
 * box — and the next re-import would silently delete it again. So the supplement lives
 * here, stamped into the two generated files only, and marked `webOnly` in boxspecs so
 * the Python code generator knows maxpylang cannot build these from their text.
 *
 * Each entry's `box` is Max's own default box dict, transcribed rather than invented:
 *
 *   live.gain~ — ports and outlettype from m4l-ref/live.gain~.maxref.xml (2 signal
 *     inlets; signal, signal, dB value, raw 0..1 float, meter list) and the saved form
 *     Max writes (snippets/m4l/live.gain~ Example.maxsnip, the M4L extended.V prototype):
 *     outlettype ["signal","signal","","float","list"], the Live parameter block under
 *     saved_attribute_attributes.valueof with Max's defaults (range -70..6 dB, initial
 *     0 dB, parameter_initial_enable 0), orientation 0 = vertical, and the vertical
 *     fader's 48x136 footprint. objects/audio/live-gain.ts reads exactly these keys.
 *     Filed under 'msp': the palette groups by maxpylang's three packages, Max files it
 *     under M4L, and 'msp' is the audio group a user would look in.
 */
const SUPPLEMENT = {
  'live.gain~': {
    pkg: 'msp',
    box: {
      maxclass: 'live.gain~',
      numinlets: 2,
      numoutlets: 5,
      orientation: 0,
      outlettype: ['signal', 'signal', '', 'float', 'list'],
      parameter_enable: 1,
      patching_rect: [100.0, 100.0, 48.0, 136.0],
      saved_attribute_attributes: {
        valueof: {
          parameter_initial: [0.0],
          parameter_initial_enable: 0,
          parameter_longname: 'live.gain~',
          parameter_mmax: 6.0,
          parameter_mmin: -70.0,
          parameter_shortname: 'live.gain~',
          parameter_type: 0,
          parameter_unitstyle: 4,
        },
      },
    },
    args: {},
    attribs: [
      { name: 'orientation', type: 'int', size: '1' },
      { name: 'channels', type: 'int', size: '1' },
    ],
  },
};

/**
 * Aliases Max accepts that obj_aliases.json lacks, for the same web-only reason.
 *
 * `p` is Max's standard abbreviation for `patcher` — the name nearly every subpatcher in
 * the wild is saved under. maxpylang's alias scrape only records an alias when Max
 * rewrites the box text to a different name, and Max keeps `p` as typed, so the scrape
 * never saw it. Recorded on the canonical boxspec as `webAliases` for the code generator.
 */
const SUPPLEMENT_ALIASES = { p: 'patcher' };

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

// Supplements go in last, and refuse to shadow real OBJ_INFO data: the day maxpylang
// learns one of these objects, its scraped metadata must win and the table entry here
// must be deleted — a thrown error is the reminder.
for (const [name, sup] of Object.entries(SUPPLEMENT)) {
  if (manifest[name]) {
    throw new Error(`supplement '${name}' is now in OBJ_INFO; delete it from SUPPLEMENT`);
  }
  const { box } = sup;
  manifest[name] = {
    pkg: sup.pkg,
    maxclass: box.maxclass,
    numInlets: box.numinlets,
    numOutlets: box.numoutlets,
    outletDomains: Array.from({ length: box.numoutlets }, (_, i) => outletDomain(box.outlettype[i])),
    args: flattenArgs(sup.args),
    aliases: [],
  };
  boxspecs[name] = { box: cleanBox(box), attribs: sup.attribs, webOnly: true };
}
for (const [alias, canonical] of Object.entries(SUPPLEMENT_ALIASES)) {
  if (manifest[alias]) {
    throw new Error(`supplement alias '${alias}' is now in OBJ_INFO; delete it from SUPPLEMENT_ALIASES`);
  }
  if (!manifest[canonical]) throw new Error(`supplement alias '${alias}' -> unknown '${canonical}'`);
  manifest[canonical].aliases.push(alias);
  manifest[alias] = { ...manifest[canonical], aliasOf: canonical, aliases: [] };
  (boxspecs[canonical].webAliases ??= []).push(alias);
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
console.log(
  `  web-only supplements: ${Object.keys(SUPPLEMENT).join(', ')}; aliases: ${Object.keys(SUPPLEMENT_ALIASES).join(', ')}`,
);
console.log(`  by primary domain:`, byDomain);
console.log(`wrote ${OUT_SPECS}`);
console.log(`  ${Object.keys(boxspecs).length} canonical objects, ${ioCount} with arity rules`);
if (ioCount !== EXPECTED_IO) {
  console.warn(`  ! expected ${EXPECTED_IO} objects with a non-empty "in/out" — the arity`);
  console.warn(`    rule set in src/ir/io-rules.ts is sized against that corpus.`);
}
