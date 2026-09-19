// Typing into a box: a one-line editor hosted inside the SVG, with completion.
//
// WHY THIS IS NOT CodeMirror. The Studio's Python pane genuinely needs an editor —
// multi-line, syntax-aware, undoable. A Max box does not: it holds ONE line of at most a
// few dozen characters, and the thing that actually makes it usable is not the text
// widget but the completion list attached to it. Shipping ~200 KB of editor into the
// patcher's critical path to render a single `<input>` would be a bad trade even if the
// keyboard story were free, and it is not: CodeMirror owns Tab, Enter, Escape and the
// arrow keys, which are exactly the four keys the completion panel has to own here.
//
// Two structural decisions carry the whole file:
//
//   • THE INPUT LIVES IN A <foreignObject>, so it sits over the box it is editing, in
//     the same coordinate space, and moves with it for free. `layer` is whatever SVG
//     element the caller wants it parented to and `geom` is in THAT element's user
//     space — so the caller decides whether the editor rides the pan/zoom transform
//     (pass the viewport group) or floats above it in CSS pixels (pass the <svg> root
//     and a `scale` for typography). ui/patcher-input.ts does the latter, because the
//     renderer's overlay layer is replaceChildren()-ed on every pointermove of a
//     gesture and would delete the editor out from under the user.
//
//   • THE COMPLETION PANEL IS NOT IN THE SVG. A <foreignObject> clips its content to
//     its own rect, so a list rendered inside one would be a single visible row. The
//     panel is therefore an absolutely-positioned <div> on document.body, placed from
//     input.getBoundingClientRect() — which is already in client coordinates, so it is
//     correct under any pan, zoom or scroll without doing the arithmetic again.
//
// The completion switches to a SIGNATURE HINT once the caret passes the first token.
// That is deliberate and it is the affordance real Max lacks: by the time you are
// typing arguments the object is decided, and what you actually need to know is what
// the next number MEANS (`cycle~ [frequency] [buffer-name] [sample-offset]`), which is
// otherwise a trip to the reference. It is non-interactive — nothing to accept, so it
// never competes with Enter for the commit.
//
// Tier-A objects (recognized, but no behaviour behind them yet) are dimmed and carry
// the same dashed marker the canvas draws around a stub box, so "this will not make a
// sound" is visible at the moment of choosing rather than after pressing ▶.

import { matchObjects, objectInfo } from '../engine/catalog';

const SVG_NS = 'http://www.w3.org/2000/svg';
const XHTML_NS = 'http://www.w3.org/1999/xhtml';

/** How many completions to offer. More than a dozen is a list nobody reads. */
const LIMIT = 12;
/** A toggle's box is 26px wide; an editor that size could not show what you typed. */
const MIN_W = 130;
/** The completion panel never narrows past this, however small the box under it. */
const MIN_PANEL_W = 180;
/**
 * …and never widens past this, however long the argument signature.
 *
 * The list has `white-space: nowrap` rows, so without a cap its width was whatever the
 * longest signature in the hit list happened to be — `mc.poly~` measured 1165px inside a
 * 573px canvas, running off the window, which hid the very names it was offering. 520px
 * fits the longest useful name plus a truncated signature and still leaves the canvas
 * visible behind it.
 */
const MAX_PANEL_W = 520;

export interface BoxEditorGeom {
  x: number;
  y: number;
  w: number;
  h: number;
  /**
   * Typography scale. 1 when the editor is parented inside a transformed group (the
   * browser scales it), otherwise the viewport zoom, so the text matches the box under
   * it at every zoom level.
   */
  scale?: number;
}

export interface BoxEditorOptions {
  /** SVG element the <foreignObject> is appended to. `geom` is in ITS user space. */
  layer: SVGElement;
  geom: BoxEditorGeom;
  /** Text to start from — what the user sees, not necessarily what the document stores. */
  initial: string;
  /** Trimmed. '' means the user cleared the box, which the caller reads as "delete". */
  onCommit(text: string): void;
  /** Escape, or a caller-side abort. The document must be left exactly as it was. */
  onCancel(): void;
}

export interface BoxEditorHandle {
  /** The live <input>, for focus and for tests. */
  readonly input: HTMLInputElement;
  /** Accept what is typed, exactly as Enter or a click away would. Idempotent. */
  commit(): void;
  /** Tear down without firing either callback. */
  close(): void;
}

/** Where the caret is, relative to the first whitespace-delimited token. */
function inFirstToken(value: string, caret: number): boolean {
  return !/\s/.test(value.slice(0, caret).replace(/^\s+/, ''));
}

/**
 * Which ARGUMENT the caret is in, 0-based, ignoring the leading class name.
 *
 * A trailing space means "about to type the next one", which is the moment the hint is
 * most useful — so `cycle~ ` already emphasises `[frequency]`.
 */
function argIndexAt(value: string, caret: number): number {
  const head = value.slice(0, caret);
  const tokens = head.match(/\S+/g) ?? [];
  return /\s$/.test(head) ? tokens.length - 1 : tokens.length - 2;
}

function firstToken(value: string): string {
  return (value.match(/\S+/) ?? [''])[0];
}

function h<K extends keyof HTMLElementTagNameMap>(
  name: K,
  css: string,
  cls?: string
): HTMLElementTagNameMap[K] {
  // createElementNS, not createElement: inside a <foreignObject> the default namespace
  // is SVG, and an HTML element created in it renders as nothing at all.
  const node = document.createElementNS(XHTML_NS, name) as HTMLElementTagNameMap[K];
  if (cls) node.setAttribute('class', cls);
  node.style.cssText = css;
  return node;
}

/**
 * Open the editor. Returns immediately; the caller hears back through onCommit/onCancel.
 *
 * Styling is inline rather than left to a stylesheet, and that is a considered choice
 * for this one module: the panel is parented to document.body, so it inherits nothing
 * from the patcher's CSS scope, and an editor that renders as invisible white-on-white
 * because a stylesheet did not load is a trap. Every declaration below is overridable by
 * a class rule of equal specificity except the ones marked as behaviour.
 */
export function openBoxEditor(opts: BoxEditorOptions): BoxEditorHandle {
  const { layer, geom, initial } = opts;
  const scale = geom.scale ?? 1;
  const font = Math.max(9, 11 * scale);

  const host = document.createElementNS(SVG_NS, 'foreignObject');
  host.setAttribute('class', 'box-editor-host');
  host.setAttribute('x', String(geom.x));
  host.setAttribute('y', String(geom.y));
  host.setAttribute('width', String(Math.max(geom.w, MIN_W * scale)));
  host.setAttribute('height', String(Math.max(geom.h, 20 * scale)));
  // The box under the editor must not eat the clicks meant for the caret.
  host.style.pointerEvents = 'auto';

  const wrap = h('div', 'width:100%;height:100%;');
  const input = h(
    'input',
    `width:100%;height:100%;box-sizing:border-box;margin:0;padding:0 ${3 * scale}px;` +
      `font:${font}px ui-monospace, Menlo, monospace;color:var(--ink);background:var(--sunken);` +
      `border:1px solid var(--control);border-radius:3px;outline:none;`,
    'box-input'
  );
  input.type = 'text';
  input.spellcheck = false;
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('autocomplete', 'off');
  input.value = initial;
  wrap.appendChild(input);
  host.appendChild(wrap);
  layer.appendChild(host);

  const panel = h(
    'div',
    'position:fixed;z-index:1000;max-height:236px;overflow:auto;padding:3px;' +
      'background:var(--panel);border:1px solid var(--btn-border);border-radius:5px;' +
      'box-shadow:0 6px 18px rgba(0,0,0,.45);font:11px ui-monospace, Menlo, monospace;' +
      'color:var(--ink);display:none;',
    'box-complete'
  );
  document.body.appendChild(panel);

  let rows: string[] = [];
  let highlight = -1;
  let closed = false;

  // ── rendering ──────────────────────────────────────────────────────────────

  /**
   * Put the panel under the input, bounded on both axes and inside the window.
   *
   * Called after the rows are in the DOM and the panel is displayed, so the panel can be
   * measured rather than guessed at — which is what lets the left edge be nudged only as
   * far as it actually needs to go.
   */
  function place(): void {
    const r = input.getBoundingClientRect();
    const cap = Math.min(MAX_PANEL_W, Math.max(MIN_PANEL_W, window.innerWidth - 16));
    panel.style.maxWidth = `${Math.round(cap)}px`;
    panel.style.minWidth = `${Math.round(Math.min(Math.max(r.width, MIN_PANEL_W), cap))}px`;
    panel.style.top = `${Math.round(r.bottom + 2)}px`;
    const width = panel.getBoundingClientRect().width;
    const rightmost = Math.max(8, window.innerWidth - width - 8);
    panel.style.left = `${Math.round(Math.min(Math.max(8, r.left), rightmost))}px`;
  }

  function hidePanel(): void {
    panel.style.display = 'none';
    panel.replaceChildren();
    rows = [];
    highlight = -1;
  }

  function paintHighlight(): void {
    const items = panel.querySelectorAll<HTMLElement>('[data-name]');
    items.forEach((node, i) => {
      node.style.background = i === highlight ? 'var(--row-active)' : 'transparent';
      node.setAttribute('aria-selected', String(i === highlight));
    });
  }

  /** The completion list, for a caret still inside the first token. */
  function renderCompletions(query: string): void {
    // matchObjects('') means "browse", and browsing 1054 objects twelve at a time is
    // not what an empty box wants — it is noise over the canvas before a single key has
    // been pressed. The palette is where browsing belongs.
    if (query === '') {
      hidePanel();
      return;
    }
    const hits = matchObjects(query, { limit: LIMIT });
    if (hits.length === 0) {
      hidePanel();
      return;
    }
    rows = hits.map((o) => o.name);
    highlight = -1; // nothing preselected: Enter must commit the box, not a guess
    panel.setAttribute('data-kind', 'objects');
    panel.replaceChildren(
      ...hits.map((o) => {
        const stub = o.tier === 'A';
        const row = h(
          'div',
          'display:flex;align-items:center;gap:6px;padding:2px 6px;border-radius:3px;' +
            `cursor:pointer;white-space:nowrap;color:${stub ? 'var(--stub-ink)' : 'var(--ink)'};`,
          stub ? 'box-complete-row tier-a' : 'box-complete-row'
        );
        row.setAttribute('data-name', o.name);
        // The same dashed marker the canvas draws around a Tier-A box, so the two
        // surfaces say "recognized, but silent" the same way.
        const mark = h(
          'span',
          'flex:0 0 auto;width:7px;height:7px;border-radius:2px;' +
            (stub ? 'border:1px dashed var(--stub-stroke);' : 'background:var(--go);'),
          'tier-mark'
        );
        const name = h('span', 'flex:0 0 auto;', 'name');
        name.textContent = o.name;
        // min-width:0 is what actually lets this shrink: a flex item's default minimum
        // is its content size, so a nowrap signature pushed the row (and the panel)
        // arbitrarily wide no matter what overflow said.
        const sig = h(
          'span',
          'flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;color:var(--faint);',
          'sig',
        );
        sig.textContent = o.argSignature;
        row.append(mark, name, sig);
        return row;
      })
    );
    paintHighlight();
    panel.style.display = 'block';
    place();
  }

  /** The signature hint, for a caret past the first token. Nothing to accept. */
  function renderSignature(name: string, argIndex: number): void {
    const info = objectInfo(name);
    if (!info || info.argSignature === '') {
      hidePanel();
      return;
    }
    rows = [];
    highlight = -1;
    panel.setAttribute('data-kind', 'signature');
    const line = h(
      'div',
      'padding:3px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;',
      'box-signature',
    );
    const head = h('span', 'color:var(--dim);', 'sig-name');
    head.textContent = `${info.name} `;
    line.appendChild(head);
    info.argSignature.split(' ').forEach((part, i) => {
      const on = i === argIndex;
      const span = h(
        'span',
        on ? 'color:var(--ink);font-weight:600;' : 'color:var(--faint);',
        on ? 'sig-arg current' : 'sig-arg'
      );
      span.textContent = i === 0 ? part : ` ${part}`;
      line.appendChild(span);
    });
    panel.replaceChildren(line);
    panel.style.display = 'block';
    place();
  }

  function refresh(): void {
    if (closed) return;
    const caret = input.selectionStart ?? input.value.length;
    if (inFirstToken(input.value, caret)) {
      renderCompletions(input.value.slice(0, caret).trimStart());
    } else {
      renderSignature(firstToken(input.value), argIndexAt(input.value, caret));
    }
  }

  // ── commit / cancel ────────────────────────────────────────────────────────

  function teardown(): void {
    closed = true;
    input.removeEventListener('keydown', onKeyDown);
    input.removeEventListener('input', refresh);
    input.removeEventListener('blur', onBlur);
    panel.removeEventListener('pointerdown', onPanelDown);
    host.remove();
    panel.remove();
  }

  // Teardown happens BEFORE the callback, always. The callback mutates the document,
  // which re-renders the box underneath; doing that while the input is still focused
  // and attached would fire `blur` re-entrantly and commit a second time.
  function commit(): void {
    if (closed) return;
    const text = input.value.trim();
    teardown();
    opts.onCommit(text);
  }

  function cancel(): void {
    if (closed) return;
    teardown();
    opts.onCancel();
  }

  /** Put the highlighted (or first) object in place of the token being typed. */
  function accept(index: number): void {
    const name = rows[index];
    if (name === undefined) return;
    const caret = input.selectionStart ?? input.value.length;
    const pad = input.value.slice(0, caret).match(/^\s*/)?.[0] ?? '';
    // Whatever followed the caret is kept, minus the whitespace that separated it from
    // the half-typed name — otherwise accepting inside `cyc 440` leaves a double space.
    const rest = input.value.slice(caret).replace(/^\s+/, '');
    input.value = `${pad}${name} ${rest}`;
    const at = pad.length + name.length + 1;
    input.setSelectionRange(at, at);
    refresh();
  }

  function onKeyDown(e: KeyboardEvent): void {
    // The canvas listens for single letters (n, m, i, …) and for Cmd-Z on its own root,
    // and this <input> is a descendant of it. Every keystroke while the editor is open
    // belongs to the editor.
    e.stopPropagation();
    const open = rows.length > 0;
    switch (e.key) {
      case 'ArrowDown':
        if (!open) return;
        e.preventDefault();
        highlight = (highlight + 1) % rows.length;
        paintHighlight();
        return;
      case 'ArrowUp':
        if (!open) return;
        e.preventDefault();
        highlight = (highlight - 1 + rows.length) % rows.length;
        paintHighlight();
        return;
      case 'Tab':
        if (!open) return;
        e.preventDefault();
        accept(highlight >= 0 ? highlight : 0);
        return;
      case 'Enter':
        e.preventDefault();
        // A highlighted row means the user was choosing; otherwise they were typing,
        // and Enter is the commit it is everywhere else.
        if (open && highlight >= 0) accept(highlight);
        else commit();
        return;
      case 'Escape':
        e.preventDefault();
        // Two presses, two meanings: dismiss the suggestion you did not want, then
        // abandon the edit. Collapsing them loses work on a mis-press.
        if (open || panel.style.display !== 'none') hidePanel();
        else cancel();
        return;
      default:
        // Selection moves land after the key is applied.
        requestAnimationFrame(refresh);
    }
  }

  function onBlur(): void {
    // Clicking away commits, as Max does. Guarded by `closed`, so the teardown that
    // follows a commit or a cancel cannot come back through here.
    if (!closed) commit();
  }

  function onPanelDown(e: Event): void {
    // Keep focus on the input: a blur here would commit the box before the click that
    // was choosing a completion had a chance to be read.
    e.preventDefault();
    const row = (e.target as Element | null)?.closest<HTMLElement>('[data-name]');
    if (!row) return;
    const index = rows.indexOf(row.getAttribute('data-name') ?? '');
    if (index >= 0) accept(index);
  }

  input.addEventListener('keydown', onKeyDown);
  input.addEventListener('input', refresh);
  input.addEventListener('blur', onBlur);
  panel.addEventListener('pointerdown', onPanelDown);

  input.focus();
  // Select-all, so typing replaces — double-clicking a box to retype it is the common
  // case, and having to clear it first would be friction on every single edit.
  input.setSelectionRange(0, input.value.length);
  refresh();

  return {
    input,
    commit,
    close: () => {
      if (!closed) teardown();
    },
  };
}
