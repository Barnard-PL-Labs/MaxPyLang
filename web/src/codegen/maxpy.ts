// The patch document, written back out as a MaxPy script.
//
// This is the canvas -> Python half of the two-way loop, and the reason ui/sync.ts has
// to guard that direction: the transform is a PROJECTION, not an inverse. A hand-written
// script that placed sixteen objects in a `for` loop comes back as sixteen literal
// place() calls, and nothing here can recover the loop — or the comments, or the
// variable names the author chose. So the output is only ever offered as *generated*
// code, never merged into a buffer somebody typed in.
//
// What it emits is deliberately the STARTER script's style (src/studio.ts): one
// `place(...)[0]` + `move(...)` per box with the moves aligned into a column, then the
// cords, then `save()`. That style is what the Studio teaches, so a user who opens the
// Python drawer sees the shape of program they already know how to edit.
//
// Three contracts it upholds:
//
//   1. DETERMINISM. The same document produces byte-identical text every time — same
//      box order (the document's own creation order, which is also the order place()
//      will run and therefore the order maxpylang will mint obj-1..obj-N in), same cord
//      order, same alignment column. Without that, "regenerate on every canvas edit"
//      would produce a useless diff and a scrolling editor on every keystroke.
//
//   2. STABLE NAMES. Variable names are cached per document (a module-level WeakMap,
//      keyed by the document object), so renaming one box does not renumber everything
//      after it. A name is re-derived only when its box's class changes — `osc` must not
//      go on calling itself `osc` after it becomes a `saw~`.
//
//   3. NO MUTATION. patchToMaxPy() is pure with respect to the document. See the note on
//      reorder() below, which is the one place this module deliberately departs from the
//      plan's letter to keep that true.
//
// KNOWN LIMITS, all of them maxpylang's rather than this module's, and all worth knowing
// before trusting a round trip:
//
//   • `MaxObject.move(x, y)` writes patching_rect[0:2] and there is NO public maxpylang
//     API for a box's width or height. A box the user resized on the canvas comes back
//     at its default size. (Resize is not offered in the patcher for exactly this
//     reason — see the plan's "Key findings".)
//   • Max-only box keys (bgcolor, presentation_rect, varname, saved_object_attributes)
//     and cord keys (`order`, which fixes fan-out execution order and so changes what
//     the patch DOES) have no maxpylang expression at all. IRNode.raw carries them
//     through a .maxpat save; it cannot carry them through Python.
//   • A `comment` box's text loses nothing but gains its own class name: get_text()
//     re-emits `name + args` for every class except `message`, so `place("comment hi")`
//     produces a comment reading "comment hi". Naming the class is the only way to get
//     the right object, so this one is unavoidable upstream.

import { parseBoxText } from '../ir/objectspec';
import type { IREdge, IRNode } from '../ir/types';

/**
 * What patchToMaxPy needs from a document.
 *
 * Structural rather than `PatchDoc`, for the same reason write-maxpat's `PatchSource`
 * is: it lets a test drive this module with three literal nodes and no document, and it
 * keeps codegen from importing the document layer at runtime.
 */
export interface MaxPySource {
  nodes(): Iterable<IRNode>;
  edges(): Iterable<IREdge>;
}

export interface MaxPyOptions {
  /** The name handed to `patch.save(...)`. Default "my_patch.maxpat". */
  filename?: string;
  /** Emit the leading explanatory comment. Default true. */
  banner?: boolean;
}

const DEFAULT_FILENAME = 'my_patch.maxpat';

/**
 * The alignment column for the trailing `.move(...)`, in characters.
 *
 * A cap, not a width: one box with a 300-character comment must not push every other
 * move() off the right of the editor. Lines past the cap simply get a single space.
 */
const MOVE_COLUMN = 72;

/**
 * Box classes whose `text` Max persists as user CONTENT rather than as decoration.
 *
 * The same set as write-maxpat.ts's, and it is here for the same reason: deciding
 * whether a leading token that matches the class name is the class name or is the first
 * word of the content. A `toggle` reading "toggle" was written by maxpylang; a comment
 * reading "comment on line 3" was written by a human.
 */
const TEXT_CLASSES = new Set(['newobj', 'message', 'comment']);

/**
 * Names a generated script must not bind, because binding one would either be a syntax
 * error or would shadow something the script itself uses.
 *
 * The Max object set really does contain `if`, `in`, `match`, `print`, `int`, `float`
 * and `dict`, so this is not hypothetical — `if = patch.place("if")[0]` does not parse.
 * `mp` and `patch` are the script's own two locals.
 */
const RESERVED = new Set([
  // keywords
  'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global',
  'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise',
  'return', 'try', 'while', 'with', 'yield',
  // soft keywords and the builtins a Max class name actually collides with
  'case', 'match', 'type', 'print', 'int', 'float', 'str', 'list', 'dict', 'set', 'tuple',
  // this script's own locals
  'mp', 'patch',
]);

/**
 * Operator objects, whose names are punctuation and have no letters to sanitize.
 *
 * Checked per dot-segment, so `mc.*~` becomes `mc_times` rather than `mc_` — which would
 * collide with every other `mc.` operator and leave the reader guessing which one.
 */
const OPERATOR_WORDS: Record<string, string> = {
  '+': 'plus', '-': 'minus', '*': 'times', '/': 'div', '%': 'mod',
  '!': 'not', '!-': 'rminus', '!/': 'rdiv', '+=': 'plusequals',
  '==': 'eq', '!=': 'neq', '>': 'gt', '>=': 'gte', '<': 'lt', '<=': 'lte',
  '&': 'and', '|': 'or', '&&': 'andand', '||': 'oror', '<<': 'shl', '>>': 'shr',
};

/** Per-character fallback for a segment the table above doesn't name outright. */
const CHAR_WORDS: Record<string, string> = {
  '+': 'plus', '-': 'minus', '*': 'times', '/': 'div', '%': 'mod', '!': 'not',
  '=': 'eq', '>': 'gt', '<': 'lt', '&': 'and', '|': 'or',
};

/**
 * nodeId -> variable name, per document.
 *
 * A WeakMap rather than a field on PatchDoc: the document layer has no business knowing
 * that a code generator exists, and a WeakMap keyed by the document releases the whole
 * table when the document is replaced (which the patcher does on every open and every
 * ▶ Run). Nothing here keeps a document alive.
 */
const nameCache = new WeakMap<MaxPySource, Map<string, string>>();

/** Drop the cached names for one document — the next generation re-derives them all. */
export function forgetNames(doc: MaxPySource): void {
  nameCache.delete(doc);
}

/**
 * A Max class name as a legal, readable Python identifier.
 *
 *   cycle~     -> cycle          (the signal tilde is noise in an identifier)
 *   *~         -> times          (punctuation-only segment: named, not transliterated)
 *   jit.movie  -> jit_movie
 *   mc.*~      -> mc_times
 *   2d.wave~   -> _2d_wave       (an identifier may not begin with a digit)
 *   print      -> print_         (legal, but shadowing a builtin reads as a bug)
 *
 * Pure and total: every input produces a non-empty identifier, and the same input always
 * produces the same one.
 */
export function varNameFor(className: string): string {
  // The tilde is a domain marker, not part of the name; `mc.*~` and `*~` differing only
  // by it would just be dedupe noise, and the dedupe pass below handles the collision.
  const bare = (className ?? '').replace(/~/g, '');

  const parts = bare.split('.').map((segment) => {
    if (segment === '') return '';
    const word = OPERATOR_WORDS[segment];
    if (word) return word;
    return [...segment]
      .map((ch, i) => {
        if (/[A-Za-z0-9_]/.test(ch)) return ch;
        // A hyphen between two word characters is a separator (windowed-fft~), not the
        // `-` object; spelling it "minus" there would read as arithmetic.
        if (ch === '-' && /[A-Za-z0-9]/.test(segment[i - 1] ?? '') && /[A-Za-z0-9]/.test(segment[i + 1] ?? '')) {
          return '_';
        }
        return CHAR_WORDS[ch] ?? '_';
      })
      .join('');
  });

  let name = parts.join('_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (name === '') name = 'obj';
  if (/^[0-9]/.test(name)) name = `_${name}`;
  if (RESERVED.has(name)) name = `${name}_`;
  return name;
}

/**
 * Assign every live box a unique variable name, reusing the cached one where it is still
 * appropriate.
 *
 * "Still appropriate" means two things, and both matter for the diff the user sees:
 * the cached name must be derived from the box's CURRENT class (retyping `cycle~ 440`
 * into `saw~ 440` has to rename `osc`), and it must not already have been handed to an
 * earlier box in this same pass (two boxes may not share a name, cache or no cache).
 * Everything else keeps the name it had, so editing one box rewrites one line.
 */
function assignNames(doc: MaxPySource): Map<string, string> {
  const cached = nameCache.get(doc) ?? new Map<string, string>();
  const assigned = new Map<string, string>();
  const taken = new Set<string>();

  // Two passes. The first honours cached names so a box keeps the identifier it had even
  // when an earlier box now wants the same base; the second allocates for the rest.
  // Doing it in one pass would let a newly-created `cycle~` claim `osc`... sorry, `cycle`
  // before the box that has been called `cycle` since the session started reached it.
  const pending: IRNode[] = [];
  for (const node of doc.nodes()) {
    const base = varNameFor(node.className);
    const prior = cached.get(node.id);
    // `prior === base`, or `prior` is `base` with a `_2`/`_3` dedupe suffix: either way
    // it was derived from this class and is still an honest name for this box. (String
    // work rather than a RegExp per box: this runs on a debounce over the whole patch.)
    const derived =
      prior !== undefined &&
      (prior === base ||
        (prior.startsWith(`${base}_`) && /^\d+$/.test(prior.slice(base.length + 1))));
    if (derived && !taken.has(prior)) {
      assigned.set(node.id, prior);
      taken.add(prior);
    } else {
      pending.push(node);
    }
  }

  for (const node of pending) {
    const base = varNameFor(node.className);
    let name = base;
    let n = 2;
    while (taken.has(name)) name = `${base}_${n++}`;
    assigned.set(node.id, name);
    taken.add(name);
  }

  nameCache.set(doc, new Map(assigned));
  return assigned;
}

/**
 * The string to hand `place()` so that maxpylang rebuilds this exact box.
 *
 * `place()` parses its argument with text.py:parse_text, which takes the FIRST TOKEN as
 * the class name — so a UI box, whose `text` in a .maxpat is its contents alone, has to
 * have its class name put back on the front. That is the inverse of get_text()'s single
 * asymmetry (`if self._name != "message"`): a message box reading "hello" is
 * `place("message hello")`, and generating `place("hello")` would try to instantiate an
 * object called "hello" and get an unknown box.
 *
 * The complication is that the leading token may ALREADY be the class name. maxpylang
 * writes one into every box it saves (`"text": "toggle"`), and ir/objectspec keeps the
 * line that was typed to create the box ("message 440") in `text` while its `args`
 * already exclude the class name. Prefixing blindly would produce `place("toggle
 * toggle")`. The rule below is write-maxpat.ts's contentOf(), for the same reason and
 * with the same two cases: strip unconditionally for a class whose text is decoration,
 * and for message/comment only once the node's own arg count confirms the token is one
 * too many — a comment may genuinely begin with the word "comment".
 */
export function placeTextFor(node: IRNode): string {
  const text = (node.text ?? '').trim().replace(/\s+/g, ' ');

  // A newobj names its own class in its text; that IS the place() argument.
  // (Whitespace is collapsed above because parse_text splits on single spaces and
  // indexes token[0] — a double space leaves it indexing the empty string.)
  if (node.maxclass === 'newobj') return text;

  const first = text.split(' ')[0] ?? '';
  let content = text;
  if (first !== '' && first === node.className) {
    const decorative = !TEXT_CLASSES.has(node.maxclass);
    const direct = parseBoxText(text, node.maxclass);
    if (decorative || direct.args.length === node.args.length + 1) {
      content = text.slice(first.length).trim();
    }
  }
  return content === '' ? node.className : `${node.className} ${content}`;
}

/** A Python double-quoted string literal. */
function pyString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')}"`;
}

/** A Python numeric literal. Non-finite coordinates are a corrupt file, not a crash. */
function pyNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '0';
}

const BANNER = [
  '# Generated from the patcher canvas. Re-run this script to rebuild the patch.',
  '#',
  '# maxpylang can place and MOVE a box but not resize one (MaxObject.move writes x/y',
  '# only), so box sizes — and Max-only keys like bgcolor or a cord\'s execution order —',
  '# are not represented here. Save a .maxpat if you need those preserved.',
];

/**
 * The document as a runnable MaxPy script.
 *
 * PURE: it does not touch the document. The plan asks for a `doc.reorder()` here first,
 * so the document's ids match the obj-1..obj-N a re-run would mint — but reorder() is an
 * undoable EDIT (see its doc comment in doc/patch-doc.ts: it costs the user a Cmd-Z and
 * clears the redo stack), and this function is called on a 150ms debounce from the
 * document's own change feed. Calling it here would mean every canvas edit silently
 * appended a second undo entry, and the transaction it commits would re-enter the feed
 * that triggered the generation — a regenerate/reorder/regenerate loop. It also buys
 * nothing: no box id appears anywhere in the output, and renumbering would INVALIDATE
 * the variable-name cache that keeps the diff small. Box order here is the document's
 * creation order, which is the order place() runs in and therefore the order maxpylang
 * numbers the boxes in, so the ids agree after the next run regardless.
 */
export function patchToMaxPy(doc: MaxPySource, opts: MaxPyOptions = {}): string {
  const { filename = DEFAULT_FILENAME, banner = true } = opts;
  const names = assignNames(doc);

  const places: { stmt: string; move: string }[] = [];
  for (const node of doc.nodes()) {
    const name = names.get(node.id)!;
    const [x, y] = node.rect;
    places.push({
      stmt: `${name} = patch.place(${pyString(placeTextFor(node))})[0];`,
      move: `${name}.move(${pyNumber(x)}, ${pyNumber(y)})`,
    });
  }

  const column = Math.min(
    places.reduce((max, p) => Math.max(max, p.stmt.length), 0),
    MOVE_COLUMN,
  );

  const cords: string[] = [];
  for (const edge of doc.edges()) {
    const from = names.get(edge.from.id);
    const to = names.get(edge.to.id);
    // A cord to a box that isn't in the document can't be written; PatchDoc drops those
    // at construction, so reaching this is a bug elsewhere rather than a normal case.
    if (!from || !to) continue;
    cords.push(`patch.connect([${from}.outs[${edge.from.outlet}], ${to}.ins[${edge.to.inlet}]])`);
  }

  const lines: string[] = [];
  if (banner) lines.push(...BANNER, '');
  lines.push('import maxpylang as mp', '', 'patch = mp.MaxPatch()', '');
  if (places.length > 0) {
    for (const p of places) lines.push(`${p.stmt.padEnd(column)}  ${p.move}`);
    lines.push('');
  }
  if (cords.length > 0) {
    lines.push(...cords, '');
  }
  lines.push(`patch.save(${pyString(filename)})`);

  return `${lines.join('\n')}\n`;
}
