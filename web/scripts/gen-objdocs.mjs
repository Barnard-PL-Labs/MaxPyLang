// Build src/generated/objdocs.json from maxpylang's generated object stubs.
//
// WHY this exists at all: OBJ_INFO (and therefore manifest.json / boxspecs.json)
// describes OUTLETS only — `outlettype[]` has no inlet counterpart. The reference
// prose that maxpylang bakes into maxpylang/objects/{max,msp,jit}.py as docstrings is
// the ONLY machine-readable source of per-INLET type and meaning, which cord
// validation ("is this inlet a signal inlet?") and port tooltips both need. It also
// carries the digest/description/messages/attributes the inspector shows.
//
// The docstrings are scraped from Max's own reference pages, so they are prose, not a
// schema: they occasionally list more xlets than the default box has (see the
// divergence allowlist in test/generated.test.ts). We transcribe them faithfully and
// let consumers reconcile — inventing numbers here would hide the disagreement.
//
// Only objects present in manifest.json are emitted: the .py files stub ~133 objects
// that OBJ_INFO has no metadata for, and docs for an object the engine cannot even
// instantiate would be dead weight in a file the patcher loads.
//
// Usage:  node scripts/gen-objdocs.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const OBJECTS = join(here, '..', '..', 'maxpylang', 'objects');
const OUT_DIR = join(here, '..', 'src', 'generated');
const OUT = join(OUT_DIR, 'objdocs.json');

const packages = ['max', 'msp', 'jit'];

/** Sections we recognize. "Args" is deliberately dropped — manifest.json has args. */
const SECTION = /^(Args|Inlets|Outlets|Messages|Attributes):[ \t]*(.*)$/;
/** An xlet row, e.g. "  0 (signal/float): Frequency". The text may be absent. */
const XLET = /^ {2}(\d+) \(([^)]*)\)(?::[ \t]?(.*))?$/;

/**
 * Every triple-quoted string in the file, in order. These are generated files with no
 * nested quoting, so naive pairing is exact.
 */
function docstrings(src) {
  const out = [];
  let i = 0;
  for (;;) {
    const a = src.indexOf('"""', i);
    if (a < 0) break;
    const b = src.indexOf('"""', a + 3);
    if (b < 0) break;
    out.push(src.slice(a + 3, b));
    i = b + 3;
  }
  return out;
}

/**
 * Attach each docstring to its object by NAME, not by position. Position is
 * ambiguous: max.py emits the docstring BEFORE its `x = MaxObject('x')` line while
 * msp.py and jit.py emit it after, so an adjacency rule silently shifts one whole
 * file by one object. Every docstring opens with "<max name>[ - <digest>]", which is
 * unambiguous and self-checking — anything that doesn't name a known object (the
 * module docstring) is reported as unattached rather than guessed at.
 */
function collectDocs(src) {
  const names = new Set();
  for (const m of src.matchAll(/^\w+ = MaxObject\('([^']+)'\)$/gm)) names.add(m[1]);
  const docs = new Map();
  let unattached = 0;
  for (const body of docstrings(src)) {
    const first = body.replace(/^\n+/, '').split('\n', 1)[0];
    const m = /^(\S+)(?: - (.*))?$/.exec(first);
    if (!m || !names.has(m[1])) {
      unattached++;
      continue;
    }
    docs.set(m[1], body);
  }
  return { names, docs, unattached };
}

/**
 * Reference prose repeats the type inside the text more often than not
 * ("0 (signal/float): (signal/float) Starting Table Location"). We surface `type` as
 * its own field, so the echo is pure noise in a tooltip. Case-insensitive because the
 * two copies disagree on it ("0 (Signal): (signal) Multiplication Result").
 */
function stripEchoedType(type, text) {
  const echo = `(${type})`;
  const head = text.slice(0, echo.length);
  return head.toLowerCase() === echo.toLowerCase() ? text.slice(echo.length).trim() : text;
}

/** Normalized cord domain for a documented xlet type token. */
function xletDomain(type) {
  const t = (type ?? '').toLowerCase();
  if (t.includes('signal')) return 'signal';
  if (t.includes('matrix') || t.includes('texture') || t.includes('jit')) return 'video';
  // Includes the literal placeholders INLET_TYPE/OUTLET_TYPE, which Max's own docs use
  // for plain message inlets, plus "inactive"/"disabled" rows.
  return 'control';
}

function parseDoc(body) {
  const lines = body.replace(/^\n+/, '').replace(/\n+$/, '').split('\n');
  const digest = /^\S+(?: - (.*))?$/.exec(lines[0])?.[1] ?? '';

  let section = null;
  const descLines = [];
  const inlets = [];
  const outlets = [];
  let messages = [];
  let attributes = [];

  for (const line of lines.slice(1)) {
    const head = SECTION.exec(line);
    if (head) {
      section = head[1];
      // Messages/Attributes are a single inline comma list; Inlets/Outlets are rows.
      if (section === 'Messages') messages = splitList(head[2]);
      if (section === 'Attributes') attributes = splitList(head[2]);
      continue;
    }
    if (section === null) {
      descLines.push(line);
      continue;
    }
    const xlet = XLET.exec(line);
    if (!xlet) continue;
    const type = xlet[2];
    const entry = { index: Number(xlet[1]), type, text: stripEchoedType(type, xlet[3] ?? '') };
    if (section === 'Inlets') inlets.push(entry);
    else if (section === 'Outlets') outlets.push(entry);
  }

  return {
    digest,
    description: paragraphs(descLines),
    inlets,
    // Parallel to `inlets`; a box with more inlets than the docs describe leaves the
    // tail undefined, and callers treat an undefined domain as 'control'.
    inletDomains: inlets.map((i) => xletDomain(i.type)),
    outlets,
    messages,
    attributes,
  };
}

function splitList(s) {
  return s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Blank-line-separated paragraphs, each collapsed to one line. A few descriptions are
 * scraped straight out of HTML and arrive hard-wrapped mid-sentence with tabs; joining
 * within a paragraph repairs those without destroying real paragraph breaks.
 */
function paragraphs(lines) {
  const out = [];
  let cur = [];
  for (const line of lines) {
    if (line.trim() === '') {
      if (cur.length) out.push(cur.join(' '));
      cur = [];
    } else {
      cur.push(line.trim());
    }
  }
  if (cur.length) out.push(cur.join(' '));
  return out.join('\n\n');
}

const manifest = JSON.parse(readFileSync(join(OUT_DIR, 'manifest.json'), 'utf-8'));

const objdocs = {};
let stubs = 0;
let documented = 0;
let unattached = 0;
let skipped = 0;
let withInlets = 0;

for (const pkg of packages) {
  const src = readFileSync(join(OBJECTS, `${pkg}.py`), 'utf-8');
  const collected = collectDocs(src);
  stubs += collected.names.size;
  unattached += collected.unattached;
  for (const [name, body] of collected.docs) {
    documented++;
    if (!(name in manifest)) {
      skipped++;
      continue;
    }
    const doc = parseDoc(body);
    if (doc.inlets.length > 0) withInlets++;
    objdocs[name] = doc;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(objdocs, null, 0) + '\n');

const domains = {};
for (const doc of Object.values(objdocs)) {
  for (const d of doc.inletDomains) domains[d] = (domains[d] ?? 0) + 1;
}

console.log(`wrote ${OUT}`);
console.log(`  ${stubs} MaxObject stubs scanned, ${documented} with a docstring`);
console.log(`  ${Object.keys(objdocs).length} emitted (${skipped} documented but absent from manifest.json)`);
console.log(`  ${withInlets} carry an Inlets section`);
console.log(`  inlet domains:`, domains);
if (unattached !== packages.length) {
  console.warn(`  ! ${unattached} docstrings named no known object (expected ${packages.length}: the module docstrings)`);
}
