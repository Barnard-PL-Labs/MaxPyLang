// The object palette: a browser over all 1054 objects, for the user who does not
// already know the name of the box they need.
//
// Until this pane existed, the canvas answered "what can I build?" with a blinking
// caret. Completion in ui/box-editor.ts only helps once you have typed a plausible
// prefix — it deliberately shows nothing for an empty query, because browsing 1054
// objects twelve at a time over the canvas is noise. Browsing is this file's whole job,
// and it is the reason the patcher can be used by someone who has never opened Max.
//
// Four decisions carry the file:
//
//   • RANKING IS NOT HERE. Every hit list comes from engine/catalog.ts's matchObjects(),
//     the same function the in-box completion calls, so three keystrokes offer the same
//     objects in the same order in the pane and in the box. A second ranking that lived
//     here would drift from that one within a week.
//
//   • THE TIER IS DISCLOSED AT THE MOMENT OF CHOOSING. Only 328 of the 1054 objects have
//     real behaviour; the rest are recognized, correctly shaped, and silent. A user who
//     drags in a stub and hears nothing concludes the app is broken, so a Tier-A row is
//     dimmed and carries the same dashed marker the canvas draws around a stub box and
//     the completion panel draws beside a stub name — one visual vocabulary, three
//     surfaces — and the "playable only" toggle removes them from the list entirely.
//
//   • THE LIST IS VIRTUALIZED. 1054 rows is roughly 5000 elements; building them makes
//     the first open janky and every keystroke afterwards worse. Rows are a fixed
//     ROW_H tall — GROUP HEADERS INCLUDED, which is what keeps the windowing arithmetic
//     a division rather than a prefix-sum table — so only the ~30 rows over the viewport
//     ever exist, inside a spacer of the full height so the scrollbar still tells the
//     truth. No library: a scroll handler and one transform is the entire mechanism.
//
//   • DRAGGING USES HTML5 DRAG-AND-DROP, not pointer events. The gesture has to cross
//     from this pane into the renderer's <svg>, and a pointer-event drag would need both
//     sides to agree about capture, hit testing and coordinate spaces. A dataTransfer
//     payload crosses that boundary as a browser primitive: this file writes
//     DND_TYPE and the canvas's drop handler reads it, and neither imports the other.
//
// ORDERING, inherited from engine/catalog.ts: the catalog table is built on its first
// call and cached, and `tier` reads the registry, so whoever constructs a Palette must
// already have imported src/objects — otherwise every row here reads as Tier A and the
// pane claims all 1054 objects are silent. patcher/main.ts imports the bootstrap first;
// so does the test for this file.
//
// STYLING IS INJECTED HERE, not in ui/patcher.css, for the same reason ui/box-editor.ts
// styles itself: the row height is not decoration but LOAD-BEARING — the windowing math
// is wrong the instant a row is not ROW_H tall — so it cannot depend on a stylesheet
// that may not have loaded, or on the palette having been mounted inside the patcher
// page at all (a test mounts it into a bare div). The class names below are stable
// hooks; moving the look into patcher.css later only needs the height rules left alone.

import {
  matchObjects,
  objectOptions,
  objectsByPackage,
  type ObjectInfo,
  type Pkg,
  type PrimaryDomain,
} from '../engine/catalog';
import { DOMAIN_COLOR } from './layout';

/**
 * Row height, in CSS pixels. Exported because it IS the contract between the stylesheet
 * below and the windowing arithmetic: a test that wants to know how far to scroll to
 * reach a given row should ask here rather than restate the number.
 */
export const ROW_H = 26;

/** Rows kept beyond each edge of the viewport, so a fast flick never shows blank space. */
const OVERSCAN = 6;

/**
 * The dataTransfer type a dropped object name travels under.
 *
 * Spelled out here rather than imported from ui/file-io.ts (which exports the same
 * string as MAXOBJECT_MIME) so that browsing objects does not pull the file-system layer
 * into this pane's chunk. It is one short wire constant on both sides of a browser
 * primitive; if it ever moves, it should move to a module both can import cheaply.
 */
export const DND_TYPE = 'application/x-maxobject';

/** How far each repeat placement steps down-right, as Max does. */
const CASCADE = 20;
/** …wrapping, so a long session of clicking never walks the box off the canvas. */
const CASCADE_WRAP = 10;

export interface PaletteFilter {
  /** 'B' = only objects that actually make sound. Omitted = everything. */
  tier?: 'B';
  pkg?: Pkg;
}

export interface PaletteOptions {
  /**
   * Place this object in the patch. `at` is a point in PATCH coordinates when the
   * palette was given a `centre` to cascade from, and is otherwise omitted — meaning
   * "you choose", because a pane on the left of the window has no way to know where the
   * canvas viewport is looking.
   */
  onPlace(name: string, at?: { x: number; y: number }): void;
  /** The row under the cursor, or null when the pointer leaves the list. */
  onHover?(name: string | null): void;
  /**
   * The patch point a click should place at — read fresh per placement, never captured,
   * so it follows the user's pan and zoom. Supplying it moves the +20/+20 cascade for
   * repeat clicks in here, where the repeat is actually observed; leaving it out keeps
   * this file honest about not knowing where the canvas is and hands both decisions to
   * the caller. Optional, so a caller written against {onPlace, onHover} still compiles.
   */
  centre?: () => { x: number; y: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rows — one flat, uniform-height list, which is what makes windowing a division
// ─────────────────────────────────────────────────────────────────────────────

interface GroupRow {
  kind: 'group';
  /** Collapse key: 'msp' for a package, 'msp/signal' for a domain within one. */
  key: string;
  label: string;
  count: number;
  level: number;
  collapsed: boolean;
}

interface ObjectRow {
  kind: 'object';
  info: ObjectInfo;
  level: number;
}

type Row = GroupRow | ObjectRow;

/** Package order in the browse tree: Max first, then MSP, then Jitter — as the docs go. */
const PKG_ORDER: readonly Pkg[] = ['max', 'msp', 'jit'];

/** Domain order within a package: what makes sound, what steers it, then video, then sinks. */
const DOMAIN_ORDER: readonly PrimaryDomain[] = ['signal', 'control', 'video', 'sink'];

const DOMAIN_LABEL: Record<PrimaryDomain, string> = {
  signal: 'Signal',
  control: 'Control',
  video: 'Video',
  sink: 'Sink',
};

/**
 * The dot colour. Borrowed from ui/layout.ts so a row and the cord that will leave the
 * box it places are the same colour; `sink` has no cord to borrow from (nothing leaves
 * it at all), so it gets the muted grey the dimmed text already uses.
 */
const DOT_COLOR: Record<PrimaryDomain, string> = {
  signal: DOMAIN_COLOR.signal,
  control: DOMAIN_COLOR.control,
  video: DOMAIN_COLOR.video,
  sink: '#6b7280',
};

// ─────────────────────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────────────────────

const CSS = `
.palette, .palette * { box-sizing: border-box; }
.palette {
  display: flex; flex-direction: column; height: 100%; min-height: 0;
  font: 12px/1.2 system-ui, -apple-system, sans-serif;
  color: var(--ink, #d6dbe2);
}
/* The pane this mounts into pads its content and scrolls it, and both are wrong for a
   virtualized list: the scrollbar would float in the middle of a 10px gutter, and an
   outer scroller would move rows the windowing arithmetic believes it has placed. The
   palette owns its own scrolling; the pane owns none. */
.pane-body:has(> .palette) { padding: 0; overflow: hidden; }

.palette-head {
  flex: 0 0 auto; display: flex; align-items: center; gap: 6px;
  padding: 8px; border-bottom: 1px solid var(--line, #2c313a);
}
.palette-search {
  flex: 1 1 auto; min-width: 0; font: inherit; color: inherit;
  background: var(--bg, #16181c); border: 1px solid #39404b; border-radius: 5px;
  padding: 5px 7px;
}
.palette-search:focus { outline: none; border-color: var(--control, #5aa9e6); }
.palette-only {
  flex: 0 0 auto; font: inherit; cursor: pointer; white-space: nowrap;
  color: var(--dim, #8b93a0); background: #262b33;
  border: 1px solid #39404b; border-radius: 5px; padding: 5px 7px;
}
.palette-only:hover { border-color: #4a5361; color: var(--ink, #d6dbe2); }
.palette-only[aria-pressed='true'] {
  background: #1f3d31; border-color: var(--go, #4bd08a); color: #cdf6e3;
}

.palette-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.palette-runway { position: relative; width: 100%; }
.palette-window { position: absolute; top: 0; left: 0; right: 0; }

.palette-row {
  display: flex; align-items: center; gap: 6px;
  height: ${ROW_H}px; padding: 0 8px;
  white-space: nowrap; cursor: pointer; user-select: none; -webkit-user-select: none;
}
.palette-row:hover { background: #262b33; }
.palette-row.is-active { background: #2f3a47; }
.palette-name { flex: 0 0 auto; }
/* min-width:0 is what actually lets the signature shrink: a flex item's default minimum
   is its content size, so a nowrap signature would push the row arbitrarily wide. */
.palette-sig {
  flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: #6b7280;
}
.palette-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; }
.palette-tier { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 2px; background: var(--go, #4bd08a); }

/* Tier A: recognized, correctly shaped, silent. The dashed marker and the desaturation
   are the canvas's own stub vocabulary (ui/patch.css .node-stub), repeated here. */
.palette-row.is-stub { color: #8a8f98; }
.palette-row.is-stub .palette-dot { opacity: .4; }
.palette-row.is-stub .palette-tier { background: none; border: 1px dashed #8a6a6a; }

.palette-group {
  color: var(--dim, #8b93a0); background: #1a1d23;
  font-size: 10px; font-weight: 600; letter-spacing: .06em; text-transform: uppercase;
}
.palette-group[data-level='2'] { background: transparent; padding-left: 18px; }
.palette-twisty { flex: 0 0 auto; width: 9px; color: #6b7280; }
.palette-glabel { flex: 0 0 auto; }
.palette-count { margin-left: auto; color: #6b7280; font-variant-numeric: tabular-nums; }

.palette-empty { padding: 12px 10px; color: #6b7280; line-height: 1.5; }
.palette-foot {
  flex: 0 0 auto; padding: 6px 8px; border-top: 1px solid var(--line, #2c313a);
  color: #6b7280; font-size: 11px; font-variant-numeric: tabular-nums;
}
`;

/** Idempotent: two palettes on one page (wide pane + narrow overlay) share one sheet. */
function ensureStyles(): void {
  if (document.getElementById('palette-css')) return;
  const style = document.createElement('style');
  style.id = 'palette-css';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const div = (cls: string): HTMLDivElement => {
  const node = document.createElement('div');
  node.className = cls;
  return node;
};

const span = (cls: string): HTMLSpanElement => {
  const node = document.createElement('span');
  node.className = cls;
  return node;
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * A searchable, groupable, virtualized list of every object in the catalog.
 *
 * Mounts one element into `host` and owns everything inside it. The caller keeps the
 * handle only to focus the search box (⌘K), to drive the filter from its own chrome, and
 * to tear the pane down when the page does.
 */
export class Palette {
  private readonly opts: PaletteOptions;

  private readonly root: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly onlyBtn: HTMLButtonElement;
  private readonly list: HTMLDivElement;
  private readonly runway: HTMLDivElement;
  private readonly win: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly foot: HTMLDivElement;

  private query = '';
  private filter: PaletteFilter = {};
  /** Collapse keys, not expand keys: everything is open until the user closes it. */
  private readonly collapsed = new Set<string>();

  private rows: Row[] = [];
  /** Recycled row elements — exactly as many as are on screen, never 1054. */
  private readonly pool: HTMLDivElement[] = [];
  private atFirst = -1;
  private atCount = -1;

  /** Index into `rows` of the keyboard-selected row, or -1. */
  private active = -1;
  /** The name last reported through onHover, so a re-render does not re-announce it. */
  private hovered: string | null = null;
  private cascade = 0;

  constructor(host: HTMLElement, opts: PaletteOptions) {
    ensureStyles();
    this.opts = opts;

    this.root = div('palette');

    const head = div('palette-head');
    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.className = 'palette-search';
    this.search.placeholder = `Search ${objectOptions().length} objects…`;
    this.search.setAttribute('aria-label', 'Search Max objects');
    this.search.autocomplete = 'off';
    // Named, not id'd: a form field with neither is flagged by Chrome's issues panel, and
    // an id would be a second global name for an element the host already addresses by
    // its host element — two palettes on one page would then collide.
    this.search.name = 'maxpy-object-search';
    this.search.spellcheck = false;

    this.onlyBtn = document.createElement('button');
    this.onlyBtn.type = 'button';
    this.onlyBtn.className = 'palette-only';
    this.onlyBtn.textContent = '♪ Playable';
    this.onlyBtn.title = 'Show only objects that actually make sound yet';
    this.onlyBtn.setAttribute('aria-pressed', 'false');
    head.append(this.search, this.onlyBtn);

    this.list = div('palette-list');
    // A tree, not a listbox: the rows really are collapsible groups containing leaves,
    // and a listbox may not contain anything but options.
    this.list.setAttribute('role', 'tree');
    this.list.setAttribute('aria-label', 'Max objects');
    this.runway = div('palette-runway');
    this.win = div('palette-window');
    this.runway.appendChild(this.win);
    this.empty = div('palette-empty');
    this.empty.hidden = true;
    this.list.append(this.runway, this.empty);

    this.foot = div('palette-foot');
    this.root.append(head, this.list, this.foot);
    // patcher.html's pane holds a paragraph that says "the palette mounts here"; mounting
    // IS what retires it. Done here rather than left to the integrator because the
    // palette is `height: 100%` of the pane, so a leftover sibling does not merely look
    // untidy — it pushes the bottom of the list out of a pane that clips its overflow.
    // Nothing else in the host is touched.
    for (const stale of host.querySelectorAll(':scope > .pane-placeholder')) stale.remove();
    host.appendChild(this.root);

    this.search.addEventListener('input', this.onQuery);
    this.search.addEventListener('keydown', this.onKey);
    this.onlyBtn.addEventListener('click', this.onToggleTier);
    this.list.addEventListener('scroll', this.onScroll, { passive: true });
    this.list.addEventListener('click', this.onClick);
    this.list.addEventListener('pointerover', this.onOver);
    this.list.addEventListener('pointerleave', this.onLeave);
    this.list.addEventListener('dragstart', this.onDragStart);

    this.rebuild();
  }

  /** ⌘K lands here: focused and selected, so the next keystroke starts a fresh search. */
  focusSearch(): void {
    this.search.focus();
    this.search.select();
  }

  /**
   * Replace the filter (it is not merged — `setFilter({})` clears both fields). Scrolls
   * back to the top, because the row at the old offset is not the row the user was
   * looking at once the list has a different length.
   */
  setFilter(f: PaletteFilter): void {
    this.filter = { ...f };
    this.onlyBtn.setAttribute('aria-pressed', String(f.tier === 'B'));
    this.list.scrollTop = 0;
    this.active = -1;
    this.rebuild();
  }

  destroy(): void {
    this.search.removeEventListener('input', this.onQuery);
    this.search.removeEventListener('keydown', this.onKey);
    this.onlyBtn.removeEventListener('click', this.onToggleTier);
    this.list.removeEventListener('scroll', this.onScroll);
    this.list.removeEventListener('click', this.onClick);
    this.list.removeEventListener('pointerover', this.onOver);
    this.list.removeEventListener('pointerleave', this.onLeave);
    this.list.removeEventListener('dragstart', this.onDragStart);
    // Whatever the integrator was showing for the hovered row outlives this pane
    // otherwise — a tooltip for a palette that is no longer on the page.
    this.report(null);
    this.root.remove();
    this.pool.length = 0;
  }

  // ── model ──────────────────────────────────────────────────────────────────

  /**
   * A SEARCH is a flat ranked list and a BROWSE is a grouped tree. Grouping the search
   * would scatter the ranking across three package headers and destroy the one property
   * the ranking exists for: that the object you meant is the first row.
   */
  private buildRows(): Row[] {
    if (this.query) {
      return matchObjects(this.query, this.filter).map(
        (info): Row => ({ kind: 'object', info, level: 1 })
      );
    }

    const groups = objectsByPackage();
    const out: Row[] = [];
    for (const pkg of PKG_ORDER) {
      if (this.filter.pkg !== undefined && this.filter.pkg !== pkg) continue;
      const inPkg =
        this.filter.tier === undefined
          ? groups[pkg]
          : groups[pkg].filter((o) => o.tier === this.filter.tier);
      if (inPkg.length === 0) continue;

      const pkgCollapsed = this.collapsed.has(pkg);
      out.push({
        kind: 'group',
        key: pkg,
        label: pkg,
        count: inPkg.length,
        level: 1,
        collapsed: pkgCollapsed,
      });
      if (pkgCollapsed) continue;

      for (const domain of DOMAIN_ORDER) {
        const inDomain = inPkg.filter((o) => o.domain === domain);
        if (inDomain.length === 0) continue;
        const key = `${pkg}/${domain}`;
        const domCollapsed = this.collapsed.has(key);
        out.push({
          kind: 'group',
          key,
          label: DOMAIN_LABEL[domain],
          count: inDomain.length,
          level: 2,
          collapsed: domCollapsed,
        });
        if (domCollapsed) continue;
        for (const info of inDomain) out.push({ kind: 'object', info, level: 3 });
      }
    }
    return out;
  }

  /** Recompute the model, resize the scroll runway, repaint the window. */
  private rebuild(): void {
    this.rows = this.buildRows();
    this.runway.style.height = `${this.rows.length * ROW_H}px`;

    const objects = this.rows.reduce((n, r) => n + (r.kind === 'object' ? 1 : 0), 0);
    const total = objectOptions().length;
    this.empty.hidden = this.rows.length > 0;
    if (this.rows.length === 0) {
      this.empty.textContent = this.filter.tier
        ? `No playable object matches “${this.query}”. Turn off ♪ Playable to search all ${total}.`
        : `No object matches “${this.query}”.`;
    }
    this.foot.textContent =
      objects === total ? `${total} objects` : `${objects} of ${total} objects`;

    this.paint(true);
  }

  // ── the window ─────────────────────────────────────────────────────────────

  /**
   * Render only the rows over the viewport. Called on every scroll event, so it returns
   * immediately when the visible range has not changed — which makes it cheap enough to
   * run synchronously, and that in turn keeps the list correct without a rAF frame
   * between the scroll and the paint.
   */
  private paint(force: boolean): void {
    // A palette in a collapsed rail has no height; render a screenful anyway so that
    // reopening it shows rows before the first scroll event arrives.
    const viewH = this.list.clientHeight || ROW_H * 16;
    const first = Math.max(0, Math.floor(this.list.scrollTop / ROW_H) - OVERSCAN);
    const want = Math.ceil(viewH / ROW_H) + OVERSCAN * 2;
    const count = Math.max(0, Math.min(this.rows.length - first, want));
    if (!force && first === this.atFirst && count === this.atCount) return;
    this.atFirst = first;
    this.atCount = count;

    while (this.pool.length < count) {
      const row = div('palette-row');
      this.pool.push(row);
      this.win.appendChild(row);
    }
    while (this.pool.length > count) this.pool.pop()?.remove();

    for (let i = 0; i < count; i++) this.paintRow(this.pool[i], this.rows[first + i], first + i);
    this.win.style.transform = `translateY(${first * ROW_H}px)`;
  }

  /** Reuse a pooled element in place; rebuild its children only when the kind changes. */
  private paintRow(el: HTMLDivElement, row: Row, index: number): void {
    if (el.dataset.kind !== row.kind) {
      el.dataset.kind = row.kind;
      el.setAttribute('role', 'treeitem');
      if (row.kind === 'group') {
        el.draggable = false;
        el.removeAttribute('aria-selected');
        el.replaceChildren(span('palette-twisty'), span('palette-glabel'), span('palette-count'));
      } else {
        el.draggable = true;
        el.removeAttribute('aria-expanded');
        el.replaceChildren(
          span('palette-dot'),
          span('palette-name'),
          span('palette-sig'),
          span('palette-tier')
        );
      }
    }
    el.dataset.index = String(index);
    el.dataset.level = String(row.level);
    el.setAttribute('aria-level', String(row.level));

    const a = el.children[0] as HTMLElement;
    const b = el.children[1] as HTMLElement;
    const c = el.children[2] as HTMLElement;

    if (row.kind === 'group') {
      el.className = 'palette-row palette-group';
      el.dataset.key = row.key;
      delete el.dataset.name;
      el.setAttribute('aria-expanded', String(!row.collapsed));
      a.textContent = row.collapsed ? '▸' : '▾';
      b.textContent = row.label;
      c.textContent = String(row.count);
      return;
    }

    const { info } = row;
    const stub = info.tier === 'A';
    el.className = `palette-row${stub ? ' is-stub' : ''}${index === this.active ? ' is-active' : ''}`;
    el.dataset.name = info.name;
    delete el.dataset.key;
    el.setAttribute('aria-selected', String(index === this.active));
    // No `title`: a native tooltip would race the integrator's onHover panel, and the
    // browser's own is the one we cannot position or style.
    a.style.background = DOT_COLOR[info.domain];
    b.textContent = info.name;
    // An alias row says what it really is; otherwise the argument signature, which is
    // the only thing on the row that tells you what to type after the name.
    c.textContent = info.aliasOf ? `= ${info.aliasOf}` : info.argSignature;
    (el.children[3] as HTMLElement).title = stub ? 'No sound yet' : 'Playable';
  }

  // ── events ─────────────────────────────────────────────────────────────────

  private readonly onQuery = (): void => {
    this.query = this.search.value.trim();
    this.list.scrollTop = 0;
    this.active = -1;
    // A fresh search is a fresh placement: the next click starts at the centre again
    // rather than wherever the previous object's cascade had walked to.
    this.cascade = 0;
    this.rebuild();
  };

  private readonly onScroll = (): void => this.paint(false);

  private readonly onToggleTier = (): void => {
    this.setFilter({ ...this.filter, tier: this.filter.tier === 'B' ? undefined : 'B' });
  };

  private readonly onClick = (e: MouseEvent): void => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('.palette-row');
    if (!el) return;
    const key = el.dataset.key;
    if (key !== undefined) {
      if (!this.collapsed.delete(key)) this.collapsed.add(key);
      this.rebuild();
      return;
    }
    const name = el.dataset.name;
    if (name !== undefined) this.place(name);
  };

  private readonly onOver = (e: PointerEvent): void => {
    const el = (e.target as Element | null)?.closest<HTMLElement>('.palette-row');
    this.report(el?.dataset.name ?? null);
  };

  private readonly onLeave = (): void => this.report(null);

  private readonly onDragStart = (e: DragEvent): void => {
    const name = (e.target as Element | null)?.closest<HTMLElement>('.palette-row')?.dataset.name;
    if (name === undefined || !e.dataTransfer) return;
    e.dataTransfer.setData(DND_TYPE, name);
    // …and the same name as plain text, for every OTHER target: the Python drawer, a
    // box editor, another window. It is safe next to the specific type because the
    // canvas's own handler (ui/file-io.ts installCanvasDrop) tests DND_TYPE first and
    // treats text only as a patch fragment when it starts with `{` or `[`.
    e.dataTransfer.setData('text/plain', name);
    e.dataTransfer.effectAllowed = 'copy';
  };

  /**
   * Keyboard from the search box, so the whole pane is usable without leaving it:
   * type, arrow to the row you meant, Enter to place it.
   */
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.step(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter') {
      const row = this.rows[this.active >= 0 ? this.active : this.firstObject()];
      if (row?.kind === 'object') {
        e.preventDefault();
        this.place(row.info.name);
      }
      return;
    }
    if (e.key === 'Escape' && this.query) {
      e.preventDefault();
      this.search.value = '';
      this.onQuery();
    }
  };

  // ── helpers ────────────────────────────────────────────────────────────────

  private firstObject(): number {
    return this.rows.findIndex((r) => r.kind === 'object');
  }

  /** Move the selection to the next/previous OBJECT row, skipping group headers. */
  private step(delta: number): void {
    const n = this.rows.length;
    if (n === 0) return;
    let i = this.active;
    for (let tried = 0; tried < n; tried++) {
      i += delta;
      if (i < 0 || i >= n) return; // stop at the ends rather than wrapping past them
      if (this.rows[i].kind === 'object') break;
    }
    if (i < 0 || i >= n || this.rows[i].kind !== 'object') return;
    this.active = i;

    // Scroll the selection into view by arithmetic, not scrollIntoView(): the row may
    // not be in the DOM at all yet, which is the whole point of the window.
    const top = i * ROW_H;
    const viewH = this.list.clientHeight;
    if (top < this.list.scrollTop) this.list.scrollTop = top;
    else if (top + ROW_H > this.list.scrollTop + viewH) {
      this.list.scrollTop = top + ROW_H - viewH;
    }
    this.paint(true);
  }

  private report(name: string | null): void {
    if (name === this.hovered) return;
    this.hovered = name;
    this.opts.onHover?.(name);
  }

  private place(name: string): void {
    const centre = this.opts.centre?.();
    if (!centre) {
      this.opts.onPlace(name);
      return;
    }
    const step = this.cascade;
    this.cascade = (this.cascade + 1) % CASCADE_WRAP;
    this.opts.onPlace(name, { x: centre.x + CASCADE * step, y: centre.y + CASCADE * step });
  }
}
