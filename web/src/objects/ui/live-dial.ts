// live.dial : Max for Live's parameter knob.
//
// One inlet, two outlets: the value in its own units out the left, and the raw knob
// position (0..1) out the right. Its range, unit, curve and starting value come from the
// Live parameter block saved on the box (see live-param.ts), never from the box text.
//
// Messages: a number sets the value and outputs it; bang re-outputs; `set N` stores
// without output; `rawfloat P` sets from a 0..1 position; `init` returns to the
// starting value.
//
// A parameter with an initial value outputs it when the device loads. Here that moment
// is the transport starting: the cords do not exist yet while the factory is running, so
// a value sent from the constructor would reach nothing.
//
// The widget is one SVG in a 44 x 48 viewBox (live.dial's own footprint) that fills
// whatever box it is mounted in, so a page can show the device at any zoom. It takes its
// colours from CSS custom properties with dark defaults, and its accent from the box's
// `activedialcolor` when the patch sets one.

import { register, type MaxNode } from '../../engine/registry';
import { firstNum, isBang, type Msg } from '../../runtime/atoms';
import { makeOutlets } from '../../runtime/outlets';
import { formatParam, liveParam, paramPosition, paramValue } from './live-param';

const hasDOM = (): boolean => typeof document !== 'undefined';
const SVG = 'http://www.w3.org/2000/svg';

// The knob's travel: 270 degrees, from 7:30 round to 4:30.
const A0 = 135;
const SWEEP = 270;
const CX = 22;
const CY = 25;
const R = 10.5;

function polar(deg: number, r = R): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

function arc(from: number, to: number): string {
  const [x0, y0] = polar(from);
  const [x1, y1] = polar(to);
  if (Math.abs(to - from) < 0.01) return `M ${x0} ${y0}`;
  return `M ${x0} ${y0} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

function cssColor(v: unknown): string | undefined {
  if (!Array.isArray(v) || v.length < 3) return undefined;
  const [r, g, b, a = 1] = v.map(Number);
  if (![r, g, b, a].every(Number.isFinite)) return undefined;
  const c = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 255);
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${a})`;
}

register('live.dial', (_args, { node }) => {
  const param = liveParam(node?.raw, 'live.dial');
  const o = makeOutlets();
  const lo = Math.min(param.min, param.max);
  const hi = Math.max(param.min, param.max);
  const bound = (v: number): number => {
    const c = Math.min(hi, Math.max(lo, v));
    return param.integer ? Math.round(c) : c;
  };

  let value = bound(param.initial);
  let redraw: (() => void) | undefined;

  const output = (): void => {
    o.emit(1, [paramPosition(param, value)]);
    o.emit(0, [value]);
  };
  const set = (v: number, emit: boolean): void => {
    const next = bound(v);
    value = next;
    redraw?.();
    if (emit) output();
  };

  function message(m: Msg): void {
    if (isBang(m)) return output();
    const n = firstNum(m.slice(typeof m[0] === 'string' ? 1 : 0));
    switch (m[0]) {
      case 'set':
        if (n !== undefined) set(n, false);
        return;
      case 'rawfloat':
        if (n !== undefined) set(paramValue(param, n), true);
        return;
      case 'init':
        return set(param.initial, true);
    }
    if (typeof m[0] === 'number') set(m[0], true);
  }

  let el: HTMLElement | undefined;
  if (hasDOM()) {
    const root = document.createElement('div');
    root.className = 'live-dial';
    root.tabIndex = 0;
    root.setAttribute('role', 'slider');
    root.setAttribute('aria-label', param.longname);
    root.setAttribute('aria-valuemin', String(lo));
    root.setAttribute('aria-valuemax', String(hi));
    root.dataset.param = param.longname;
    root.style.cssText =
      'width:100%;height:100%;min-width:44px;min-height:48px;cursor:ns-resize;touch-action:none;user-select:none;-webkit-user-select:none;outline:none;';
    const accent = cssColor(node?.raw?.activedialcolor);
    if (accent) root.style.setProperty('--ld-accent', accent);

    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 44 48');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.display = 'block';
    svg.style.overflow = 'visible';

    const mk = <K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string>): SVGElementTagNameMap[K] => {
      const e = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      svg.appendChild(e);
      return e;
    };
    const font = 'font-family:inherit;';
    const name = mk('text', { x: '22', y: '8', 'text-anchor': 'middle', style: `${font}font-size:7.2px;fill:var(--ld-ink,#c9ced6);letter-spacing:.02em;` });
    name.textContent = param.shortname;
    mk('path', { d: arc(A0, A0 + SWEEP), fill: 'none', stroke: 'var(--ld-track,#3a3f47)', 'stroke-width': '2.6', 'stroke-linecap': 'round' });
    const fill = mk('path', { d: '', fill: 'none', stroke: 'var(--ld-accent,#ffad56)', 'stroke-width': '2.6', 'stroke-linecap': 'round' });
    mk('circle', { cx: String(CX), cy: String(CY), r: '6.6', fill: 'var(--ld-cap,#22262c)', stroke: 'var(--ld-cap-edge,#4a505a)', 'stroke-width': '0.6' });
    const needle = mk('line', { x1: String(CX), y1: String(CY), x2: String(CX), y2: String(CY), stroke: 'var(--ld-needle,#f2f4f7)', 'stroke-width': '1.4', 'stroke-linecap': 'round' });
    const readout = mk('text', { x: '22', y: '46', 'text-anchor': 'middle', style: `${font}font-size:6.8px;fill:var(--ld-dim,#8b929c);font-variant-numeric:tabular-nums;` });
    const focus = mk('circle', { cx: String(CX), cy: String(CY), r: '14.5', fill: 'none', stroke: 'var(--ld-accent,#ffad56)', 'stroke-width': '0.8', opacity: '0' });
    root.appendChild(svg);

    redraw = () => {
      const pos = paramPosition(param, value);
      const deg = A0 + SWEEP * pos;
      fill.setAttribute('d', arc(A0, deg));
      const [x0, y0] = polar(deg, 2.2);
      const [x1, y1] = polar(deg, 6.2);
      needle.setAttribute('x1', String(x0));
      needle.setAttribute('y1', String(y0));
      needle.setAttribute('x2', String(x1));
      needle.setAttribute('y2', String(y1));
      const text = formatParam(param, value);
      readout.textContent = text;
      root.setAttribute('aria-valuenow', String(value));
      root.setAttribute('aria-valuetext', text);
    };
    redraw();

    const nudge = (delta: number): void => set(paramValue(param, paramPosition(param, value) + delta), true);

    // Drag up and down, the way every plugin knob works; Shift for fine control.
    let dragY = 0;
    let dragPos = 0;
    let dragging = false;
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      dragging = true;
      dragY = e.clientY;
      dragPos = paramPosition(param, value);
      root.setPointerCapture(e.pointerId);
      root.focus();
      e.preventDefault();
    });
    root.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const span = e.shiftKey ? 900 : 180;
      const pos = dragPos + (dragY - e.clientY) / span;
      const next = bound(paramValue(param, pos));
      if (next !== value) set(next, true);
    });
    const release = (e: PointerEvent): void => {
      dragging = false;
      if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    root.addEventListener('dblclick', () => set(param.initial, true));
    root.addEventListener('wheel', (e) => {
      e.preventDefault();
      nudge(-e.deltaY * (e.shiftKey ? 0.0002 : 0.001));
    }, { passive: false });
    root.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 0.1 : 0.01;
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') nudge(step);
      else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') nudge(-step);
      else if (e.key === 'Home') set(lo, true);
      else if (e.key === 'End') set(hi, true);
      else return;
      e.preventDefault();
    });
    root.addEventListener('focus', () => { if (root.matches(':focus-visible')) focus.setAttribute('opacity', '0.9'); });
    root.addEventListener('blur', () => focus.setAttribute('opacity', '0'));
    el = root;
  }

  return {
    el,
    signalIns: [],
    signalOuts: [],
    controlIns: [message],
    onControlOut: o.onControlOut,
    start: output,
  } satisfies MaxNode;
});
