// IRPatch / PatchDoc  ->  .maxpat JSON — the mirror of parser/maxpat.ts.
//
// The bar is not "Max can open it". It is "a file this produces loses nothing from a
// file real Max produced", and that is a preservation problem rather than a formatting
// one. Max stores far more about a box than this app models — bgcolor,
// presentation_rect, varname, saved_object_attributes, parameter_enable, fontsize, a
// vst~'s base64 `save` blob, a `p` object's entire nested patcher, keys from a Max
// newer than this code — and a writer that rebuilt each box out of the IR's ten
// distilled fields would silently delete every one of them. So nothing is rebuilt:
// every box is the ORIGINAL dict (ir/types.ts:IRNode.raw, stashed on the way past by
// the parser) with the handful of keys the IR owns overlaid on top. That is the whole
// contract of this module, and test/writer.test.ts pins it with a box carrying a key no
// version of Max has ever written.
//
// The keys the IR owns, and why each must come from the IR and never from `raw`:
//   id, patching_rect      the document moves, renumbers and resizes boxes
//   numinlets, numoutlets  retyping `unpack 1 2 3` as `unpack 1 2` changes them
//   outlettype             ...and the stale third entry a `raw` copy would leave behind
//                          is a phantom outlet for Max to draw and let you connect
//   maxclass, text         the box's identity and its contents
//
// Three Max conventions, each verified against the 1093 boxes of the hand-built patches
// under examples/ rather than assumed:
//   - `outlettype` is present exactly when numoutlets > 0, and is always numoutlets long.
//   - `text` is present only on newobj, message and comment. A UI box (toggle, number,
//     ezdac~, gain~, …) carries none, and a `message` box's text is its CONTENTS with no
//     class prefix — the `if self._name != "message"` asymmetry in text.py:get_text.
//   - `midpoints` is absent on a straight cord and an even-length list of coordinates on
//     a bent one; it is never `[null]`.
// maxpylang disagrees on all three cosmetics: it writes `text` on every box (a toggle's
// reads "toggle"), and `"midpoints": [null]` on every cord. `maxpylangCompat` reproduces
// its shape so a parity test can hold both writers to the same file.
//
// Cords are preserved the same way, and for a less obvious reason: Max writes `order` on
// a patchline to fix the execution order of a fan-out from one outlet, which changes what
// the patch DOES rather than how it looks (238 of the 6255 patchlines in the hand-built
// patches under examples/ carry one). So a line is its original dict too, with only
// source, destination and midpoints written over it.
//
// Box text gets the same treatment for the same reason, and it is the one place the
// preservation rule is easy to break by accident: parseBoxText/formatBoxText are
// maxpylang's parse_text/get_text, they normalize (whitespace collapses, `33.` becomes
// `33.0`), and that is correct for an inspector edit and wrong for a box nobody touched.
// So the parse decides only whether a leading class name has to come off; when it
// doesn't, node.text is written back verbatim. See boxText.
//
// What this cannot preserve, reported rather than hidden:
//   - Max writes whole numbers as "34.0". JSON.parse gives a JS number and JSON.stringify
//     writes "34" back, so a byte diff of a round trip always shows that churn. Max reads
//     either. Compare round trips as parsed JSON, never as text.
//   - `order` is preserved per cord but never RENUMBERED. Delete the middle cord of a
//     three-way fan-out and the survivors still read 0 and 2. That is the file Max would
//     have written minus one line, which is the conservative choice available to a writer
//     that does not model what `order` means; a patcher that starts letting the user
//     reorder a fan-out has to own the whole sequence rather than just carry it.

import { formatBoxText, parseBoxText, resolveBox, type ParsedBoxText } from '../ir/objectspec';
import type { IREdge, IRNode, IRPatch } from '../ir/types';

/**
 * maxpylang/data/PATCH_TEMPLATES/empty_template.json's patcher dict, minus `boxes` and
 * `lines` — i.e. the same shape as IRPatch.header, so the two are interchangeable.
 *
 * Copied verbatim rather than imported: maxpylang's data directory is outside this
 * package and outside the Vite build's roots. Its 34 keys are byte-identical to the
 * patcher header of every hand-built patch in examples/ (Max 8.1.11), so this really is
 * "what Max writes for an empty patcher" and not just what maxpylang happens to ship.
 *
 * Deep-frozen. It is the base for every new patch, so one stray `header.rect[2] = …`
 * would otherwise corrupt every patch saved afterwards in the same session. Override
 * through WriteOptions.header instead.
 */
export const EMPTY_PATCHER_HEADER: Readonly<Record<string, unknown>> = deepFreeze({
  fileversion: 1,
  appversion: { major: 8, minor: 1, revision: 11, architecture: 'x64', modernui: 1 },
  classnamespace: 'box',
  rect: [34.0, 87.0, 1372.0, 779.0],
  bglocked: 0,
  openinpresentation: 0,
  default_fontsize: 12.0,
  default_fontface: 0,
  default_fontname: 'Arial',
  gridonopen: 1,
  gridsize: [15.0, 15.0],
  gridsnaponopen: 1,
  objectsnaponopen: 1,
  statusbarvisible: 2,
  toolbarvisible: 1,
  lefttoolbarpinned: 0,
  toptoolbarpinned: 0,
  righttoolbarpinned: 0,
  bottomtoolbarpinned: 0,
  toolbars_unpinned_last_save: 0,
  tallnewobj: 0,
  boxanimatetime: 200,
  enablehscroll: 1,
  enablevscroll: 1,
  devicewidth: 0.0,
  description: '',
  digest: '',
  tags: '',
  style: '',
  subpatcher_template: '',
  assistshowspatchername: 0,
  dependency_cache: [],
  autosave: 0,
});

export interface WriteOptions {
  /**
   * Renumber the boxes densely as obj-1…obj-N in document order, rewriting every cord
   * endpoint to match. The document's own ids are monotonic and never reused (reuse
   * would break outstanding undo records), so they go sparse as you edit; a saved file
   * should not show the holes.
   */
  renumber?: boolean;
  /** Patcher-header keys to override — window `rect`, `openinpresentation`, fonts, … */
  header?: Record<string, unknown>;
  /** Emit maxpylang's shape rather than Max's own. See the module comment. */
  maxpylangCompat?: boolean;
}

/**
 * What this writer serializes.
 *
 * Structural on purpose: doc/patch-doc.ts's `PatchDoc` satisfies it through `toIR()`,
 * and so does a bare `IRPatch` straight out of parseMaxPat — which is what lets the
 * player save a file it never opened in the editor, and lets this module be tested
 * without standing up a document.
 */
export interface PatchSource {
  toIR(): IRPatch;
}

/** Box classes whose `text` is user content Max reads back. See the module comment. */
const TEXT_CLASSES = new Set(['newobj', 'message', 'comment']);

/**
 * Patcher keys Max writes AFTER `boxes`/`lines`.
 *
 * IRPatch.header is the patcher dict with boxes and lines deleted, which loses where
 * they sat. Every patcher in the corpus puts them immediately before the first of these,
 * so re-inserting there reproduces Max's own key order and keeps a diff of a round trip
 * free of reordering noise. Purely cosmetic — JSON object order carries no meaning.
 */
const HEADER_TAIL_KEYS = new Set(['parameters', 'styles', 'dependency_cache', 'autosave']);

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

/**
 * The default box dict to build on when a node has no `raw` — a box created on the
 * canvas rather than read from a file.
 *
 * Without it a new `toggle` would lose `parameter_enable`, a new `vst~` its `save`
 * blob and its `saved_object_attributes`: keys the IR has no field for but Max needs.
 * A newobj is resolved from its whole text because that is where its class name lives
 * (and because a vst~'s `save` depends on its arguments); a UI box's text is its
 * contents, so that one has to be asked for by class name.
 *
 * Empty until loadBoxSpecs() has resolved, and empty for a class no object has. Both
 * are survivable: everything the engine and the renderer need is IR-owned anyway.
 */
function defaultBoxFor(node: IRNode): Record<string, unknown> {
  const spec = resolveBox(node.maxclass === 'newobj' ? node.text : node.className);
  return spec.known ? spec.box : {};
}

/**
 * A node's box text, split the way the parser split it.
 *
 * A UI box's text is supposed to be its contents alone — Max stores no class name there,
 * and for most UI classes stores nothing at all. Two writers put one there anyway, and
 * both mean "this is the class", not "this is an argument":
 *   - maxpylang writes it into every box (`"text": "ezdac~"`), because text.py:get_text
 *     has no idea Max omits the key for a UI box;
 *   - ir/objectspec's specToNode keeps the line that was TYPED to create the box
 *     ("message 440") in `text`, while its `args` already exclude the class name.
 * Left in place, the first doubles the name back into maxpylang's own format and the
 * second saves a message box that sends the symbol "message".
 *
 * So the leading token is dropped when it is the class name — unconditionally for a
 * class whose text is decoration, and for message and comment only once the node's own
 * arg count confirms it is one token too many, because their text is real content and a
 * comment may genuinely begin with the word "comment".
 *
 * Whether it dropped one is reported, because that is the ONLY reason to rewrite a box's
 * text at all. See boxText.
 */
interface BoxContent {
  parsed: ParsedBoxText;
  /** True when a leading class-name token was removed from the node's own text. */
  stripped: boolean;
}

function contentOf(node: IRNode): BoxContent {
  const text = node.text ?? '';
  if (node.maxclass === 'newobj') return { parsed: parseBoxText(text), stripped: false };

  const trimmed = text.trim();
  const direct = parseBoxText(trimmed, node.maxclass);
  const first = trimmed.split(/\s+/)[0] ?? '';
  if (first === '' || first !== node.className) return { parsed: direct, stripped: false };

  const decorative = !TEXT_CLASSES.has(node.maxclass);
  if (decorative || direct.args.length === node.args.length + 1) {
    return { parsed: parseBoxText(trimmed.slice(first.length), node.maxclass), stripped: true };
  }
  return { parsed: direct, stripped: false };
}

/**
 * What to write into `text`.
 *
 * Max's form drops the class name from a UI box; maxpylang's keeps it, and leaves the
 * leading space its `text = ""` / `text += " " + args` produces for a message box — the
 * reason webcam_pixelated_synth.maxpat contains `"text": " 440"`.
 *
 * In Max's form the text is otherwise written back ATOM FOR ATOM, straight off the node,
 * and the parse is used only to decide whether a class name has to come off. Recomposing
 * it with formatBoxText would be a normalization, and parseBoxText/formatBoxText
 * normalize by design — they are maxpylang's parse_text/get_text, meant for an inspector
 * edit where the round trip through the atoms IS the edit. Applied to a box nobody
 * touched they rewrite what Max wrote:
 *   - `mc.lores~ 33. 0.5` becomes `mc.lores~ 33.0 0.5`, because Python's str() spells a
 *     whole float "33.0" and Max spells it "33.";
 *   - a comment reading "1. load the file\n2. generate" becomes "1.0 load the file 2.0
 *     generate" — both halves wrong, the numbered list renumbered and the line breaks
 *     flattened, because whitespace collapses to single spaces.
 * Neither changes what the patch DOES, and both change what the author wrote. 38 boxes
 * across the nine Max-saved patches under examples/ hit one or the other; the round-trip
 * suite's "real Max files" layer is what pins it.
 */
function boxText(node: IRNode, compat: boolean): string {
  const { parsed, stripped } = contentOf(node);
  if (compat) {
    const text = formatBoxText(parsed);
    return parsed.name === 'message' && text !== '' ? ` ${text}` : text;
  }
  if (!stripped) return node.text ?? '';
  return formatBoxText(parsed, node.maxclass === 'newobj' ? undefined : node.maxclass);
}

/**
 * `outlettype`, always exactly numOutlets long.
 *
 * Taken from the COMPUTED tokens, never from `raw`: shrinking `unpack 1 2 3` to
 * `unpack 1 2` has to drop the third entry, and a copied `raw` would leave Max reading
 * an outlet the box no longer has. A node built by hand may have no tokens at all, in
 * which case the coarsest tokens that reproduce its domains are good enough — "" is
 * what Max writes for bang/int/list outlets anyway.
 */
function outletTokens(node: IRNode): string[] {
  const tokens =
    node.outletTypes ??
    node.outletDomains.map((d) => (d === 'signal' ? 'signal' : d === 'video' ? 'jit_matrix' : ''));
  return Array.from({ length: node.numOutlets }, (_, i) => tokens[i] ?? '');
}

/**
 * One IR node as a .maxpat box dict: everything it arrived with, with the IR-owned keys
 * overlaid. See the module comment for why that direction is the entire point.
 *
 * The copy is shallow, so values this writer does not own (a nested `patcher`, a vst~'s
 * `save`, `saved_object_attributes`) are shared with the node rather than cloned. The
 * writer never mutates them and the result is normally handed straight to
 * JSON.stringify; a caller that plans to edit the output should clone it first.
 */
export function nodeToBox(node: IRNode, opts: WriteOptions = {}): Record<string, unknown> {
  const compat = opts.maxpylangCompat === true;
  const base = node.raw ?? defaultBoxFor(node);

  // A box that arrived from a file already has `id` where its writer put it, and that is
  // not always first: Max orders a box dict alphabetically, so an inlet box begins
  // `"comment": "", "id": …`. Seeding would move it and make a round trip differ by key
  // order for no reason. Only a box with no original needs the seed, and there `id`
  // first IS Max's order (boxspecs' default dicts start at `maxclass`). Either way the
  // assignment below is what sets the value, since `base` may carry a stale id.
  const box: Record<string, unknown> = 'id' in base ? { ...base } : { id: node.id, ...base };
  box.id = node.id;
  box.maxclass = node.maxclass;
  box.numinlets = node.numInlets;
  box.numoutlets = node.numOutlets;

  if (node.numOutlets > 0) box.outlettype = outletTokens(node);
  else delete box.outlettype;

  box.patching_rect = [...node.rect];

  if (compat || TEXT_CLASSES.has(node.maxclass) || 'text' in base) {
    let text = boxText(node, compat);
    // A UI box's text is decoration: Max omits it, maxpylang writes the class name into
    // it, and neither is content the IR models. If the box came in with one and the
    // contents distil to nothing, keep what was there rather than blanking it — the
    // node is authoritative only for the three classes whose text is real.
    if (text === '' && !TEXT_CLASSES.has(node.maxclass) && typeof base.text === 'string') {
      text = base.text;
    }
    box.text = text;
  } else {
    delete box.text;
  }

  return box;
}

/**
 * One IR edge as a `lines[]` entry — the same overlay as nodeToBox, for the same reason.
 *
 * A cord looks like it has nothing worth preserving, and that is wrong: Max also writes
 * `order` on it, which fixes the execution order of a fan-out from one outlet and so
 * changes what the patch DOES, plus `hidden` and `disabled`. So the original patchline
 * dict (IREdge.raw) is the base and only the three keys the IR owns are written over it.
 * A cord drawn on the canvas has no original and starts from the key order of whichever
 * writer's shape is being produced.
 *
 * The IR-owned keys:
 *   source, destination  the document renumbers boxes (`idOf`), and both ends of a cord
 *                        have to follow the ids the boxes were just written under
 *   midpoints            cord waypoints, and the one key whose PRESENCE is meaningful:
 *                        Max reads a cord with no midpoints as straight
 */
function edgeToLine(
  edge: IREdge,
  idOf: (id: string) => string,
  compat: boolean,
): Record<string, unknown> {
  const destination = [idOf(edge.to.id), edge.to.inlet];
  const source = [idOf(edge.from.id), edge.from.outlet];
  const midpoints = edge.midpoints;

  // The seeds exist only to fix key order for a cord that has no original: Max's is
  // alphabetical, maxpylang's is the order its writer appends in. Neither order changes
  // what Max reads; both keep a round trip of that writer's file diffing cleanly. The
  // values are placeholders — every one of the three is assigned or deleted below.
  const line: Record<string, unknown> = edge.raw
    ? { ...edge.raw }
    : compat
      ? { destination, source, midpoints }
      : { destination, midpoints, source };
  line.destination = destination;
  line.source = source;

  if (compat) {
    // maxpylang writes the key on every cord, defaulting to the [null] placeholder its
    // MaxInlet carries per source; Max writes it only for a cord that actually bends.
    line.midpoints = midpoints ?? [null];
    // Note that compat inherits `raw` too, so a cord that came from a Max file keeps its
    // `order` here even though maxpylang would not have written one. Compat reproduces
    // maxpylang's shape for the files maxpylang wrote — which is all the parity test
    // asks of it — rather than deleting data to imitate its omissions.
    return { patchline: line };
  }

  const bent =
    Array.isArray(midpoints) &&
    midpoints.length > 0 &&
    midpoints.every((m) => typeof m === 'number');
  if (bent) line.midpoints = [...(midpoints as number[])];
  else delete line.midpoints;

  return { patchline: line };
}

/**
 * Rebuild the patcher dict with `boxes`/`lines` back in the slot Max puts them in.
 * Header keys named `boxes`/`lines` are dropped: this writer owns the graph.
 */
function assemblePatcher(
  header: Record<string, unknown>,
  boxes: unknown[],
  lines: unknown[],
): Record<string, unknown> {
  const keys = Object.keys(header).filter((k) => k !== 'boxes' && k !== 'lines');
  const tailAt = keys.findIndex((k) => HEADER_TAIL_KEYS.has(k));
  const cut = tailAt === -1 ? keys.length : tailAt;

  const out: Record<string, unknown> = {};
  for (const k of keys.slice(0, cut)) out[k] = header[k];
  out.boxes = boxes;
  out.lines = lines;
  for (const k of keys.slice(cut)) out[k] = header[k];
  return out;
}

/**
 * A whole document as .maxpat JSON, ready for JSON.stringify.
 *
 * Accepts a PatchDoc or a bare IRPatch. The patcher header is the one the patch was
 * opened with when it has one — so a file opened here and saved again keeps its window
 * size, its fonts and its presentation flag — and EMPTY_PATCHER_HEADER otherwise.
 */
export function patchToMaxPat(doc: PatchSource | IRPatch, opts: WriteOptions = {}): unknown {
  const patch = 'toIR' in doc ? doc.toIR() : doc;
  const compat = opts.maxpylangCompat === true;

  // Renumbering is done here rather than by mutating the document: saving must not
  // disturb ids the undo stack and the engine's per-cord teardown map are holding.
  const renumbered = new Map<string, string>();
  if (opts.renumber) {
    patch.nodes.forEach((node, i) => renumbered.set(node.id, `obj-${i + 1}`));
  }
  // An endpoint with no mapping is a dangling cord; keep its id rather than inventing
  // one, so the damage stays visible instead of being silently re-pointed.
  const idOf = (id: string): string => renumbered.get(id) ?? id;

  const boxes = patch.nodes.map((node) => ({
    box: nodeToBox(opts.renumber ? { ...node, id: idOf(node.id) } : node, opts),
  }));
  const lines = patch.edges.map((edge) => edgeToLine(edge, idOf, compat));

  const header = { ...(patch.header ?? EMPTY_PATCHER_HEADER), ...(opts.header ?? {}) };
  return { patcher: assemblePatcher(header, boxes, lines) };
}
