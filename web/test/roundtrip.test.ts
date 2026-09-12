// The round-trip property suite: "patches written here round-trip with real Max".
//
// That sentence is the load-bearing claim of the whole patcher. If it is false, the
// editor is a toy — you open a patch somebody spent a week on, move one box, save, and
// silently lose its colours, its presentation layout, its vst~ plugin state and the
// three keys a newer Max version invented. Nothing in the UI would tell you. So this
// file exists to turn that sentence into a fact, and it is organised as the four
// independent ways it could be false:
//
//   LAYER 1 — the fixed corpus.  Every .maxpat this repo ships goes out to JSON and
//     comes back, twice. The first pass is allowed to differ from the original ONLY in
//     ways named in ROUND_TRIP_NORMALIZATIONS below; the second pass is allowed to
//     differ in no way at all, which is what "idempotent" means and what guarantees the
//     losses (if any) are one-time rather than compounding with every save.
//     Worth knowing before trusting it too far: all 16 of those files were written by
//     MAXPYLANG, not by Max. Every one carries maxpylang's `"midpoints": [null]`
//     placeholder and its habit of writing a class name into a UI box's `text`, neither
//     of which Max emits, and none carries a bgcolor, a presentation_rect or a varname.
//     So layer 1 shows the corpus survives; on its own it cannot show that a file Max
//     saved does.
//
//   LAYER 1B — the files Max actually saved.  Nine of them, in examples/, holding 492
//     boxes and 622 cords of somebody's real work: `order` on their fan-outs, bent cords
//     with real waypoints, ten nested subpatcher dicts, 205 boxes with no `text` key at
//     all. No allowlist applies to these — they come back byte-identical, key order
//     included, or the claim in this file's title is false. They are what turns layer 1
//     from a proxy into the thing itself, and two real bugs came straight out of adding
//     them: a cord's `order` was being dropped, and `33.` was being respelled `33.0`.
//
//   LAYER 2 — unknown keys.  A box carrying bgcolor, presentation_rect, varname,
//     saved_object_attributes, parameter_enable, fontsize, a vst~ save blob and a key no
//     version of Max has ever written survives byte-identically, as does a patcher header
//     with an unrecognised key. This is the single most important test in the file: it is
//     the only one that tests the case nobody can enumerate — whatever Max 9 adds.
//
//   LAYER 3 — a seeded generative property.  500 random documents built from the real
//     catalog, deliberately biased towards the 46 objects whose arity depends on their
//     arguments, because that is where a writer actually goes wrong.
//
// Plus a cross-language parity check that hands a file we wrote to the real maxpylang
// and asks it what it sees. It is SKIPPED unless ../../.venv/bin/python exists, so
// `npm test` never depends on Python being installed (see the note above PYTHON).
//
// ---------------------------------------------------------------------------------
// THE COMPARISON IS ON PARSED JSON, NEVER ON BYTES OF THE ORIGINAL FILE.
//
// Max writes whole numbers as "34.0". JSON.parse gives a JS number, JSON.stringify
// writes "34", and no amount of care in the writer can change that — JS has one numeric
// type. Comparing `JSON.stringify(JSON.parse(original))` against
// `JSON.stringify(written)` therefore compares everything that survives a JSON reader,
// key ORDER included, which is the strictest bar this language can hold.
// ---------------------------------------------------------------------------------
//
// Read `src/parser/write-maxpat.ts` before touching ROUND_TRIP_NORMALIZATIONS. Growing
// that constant to make a test pass is not a fix — it is the record of a key whose
// contents the editor just started throwing away, and the only reason the constant is
// written out longhand instead of being a `diffs.length < 5` threshold.

import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMaxPat } from '../src/parser/maxpat';
import { patchToMaxPat } from '../src/parser/write-maxpat';
import { boxSpecs, loadBoxSpecs, parseBoxText } from '../src/ir/objectspec';
import { applyIoRules } from '../src/ir/io-rules';
import { objectInfo } from '../src/engine/catalog';
import { PatchDoc } from '../src/doc/patch-doc';
import type { IRPatch } from '../src/ir/types';
import { Rng, arityRuleNames, randomDoc } from './helpers/patchgen';

// ===================================================================================
// the shapes we are comparing
// ===================================================================================

/** The parsed shape of a .maxpat file. Only the parts this suite reaches into. */
interface MaxPatFile {
  patcher: Record<string, unknown> & {
    boxes: { box: Record<string, unknown> }[];
    lines: { patchline: Record<string, unknown> }[];
  };
}

const serialize = (patch: IRPatch | PatchDoc, opts?: Parameters<typeof patchToMaxPat>[1]) =>
  patchToMaxPat(patch, opts) as MaxPatFile;

// ===================================================================================
// the corpus
// ===================================================================================

const PATCH_DIR = fileURLToPath(new URL('../public/test-patches/', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Every .maxpat this repo ships: the 14 bundled with the player plus `attributes.maxpat`
 * at the repository root.
 *
 * Listed by absolute path and read at module load so a missing file is a hard failure
 * rather than a silently smaller corpus — "0 files round-tripped perfectly" is exactly
 * the result a broken glob would produce. Which is also why every entry has to be a
 * TRACKED file: a corpus that reaches for something untracked passes here and fails on a
 * fresh clone, and the CI job Phase 8 adds would be the first to find out. The copy of
 * `webcam_pixelated_synth.maxpat` sitting untracked at the repository root is byte-
 * identical to the tracked `test-patches/` one the glob above already picks up, so it is
 * deliberately not listed a second time.
 */
const CORPUS: { name: string; path: string }[] = [
  ...readdirSync(PATCH_DIR)
    .filter((n) => n.endsWith('.maxpat'))
    .sort()
    .map((n) => ({ name: `test-patches/${n}`, path: join(PATCH_DIR, n) })),
  { name: 'attributes.maxpat', path: join(REPO_ROOT, 'attributes.maxpat') },
];

/**
 * The patches in this repo that MAX saved, not maxpylang. Layer 1B.
 *
 * These are what layer 1 cannot be: files carrying the things only the real application
 * writes. They were identified by the three habits maxpylang has and Max does not —
 * maxpylang puts a `"midpoints": [null]` placeholder on every cord, writes a `text` key
 * into every box including UI boxes that have no text, and never writes `order` — and
 * `asserts the corpus is Max-shaped` below re-checks that on every run, so this list
 * cannot quietly decay into a second copy of the maxpylang corpus.
 *
 * They are the most valuable files in the repository for this suite's purposes and were
 * hiding in examples/ the whole time: 492 boxes and 622 cords of somebody's real work,
 * with `order` on their fan-outs, bent cords with genuine waypoints, a bgcolor, ten
 * nested subpatcher dicts and 205 boxes with no `text` key at all.
 *
 * Deliberately NOT included: examples/stocksonification_v1/stockSonification.maxpat,
 * which is mcfm.maxpat after a pass through maxpylang — Max's boxes with maxpylang's
 * cords. It belongs to neither corpus and would only blur what each one proves.
 */
const MAX_CORPUS: { name: string; path: string }[] = [
  'examples/basic-sonification-using-abstracted-csvReader/csvReader.maxpat',
  'examples/basic-sonification-using-abstracted-csvReader/tester2-edited.maxpat',
  'examples/chess-paper-example/desired-patch.maxpat',
  'examples/chess-paper-example/pure_max_chess_generation.maxpat',
  'examples/stocksonification_v1/mcfm.maxpat',
  'examples/stocksonification_v1/stocksounds.maxpat',
  'examples/variable-osc-synth/additive-bottom.maxpat',
  'examples/variable-osc-synth/additive-dynamic-template.maxpat',
  'examples/variable-osc-synth/osc-to-add.maxpat',
].map((rel) => ({ name: rel.slice(rel.lastIndexOf('/') + 1), path: join(REPO_ROOT, rel) }));

const load = (path: string): MaxPatFile => JSON.parse(readFileSync(path, 'utf-8')) as MaxPatFile;

// ===================================================================================
// the allowlist
// ===================================================================================

/** One observed difference between two .maxpat trees. `undefined` means "key absent". */
export interface JsonDiff {
  /** Path from the root of the file, e.g. `patcher.boxes[3].box.text`. */
  path: string;
  before: unknown;
  after: unknown;
}

export interface Normalization {
  id: string;
  /**
   * 'diff' — shows up as a JsonDiff and is matched by `applies`.
   * 'bytes' — cannot show up at all, because the comparison (or JSON.parse before it)
   *   has already erased it. Each one is pinned by its own test below instead, so it is
   *   an asserted claim rather than an excuse.
   */
  kind: 'diff' | 'bytes';
  /** The key or property being normalized. */
  what: string;
  /** Why losing it is legitimate — the bar every entry has to clear. */
  why: string;
  applies?: (diff: JsonDiff) => boolean;
}

const MIDPOINTS_PATH = /^patcher\.lines\[\d+\]\.patchline\.midpoints$/;

/**
 * THE ALLOWLIST. Every difference a round trip through this editor is permitted to make
 * to a .maxpat file, with the reason each one is not data loss.
 *
 * Three entries, and three is the number to watch. Each of them is something the
 * ORIGINAL writer put there that Max itself would not have, or something no JSON reader
 * can tell apart in the first place — none of them is a Max feature being dropped. If a
 * fourth entry ever looks necessary, the thing to do is read what is actually being
 * dropped and decide whether the writer should be preserving it, because "the allowlist
 * grew" and "we started deleting people's data" are the same sentence.
 *
 * It has gone the other way once, which is the direction to imitate. A
 * `box-text-whitespace` entry used to sit here excusing the writer for tidying a message
 * box's leading space, on the reasoning that Max's tokenizer collapses whitespace
 * anyway. True, and beside the point: the tidy-up came from recomposing the text through
 * parseBoxText/formatBoxText, and the same recomposition respelled real Max's `33.` as
 * `33.0` and flattened a comment's newlines into one reflowed paragraph. The entry was
 * removed by making the writer stop rewriting text it is not restructuring — see
 * write-maxpat.ts:boxText and the real-Max layer below.
 */
export const ROUND_TRIP_NORMALIZATIONS: readonly Normalization[] = [
  {
    id: 'midpoints-placeholder',
    kind: 'diff',
    what: 'patcher.lines[].patchline.midpoints',
    why:
      'maxpylang writes `"midpoints": [null]` on every cord — the placeholder its ' +
      'MaxInlet carries, not a waypoint. Max writes the key only for a cord that ' +
      'actually bends, and reads a cord with no midpoints as straight, which is what ' +
      '[null] already meant. Real coordinates are preserved: see the bent-cord cases ' +
      'in layer 2.',
    applies: (d) =>
      MIDPOINTS_PATH.test(d.path) &&
      d.after === undefined &&
      Array.isArray(d.before) &&
      d.before.every((m) => m === null),
  },
  {
    id: 'whole-number-spelling',
    kind: 'bytes',
    what: 'every number, but visibly patching_rect and the patcher rect',
    why:
      'Max writes whole numbers as "34.0"; JavaScript has one numeric type, so ' +
      'JSON.parse("34.0") and JSON.parse("34") are the same value and JSON.stringify ' +
      'writes "34" for both. No writer in this language can do otherwise, and Max reads ' +
      'either spelling. Pinned by "writes every patching_rect back numerically ' +
      'unchanged" below, which is the part that would actually matter.',
  },
  {
    id: 'key-order',
    kind: 'bytes',
    what: 'the order of keys within the patcher dict, a box dict and a patchline',
    why:
      'JSON object key order carries no meaning; it matters only so that a diff of a ' +
      'saved file is readable. The writer reproduces it anyway (boxes/lines go back in ' +
      'the slot Max puts them in, and a box dict is a copy of the original), and the ' +
      'corpus comparison below is a JSON.stringify string equality, so order IS ' +
      'checked — this entry records that it costs us nothing, not that we ignore it.',
  },
];

const DIFF_NORMALIZATIONS = ROUND_TRIP_NORMALIZATIONS.filter((n) => n.kind === 'diff');

function explain(diff: JsonDiff): Normalization | undefined {
  return DIFF_NORMALIZATIONS.find((n) => n.applies!(diff));
}

// ===================================================================================
// the differ
// ===================================================================================

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Every leaf at which two JSON trees disagree.
 *
 * Key-wise rather than order-wise on purpose: a missing key and a reordered key are very
 * different findings, and collapsing them into one "objects differ" diff would make the
 * allowlist match on far too much. Arrays compare by index, so a length change surfaces
 * as a diff at the index that gained or lost an entry.
 */
export function diffJson(
  before: unknown,
  after: unknown,
  path = '',
  out: JsonDiff[] = [],
): JsonDiff[] {
  if (before === after) return out;

  if (Array.isArray(before) || Array.isArray(after)) {
    if (!Array.isArray(before) || !Array.isArray(after)) {
      out.push({ path, before, after });
      return out;
    }
    const n = Math.max(before.length, after.length);
    for (let i = 0; i < n; i++) diffJson(before[i], after[i], `${path}[${i}]`, out);
    return out;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      diffJson(before[key], after[key], path === '' ? key : `${path}.${key}`, out);
    }
    return out;
  }

  out.push({ path, before, after });
  return out;
}

// ===================================================================================
// the graph projection
// ===================================================================================

/**
 * What a parse is supposed to recover from a file, as a comparable value.
 *
 * Two fields are deliberately NOT in it, and both exclusions are load-bearing:
 *
 *   `raw` — the verbatim box dict the parse started from. After a round trip it is the
 *     REWRITTEN dict, so comparing it would be comparing the writer to itself. The
 *     preservation claim it carries is tested directly instead (layers 1 and 2 compare
 *     whole files, which is strictly stronger).
 *
 *   `text` — the verbatim box text, which is subject to the two documented
 *     normalizations (a message box's leading space) and to Max's own convention that a
 *     UI box stores no text. Round-tripping the box's MEANING is what matters and that
 *     is className/args/attrs, which are in. Object boxes get their text compared
 *     exactly, separately, where the claim really does hold.
 *
 * `className` is compared only for the three classes Max stores a name for. A UI box's
 * class in the file IS its maxclass, so there is nowhere to record that the user typed
 * the alias `mc.gain~` for a box Max calls `gain~` (Max tells them apart by the
 * `multichannelvariant` key, which survives in the box dict but which the parser does
 * not model — see the dedicated case in layer 1).
 */
const NAMED_CLASSES = new Set(['newobj', 'message', 'comment']);

/**
 * The one allowlisted normalization this projection has to apply itself: maxpylang's
 * `[null]` placeholder and a cord with no midpoints key at all mean the same thing —
 * "straight" — and the writer emits the latter. Written as a guard on the CONTENT rather
 * than a blanket `?? null` so that losing real coordinates still shows up as a diff.
 * See ROUND_TRIP_NORMALIZATIONS['midpoints-placeholder'].
 */
function waypoints(midpoints: readonly (number | null)[] | undefined): (number | null)[] | null {
  if (!midpoints || !midpoints.some((m) => typeof m === 'number')) return null;
  return [...midpoints];
}

function graphOf(patch: IRPatch) {
  return {
    nodes: patch.nodes.map((n) => ({
      id: n.id,
      maxclass: n.maxclass,
      className: NAMED_CLASSES.has(n.maxclass) ? n.className : null,
      args: n.args,
      attrs: n.attrs ?? {},
      numInlets: n.numInlets,
      numOutlets: n.numOutlets,
      outletDomains: n.outletDomains,
      outletTypes: (n.outletTypes ?? []).slice(0, n.numOutlets),
      rect: n.rect,
    })),
    edges: patch.edges.map((e) => ({
      from: e.from,
      to: e.to,
      domain: e.domain,
      midpoints: waypoints(e.midpoints),
    })),
  };
}

// ===================================================================================
// arity, re-derived independently of resolveBox
// ===================================================================================

interface Counts {
  numinlets: number;
  numoutlets: number;
  outlettype: string[];
}

/**
 * What ir/io-rules says a box of this text SHOULD have, computed from the generated
 * tables directly rather than by asking resolveBox again.
 *
 * The point of going the long way round is that resolveBox is what produced the document
 * in the first place; re-reading its answer would assert nothing. Reaching for
 * boxspecs.json + applyIoRules independently makes this a real cross-check of everything
 * in between — the document, the ops, the writer — against the rules.
 *
 * Returns undefined for a name no object has, which the caller skips: an unknown box is
 * 0-in/0-out by policy (objectspec's unknownSpec) and has no rule to check.
 */
function expectedCounts(className: string, args: readonly (number | string)[]): Counts | undefined {
  const info = objectInfo(className);
  if (!info) return undefined;
  const spec = boxSpecs()?.[info.aliasOf ?? className];
  if (!spec) return undefined;

  const box = spec.box as { numinlets?: number; numoutlets?: number; outlettype?: string[] };
  const counts = applyIoRules(spec.io, args, {
    numinlets: box.numinlets ?? 0,
    numoutlets: box.numoutlets ?? 0,
    outlettype: box.outlettype ?? [],
  });
  return {
    numinlets: counts.numinlets,
    numoutlets: counts.numoutlets,
    // The writer's own invariant: exactly numoutlets tokens, padded with "" if a rule
    // produced fewer. Applied here too so the two sides are comparable.
    outlettype: Array.from({ length: counts.numoutlets }, (_, i) => counts.outlettype[i] ?? ''),
  };
}

beforeAll(async () => {
  await loadBoxSpecs();
});

// ===================================================================================
// LAYER 1 — the fixed corpus
// ===================================================================================

describe('layer 1 — the shipped corpus round-trips', () => {
  it('is the 15 files this repo ships, not a smaller glob', () => {
    expect(CORPUS.length).toBe(15);
    for (const { name, path } of CORPUS) expect(existsSync(path), name).toBe(true);
  });

  it('is made only of files git actually tracks, so a fresh clone runs it', () => {
    // A corpus entry that is untracked passes on the machine that created it and fails
    // for everyone else. `git ls-files` answers for the real index rather than for this
    // working tree; a checkout with no git at all simply skips.
    let tracked: Set<string>;
    try {
      tracked = new Set(
        execFileSync('git', ['ls-files', '-z', '--', ...CORPUS.map((f) => f.path)], {
          cwd: REPO_ROOT,
          encoding: 'utf-8',
        })
          .split('\0')
          .filter(Boolean)
          .map((p) => join(REPO_ROOT, p)),
      );
    } catch {
      return; // no git, or not a repository: nothing to assert against
    }
    expect(CORPUS.filter((f) => !tracked.has(f.path)).map((f) => f.name)).toEqual([]);
  });

  it.each(CORPUS)('$name: differs from the original only by a listed normalization', ({ path }) => {
    const original = load(path);
    const written = serialize(parseMaxPat(original));

    const unexplained = diffJson(original, written).filter((d) => !explain(d));
    // Rendered rather than raw, so a failure reads as "this key, this value, gone"
    // instead of as a wall of object dumps.
    expect(
      unexplained.map((d) => `${d.path}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`),
    ).toEqual([]);
  });

  it.each(CORPUS)('$name: the second pass changes nothing at all', ({ path }) => {
    const first = serialize(parseMaxPat(load(path)));
    const second = serialize(parseMaxPat(first));

    // String equality, so key order counts. One application of parse->serialize reaches
    // a fixed point: whatever the first save normalized, no later save touches again.
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it.each(CORPUS)('$name: parse(serialize(parse(x))) recovers the same graph', ({ path }) => {
    const before = parseMaxPat(load(path));
    const after = parseMaxPat(serialize(before));
    expect(graphOf(after)).toEqual(graphOf(before));
  });

  it.each(CORPUS)('$name: object-box text survives exactly', ({ path }) => {
    // The normalization allowance above is for message boxes specifically. An object
    // box's text is its class and its arguments, and nothing in the pipeline is entitled
    // to touch it — `jit.movie @moviefile crashtest.mov` has to come back atom for atom.
    const before = parseMaxPat(load(path));
    const after = parseMaxPat(serialize(before));
    const texts = (p: IRPatch) =>
      p.nodes.filter((n) => n.maxclass === 'newobj').map((n) => [n.id, n.text]);
    expect(texts(after)).toEqual(texts(before));
  });

  it('every listed normalization is one the corpus actually provokes', () => {
    // An allowlist nobody can see firing is an allowlist that quietly covers more than
    // it says. Each 'diff' entry has to be justified by a real file in the repo.
    const fired = new Set<string>();
    for (const { path } of CORPUS) {
      const original = load(path);
      const written = serialize(parseMaxPat(original));
      for (const diff of diffJson(original, written)) {
        const hit = explain(diff);
        if (hit) fired.add(hit.id);
      }
    }
    expect([...fired].sort()).toEqual(DIFF_NORMALIZATIONS.map((n) => n.id).sort());
  });

  it('reproduces the corpus byte-for-byte in maxpylangCompat mode', () => {
    // Every file in the corpus was written by maxpylang (all 16 carry its `[null]`
    // midpoints placeholder and its habit of writing a class name into a UI box's text),
    // so the writer's compat mode must be the identity on them. Compared as strings, so
    // this also asserts key order in the patcher dict, in every box and in every cord.
    for (const { name, path } of CORPUS) {
      const original = load(path);
      const rewritten = serialize(parseMaxPat(original), { maxpylangCompat: true });
      expect(JSON.stringify(rewritten), name).toBe(JSON.stringify(original));
    }
  });

  it('writes every patching_rect back numerically unchanged (the "34.0" case)', () => {
    // The one thing the "whole-number-spelling" allowlist entry could be hiding is an
    // actual change of value — a box drifting by half a pixel per save. It does not.
    for (const { name, path } of CORPUS) {
      const original = load(path);
      const written = serialize(parseMaxPat(original));
      const rects = (f: MaxPatFile) => f.patcher.boxes.map((b) => b.box.patching_rect);
      expect(rects(written), name).toEqual(rects(original));
      expect(written.patcher.rect, name).toEqual(original.patcher.rect);
    }
  });

  it('preserves patcher-header key order, boxes and lines included', () => {
    for (const { name, path } of CORPUS) {
      const original = load(path);
      const written = serialize(parseMaxPat(original));
      expect(Object.keys(written.patcher), name).toEqual(Object.keys(original.patcher));
    }
  });

  it('records what an mc.gain~ loses: the IR reads it back as gain~', () => {
    // Not a writer bug and not covered by the allowlist, because the FILE is perfect —
    // Max distinguishes the two by `multichannelvariant`, which rides along in the box
    // dict untouched. It is the parser that has no field for it, so the IR's className
    // degrades. Pinned here so that if ir/maxpat.ts ever learns the key, this fails and
    // somebody deletes the test rather than discovering the gap in the inspector.
    const doc = PatchDoc.empty();
    const node = doc.addBox('mc.gain~', 40, 40);
    expect(node.className).toBe('mc.gain~');

    const file = serialize(doc);
    const box = file.patcher.boxes[0].box;
    expect(box.maxclass).toBe('gain~');
    expect(box.multichannelvariant).toBe(1); // ...so Max still reopens it as mc.gain~
    expect(box.outlettype).toEqual(['multichannelsignal', '']);

    expect(parseMaxPat(file).nodes[0].className).toBe('gain~');
  });
});

// ===================================================================================
// LAYER 1B — the files MAX saved
// ===================================================================================

describe('layer 1b — real Max files round-trip with no allowance at all', () => {
  it('asserts the corpus is Max-shaped, so it cannot decay into another maxpylang one', () => {
    // The whole value of this layer is that these files were written by the application
    // we claim to be compatible with. If somebody ever re-saves one through maxpylang
    // (as already happened to stockSonification.maxpat) the layer would keep passing
    // while testing nothing new, so the distinguishing features are asserted directly.
    let orderCords = 0;
    let bentCords = 0;
    let placeholderCords = 0;
    let uiBoxesWithNoText = 0;
    let subpatchers = 0;
    let coloured = 0;
    let boxes = 0;
    let cords = 0;

    for (const { name, path } of MAX_CORPUS) {
      const f = load(path);
      boxes += f.patcher.boxes.length;
      cords += f.patcher.lines.length;
      for (const { patchline } of f.patcher.lines) {
        if ('order' in patchline) orderCords++;
        const mid = patchline.midpoints;
        if (Array.isArray(mid) && mid.every((m) => m === null)) placeholderCords++;
        if (Array.isArray(mid) && mid.every((m) => typeof m === 'number')) bentCords++;
      }
      for (const { box } of f.patcher.boxes) {
        if (!('text' in box)) uiBoxesWithNoText++;
        if ('patcher' in box) subpatchers++;
        if ('bgcolor' in box) coloured++;
      }
      expect(f.patcher.boxes.length, name).toBeGreaterThan(0);
    }

    expect(boxes).toBe(492);
    expect(cords).toBe(622);
    expect(orderCords).toBe(168); // maxpylang never writes `order`
    expect(placeholderCords).toBe(0); // ...and writes `[null]` on every cord
    expect(uiBoxesWithNoText).toBe(205); // ...and a `text` key on every box
    expect(bentCords).toBe(272);
    expect(subpatchers).toBe(10);
    expect(coloured).toBeGreaterThan(0);
  });

  it.each(MAX_CORPUS)('$name: comes back byte-identical, with nothing allowlisted', ({ path }) => {
    // No `explain()` here, unlike layer 1. A file Max wrote must survive with zero
    // differences of any kind: every normalization the allowlist excuses is a habit of
    // maxpylang's writer, and none of these files went through it.
    const original = load(path);
    const written = serialize(parseMaxPat(original));

    expect(
      diffJson(original, written).map(
        (d) => `${d.path}: ${JSON.stringify(d.before)} -> ${JSON.stringify(d.after)}`,
      ),
    ).toEqual([]);
    // Key order too — a box dict and a patchline dict are both copies of the original.
    expect(JSON.stringify(written)).toBe(JSON.stringify(original));
  });

  it.each(MAX_CORPUS)('$name: a second pass changes nothing', ({ path }) => {
    const first = serialize(parseMaxPat(load(path)));
    const second = serialize(parseMaxPat(first));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it.each(MAX_CORPUS)('$name: recovers the same graph', ({ path }) => {
    const before = parseMaxPat(load(path));
    const after = parseMaxPat(serialize(before));
    expect(graphOf(after)).toEqual(graphOf(before));
  });

  it.each(MAX_CORPUS)('$name: every box text survives, not just object boxes', ({ path }) => {
    // Stronger than layer 1's equivalent, which only claims it for newobj. The two
    // spellings that used to break here are Max's bare `33.` (which came back `33.0`)
    // and a comment's newlines (which came back as spaces, reflowing the author's
    // numbered list and renumbering it on the way).
    const before = parseMaxPat(load(path));
    const after = parseMaxPat(serialize(before));
    const texts = (p: IRPatch) => p.nodes.map((n) => [n.id, n.text]);
    expect(texts(after)).toEqual(texts(before));
  });

  // ---------------------------------------------------------------------------------
  // ...and the same files through the DOCUMENT, which is the path the app actually takes
  // ---------------------------------------------------------------------------------
  //
  // Everything above serializes a bare parse. The Studio's "Save .maxpat" does not: it
  // opens the file into a PatchDoc, the user edits it, and the writer is handed
  // doc.toIR(). That is two modules and an undo stack between the file and the file, and
  // each of them is a place a key can quietly fall out — so the same byte-identity bar
  // is applied to the whole path, on a file Max wrote.

  const EDITED = MAX_CORPUS.find((f) => f.name === 'additive-dynamic-template.maxpat')!;

  it('carries a real Max file through PatchDoc untouched', async () => {
    const original = load(EDITED.path);
    const doc = await PatchDoc.open(parseMaxPat(original));
    expect(JSON.stringify(serialize(doc))).toBe(JSON.stringify(original));
  });

  it('changes exactly the one box a move moved, and nothing else', async () => {
    const original = load(EDITED.path);
    const doc = await PatchDoc.open(parseMaxPat(original));
    const target = [...doc.nodes()][3];
    const [x, y, w, h] = target.rect;

    doc.moveNodes([target.id], 13, 7);
    const moved = serialize(doc);

    const diffs = diffJson(original, moved);
    expect(diffs.map((d) => d.path)).toEqual([
      `patcher.boxes[3].box.patching_rect[0]`,
      `patcher.boxes[3].box.patching_rect[1]`,
    ]);
    expect(moved.patcher.boxes[3].box.patching_rect).toEqual([x + 13, y + 7, w, h]);
  });

  it('comes back byte-identical after undoing a move, a retype and a delete', async () => {
    // The ordering invariant from patch-doc.ts's header, tested where it actually
    // matters: a delete removes a box and its cords, and undo has to put the box back at
    // its ORIGINAL index in the boxes array and the cords back in theirs. A document
    // that appended instead would round-trip a graph that is still correct and a file
    // that is reshuffled — every box after the deleted one showing as changed in the
    // author's version control, for an edit they undid.
    const original = load(EDITED.path);
    const doc = await PatchDoc.open(parseMaxPat(original));

    const target = [...doc.nodes()].find((n) => doc.edgesOf(n.id).length >= 2)!;
    const cordCount = doc.edgeCount;

    doc.moveNodes([target.id], 40, 40);
    doc.setBoxText(target.id, 'cycle~ 220');
    doc.removeNodes([target.id]);
    expect(doc.edgeCount).toBeLessThan(cordCount);

    doc.undo();
    doc.undo();
    doc.undo();
    expect(doc.canUndo).toBe(false);
    expect(doc.edgeCount).toBe(cordCount);

    expect(JSON.stringify(serialize(doc))).toBe(JSON.stringify(original));
  });

  it('keeps the fan-out ordering that makes a patch sound the way it sounds', () => {
    // `order` fixes which cord out of one outlet fires first. It is the single piece of
    // real Max data this pipeline used to drop, and dropping it is silent: the file
    // reopens fine, looks identical, and evaluates in a different sequence.
    const { path } = MAX_CORPUS.find((f) => f.name === 'mcfm.maxpat')!;
    const original = load(path);
    const written = serialize(parseMaxPat(original));

    const orders = (f: MaxPatFile) =>
      f.patcher.lines.map(({ patchline }) => [
        patchline.source,
        patchline.destination,
        patchline.order,
      ]);
    expect(orders(written)).toEqual(orders(original));
    expect(orders(original).filter(([, , o]) => o !== undefined).length).toBe(134);
  });
});

// ===================================================================================
// LAYER 2 — unknown-key preservation
// ===================================================================================

/**
 * A patch full of everything the IR has no field for.
 *
 * Hand-written as a literal rather than generated, because the whole point is to carry
 * keys no part of this codebase knows about — anything generated could only contain keys
 * the generator knows, which is the opposite of the test. Shaped the way MAX writes a
 * file, not the way maxpylang does: a UI box with no `text` at all, a straight cord with
 * no `midpoints` key, a bent cord with real coordinates, and `destination` before
 * `source` in alphabetical order.
 */
function unknownKeyPatch(): MaxPatFile {
  return {
    patcher: {
      fileversion: 1,
      appversion: { major: 8, minor: 5, revision: 6, architecture: 'x64', modernui: 1 },
      classnamespace: 'box',
      rect: [34.0, 87.0, 1372.0, 779.0],
      openinpresentation: 1,
      // A patcher key from a Max this code has never seen.
      zzz_future_patcher_key: { nested: [1, 2, 3], enabled: true },
      boxes: [
        {
          box: {
            id: 'obj-1',
            bgcolor: [0.2, 0.3, 0.4, 1.0],
            fontsize: 14.0,
            maxclass: 'newobj',
            numinlets: 2,
            numoutlets: 1,
            outlettype: ['signal'],
            patching_rect: [40.0, 40.0, 68.0, 22.0],
            presentation: 1,
            presentation_rect: [10.0, 10.0, 68.0, 22.0],
            text: 'cycle~ 440',
            varname: 'theOscillator',
            // The point of the whole file.
            zzz_future_key: { anything: 'at all', deeply: { nested: [null, 1, 'two'] } },
          },
        },
        {
          box: {
            id: 'obj-2',
            maxclass: 'newobj',
            numinlets: 2,
            numoutlets: 8,
            outlettype: ['signal', 'signal', '', 'list', 'int', '', '', ''],
            patching_rect: [40.0, 100.0, 120.0, 22.0],
            // A vst~'s plugin state. Deleting this reopens as an empty vst~ in Max, with
            // the box text still looking perfectly correct.
            save: ['#N', 'vst~', 'loaduniqueid', 0, 'Ableton:/Plug-Ins/Fabfilter.vst', ';'],
            saved_attribute_attributes: { valueof: { parameter_longname: 'vst~[1]' } },
            saved_object_attributes: { parameter_enable: 1, parameter_mappable: 0 },
            text: 'vst~ 2',
          },
        },
        {
          box: {
            id: 'obj-3',
            // A Max-written UI box: no `text` key at all.
            maxclass: 'gain~',
            multichannelvariant: 0,
            numinlets: 1,
            numoutlets: 2,
            outlettype: ['signal', ''],
            parameter_enable: 0,
            patching_rect: [200.0, 100.0, 22.0, 140.0],
            varname: 'theFader',
          },
        },
        {
          box: {
            id: 'obj-4',
            maxclass: 'ezdac~',
            numinlets: 2,
            numoutlets: 0,
            patching_rect: [40.0, 300.0, 45.0, 45.0],
          },
        },
      ],
      lines: [
        // A straight cord: no midpoints key, Max's own alphabetical key order.
        { patchline: { destination: ['obj-2', 0], source: ['obj-1', 0] } },
        // A bent one: real coordinates, which must come back to the pixel.
        {
          patchline: {
            destination: ['obj-3', 0],
            midpoints: [49.5, 130.0, 209.5, 130.0],
            source: ['obj-2', 0],
          },
        },
        { patchline: { destination: ['obj-4', 0], source: ['obj-3', 0] } },
      ],
      dependency_cache: [],
      autosave: 0,
    },
  };
}

describe('layer 2 — keys nobody modelled survive untouched', () => {
  it('round-trips a patch of unknown keys byte-identically', () => {
    // THE test. String equality on the whole file: not one key added, removed, reordered
    // or retyped. Everything else in this suite is a consequence of this holding.
    const original = unknownKeyPatch();
    const written = serialize(parseMaxPat(original));
    expect(diffJson(original, written)).toEqual([]);
    expect(JSON.stringify(written)).toBe(JSON.stringify(original));
  });

  it('is still byte-identical after a second pass', () => {
    const first = serialize(parseMaxPat(unknownKeyPatch()));
    const second = serialize(parseMaxPat(first));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('names each preserved key explicitly, so a regression says which one broke', () => {
    // The byte comparison above already covers these. Spelling them out means a failure
    // reports "varname is gone" rather than "two 4KB strings differ at offset 1183".
    const written = serialize(parseMaxPat(unknownKeyPatch()));
    const byId = new Map(written.patcher.boxes.map((b) => [b.box.id as string, b.box]));

    const osc = byId.get('obj-1')!;
    expect(osc.bgcolor).toEqual([0.2, 0.3, 0.4, 1.0]);
    expect(osc.presentation_rect).toEqual([10.0, 10.0, 68.0, 22.0]);
    expect(osc.presentation).toBe(1);
    expect(osc.varname).toBe('theOscillator');
    expect(osc.fontsize).toBe(14.0);
    expect(osc.zzz_future_key).toEqual({
      anything: 'at all',
      deeply: { nested: [null, 1, 'two'] },
    });

    const vst = byId.get('obj-2')!;
    expect(vst.save).toEqual([
      '#N',
      'vst~',
      'loaduniqueid',
      0,
      'Ableton:/Plug-Ins/Fabfilter.vst',
      ';',
    ]);
    expect(vst.saved_object_attributes).toEqual({ parameter_enable: 1, parameter_mappable: 0 });
    expect(vst.saved_attribute_attributes).toEqual({
      valueof: { parameter_longname: 'vst~[1]' },
    });

    const fader = byId.get('obj-3')!;
    expect(fader.parameter_enable).toBe(0);
    expect(fader.multichannelvariant).toBe(0);
    expect('text' in fader).toBe(false); // Max writes none for a UI box; neither do we

    expect(written.patcher.zzz_future_patcher_key).toEqual({
      nested: [1, 2, 3],
      enabled: true,
    });
    expect(written.patcher.openinpresentation).toBe(1);
  });

  it('keeps a bent cord\'s waypoints and does not invent any for a straight one', () => {
    const written = serialize(parseMaxPat(unknownKeyPatch()));
    const lines = written.patcher.lines.map((l) => l.patchline);
    expect(lines[0].midpoints).toBeUndefined();
    expect(lines[1].midpoints).toEqual([49.5, 130.0, 209.5, 130.0]);
    expect(lines[2].midpoints).toBeUndefined();
  });

  it('keeps a cord\'s unmodelled keys too — `order` above all', () => {
    // A cord looks like it has nothing worth preserving. It does: `order` fixes the
    // execution order of a fan-out from one outlet, so dropping it changes what the
    // patch DOES, silently, in a way that only shows up as a wrong-sounding patch. Real
    // Max writes one on 238 of the 6255 patchlines in this repo's hand-built examples.
    // IREdge.raw is what makes this pass; before it existed, this test was the record of
    // the one thing a round trip still lost.
    const original = unknownKeyPatch();
    original.patcher.lines[0].patchline.order = 1;
    original.patcher.lines[0].patchline.hidden = 1;
    original.patcher.lines[1].patchline.zzz_future_cord_key = { whatever: true };

    const written = serialize(parseMaxPat(original));
    expect(diffJson(original, written)).toEqual([]);

    const first = written.patcher.lines[0].patchline;
    expect(first.order).toBe(1);
    expect(first.hidden).toBe(1);
    expect(written.patcher.lines[1].patchline.zzz_future_cord_key).toEqual({ whatever: true });
    // Key order included: a cord dict is a copy of the original, like a box dict.
    expect(JSON.stringify(written)).toBe(JSON.stringify(original));
  });

  it('renumbers a preserved cord\'s endpoints without disturbing its other keys', () => {
    // The overlay's whole risk in one test: `raw` carries a stale `source`/`destination`
    // from before the renumber, and a writer that merely spread it would save cords
    // pointing at ids no box has any more.
    const original = unknownKeyPatch();
    original.patcher.lines[0].patchline.order = 2;

    const written = serialize(parseMaxPat(original), { renumber: true });
    const ids = new Set(written.patcher.boxes.map((b) => b.box.id as string));
    expect([...ids]).toEqual(written.patcher.boxes.map((_, i) => `obj-${i + 1}`));

    for (const { patchline } of written.patcher.lines) {
      const [fromId] = patchline.source as [string, number];
      const [toId] = patchline.destination as [string, number];
      expect(ids.has(fromId)).toBe(true);
      expect(ids.has(toId)).toBe(true);
    }
    expect(written.patcher.lines[0].patchline.order).toBe(2);
  });
});

// ===================================================================================
// LAYER 3 — the seeded generative property
// ===================================================================================

/** Fixed forever. A property test you cannot re-run is a property test nobody trusts. */
const SEED = 0xc0ffee;
const CASES = 500;

describe('layer 3 — 500 seeded random documents', () => {
  it('covers the 46 argument-dependent objects', () => {
    // The bias in patchgen is only worth having if the table it draws from is the real
    // one; if boxspecs.json ever stops carrying "in/out" this test says so directly
    // rather than letting 500 cases quietly become 500 easy cases.
    expect(arityRuleNames()).toHaveLength(46);
    expect(arityRuleNames()).toContain('trigger');
    expect(arityRuleNames()).toContain('unpack');
    expect(arityRuleNames()).toContain('vst~');
  });

  it('reaches every one of them, at several argument counts each', () => {
    // The bias is a probability, so "it covers the 46" is a claim and not a guarantee —
    // and a generator that quietly stopped producing arguments would still satisfy every
    // other assertion in this describe. Measured here so the coverage is a fact:
    // 46 rule objects, each seen with at least three different arg counts, is what this
    // seed produces, and a change to the generator that loses that fails HERE rather
    // than by making the property weaker in silence.
    const rules = new Set(arityRuleNames());
    const argCounts = new Map<string, Set<number>>();
    const classes = new Set<string>();

    const rng = new Rng(SEED);
    for (let i = 0; i < CASES; i++) {
      for (const node of randomDoc(rng).nodes()) {
        classes.add(node.className);
        if (!rules.has(node.className)) continue;
        const seen = argCounts.get(node.className) ?? new Set<number>();
        seen.add(parseBoxText(node.text).args.length);
        argCounts.set(node.className, seen);
      }
    }

    expect([...argCounts.keys()].sort()).toEqual(arityRuleNames());
    const thin = [...argCounts].filter(([, counts]) => counts.size < 3).map(([name]) => name);
    expect(thin).toEqual([]);
    // ...and the rest of the catalog is not being ignored either.
    expect(classes.size).toBeGreaterThan(500);
  });

  it('parse(serialize(doc)) recovers doc.toIR(), for every case', () => {
    const rng = new Rng(SEED);
    let boxes = 0;
    let cords = 0;

    for (let i = 0; i < CASES; i++) {
      const doc = randomDoc(rng);
      const ir = doc.toIR();
      boxes += ir.nodes.length;
      cords += ir.edges.length;

      const file = serialize(doc);
      const reread = parseMaxPat(file);
      // `case ${i}` is the whole point of the fixed seed: a failure names a case number
      // that reproduces on any machine by re-running with the same SEED.
      expect(graphOf(reread), `case ${i}`).toEqual(graphOf(ir));
    }

    // Sanity on the generator itself — a bug that produced 500 empty patches would pass
    // every assertion above.
    expect(boxes).toBeGreaterThan(2000);
    expect(cords).toBeGreaterThan(1000);
  });

  it('serializes the arity the io rules compute, for every box', () => {
    const rng = new Rng(SEED);
    let checked = 0;

    for (let i = 0; i < CASES; i++) {
      const file = serialize(randomDoc(rng));
      for (const { box } of file.patcher.boxes) {
        // An object box names its class in its own text; a UI box's class IS its
        // maxclass and Max stores no arguments for it, so there is nothing to feed the
        // rules. (None of the 46 rule objects is a UI class — objectspec.test.ts pins
        // that — so that branch is only ever the default arity.)
        //
        // The `mc.` prefix is the exception, and it is Max's own encoding rather than
        // this suite's: an mc.gain~ is saved as `"maxclass": "gain~"` with
        // `"multichannelvariant": 1`, so reading the maxclass alone would ask for the
        // single-channel object's arity and get "signal" where the file says
        // "multichannelsignal".
        const maxclass = box.maxclass as string;
        const uiName = box.multichannelvariant === 1 ? `mc.${maxclass}` : maxclass;
        const text = typeof box.text === 'string' ? box.text : '';
        const parsed = maxclass === 'newobj' ? parseBoxText(text) : { name: uiName, args: [] };
        const expected = expectedCounts(parsed.name, parsed.args);
        if (!expected) continue; // an unknown name has no rule to check

        const label = `case ${i}: ${parsed.name} [${parsed.args.join(' ')}]`;
        expect(box.numinlets, label).toBe(expected.numinlets);
        expect(box.numoutlets, label).toBe(expected.numoutlets);
        expect(box.outlettype ?? [], label).toEqual(expected.outlettype);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(2000);
  });

  it('writes no cord whose endpoints are out of range for the ports that survived', () => {
    const rng = new Rng(SEED);
    let cords = 0;

    for (let i = 0; i < CASES; i++) {
      const file = serialize(randomDoc(rng));
      const ports = new Map(
        file.patcher.boxes.map(({ box }) => [
          box.id as string,
          { ins: box.numinlets as number, outs: box.numoutlets as number },
        ]),
      );

      for (const { patchline } of file.patcher.lines) {
        const [fromId, outlet] = patchline.source as [string, number];
        const [toId, inlet] = patchline.destination as [string, number];
        const src = ports.get(fromId);
        const dst = ports.get(toId);
        const label = `case ${i}: ${fromId}:${outlet} -> ${toId}:${inlet}`;

        // A dangling endpoint is the worst of the three: Max drops the cord silently.
        expect(src, label).toBeDefined();
        expect(dst, label).toBeDefined();
        expect(outlet, label).toBeGreaterThanOrEqual(0);
        expect(outlet, label).toBeLessThan(src!.outs);
        expect(inlet, label).toBeGreaterThanOrEqual(0);
        expect(inlet, label).toBeLessThan(dst!.ins);
        cords++;
      }
    }
    expect(cords).toBeGreaterThan(1000);
  });

  it('keeps outlettype exactly numoutlets long, and drops it when there are none', () => {
    // The invariant that makes a phantom outlet impossible: Max draws one outlet per
    // outlettype entry, so a stale extra entry is a port a user can drop a cord on that
    // the object does not have.
    const rng = new Rng(SEED);
    for (let i = 0; i < CASES; i++) {
      for (const { box } of serialize(randomDoc(rng)).patcher.boxes) {
        const n = box.numoutlets as number;
        const label = `case ${i}: ${String(box.id)} ${String(box.text ?? box.maxclass)}`;
        if (n === 0) expect('outlettype' in box, label).toBe(false);
        else expect((box.outlettype as string[]).length, label).toBe(n);
      }
    }
  });

  it('is reproducible: the same seed gives the same 500 files', () => {
    const run = () => {
      const rng = new Rng(SEED);
      const out: string[] = [];
      for (let i = 0; i < 25; i++) out.push(JSON.stringify(serialize(randomDoc(rng))));
      return out;
    };
    expect(run()).toEqual(run());
  });
});

// ===================================================================================
// cross-language parity — the real maxpylang reads what we wrote
// ===================================================================================

/**
 * The Python side is OPTIONAL, and that is a deliberate trade rather than a compromise.
 *
 * Shelling out costs one interpreter start (~0.4s warm) and gives something no fixture
 * can: the answer comes from whatever maxpylang is checked out RIGHT NOW, so a change to
 * its loader is caught the day it lands instead of the day somebody remembers to
 * regenerate a fixture. The cost is that it only runs where the venv exists, so the
 * whole describe is skipped without it and `npm test` never depends on Python. A
 * committed fixture would have inverted both properties — always runs, always stale —
 * and the arity parity that a fixture WOULD be right for already exists as one
 * (test/fixtures/io-parity.json, replayed by test/io-rules.test.ts). This test is about
 * the FILE: does the other implementation see the same patch in it.
 *
 * Everything is handed over in maxpylangCompat mode, because maxpylang cannot read Max's
 * own convention at all — build_from_dict indexes `given_dict['box']['text']`
 * unconditionally, so a UI box written the way Max writes it (no `text` key) raises
 * KeyError. That is asserted below rather than worked around silently.
 */
const PYTHON = fileURLToPath(new URL('../../.venv/bin/python', import.meta.url));
// Opt-in, NOT part of `npm test`. Spawning maxpylang costs a Python interpreter start plus
// a ~1s package import per batch, and under any real machine load (a parallel test run, a
// build) that reliably blows past the spawn timeout and takes the whole suite with it — this
// file alone once turned a 2s suite into a 78-minute one. The check is genuinely valuable, so
// it stays: run it deliberately with `npm run test:parity`, or in its own CI job.
const HAS_PYTHON = existsSync(PYTHON) && process.env.MAXPY_PARITY === '1';

const PROBE = `
import contextlib, io, json, sys
import maxpylang as mp

# maxpylang prints on nearly every call (place(), connect(), build_from_dict()), so its
# stdout is swallowed and the answer comes back after a marker.
def describe(path):
    with contextlib.redirect_stdout(io.StringIO()):
        patch = mp.MaxPatch(load_file=path, reorder=False, verbose=False)
        patcher = patch.dict['patcher']
    return {
        'boxes': [
            [b['box']['id'], b['box']['maxclass'], b['box']['numinlets'], b['box']['numoutlets']]
            for b in patcher['boxes']
        ],
        'lines': len(patcher['lines']),
    }

out = {}
for path in json.loads(sys.argv[1]):
    try:
        out[path] = describe(path)
    except Exception as exc:
        out[path] = {'error': type(exc).__name__ + ': ' + str(exc)}
print('<<<MAXPYLANG>>>' + json.dumps(out))
`;

interface Probe {
  boxes?: [string, string, number, number][];
  lines?: number;
  error?: string;
}

function askMaxpylang(paths: string[], scriptPath: string): Record<string, Probe> {
  const stdout = execFileSync(PYTHON, [scriptPath, JSON.stringify(paths)], {
    encoding: 'utf-8',
    timeout: 120_000,
  });
  const at = stdout.lastIndexOf('<<<MAXPYLANG>>>');
  if (at === -1) throw new Error(`maxpylang probe produced no result:\n${stdout}`);
  return JSON.parse(stdout.slice(at + '<<<MAXPYLANG>>>'.length)) as Record<string, Probe>;
}

/** What this side thinks is in a file, in the same shape the probe reports. */
function ourView(file: MaxPatFile): Probe {
  return {
    boxes: file.patcher.boxes.map(({ box }) => [
      box.id as string,
      box.maxclass as string,
      box.numinlets as number,
      box.numoutlets as number,
    ]),
    lines: file.patcher.lines.length,
  };
}

describe.skipIf(!HAS_PYTHON)('cross-language parity — real maxpylang reads our output', () => {
  let dir: string;
  let script: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'maxpy-roundtrip-'));
    script = join(dir, 'probe.py');
    writeFileSync(script, PROBE, 'utf-8');
  });

  it('agrees on every box and cord of every corpus file we rewrote', () => {
    const ours = new Map<string, Probe>();
    for (const { name, path } of CORPUS) {
      const file = serialize(parseMaxPat(load(path)), { maxpylangCompat: true });
      const out = join(dir, `${name.replace(/[/\\]/g, '_')}`);
      writeFileSync(out, JSON.stringify(file, null, 2), 'utf-8');
      ours.set(out, ourView(file));
    }

    const theirs = askMaxpylang([...ours.keys()], script);
    for (const [path, mine] of ours) {
      expect(theirs[path]?.error, path).toBeUndefined();
      expect(theirs[path], path).toEqual(mine);
    }
  });

  it('agrees on generated documents, arity rules and all', () => {
    // The corpus above is patches maxpylang itself wrote, so it only proves we did not
    // damage them. These are patches this codebase invented — the arity came from the TS
    // port of parse_io_num, and maxpylang is being asked whether it reads the same box.
    const rng = new Rng(SEED);
    const ours = new Map<string, Probe>();
    for (let i = 0; i < 20; i++) {
      const file = serialize(randomDoc(rng, { boxes: [4, 12] }), { maxpylangCompat: true });
      const out = join(dir, `generated-${i}.maxpat`);
      writeFileSync(out, JSON.stringify(file, null, 2), 'utf-8');
      ours.set(out, ourView(file));
    }

    const theirs = askMaxpylang([...ours.keys()], script);
    for (const [path, mine] of ours) {
      expect(theirs[path]?.error, path).toBeUndefined();
      expect(theirs[path], path).toEqual(mine);
    }
  });

  it('shows why parity has to run in compat mode: maxpylang cannot read Max\'s own shape', () => {
    // A UI box written the way Max writes it carries no `text` key, and maxpylang's
    // build_from_dict reaches for one unconditionally. Asserted, not assumed: if
    // maxpylang is fixed upstream this test fails and the compat-mode requirement above
    // can be relaxed.
    const file = serialize(parseMaxPat(unknownKeyPatch())); // Max's own shape, no compat
    const out = join(dir, 'max-shape.maxpat');
    writeFileSync(out, JSON.stringify(file, null, 2), 'utf-8');

    const probe = askMaxpylang([out], script)[out];
    expect(probe.error).toMatch(/KeyError/);
    expect(probe.error).toMatch(/text/);
  });
});
