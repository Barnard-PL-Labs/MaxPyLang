// The inspector: everything about the selected box that the box cannot show itself.
//
// A Max box is a single line of text, and that line is the whole truth about the object
// — its class, its arguments, its `@attributes`. What the line does NOT carry is what
// any of it MEANS: that `440` is the frequency and `mybuf` would be a buffer name, that
// `cycle~` has a second inlet for phase, that `@phase` is even a legal thing to write
// there, or — the one this app owes the user most — that the box will actually make a
// sound rather than sit there as a metadata-only stub. The canvas can show none of it.
// So this pane answers, for one selected box: what is it, does it play, what do its
// arguments mean, what can be set on it, and what are its ports for.
//
// THE BOX TEXT IS THE SOURCE OF TRUTH, and the structured sections are editors over it.
// Every widget here reads its value out of parseBoxText(node.text) and writes back by
// re-formatting that same parse through setArg/setAttrib. There is no second model of a
// box's contents to drift out of sync: retyping the raw text row rebuilds the argument
// rows, and editing an argument row rewrites the raw text row, because both are views of
// one string. That is also why the raw row is never hidden — it is the escape hatch for
// everything the structured sections cannot express, and for every object whose
// documented signature is wrong or missing.
//
// WHAT IT DELIBERATELY REFUSES TO HIDE. 328 of the 1054 objects in the catalog have real
// behaviour; the other 726 build, wire and save correctly and make no sound. Nothing
// else in the UI says which is which at the moment it matters — a stub box looks exactly
// like a playable one on the canvas — so the header carries a badge that says it
// outright, in the one place the user is already asking "what is this box?". Likewise
// the footer: maxpylang models attributes only as in-text `@key val`, while Max keeps
// many box properties (bgcolor, presentation_rect, parameter_enable, …) as sibling keys
// on the box dict. parser/write-maxpat.ts preserves every one of them verbatim on a
// round trip, but this pane cannot edit them, and the footer counts them rather than
// leaving the user to discover the gap by saving and diffing.
//
// WHAT IT WRITES, AND WHY THAT IS ALL. The only mutation is `onEdit(id, text)`. The
// inspector never touches PatchDoc: a pane that edited the document directly would have
// its own transaction boundaries, its own undo labels and its own opinion about when the
// engine rebuilds, all of which the app shell already owns. The two things that are not
// box text — position, and aligning a multi-selection — are optional callbacks, and when
// they are not wired the affordances degrade to read-only rather than appearing as
// buttons that do nothing.
//
// STYLING IS IN THIS FILE, not in ui/patcher.css, following the precedent that file
// records for ui/box-editor.ts: a pane whose controls came up unstyled because a
// stylesheet had not loaded is a trap, and the inspector is mounted by tests and could
// be mounted by any host, not only patcher.html. One <style> element is injected once
// per document, scoped entirely under `.insp`, and it reads the page's theme tokens
// (--ink, --line, --go, …) with hard-coded fallbacks so it looks right either way.

import { MANIFEST, isRecognized, isSupported, type MaxNode } from '../engine/registry';
import { inletDomain, loadObjDocs, objDocFor, objDocs, type ObjDocPort } from '../ir/connect';
import {
  boxSpecs,
  formatBoxText,
  loadBoxSpecs,
  parseBoxText,
  setArg,
  setAttrib,
  type ParsedBoxText,
} from '../ir/objectspec';
import type { ArgValue, Domain, IRNode } from '../ir/types';

type ManifestEntry = (typeof MANIFEST)[string];

/** Which edge of the selection's bounding box the boxes line up on. */
export type AlignEdge = 'left' | 'centre-x' | 'right' | 'top' | 'middle-y' | 'bottom';

export interface InspectorOptions {
  /**
   * Commit new box text. `text` is in the form PatchDoc.setBoxText() reads: an object
   * box's text names its class, and a UI box's text is prefixed with its class (the
   * `sourceText` convention stated at the top of ui/patcher-input.ts, so the two editing
   * surfaces store the same shape).
   */
  onEdit(id: string, newText: string): void;
  /**
   * Move a box to an absolute patch position. Without it the x/y fields render
   * read-only — the box can still be dragged, and a field that silently did nothing
   * would be worse than one that says it is not editable here.
   */
  onMove?(id: string, x: number, y: number): void;
  /** Align a multi-selection. Without it showMulti() omits the buttons entirely. */
  onAlign?(ids: string[], edge: AlignEdge): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The box-dict keys parser/write-maxpat.ts's nodeToBox() computes from the IR.
 * Everything else in `node.raw` is a Max property this app preserves and cannot edit,
 * which is exactly what the footer counts.
 */
const IR_OWNED_BOX_KEYS = new Set([
  'id',
  'maxclass',
  'numinlets',
  'numoutlets',
  'outlettype',
  'patching_rect',
  'text',
]);

/**
 * Port `type` values that say nothing — an upstream doc template nobody filled in.
 * 1400 of the 3373 documented ports carry one. Same rule, same reason, as ui/tooltip.ts:
 * printing them would teach the reader that this table is noise.
 */
const PLACEHOLDER_TYPES = new Set(['INLET_TYPE', 'OUTLET_TYPE']);

/** Attribute types whose single value is a number, so the field can be a number input. */
const NUMERIC_ATTRIB_TYPES = new Set([
  'float',
  'double',
  'atom_float',
  'long',
  'atom_long',
  'int',
  'char',
]);

/** Python's numeric literal forms, as ir/objectspec reads them. Not Number(): that
 *  accepts "0x10" and "", which Max treats as symbols. */
const NUMERIC_LITERAL = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const STYLE_ID = 'maxpy-inspector-style';

const CSS = `
/* Not inherited from the page: patcher.html's stylesheet sets this globally, and a pane
   whose inputs overflowed their 104px column by exactly their padding when mounted
   anywhere else would be a puzzle nobody should have to solve twice. */
.insp, .insp * { box-sizing: border-box; }
.insp { display: flex; flex-direction: column; gap: 11px;
  font: 12px/1.5 system-ui, -apple-system, sans-serif; color: var(--ink, #d6dbe2); }
.insp-head { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
.insp-class { font: 650 13px ui-monospace, Menlo, monospace; word-break: break-all; }
.insp-chip { font-size: 9px; letter-spacing: .07em; text-transform: uppercase; padding: 1px 5px;
  border: 1px solid var(--line, #2c313a); border-radius: 999px; color: var(--dim, #8b93a0); }
.insp-badge { font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
  padding: 1px 6px; border-radius: 999px; border: 1px solid currentColor; }
.insp-badge.is-playable { color: var(--go, #4bd08a); background: rgba(75, 208, 138, .12); }
.insp-badge.is-stub { color: var(--signal, #e8b73e); background: rgba(232, 183, 62, .12); }
.insp-badge.is-unknown { color: var(--err, #e8736b); background: rgba(232, 115, 107, .12); }
.insp-alias { font-size: 11px; color: var(--dim, #8b93a0); }
.insp-digest { margin: 0; font-size: 12px; }
.insp-desc { margin: 0; font-size: 11px; line-height: 1.5; color: var(--dim, #8b93a0); }
.insp-sec { border-top: 1px solid var(--line, #2c313a); padding-top: 9px; }
.insp-sec-title { margin: 0 0 6px; font-size: 9px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: var(--dim, #8b93a0); }
.insp-row { display: grid; grid-template-columns: 1fr 104px; gap: 6px; align-items: center;
  margin-bottom: 4px; }
.insp-row.wide { grid-template-columns: 1fr; }
.insp-label { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* The required/optional marker must survive the truncation of a long argument name:
   "number-of-output-channels ·o…" says nothing, and whether an argument is required is
   the more important half of the row. */
.insp-arg-label { display: flex; align-items: baseline; gap: 2px; min-width: 0; font-size: 11px; }
.insp-arg-label .insp-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.insp-arg-label .insp-req, .insp-arg-label .insp-opt { flex: 0 0 auto; }
.insp-req { color: var(--err, #e8736b); margin-left: 2px; }
.insp-opt { color: var(--dim, #8b93a0); }
.insp-input { width: 100%; min-width: 0; background: #15171b; color: var(--ink, #d6dbe2);
  border: 1px solid #39404b; border-radius: 4px; padding: 3px 5px;
  font: 11px ui-monospace, Menlo, monospace; }
.insp-input:focus { outline: none; border-color: var(--control, #5aa9e6); }
.insp-input[readonly] { color: var(--dim, #8b93a0); border-style: dashed; }
.insp-input.mono-wide { font-size: 12px; }
.insp-check { display: flex; align-items: center; gap: 5px; min-width: 0; }
.insp-check input { flex: 0 0 auto; margin: 0; }
.insp-extra { font: 11px ui-monospace, Menlo, monospace; color: var(--dim, #8b93a0);
  word-break: break-all; }
.insp-note { margin: 4px 0 0; font-size: 10px; color: var(--signal, #e8b73e); }
.insp-empty { margin: 0; font-size: 11px; color: #6b7280; }
.insp-attrs summary { cursor: pointer; font-size: 9px; font-weight: 700; letter-spacing: .08em;
  text-transform: uppercase; color: var(--dim, #8b93a0); }
.insp-attrs[open] summary { margin-bottom: 6px; }
.insp-attr-list { max-height: 260px; overflow: auto; }
.insp-io { width: 100%; border-collapse: collapse; font-size: 11px; }
.insp-io td { padding: 2px 4px 2px 0; vertical-align: top; }
.insp-io td.i { width: 14px; color: var(--dim, #8b93a0); font-variant-numeric: tabular-nums; }
.insp-io td.d { width: 12px; }
.insp-io td.t { color: var(--dim, #8b93a0); white-space: nowrap; }
.insp-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; }
.insp-dot.signal { background: var(--signal, #e8b73e); }
.insp-dot.control { background: var(--control, #5aa9e6); }
.insp-dot.video { background: var(--video, #a882e6); }
.insp-foot { margin: 0; padding-top: 8px; border-top: 1px solid var(--line, #2c313a);
  font-size: 10px; line-height: 1.45; color: #6b7280; }
.insp-multi-count { font: 650 13px system-ui, sans-serif; }
.insp-align { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
.insp-align button { background: #262b33; color: var(--ink, #d6dbe2); border: 1px solid #39404b;
  border-radius: 5px; padding: 4px 0; font-size: 11px; cursor: pointer; }
.insp-align button:hover:not(:disabled) { background: #2f3540; border-color: #4a5361; }
.insp-align button:disabled { opacity: .4; cursor: default; }
`;

// ─────────────────────────────────────────────────────────────────────────────
// Small helpers
// ─────────────────────────────────────────────────────────────────────────────

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function field(kind: 'text' | 'number', name: string): HTMLInputElement {
  const el = h('input', 'insp-input');
  el.type = kind;
  el.dataset.field = name;
  // `name` as well as `data-field`: a form control with neither is flagged by Chrome's
  // issues panel on every render. data-field stays the query hook — it is what the tests
  // and findField() use — and this is only the accessible/autofill name beside it.
  el.name = `insp-${name}`;
  el.spellcheck = false;
  el.setAttribute('autocomplete', 'off');
  el.setAttribute('autocapitalize', 'off');
  return el;
}

/** One `label — control` line. */
function row(label: HTMLElement, control: HTMLElement): HTMLDivElement {
  const line = h('div', 'insp-row');
  line.append(label, control);
  return line;
}

function section(title: string): HTMLElement {
  const sec = h('section', 'insp-sec');
  sec.appendChild(h('h3', 'insp-sec-title', title));
  return sec;
}

/** The first whitespace-delimited token, or ''. */
const head = (s: string): string => (s.match(/^\S+/) ?? [''])[0];

/**
 * The half of a box's text the user typed — what the canvas box editor shows too.
 *
 * A `newobj`'s text names its own class and is editable whole. A UI box's text is its
 * CONTENTS, which Max writes bare (`1 2`) and maxpylang writes behind the class name
 * (`message 1 2`); both shapes reach the document through the parser, so the prefix is
 * stripped when it is there. Mirrors ui/patcher-input.ts's editableText().
 */
function editableText(node: IRNode): string {
  const text = node.text.trim();
  if (node.maxclass === 'newobj') return text;
  const first = head(text);
  return first === node.className ? text.slice(first.length).trim() : text;
}

/**
 * The inverse: what the document should store for a typed line, and therefore what
 * onEdit hands back. Mirrors ui/patcher-input.ts's storedText(), because both surfaces
 * feed the same PatchDoc.setBoxText(), which resolves its argument by reading the first
 * token as a class name — a bare `1 2` would resolve the class "1" and corrupt the box.
 */
function storedText(node: IRNode, typed: string): string {
  const text = typed.trim();
  if (node.maxclass === 'newobj') return text;
  return `${node.className} ${text}`.trim();
}

/**
 * str(arg) with the float-ness JS cannot hold, for DISPLAY only — the same rule as
 * ir/objectspec's private formatArg, so a `0.` argument shows as `0.0` in its row rather
 * than as the `0` that JS would print and that would read as an int.
 */
function showArg(value: ArgValue | undefined, isFloat: boolean): string {
  if (value === undefined) return '';
  const s = String(value);
  return isFloat && typeof value === 'number' && !/[.e]/i.test(s) ? `${s}.0` : s;
}

/**
 * A typed field's value as an argument atom.
 *
 * Numbers go back as numbers so setArg can keep the slot's int/float character (see
 * slotIsFloat in ir/objectspec). The one exception is a value JS would flatten: `2.`
 * typed into a slot that was NOT already float is returned as the string, because only
 * the string still says "float" once Number() has had it.
 */
function coerceArg(raw: string, wasFloat: boolean): ArgValue {
  if (!NUMERIC_LITERAL.test(raw)) return raw;
  const n = Number(raw);
  if (!wasFloat && Number.isInteger(n) && /[.e]/i.test(raw)) return raw;
  return n;
}

/** Is every type this argument slot accepts a number? Then the widget can be one. */
function numericSlot(types: readonly string[]): boolean {
  return types.length > 0 && types.every((t) => t === 'int' || t === 'float' || t === 'number');
}

const portType = (port: ObjDocPort | undefined): string =>
  port?.type && !PLACEHOLDER_TYPES.has(port.type) ? port.type : '';

/** Focus to put back after a rebuild: which control, and where the caret was in it. */
interface FocusMark {
  name: string;
  start: number | null;
  end: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The pane
// ─────────────────────────────────────────────────────────────────────────────

type State =
  | { kind: 'empty' }
  | { kind: 'single'; node: IRNode; built?: MaxNode }
  | { kind: 'multi'; ids: string[] };

export class Inspector {
  private readonly host: HTMLElement;
  private readonly opts: InspectorOptions;
  private readonly root: HTMLDivElement;
  /** Whatever the host held before we took it over, put back by destroy(). */
  private readonly displaced: ChildNode[];
  private state: State = { kind: 'empty' };
  private destroyed = false;
  /** One advisory line per render, used by the edits this pane declines to make. */
  private noteEl: HTMLParagraphElement | null = null;

  constructor(host: HTMLElement, opts: InspectorOptions) {
    ensureStyle();
    this.host = host;
    this.opts = opts;
    // The pane OWNS its host's contents for its lifetime: patcher.html seeds the pane
    // with a placeholder paragraph, and a second placeholder underneath ours would be
    // the first thing a user saw. Kept rather than dropped, so destroy() is reversible.
    this.displaced = [...host.childNodes];
    for (const child of this.displaced) child.remove();
    this.root = h('div', 'insp');
    host.appendChild(this.root);
    this.render();
  }

  /** Show one box. `built` is its live engine node, when the patch has been built. */
  show(node: IRNode, built?: MaxNode): void {
    if (this.destroyed) return;
    const prev = this.state;
    this.state = { kind: 'single', node, built };
    this.ensureData();
    // A drag calls this once per frame with a node that differs only in its rect. A
    // rebuild there would throw away the DOM (and the focus) 60 times a second, so the
    // cheap path updates the two position fields and stops.
    if (
      prev.kind === 'single' &&
      prev.node.id === node.id &&
      prev.built === built &&
      shapeKey(prev.node) === shapeKey(node)
    ) {
      this.syncPosition(node);
      return;
    }
    this.render();
  }

  /**
   * Show a multi-selection: how many boxes, and the alignment affordances when the host
   * wired onAlign. Nothing per-box — every field in this pane edits one box's text, and
   * showing one box's arguments for a selection of six would be a lie about what an edit
   * would do.
   */
  showMulti(ids: string[]): void {
    if (this.destroyed) return;
    this.state = { kind: 'multi', ids: [...ids] };
    this.render();
  }

  /** Nothing selected. */
  hide(): void {
    if (this.destroyed) return;
    this.state = { kind: 'empty' };
    this.render();
  }

  /** Give the host back exactly what it had before the constructor took it over. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.root.remove();
    this.host.append(...this.displaced);
  }

  // ── data ───────────────────────────────────────────────────────────────────

  /**
   * Pull in the two generated tables this pane reads, and re-render when they land.
   *
   * Both are `await import()`ed (~170 KB and ~382 KB) and both are cached module-side,
   * so this costs one chunk fetch per session and only for a user who actually selected
   * a box. Failure is silent by design: an inspector with no digest and no attribute
   * list is still a working argument and box-text editor, and an error banner for a
   * chunk the user never asked for would be noise.
   */
  private ensureData(): void {
    if (!boxSpecs()) void loadBoxSpecs().then(() => this.onDataArrived()).catch(() => {});
    if (!objDocs()) void loadObjDocs().then(() => this.onDataArrived()).catch(() => {});
  }

  private onDataArrived(): void {
    if (!this.destroyed && this.state.kind === 'single') this.render();
  }

  // ── rendering ──────────────────────────────────────────────────────────────

  private render(): void {
    const focus = this.captureFocus();
    this.root.replaceChildren();
    this.noteEl = null;
    if (this.state.kind === 'single') this.renderSingle(this.state.node, this.state.built);
    else if (this.state.kind === 'multi') this.renderMulti(this.state.ids);
    else {
      this.root.appendChild(
        h('p', 'insp-empty', 'Select a box to see its arguments, attributes and I/O here.'),
      );
    }
    this.restoreFocus(focus);
  }

  /**
   * Which control had focus, so a rebuild does not interrupt typing.
   *
   * Read at the START of a render, which is what makes tabbing work: a `change` fired by
   * blurring a field arrives when focus has already moved to the next one, so the mark
   * names the NEW field and focus lands on its rebuilt counterpart rather than snapping
   * back to the field just left.
   */
  private captureFocus(): FocusMark | null {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || !this.root.contains(active)) return null;
    const name = active.dataset.field;
    if (!name) return null;
    // selectionStart throws on a number input in Chrome, hence the type test.
    const text = active instanceof HTMLInputElement && active.type === 'text';
    return {
      name,
      start: text ? (active as HTMLInputElement).selectionStart : null,
      end: text ? (active as HTMLInputElement).selectionEnd : null,
    };
  }

  private restoreFocus(mark: FocusMark | null): void {
    if (!mark) return;
    const next = this.control(mark.name);
    if (!next) return;
    next.focus();
    if (mark.start !== null && next instanceof HTMLInputElement && next.type === 'text') {
      next.setSelectionRange(mark.start, mark.end ?? mark.start);
    }
  }

  /** One control by its `data-field` name. Scanned rather than selected, so a name with
   *  punctuation in it (attributes are named by Max, not by us) needs no escaping. */
  private control(name: string): HTMLElement | null {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-field]')) {
      if (el.dataset.field === name) return el;
    }
    return null;
  }

  private note(message: string): void {
    if (!this.noteEl) return;
    this.noteEl.textContent = message;
  }

  private syncPosition(node: IRNode): void {
    for (const [name, value] of [
      ['x', node.rect[0]],
      ['y', node.rect[1]],
    ] as const) {
      const el = this.control(name);
      if (el instanceof HTMLInputElement && el !== document.activeElement) {
        el.value = String(Math.round(value));
      }
    }
  }

  // ── single box ─────────────────────────────────────────────────────────────

  private renderSingle(node: IRNode, built: MaxNode | undefined): void {
    const name = node.className;
    const entry: ManifestEntry | undefined = MANIFEST[name];
    const canonical = entry?.aliasOf ?? name;
    const docs = objDocFor(name);
    const spec = boxSpecs()?.[canonical];
    // Only a `newobj` names its class in its own text, and only a `newobj` carries
    // in-text attributes: `@gain 0.5` in a message box is a two-atom message to send.
    const isObjectBox = node.maxclass === 'newobj';
    const parsed = isObjectBox
      ? parseBoxText(node.text)
      : parseBoxText(editableText(node), node.maxclass);

    this.root.appendChild(this.headerFor(node, entry, canonical));
    this.appendDocs(docs);
    this.root.appendChild(this.argumentsFor(node, entry, parsed));
    if (isObjectBox) this.root.appendChild(this.attributesFor(node, spec?.attribs ?? [], parsed));
    this.root.appendChild(this.boxTextFor(node));
    this.root.appendChild(this.portsFor(node, docs, built));
    this.root.appendChild(this.positionFor(node));
    this.root.appendChild(this.footerFor(node));
  }

  /** Class name, package chip, and the badge that says whether this box makes a sound. */
  private headerFor(
    node: IRNode,
    entry: ManifestEntry | undefined,
    canonical: string,
  ): HTMLElement {
    const header = h('header', 'insp-head');
    header.appendChild(h('span', 'insp-class', node.className || node.maxclass));
    if (entry) header.appendChild(h('span', 'insp-chip', entry.pkg));

    // Tier B has a hand-written factory; Tier A is the metadata-only stub the registry
    // generates for everything else. The wording is the plan's and is deliberately
    // blunt: "stub" alone would read as a technicality, and the thing the user needs to
    // know is that pressing ▶ will not produce a sound from this box.
    const playable = isSupported(node.className);
    const known = isRecognized(node.className) && node.known !== false;
    const badge = !known
      ? h('span', 'insp-badge is-unknown', 'unknown object')
      : playable
        ? h('span', 'insp-badge is-playable', 'playable')
        : h('span', 'insp-badge is-stub', 'stub — no sound yet');
    badge.title = !known
      ? 'No object of this name is in the catalog. The box is kept, drawn broken, and saved as typed.'
      : playable
        ? 'This object has a real implementation in the browser engine.'
        : 'Recognized and saved correctly, with the right inlets and outlets — but it has no behaviour in the browser engine yet.';
    badge.dataset.field = 'tier';
    header.appendChild(badge);

    if (canonical !== node.className) {
      header.appendChild(h('span', 'insp-alias', `alias of ${canonical}`));
    }
    return header;
  }

  private appendDocs(docs: ReturnType<typeof objDocFor>): void {
    if (!docs) return;
    if (docs.digest) this.root.appendChild(h('p', 'insp-digest', docs.digest));
    // `description` is in generated/objdocs.json but not in ir/connect's ObjDocEntry —
    // see needsOtherFiles. Read through a local widening rather than a cast of the table.
    const description = (docs as { description?: string }).description;
    if (description) this.root.appendChild(h('p', 'insp-desc', description));
  }

  /**
   * One row per documented argument, plus a read-only row for anything typed beyond the
   * signature — 46 objects take a variadic tail the metadata does not spell out
   * (`trigger b f`, `pack 0 0 0`), and dropping those from the pane would make it look
   * as though the box had fewer arguments than it does.
   */
  private argumentsFor(
    node: IRNode,
    entry: ManifestEntry | undefined,
    parsed: ParsedBoxText,
  ): HTMLElement {
    const sec = section('Arguments');
    const signature = entry?.args ?? [];

    signature.forEach((slot, i) => {
      const label = h('div', 'insp-arg-label');
      label.append(
        h('span', 'insp-name', slot.name),
        slot.optional ? h('span', 'insp-opt', '·opt') : h('span', 'insp-req', '*'),
      );
      label.title = `${slot.name} — ${slot.type.join('/')}${slot.optional ? ' (optional)' : ' (required)'}`;

      const wasFloat = parsed.argIsFloat[i] ?? false;
      const input = field(numericSlot(slot.type) ? 'number' : 'text', `arg-${i}`);
      if (numericSlot(slot.type) && !slot.type.includes('int')) input.step = 'any';
      input.value = showArg(parsed.args[i], wasFloat);
      input.placeholder = slot.type.join('/');
      // The visible label is a sibling <div>, not a <label for>, so the control carries
      // its own name for a screen reader.
      input.setAttribute('aria-label', `argument ${i + 1}: ${slot.name}`);
      input.addEventListener('change', () => this.onArgChange(node, parsed, i, input, wasFloat));
      sec.appendChild(row(label, input));
    });

    if (parsed.args.length > signature.length) {
      const extra = parsed.args
        .slice(signature.length)
        .map((a, i) => showArg(a, parsed.argIsFloat[signature.length + i] ?? false))
        .join(' ');
      const value = h('span', 'insp-extra', extra);
      value.dataset.field = 'extra-args';
      value.title = 'Beyond the documented signature — edit these in the box text field below.';
      // A UI box has no documented signature at all: every token in a message box is its
      // contents, and calling those "extra args" would misname the only thing in it.
      const label = node.maxclass === 'newobj' ? 'extra args' : 'contents';
      sec.appendChild(row(h('div', 'insp-label', label), value));
    } else if (signature.length === 0) {
      sec.appendChild(h('p', 'insp-empty', 'This object takes no arguments.'));
    }

    this.noteEl = h('p', 'insp-note');
    sec.appendChild(this.noteEl);
    return sec;
  }

  private onArgChange(
    node: IRNode,
    parsed: ParsedBoxText,
    index: number,
    input: HTMLInputElement,
    wasFloat: boolean,
  ): void {
    const raw = input.value.trim();
    const current = parsed.args.length;

    // Max arguments are positional with no way to skip one, so neither filling a gap nor
    // clearing a middle slot can mean what it looks like it means: setArg would clamp to
    // the end of the list and write into the wrong argument. Refused out loud, with the
    // field put back, rather than silently rewriting a different argument.
    if (raw === '') {
      if (index >= current) return; // clearing a slot that was already empty
      if (index !== current - 1) {
        input.value = showArg(parsed.args[index], wasFloat);
        this.note('Arguments are positional — only the last one can be cleared.');
        return;
      }
      this.commit(node, setArg(parsed, index, null));
      return;
    }
    if (index > current) {
      input.value = '';
      this.note(`Fill argument ${current + 1} first — arguments are positional.`);
      return;
    }
    this.commit(node, setArg(parsed, index, coerceArg(raw, wasFloat)));
  }

  /**
   * `@key val` attributes, from the object's own attribute list.
   *
   * Collapsed, because the list is 29 entries long for jit.window and 18 for sfplay~ and
   * an expanded one would push the box text field off the bottom of the pane. Anything
   * already written into the text that is NOT in the list is appended to the rows, so
   * the pane can never show fewer attributes than the box actually carries.
   */
  private attributesFor(
    node: IRNode,
    attribs: readonly { name: string; type?: string; size?: string }[],
    parsed: ParsedBoxText,
  ): HTMLElement {
    const known = attribs.map((a) => a.name);
    const extra = Object.keys(parsed.attrs).filter((name) => !known.includes(name));
    const names = [...known, ...extra];
    const setCount = Object.keys(parsed.attrs).length;

    const details = h('details', 'insp-sec insp-attrs');
    const summary = h(
      'summary',
      undefined,
      setCount > 0
        ? `Attributes (${names.length} · ${setCount} set)`
        : `Attributes (${names.length})`,
    );
    details.appendChild(summary);
    // Open it when something is already set: a collapsed disclosure hiding a value that
    // is affecting the patch is exactly the state a user cannot debug.
    details.open = setCount > 0;

    if (names.length === 0) {
      details.appendChild(
        h('p', 'insp-empty', boxSpecs() ? 'No attributes.' : 'Attribute list not loaded.'),
      );
      return details;
    }

    const list = h('div', 'insp-attr-list');
    for (const name of names) {
      const meta = attribs.find((a) => a.name === name);
      const present = name in parsed.attrs;

      const label = h('label', 'insp-check');
      const check = h('input');
      check.type = 'checkbox';
      check.dataset.field = `attr-set:${name}`;
      check.name = `insp-attr-set-${name}`; // see field(): a nameless control is an issue
      check.checked = present;
      label.append(check, h('span', 'insp-label', name));
      if (meta) label.title = `@${name} — ${meta.type ?? 'atom'}${meta.size && meta.size !== '1' ? ` ×${meta.size}` : ''}`;

      const numeric = meta !== undefined && meta.size === '1' && NUMERIC_ATTRIB_TYPES.has(meta.type ?? '');
      const value = field(numeric ? 'number' : 'text', `attr:${name}`);
      if (numeric) value.step = 'any';
      value.value = (parsed.attrs[name] ?? []).join(' ');
      value.setAttribute('aria-label', `@${name} value`);
      check.setAttribute('aria-label', `set @${name}`);

      // Typing a value means you want the attribute set — ticking the box as well would
      // be a second gesture for one intention.
      value.addEventListener('change', () => {
        check.checked = true;
        this.commitAttrib(node, parsed, name, check, value);
      });
      check.addEventListener('change', () => this.commitAttrib(node, parsed, name, check, value));

      list.appendChild(row(label, value));
    }
    details.appendChild(list);
    return details;
  }

  private commitAttrib(
    node: IRNode,
    parsed: ParsedBoxText,
    name: string,
    check: HTMLInputElement,
    value: HTMLInputElement,
  ): void {
    if (!check.checked) {
      this.commit(node, setAttrib(parsed, name, null));
      return;
    }
    // An empty field writes the valueless `@name` form, which parseBoxText and
    // formatBoxText both round-trip. It shows up immediately in the box text field, so
    // what was written is never a mystery.
    const tokens = value.value.trim().split(/\s+/).filter((t) => t.length > 0);
    this.commit(node, setAttrib(parsed, name, tokens));
  }

  /** The raw line — the escape hatch, and the thing every other section is a view of. */
  private boxTextFor(node: IRNode): HTMLElement {
    const sec = section('Box text');
    const input = field('text', 'text');
    input.classList.add('mono-wide');
    input.setAttribute('aria-label', 'box text');
    input.value = editableText(node);
    input.placeholder = node.maxclass === 'newobj' ? 'object arguments @attrs' : 'contents';
    input.addEventListener('change', () => {
      const text = storedText(node, input.value);
      if (text !== node.text.trim()) this.opts.onEdit(node.id, text);
    });
    const line = h('div', 'insp-row wide');
    line.appendChild(input);
    sec.appendChild(line);
    return sec;
  }

  /**
   * The read-only port tables.
   *
   * Rows are driven by the BOX's arity, never by the documentation's length: 13 objects
   * (midiformat has 7 inlets and 0 documented ones) have a reference page that describes
   * only some of their inlets, and a table that stopped early would read as "this box has
   * one inlet". A row with no entry shows the port and says nothing about it, and its
   * domain falls back to 'control' the same way ir/connect's inletDomain does.
   */
  private portsFor(
    node: IRNode,
    docs: ReturnType<typeof objDocFor>,
    built: MaxNode | undefined,
  ): HTMLElement {
    const sec = section('Inlets / outlets');
    sec.appendChild(
      this.portTable('in', node.numInlets, docs?.inlets, (i) =>
        inletDomain(node.className, i, built),
      ),
    );
    sec.appendChild(
      this.portTable('out', node.numOutlets, docs?.outlets, (i) =>
        node.outletDomains[i] ?? 'control',
      ),
    );
    if (node.numInlets === 0 && node.numOutlets === 0) {
      sec.appendChild(h('p', 'insp-empty', 'No ports.'));
    }
    return sec;
  }

  private portTable(
    dir: 'in' | 'out',
    count: number,
    ports: readonly ObjDocPort[] | undefined,
    domainOf: (index: number) => Domain,
  ): HTMLElement {
    const table = h('table', 'insp-io');
    table.dataset.field = `ports-${dir}`;
    const body = h('tbody');
    for (let i = 0; i < count; i++) {
      const doc = ports?.find((p) => p.index === i);
      const tr = h('tr');
      const index = h('td', 'i', String(i));
      const dot = h('td', 'd');
      dot.appendChild(h('span', `insp-dot ${domainOf(i)}`));
      const meaning = h('td', undefined, doc?.text ?? '');
      const type = h('td', 't', portType(doc));
      tr.append(index, dot, meaning, type);
      body.appendChild(tr);
    }
    table.appendChild(body);
    const wrap = h('div');
    wrap.appendChild(h('div', 'insp-label', dir === 'in' ? 'Inlets' : 'Outlets'));
    wrap.appendChild(table);
    return wrap;
  }

  private positionFor(node: IRNode): HTMLElement {
    const sec = section('Position');
    const movable = typeof this.opts.onMove === 'function';
    const inputs: HTMLInputElement[] = [];
    (['x', 'y'] as const).forEach((axis, i) => {
      const input = field('number', axis);
      input.value = String(Math.round(node.rect[i]));
      input.setAttribute('aria-label', `${axis} position`);
      input.readOnly = !movable;
      if (!movable) input.title = 'Drag the box on the canvas to move it.';
      input.addEventListener('change', () => {
        const x = Number(inputs[0].value);
        const y = Number(inputs[1].value);
        if (Number.isFinite(x) && Number.isFinite(y)) this.opts.onMove?.(node.id, x, y);
      });
      inputs.push(input);
      sec.appendChild(row(h('div', 'insp-label', axis), input));
    });
    return sec;
  }

  /**
   * The honest footer.
   *
   * maxpylang models attributes only as in-text `@key val`. Max keeps far more on the
   * box dict itself — bgcolor, presentation_rect, parameter_enable, varname,
   * saved_object_attributes, and whatever a newer Max invents. write-maxpat.ts carries
   * every one of them through a round trip untouched, and this pane cannot edit any of
   * them, so the count is stated rather than left to be discovered.
   */
  private footerFor(node: IRNode): HTMLElement {
    const keys = Object.keys(node.raw ?? {}).filter((k) => !IR_OWNED_BOX_KEYS.has(k));
    const text =
      keys.length === 0
        ? 'No Max-only properties on this box.'
        : `${keys.length} Max-only ${keys.length === 1 ? 'property' : 'properties'} preserved but not editable`;
    const foot = h('p', 'insp-foot', text);
    foot.dataset.field = 'max-only';
    if (keys.length > 0) foot.title = keys.join(', ');
    return foot;
  }

  // ── multi-selection ────────────────────────────────────────────────────────

  private renderMulti(ids: string[]): void {
    const header = h('header', 'insp-head');
    header.appendChild(
      h('span', 'insp-multi-count', `${ids.length} ${ids.length === 1 ? 'box' : 'boxes'} selected`),
    );
    this.root.appendChild(header);
    this.root.appendChild(
      h(
        'p',
        'insp-desc',
        'Arguments and attributes are edited one box at a time. Select a single box to see them.',
      ),
    );

    const align = this.opts.onAlign;
    if (!align) return;
    const sec = section('Align');
    const grid = h('div', 'insp-align');
    // Words, not arrow glyphs: ⇤ ⇥ ⇧ ⇩ are six near-identical shapes at 11px, and
    // "did that align the left edges or move them left?" is not a question a button
    // should raise.
    const edges: [AlignEdge, string, string][] = [
      ['left', 'Left', 'Align left edges'],
      ['centre-x', 'Centre', 'Centre horizontally'],
      ['right', 'Right', 'Align right edges'],
      ['top', 'Top', 'Align top edges'],
      ['middle-y', 'Middle', 'Centre vertically'],
      ['bottom', 'Bottom', 'Align bottom edges'],
    ];
    for (const [edge, glyph, title] of edges) {
      const button = h('button', undefined, glyph);
      button.type = 'button';
      button.title = title;
      button.dataset.field = `align-${edge}`;
      // One box has nothing to line up with, and a button that quietly did nothing would
      // read as broken.
      button.disabled = ids.length < 2;
      button.addEventListener('click', () => align([...ids], edge));
      grid.appendChild(button);
    }
    sec.appendChild(grid);
    this.root.appendChild(sec);
  }

  // ── writing ────────────────────────────────────────────────────────────────

  /** Re-format an edited parse and hand it to the host, unless nothing changed. */
  private commit(node: IRNode, next: ParsedBoxText): void {
    const isObjectBox = node.maxclass === 'newobj';
    const text = storedText(node, formatBoxText(next, isObjectBox ? undefined : node.maxclass));
    if (text === node.text.trim()) return;
    this.opts.onEdit(node.id, text);
  }
}

/**
 * Everything about a box that changes what this pane DRAWS. Position is excluded on
 * purpose — see show().
 */
function shapeKey(node: IRNode): string {
  return [
    node.className,
    node.maxclass,
    node.text,
    node.numInlets,
    node.numOutlets,
    node.known !== false,
  ].join(' ');
}
