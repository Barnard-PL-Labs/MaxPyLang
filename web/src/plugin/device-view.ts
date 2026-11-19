// The two faces of the device: presentation (what Ableton shows) and the patch behind it.
//
// Both are drawn straight from the patcher JSON maxpylang produced, so what is on screen
// is what is in the file. The presentation view places every box that has
// `presentation: 1` at its `presentation_rect`; the patch view places every box at its
// `patching_rect` and draws the cords.
//
// Dials are not drawn here. Each live.dial is the widget the running engine built for
// that box, mounted into its slot, so turning it changes the sound through the same
// cords the patch has.

import type { MaxNode } from '../engine/registry';
import type { IRNode, IRPatch } from '../ir/types';
import { liveParam } from '../objects/ui/live-param';
import { cordPath, inletPoint, outletPoint, textWidth, type LaidBox } from '../ui/layout';

const SVG = 'http://www.w3.org/2000/svg';

/** A Live device is this tall; fxgen lays its cards out against the same number. */
export const DEVICE_HEIGHT = 169;

type Box = Record<string, unknown>;

function rgba(v: unknown, fallback: string): string {
  if (!Array.isArray(v) || v.length < 3) return fallback;
  const [r, g, b, a = 1] = v.map(Number);
  if (![r, g, b, a].every(Number.isFinite)) return fallback;
  const c = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 255);
  return `rgba(${c(r)}, ${c(g)}, ${c(b)}, ${a})`;
}

function boxesOf(json: unknown): Box[] {
  const boxes = (json as { patcher?: { boxes?: { box?: Box }[] } })?.patcher?.boxes ?? [];
  return boxes.map((b) => b.box).filter((b): b is Box => !!b);
}

/**
 * Draw the presentation view into `host`. Returns the device's natural width; the
 * caller scales the host to fit its stage.
 */
export function renderDevice(host: HTMLElement, json: unknown, built: ReadonlyMap<string, MaxNode>): number {
  host.replaceChildren();
  const shown = boxesOf(json).filter((b) => Number(b.presentation) === 1 && Array.isArray(b.presentation_rect));
  // Max paints `background` boxes under everything else.
  shown.sort((a, b) => Number(b.background ?? 0) - Number(a.background ?? 0));

  let width = Number((json as { patcher?: { devicewidth?: number } })?.patcher?.devicewidth) || 0;
  for (const box of shown) {
    const [x, y, w, h] = (box.presentation_rect as number[]).map(Number);
    width = Math.max(width, x + w);
    const el = document.createElement('div');
    el.style.cssText = `position:absolute;left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
    switch (box.maxclass) {
      case 'panel':
        el.className = 'dv-panel';
        el.style.background = rgba(box.bgcolor, '#1c1e23');
        el.style.borderRadius = `${Number(box.rounded ?? 0)}px`;
        break;
      case 'live.comment':
      case 'comment': {
        el.className = 'dv-label';
        el.textContent = String(box.text ?? '');
        el.style.fontSize = `${Number(box.fontsize ?? 10)}px`;
        el.style.fontWeight = Number(box.fontface ?? 0) === 1 ? '700' : '400';
        el.style.color = rgba(box.textcolor, '#d5d9e0');
        el.style.textAlign = Number(box.textjustification ?? 0) === 1 ? 'center' : 'left';
        el.style.lineHeight = `${h}px`;
        break;
      }
      default: {
        const widget = built.get(String(box.id))?.el;
        if (!widget) continue;
        el.className = 'dv-widget';
        el.appendChild(widget);
      }
    }
    host.appendChild(el);
  }
  host.style.width = `${width}px`;
  host.style.height = `${DEVICE_HEIGHT}px`;
  return width;
}

// ── patch view ──────────────────────────────────────────────────────────────────

/** Boxes that exist only to dress the presentation view; the patch view leaves them out. */
const DRESSING = new Set(['panel', 'live.comment']);

function label(node: IRNode): string {
  if (node.maxclass === 'live.dial') return liveParam(node.raw, 'live.dial').longname;
  if (node.maxclass === 'comment') return String(node.raw?.text ?? node.text);
  return node.text || node.className;
}

function mk<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent.appendChild(e);
  return e;
}

/** Draw the patching view into `host` as one SVG. Returns how many boxes were left out. */
export function renderPatch(host: HTMLElement, patch: IRPatch): number {
  host.replaceChildren();
  const laid = new Map<string, LaidBox>();
  let hidden = 0;
  for (const node of patch.nodes) {
    if (DRESSING.has(node.maxclass)) { hidden++; continue; }
    const [x, y, w, h] = node.rect;
    const isDial = node.maxclass === 'live.dial';
    const isComment = node.maxclass === 'comment';
    const width = isDial ? Math.max(w, textWidth(label(node)) + 30) : Math.max(isComment ? 0 : w, textWidth(label(node)) + 14);
    laid.set(node.id, { x, y, w: width, h: isDial ? 30 : Math.max(22, Math.min(h, 22)), node, authoredRect: [...node.rect] });
  }

  let maxX = 0;
  let maxY = 0;
  for (const b of laid.values()) {
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  const pad = 28;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${maxX + pad} ${maxY + pad}`);
  svg.setAttribute('width', String(maxX + pad));
  svg.setAttribute('height', String(maxY + pad));
  svg.classList.add('pv');

  const cords = mk(svg, 'g', { class: 'pv-cords' });
  for (const edge of patch.edges) {
    const from = laid.get(edge.from.id);
    const to = laid.get(edge.to.id);
    if (!from || !to) continue;
    mk(cords, 'path', {
      d: cordPath(outletPoint(from, edge.from.outlet), inletPoint(to, edge.to.inlet)),
      class: edge.domain === 'signal' ? 'pv-cord is-signal' : 'pv-cord',
    });
  }

  const boxes = mk(svg, 'g', { class: 'pv-boxes' });
  for (const b of laid.values()) {
    const g = mk(boxes, 'g', { transform: `translate(${b.x} ${b.y})` });
    const text = label(b.node);
    if (b.node.maxclass === 'comment') {
      mk(g, 'text', { x: 0, y: 15, class: 'pv-comment' }).textContent = text;
      continue;
    }
    const isDial = b.node.maxclass === 'live.dial';
    const isSignal = b.node.outletDomains.includes('signal') || b.node.className.endsWith('~');
    mk(g, 'rect', { width: b.w, height: b.h, rx: 4, class: `pv-box${isSignal ? ' is-signal' : ''}${isDial ? ' is-dial' : ''}` });
    if (isDial) {
      mk(g, 'circle', { cx: 15, cy: 15, r: 7.5, class: 'pv-knob' });
      mk(g, 'line', { x1: 15, y1: 15, x2: 19.5, y2: 10.5, class: 'pv-knob-needle' });
    }
    mk(g, 'text', { x: isDial ? 29 : 7, y: b.h / 2 + 4, class: 'pv-text' }).textContent = text;
    for (let i = 0; i < b.node.numInlets; i++) {
      const p = inletPoint(b, i);
      mk(g, 'rect', { x: p.x - b.x - 3.5, y: -1, width: 7, height: 3, rx: 1, class: 'pv-port' });
    }
    for (let i = 0; i < b.node.numOutlets; i++) {
      const p = outletPoint(b, i);
      mk(g, 'rect', { x: p.x - b.x - 3.5, y: b.h - 2, width: 7, height: 3, rx: 1, class: `pv-port${b.node.outletDomains[i] === 'signal' ? ' is-signal' : ''}` });
    }
  }

  host.appendChild(svg);
  return hidden;
}

// ── code view ───────────────────────────────────────────────────────────────────

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const KEYWORDS = /\b(import|as|def|return|if|else|for|in|None|True|False)\b/g;

/** Light syntax colouring for the generated script. One line at a time, no parser. */
export function highlightPython(source: string): string {
  let inDoc = false;
  return source
    .split('\n')
    .map((line) => {
      const quotes = (line.match(/"""|'''/g) ?? []).length;
      if (inDoc || quotes > 0) {
        if (quotes % 2 === 1) inDoc = !inDoc;
        return `<span class="c-str">${esc(line)}</span>`;
      }
      const hash = commentStart(line);
      const code = hash < 0 ? line : line.slice(0, hash);
      const comment = hash < 0 ? '' : line.slice(hash);
      const parts: string[] = [];
      let last = 0;
      for (const m of code.matchAll(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g)) {
        parts.push(plain(code.slice(last, m.index)));
        parts.push(`<span class="c-str">${esc(m[0])}</span>`);
        last = (m.index ?? 0) + m[0].length;
      }
      parts.push(plain(code.slice(last)));
      const tail = comment
        ? `<span class="c-com">${esc(comment).replace(/gap (M4L-\d+)/g, '<span class="c-gap">gap $1</span>')}</span>`
        : '';
      return parts.join('') + tail;
    })
    .join('\n');
}

function plain(s: string): string {
  return esc(s)
    .replace(/(?<![\w.])(-?\d+\.?\d*)(?![\w])/g, '<span class="c-num">$1</span>')
    .replace(KEYWORDS, '<span class="c-kw">$1</span>');
}

/** Index of the `#` that starts a comment, ignoring any inside a string. */
function commentStart(line: string): number {
  let quote = '';
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '#') return i;
  }
  return -1;
}
