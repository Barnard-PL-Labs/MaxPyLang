// The palette, in real Chromium — because every property that makes it worth having is
// a layout property, and jsdom has no layout.
//
// Virtualization is the case in point: `clientHeight` is 0, `scrollHeight` is 0 and
// assigning `scrollTop` is a no-op under jsdom, so a windowed list "passes" there while
// rendering exactly one screen's worth of rows and never scrolling — which is also what
// a completely broken implementation does. The sweeps below drive the real scroller from
// top to bottom and assert two things at once that only a real engine can answer: that
// the DOM never holds anything like 1054 rows, and that the bottom of the list is
// genuinely reachable (the jit.* objects are the last 208 of the catalog, so "can you
// scroll to jit" IS the test of whether the runway and the transform agree).
//
// The other three assertions are the ones a user would file a bug about: the object you
// typed three letters of is the first row; "playable only" never shows something silent;
// and a row you drag carries a payload the canvas will accept.

import '../../src/objects'; // bootstrap FIRST: the catalog caches tiers on its first call
// The real page stylesheet, so the last block below can mount the palette in the real
// pane markup. It is a global side effect for this file, which is safe because every
// rule in it is scoped to a class or id the other tests here never use.
import '../../src/ui/patcher.css';
import { afterEach, describe, expect, it } from 'vitest';
import { matchObjects, objectInfo, objectOptions } from '../../src/engine/catalog';
import { DND_TYPE, Palette, ROW_H, type PaletteOptions } from '../../src/ui/palette';

interface Mounted {
  host: HTMLDivElement;
  palette: Palette;
  /** Every onPlace call, in order. */
  placed: { name: string; at?: { x: number; y: number } }[];
  /** Every onHover call, in order — null included, since "left the list" is a signal. */
  hovered: (string | null)[];
  destroy(): void;
}

let m: Mounted;

afterEach(() => m?.destroy());

// Narrow and short on purpose: a pane that showed the whole catalog at once would make
// the virtualization assertions vacuous. 420px holds ~14 rows of the 1069 in the tree.
const HOST_W = 260;
const HOST_H = 420;

function mount(extra: Partial<PaletteOptions> = {}): Mounted {
  const host = document.createElement('div');
  host.style.cssText =
    `position:fixed;left:0;top:0;width:${HOST_W}px;height:${HOST_H}px;` +
    'margin:0;padding:0;background:#1d2027;z-index:2147483000;';
  document.body.appendChild(host);

  const placed: Mounted['placed'] = [];
  const hovered: (string | null)[] = [];
  const palette = new Palette(host, {
    onPlace: (name, at) => placed.push(at ? { name, at } : { name }),
    onHover: (name) => hovered.push(name),
    ...extra,
  });

  return {
    host,
    palette,
    placed,
    hovered,
    destroy() {
      palette.destroy();
      host.remove();
    },
  };
}

const listEl = (mm: Mounted): HTMLElement => mm.host.querySelector<HTMLElement>('.palette-list')!;
const searchEl = (mm: Mounted): HTMLInputElement =>
  mm.host.querySelector<HTMLInputElement>('.palette-search')!;
const rowEls = (mm: Mounted): HTMLElement[] => [
  ...mm.host.querySelectorAll<HTMLElement>('.palette-row'),
];
const objectRows = (mm: Mounted): HTMLElement[] => rowEls(mm).filter((r) => r.dataset.name);
const renderedNames = (mm: Mounted): string[] =>
  objectRows(mm).map((r) => r.dataset.name as string);

/** Type into the search box exactly as a keystroke would. */
function type(mm: Mounted, query: string): void {
  const input = searchEl(mm);
  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function scrollTo(mm: Mounted, top: number): void {
  const list = listEl(mm);
  list.scrollTop = top;
  // Dispatched rather than awaited: a real scroll event is asynchronous, and every
  // assertion here is about what the list renders for a given offset, not about when.
  list.dispatchEvent(new Event('scroll'));
}

interface Sweep {
  /** Every object name that appeared at any scroll offset, top to bottom. */
  names: string[];
  /** Names whose row carried the Tier-A stub marker. */
  stubs: string[];
  /** The largest number of .palette-row elements in the DOM at any one moment. */
  peakRows: number;
  /** What was on screen at the very bottom. */
  bottom: string[];
}

/** Scroll the whole list, a screen at a time, recording what is in the DOM. */
function sweep(mm: Mounted): Sweep {
  const list = listEl(mm);
  const step = Math.max(ROW_H, list.clientHeight - 2 * ROW_H); // overlap, so nothing is skipped
  const seen = new Set<string>();
  const stubs = new Set<string>();
  let peakRows = 0;
  let bottom: string[] = [];

  for (let top = 0; ; top += step) {
    scrollTo(mm, top);
    const rows = rowEls(mm);
    peakRows = Math.max(peakRows, rows.length);
    for (const row of rows) {
      const name = row.dataset.name;
      if (!name) continue;
      seen.add(name);
      if (row.classList.contains('is-stub')) stubs.add(name);
    }
    bottom = renderedNames(mm);
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 1) break;
  }
  return { names: [...seen], stubs: [...stubs], peakRows, bottom };
}

describe('palette: search', () => {
  it('ranks cycle~ first for "cyc" — the object everyone means, not the alphabetical one', () => {
    m = mount();
    type(m, 'cyc');

    const names = renderedNames(m);
    expect(names[0]).toBe('cycle~');
    // The stub `cycle` sorts before `cycle~` alphabetically; the ranking is what puts the
    // playable oscillator on top, and this row order is the palette's whole promise.
    expect(names).toContain('cycle');
    expect(names.indexOf('cycle')).toBeGreaterThan(0);
    // A search is a flat ranked list: a group header here would scatter the ranking.
    expect(rowEls(m).filter((r) => r.classList.contains('palette-group'))).toEqual([]);
  });

  it('renders the same order matchObjects returns, so the box and the pane agree', () => {
    m = mount();
    type(m, 'del');
    expect(renderedNames(m).slice(0, 5)).toEqual(
      matchObjects('del').slice(0, 5).map((o) => o.name)
    );
  });

  it('says so when nothing matches, instead of showing an empty pane', () => {
    m = mount();
    type(m, 'zzzznotanobject');
    expect(renderedNames(m)).toEqual([]);
    expect(m.host.querySelector<HTMLElement>('.palette-empty')!.hidden).toBe(false);
  });
});

describe('palette: the playable-only filter', () => {
  it('never shows a stub anywhere in the list', () => {
    m = mount();
    const playable = matchObjects('', { tier: 'B' }).map((o) => o.name);
    const aStub = objectOptions().find((o) => o.tier === 'A')!.name;

    m.host.querySelector<HTMLButtonElement>('.palette-only')!.click();
    const all = sweep(m);

    expect(all.stubs, 'a Tier-A row survived the playable filter').toEqual([]);
    expect(all.names).not.toContain(aStub);
    expect([...all.names].sort()).toEqual([...playable].sort());
    // The filter is only useful if it is a big cut: 328 of 1054.
    expect(all.names.length).toBeLessThan(objectOptions().length / 2);
  });

  it('marks the stubs it does show, so an unfiltered list still discloses the gap', () => {
    m = mount();
    type(m, 'cyc');
    const rows = objectRows(m);
    const stub = rows.find((r) => r.dataset.name === 'cycle')!;
    const real = rows.find((r) => r.dataset.name === 'cycle~')!;

    expect(stub.classList.contains('is-stub')).toBe(true);
    expect(real.classList.contains('is-stub')).toBe(false);
    // The marker is the canvas's dashed stub vocabulary, not a colour swap.
    const mark = stub.querySelector<HTMLElement>('.palette-tier')!;
    expect(getComputedStyle(mark).borderStyle).toBe('dashed');
    expect(getComputedStyle(real.querySelector<HTMLElement>('.palette-tier')!).borderStyle)
      .not.toBe('dashed');
  });

  it('setFilter drives the same state as the toggle', () => {
    m = mount();
    m.palette.setFilter({ tier: 'B' });
    expect(m.host.querySelector('.palette-only')!.getAttribute('aria-pressed')).toBe('true');
    expect(renderedNames(m).every((n) => objectInfo(n)!.tier === 'B')).toBe(true);

    m.palette.setFilter({ pkg: 'jit' });
    expect(m.host.querySelector('.palette-only')!.getAttribute('aria-pressed')).toBe('false');
    expect(renderedNames(m).every((n) => objectInfo(n)!.pkg === 'jit')).toBe(true);
  });
});

describe('palette: virtualization', () => {
  it('keeps a few dozen rows in the DOM, not 1054, and still reaches jit at the bottom', () => {
    m = mount();
    const total = objectOptions().length;
    const list = listEl(m);

    // The runway is the full height of the model — the scrollbar tells the truth even
    // though the rows behind it do not exist.
    expect(list.scrollHeight).toBeGreaterThanOrEqual(total * ROW_H);
    const first = sweep(m);

    expect(first.peakRows, 'the window is not windowed').toBeLessThan(80);
    expect(first.names.length, 'the sweep did not reach every object').toBe(total);

    // …and the bottom of the scroll really is the bottom of the catalog.
    expect(first.bottom.some((n) => n.startsWith('jit.'))).toBe(true);
    expect(objectInfo(first.bottom[first.bottom.length - 1])!.pkg).toBe('jit');
  });

  it('renders the row at the offset it was scrolled to', () => {
    m = mount();
    // The third screen down, chosen by arithmetic rather than by what happens to be
    // on screen: if the runway and the translate disagreed, this would show row 0.
    const target = 40;
    scrollTo(m, target * ROW_H);
    const rows = rowEls(m);
    const indices = rows.map((r) => Number(r.dataset.index));
    expect(Math.min(...indices)).toBeLessThanOrEqual(target);
    expect(Math.max(...indices)).toBeGreaterThan(target);
    // Every rendered row sits at its true model offset.
    for (const row of rows) {
      const top = row.getBoundingClientRect().top - listEl(m).getBoundingClientRect().top;
      const expected = Number(row.dataset.index) * ROW_H - listEl(m).scrollTop;
      expect(Math.abs(top - expected)).toBeLessThan(1.5);
    }
  });
});

describe('palette: grouping', () => {
  it('browses as collapsible package groups subdivided by domain', () => {
    m = mount();
    const heads = rowEls(m).filter((r) => r.classList.contains('palette-group'));
    expect(heads[0].textContent).toContain('max');
    expect(heads.some((h) => h.dataset.key === 'max/signal' || h.dataset.key === 'max/control'))
      .toBe(true);

    // Collapsing the first package must remove its objects, not merely hide the header.
    const before = listEl(m).scrollHeight;
    heads[0].click();
    expect(listEl(m).scrollHeight).toBeLessThan(before);
    expect(heads[0].getAttribute('aria-expanded')).toBe('false');
    expect(renderedNames(m).every((n) => objectInfo(n)!.pkg !== 'max')).toBe(true);

    // …and expanding it again restores exactly what was there.
    rowEls(m)[0].click();
    expect(listEl(m).scrollHeight).toBe(before);
  });
});

describe('palette: placing', () => {
  it('clicking a row places that object', () => {
    m = mount();
    type(m, 'cyc');
    objectRows(m)[0].click();
    expect(m.placed).toEqual([{ name: 'cycle~' }]);
  });

  it('cascades repeat placements down-right from the viewport centre', () => {
    m = mount({ centre: () => ({ x: 100, y: 200 }) });
    type(m, 'cyc');
    const row = objectRows(m)[0];
    row.click();
    row.click();
    row.click();

    expect(m.placed.map((p) => p.at)).toEqual([
      { x: 100, y: 200 },
      { x: 120, y: 220 },
      { x: 140, y: 240 },
    ]);
  });

  it('places the top-ranked match on Enter, so ⌘K → type → Enter builds a box', () => {
    m = mount();
    type(m, 'cyc');
    searchEl(m).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(m.placed.map((p) => p.name)).toEqual(['cycle~']);
  });

  it('a group header is not placeable', () => {
    m = mount();
    rowEls(m).find((r) => r.classList.contains('palette-group'))!.click();
    expect(m.placed).toEqual([]);
  });

  it('focusSearch selects the box so the next keystroke starts a new search', () => {
    m = mount();
    type(m, 'cyc');
    m.palette.focusSearch();
    expect(document.activeElement).toBe(searchEl(m));
    expect(searchEl(m).selectionStart).toBe(0);
    expect(searchEl(m).selectionEnd).toBe(3);
  });
});

describe('palette: dragging to the canvas', () => {
  it('carries the object name under the type the canvas drop handler reads', () => {
    m = mount();
    type(m, 'cycle~');
    const row = objectRows(m)[0];
    expect(row.draggable).toBe(true);

    const dt = new DataTransfer();
    row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));

    // The string ui/file-io.ts's installCanvasDrop tests for, spelled out on both sides.
    expect(DND_TYPE).toBe('application/x-maxobject');
    expect(dt.getData(DND_TYPE)).toBe('cycle~');
    // Plain text too, for every other target — safe only because the canvas handler
    // tests the specific type first and reads text as a patch fragment solely when it
    // starts with `{` or `[`, which an object name never does.
    expect(dt.getData('text/plain')).toBe('cycle~');
    // Both types are advertised during the drag, which is what the drop handler reads:
    // the data itself is unreadable until the drop (drag-and-drop protected mode).
    expect([...dt.types].sort()).toEqual([DND_TYPE, 'text/plain']);
  });

  it('does not start a drag from a group header', () => {
    m = mount();
    const head = rowEls(m).find((r) => r.classList.contains('palette-group'))!;
    expect(head.draggable).toBe(false);

    const dt = new DataTransfer();
    head.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    expect(dt.getData(DND_TYPE)).toBe('');
  });
});

describe('palette: hover and teardown', () => {
  it('reports the row under the cursor once, and reports leaving', () => {
    m = mount();
    type(m, 'cyc');
    const row = objectRows(m)[0];

    row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1 }));
    // A second event over a child of the same row is the same row: no re-announcement.
    row
      .querySelector('.palette-name')!
      .dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1 }));
    listEl(m).dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerId: 1 }));

    expect(m.hovered).toEqual(['cycle~', null]);
  });

  it('destroy leaves nothing behind, and cancels the hover it announced', () => {
    m = mount();
    type(m, 'cyc');
    objectRows(m)[0].dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerId: 1 }));

    m.palette.destroy();

    expect(m.host.querySelector('.palette')).toBeNull();
    expect(m.hovered[m.hovered.length - 1], 'a tooltip outlived the pane').toBeNull();
  });
});

describe('palette: inside the real pane markup', () => {
  // The pane it actually mounts into pads its content by 10px and scrolls it, which
  // would put a scrollbar in the middle of a gutter and, worse, move rows the windowing
  // arithmetic believes it has already placed. The palette neutralizes both from its own
  // stylesheet; if patcher.css ever stops matching that selector, this is what says so.
  it('owns the scrolling, and its rows are still exactly ROW_H tall', () => {
    const aside = document.createElement('aside');
    aside.className = 'pane pane-left';
    aside.style.cssText = 'position:fixed;left:0;top:0;width:230px;height:420px;z-index:2147483000;';
    const head = document.createElement('div');
    head.className = 'pane-head';
    const body = document.createElement('div');
    body.className = 'pane-body';
    // The "the palette mounts here" placeholder patcher.html ships with.
    const placeholder = document.createElement('p');
    placeholder.className = 'pane-placeholder';
    placeholder.textContent = 'The searchable list of all 1054 Max objects mounts here.';
    body.appendChild(placeholder);
    aside.append(head, body);
    document.body.appendChild(aside);

    const palette = new Palette(body, { onPlace: () => {} });
    try {
      expect(getComputedStyle(body).padding).toBe('0px');
      expect(getComputedStyle(body).overflow).toBe('hidden');

      // Mounting retires the placeholder, or the list would be pushed out of a pane
      // that clips its overflow and the bottom rows would be unreachable.
      expect(body.querySelector('.pane-placeholder')).toBeNull();

      const list = body.querySelector<HTMLElement>('.palette-list')!;
      expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
      const row = body.querySelector<HTMLElement>('.palette-row')!;
      expect(row.getBoundingClientRect().height).toBe(ROW_H);
    } finally {
      palette.destroy();
      aside.remove();
    }
  });
});
