// UI "menu"-family widgets: index/list selectors that store a value and emit
// control messages when that value changes. Each is a real (Tier-B) factory whose
// message behavior (inlet -> value -> outlet) is fully headless-testable; the DOM
// widget (`el`) is an OPTIONAL convenience mounted by ui/graph.ts and is only ever
// created when a `document` exists, so these objects build in Node too.
//
// Pattern shared with control objects: makeOutlets() fans out to cords, controlIns[i]
// handles an incoming Msg, onControlOut lets the engine subscribe. The KEY invariant
// here is that the DOM event handler ('input'/'change'/'click') calls the SAME value
// setter as the inlet handler — so the widget and the patch cord stay in lock-step.

import { num, register, type MaxNode } from '../../engine/registry';
import { makeOutlets } from '../../runtime/outlets';
import { firstNum, isBang, nums, type Atom } from '../../runtime/atoms';

const HAS_DOM = typeof document !== 'undefined';

/** Parse creation args into menu items. A lone number = an item count (labels
 *  "0".."n-1"); otherwise each arg becomes an item label. */
function parseItems(args: Atom[]): string[] {
  if (args.length === 1 && typeof args[0] === 'number') {
    const n = Math.max(0, Math.round(args[0]));
    return Array.from({ length: n }, (_, i) => String(i));
  }
  return args.map((a) => String(a));
}

// ── umenu / tab : an index -> item selector ──────────────────────────────────
// Both emit the selected index (int) on outlet 0 and the selected item (symbol)
// on outlet 1; umenu's outlet 2 is its "middle/dump" outlet (unused here). A tab
// is the same contract drawn as tabs. Args set the item list (see parseItems).
function makeSelector(tag: 'select' | 'tabs') {
  return (args: Atom[]): MaxNode => {
    const o = makeOutlets();
    const items = parseItems(args);
    const count = items.length;
    let index = 0;

    const clampIdx = (n: number): number => {
      const r = Math.round(n);
      return count > 0 ? Math.max(0, Math.min(count - 1, r)) : Math.max(0, r);
    };
    const label = (i: number): string => items[i] ?? String(i);
    const emit = (): void => {
      o.emit(0, [index]);
      o.emit(1, [label(index)]);
    };
    const setIndex = (n: number, doEmit = true): void => {
      index = clampIdx(n);
      if (el && 'selectedIndex' in el) (el as HTMLSelectElement).selectedIndex = index;
      if (doEmit) emit();
    };

    let el: HTMLElement | undefined;
    if (HAS_DOM) {
      if (tag === 'select' || count === 0) {
        const sel = document.createElement('select');
        items.forEach((it, i) => {
          const opt = document.createElement('option');
          opt.value = String(i);
          opt.textContent = it;
          sel.appendChild(opt);
        });
        sel.addEventListener('change', () => setIndex(sel.selectedIndex));
        el = sel;
      } else {
        const wrap = document.createElement('div');
        items.forEach((it, i) => {
          const b = document.createElement('button');
          b.textContent = it;
          b.addEventListener('click', () => setIndex(i));
          wrap.appendChild(b);
        });
        el = wrap;
      }
    }

    return {
      signalIns: [],
      signalOuts: [],
      controlIns: [
        (m) => {
          if (isBang(m)) { emit(); return; }
          const n = firstNum(m);
          if (n !== undefined) setIndex(n);
        },
      ],
      onControlOut: o.onControlOut,
      el,
    };
  };
}
register('umenu', makeSelector('select'));
register('tab', makeSelector('tabs'));

// ── radiogroup : pick exactly one of N buttons ───────────────────────────────
// One outlet: the selected index (int). A number selects (and clamps to) a button;
// a bang re-outputs the current selection. First numeric arg = button count.
register('radiogroup', (args) => {
  const o = makeOutlets();
  const count = Math.max(0, Math.round(num(args[0], 0)));
  let index = 0;
  const clampIdx = (n: number): number => {
    const r = Math.round(n);
    return count > 0 ? Math.max(0, Math.min(count - 1, r)) : Math.max(0, r);
  };
  const emit = (): void => o.emit(0, [index]);
  const setIndex = (n: number, doEmit = true): void => {
    index = clampIdx(n);
    if (radios[index]) radios[index].checked = true;
    if (doEmit) emit();
  };

  let el: HTMLElement | undefined;
  const radios: HTMLInputElement[] = [];
  if (HAS_DOM) {
    const wrap = document.createElement('div');
    const name = `radiogroup-${Math.random().toString(36).slice(2)}`;
    for (let i = 0; i < Math.max(count, 1); i++) {
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = name;
      if (i === 0) r.checked = true;
      r.addEventListener('change', () => setIndex(i));
      radios.push(r);
      wrap.appendChild(r);
    }
    el = wrap;
  }

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { emit(); return; }
        const n = firstNum(m);
        if (n !== undefined) setIndex(n);
      },
    ],
    onControlOut: o.onControlOut,
    el,
  };
});

// ── matrixctrl : a grid of cells, each emitting [col row value] ───────────────
// Set a cell by sending the list [col row value]; the cell change is echoed on
// outlet 0 as [col row value]. A [col row] pair defaults the value to 1. A bang
// dumps every non-zero cell. First two numeric args = columns, rows (for clamping).
register('matrixctrl', (args) => {
  const o = makeOutlets();
  const cols = Math.max(1, Math.round(num(args[0], 8)));
  const rows = Math.max(1, Math.round(num(args[1], 8)));
  const cells = new Map<string, number>(); // "col,row" -> value
  const key = (c: number, r: number) => `${c},${r}`;

  const setCell = (c: number, r: number, v: number, doEmit = true): void => {
    c = Math.max(0, Math.min(cols - 1, Math.round(c)));
    r = Math.max(0, Math.min(rows - 1, Math.round(r)));
    v = Math.round(v);
    if (v) cells.set(key(c, r), v);
    else cells.delete(key(c, r));
    if (boxes[r]?.[c]) boxes[r][c].checked = !!v;
    if (doEmit) o.emit(0, [c, r, v]);
  };
  const dump = (): void => {
    for (const [k, v] of cells) {
      const [c, r] = k.split(',').map(Number);
      o.emit(0, [c, r, v]);
    }
  };

  let el: HTMLElement | undefined;
  const boxes: HTMLInputElement[][] = [];
  if (HAS_DOM) {
    const table = document.createElement('div');
    for (let r = 0; r < rows; r++) {
      const row = document.createElement('div');
      boxes[r] = [];
      for (let c = 0; c < cols; c++) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.addEventListener('change', () => setCell(c, r, cb.checked ? 1 : 0));
        boxes[r][c] = cb;
        row.appendChild(cb);
      }
      table.appendChild(row);
    }
    el = table;
  }

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { dump(); return; }
        const list = nums(m);
        if (list.length >= 3) setCell(list[0], list[1], list[2]);
        else if (list.length === 2) setCell(list[0], list[1], 1);
      },
    ],
    onControlOut: o.onControlOut,
    el,
  };
});

// ── multislider : a list of values ───────────────────────────────────────────
// Stores an array of values; sending a numeric list replaces the array (clamped
// to [min,max]) and emits it on outlet 0. A bang re-outputs the current list.
// Args: [size min max] (defaults 1, 0, 1). Outlet 1 is reserved (Max: per-slider).
register('multislider', (args) => {
  const o = makeOutlets();
  const size = Math.max(1, Math.round(num(args[0], 1)));
  const min = num(args[1], 0);
  const max = num(args[2], 1);
  const clamp = (v: number): number => Math.max(min, Math.min(max, v));
  let values: number[] = new Array(size).fill(min);

  const syncEl = (): void => {
    if (!sliders.length) return;
    values.forEach((v, i) => { if (sliders[i]) sliders[i].value = String(v); });
  };
  const setValues = (arr: number[], doEmit = true): void => {
    values = arr.map(clamp);
    syncEl();
    if (doEmit) o.emit(0, values.slice());
  };

  let el: HTMLElement | undefined;
  const sliders: HTMLInputElement[] = [];
  if (HAS_DOM) {
    const wrap = document.createElement('div');
    for (let i = 0; i < size; i++) {
      const s = document.createElement('input');
      s.type = 'range';
      s.min = String(min);
      s.max = String(max);
      s.value = String(values[i]);
      s.addEventListener('input', () => {
        const next = sliders.map((sl) => Number(sl.value));
        setValues(next);
      });
      sliders.push(s);
      wrap.appendChild(s);
    }
    el = wrap;
  }

  return {
    signalIns: [],
    signalOuts: [],
    controlIns: [
      (m) => {
        if (isBang(m)) { o.emit(0, values.slice()); return; }
        const list = nums(m);
        if (list.length) setValues(list);
      },
    ],
    onControlOut: o.onControlOut,
    el,
  };
});
