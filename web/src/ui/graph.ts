// Read-only node-graph renderer for the player. Lays out each object from its
// patch coordinates, sizes boxes to their content (and widgets to a usable size),
// draws curved cords coloured by domain, and mounts interactive widgets in place.

import type { IRNode, IRPatch } from '../ir/types';
import { isSupported, type MaxNode } from '../engine/registry';

const DOMAIN_COLOR: Record<string, string> = {
  signal: '#e8b73e', // amber — audio, like Max signal cords
  control: '#5aa9e6', // blue — control/message
  video: '#a882e6', // purple — jitter
};

// Usable on-screen sizes for interactive widgets (their Max box is far too small).
const WIDGET_SIZE: Record<string, [number, number]> = {
  slider: [136, 24], dial: [50, 50], rslider: [136, 34], kslider: [176, 46],
  nslider: [76, 34], incdec: [28, 36], number: [60, 24], flonum: [66, 24],
  'number~': [66, 24], toggle: [26, 26], button: [26, 26], bng: [26, 26],
  led: [20, 20], umenu: [130, 26], tab: [150, 28], matrixctrl: [128, 128],
  multislider: [150, 64], comment: [130, 22], panel: [90, 64],
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

interface Box {
  x: number; y: number; w: number; h: number;
  node: IRNode;
  widget?: HTMLElement;
}

/** ~monospace 11px advance. */
const textWidth = (s: string) => Math.ceil(s.length * 6.7);

/** Which colour to accent a node by (its primary output domain). */
function nodeDomain(n: IRNode): 'signal' | 'control' | 'video' | 'sink' {
  if (n.outletDomains.includes('signal')) return 'signal';
  if (n.outletDomains.includes('video')) return 'video';
  if (n.numOutlets === 0) return 'sink';
  return 'control';
}

function widgetDims(node: IRNode, widget: HTMLElement): [number, number] {
  const known = WIDGET_SIZE[node.className];
  if (known) return known;
  if (typeof HTMLCanvasElement !== 'undefined' && widget instanceof HTMLCanvasElement) {
    return [Math.max(widget.width, 48), Math.max(widget.height, 36)];
  }
  return [Math.max(node.rect[2], 90), Math.max(node.rect[3], 24)];
}

/** Port centre x on a box edge, spread across the width. */
function portX(b: Box, index: number, count: number): number {
  if (count <= 1) return b.x + b.w / 2;
  const inset = Math.min(10, b.w / 4);
  return b.x + inset + ((b.w - 2 * inset) * index) / (count - 1);
}

export function renderGraph(
  container: HTMLElement,
  patch: IRPatch,
  built?: Map<string, MaxNode>
): void {
  container.innerHTML = '';

  // 1. Lay out: content-sized boxes, widgets at a usable size.
  const boxes = new Map<string, Box>();
  for (const n of patch.nodes) {
    const widget = built?.get(n.id)?.el ?? undefined;
    let w: number, h: number;
    if (widget) {
      [w, h] = widgetDims(n, widget);
    } else {
      w = Math.max(textWidth(n.text || n.className) + 18, 38);
      h = 26;
    }
    boxes.set(n.id, { x: n.rect[0], y: n.rect[1], w, h, node: n, widget });
  }

  // 2. Normalise origin to a small padding, compute canvas size.
  const pad = 28;
  const all = [...boxes.values()];
  const minX = Math.min(...all.map((b) => b.x));
  const minY = Math.min(...all.map((b) => b.y));
  for (const b of boxes.values()) { b.x += pad - minX; b.y += pad - minY; }
  const width = Math.max(...all.map((b) => b.x + b.w)) + pad;
  const height = Math.max(...all.map((b) => b.y + b.h)) + pad;

  const root = svg('svg', { width, height, class: 'patch-graph', viewBox: `0 0 ${width} ${height}` });

  // 3. Cords (curved) beneath the boxes.
  const cords = svg('g', { class: 'cords' });
  for (const e of patch.edges) {
    const src = boxes.get(e.from.id);
    const dst = boxes.get(e.to.id);
    if (!src || !dst) continue;
    const x1 = portX(src, e.from.outlet, src.node.numOutlets);
    const y1 = src.y + src.h;
    const x2 = portX(dst, e.to.inlet, dst.node.numInlets);
    const y2 = dst.y;
    const dy = Math.max(18, Math.abs(y2 - y1) * 0.4);
    const color = DOMAIN_COLOR[e.domain] ?? '#888';
    cords.appendChild(
      svg('path', {
        d: `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`,
        fill: 'none',
        stroke: color,
        'stroke-width': e.domain === 'signal' ? 3 : 1.6,
        'stroke-opacity': 0.85,
        'stroke-linecap': 'round',
      })
    );
  }
  root.appendChild(cords);

  // 4. Boxes + widgets on top.
  for (const b of boxes.values()) {
    const { x, y, w, h, node, widget } = b;

    if (widget) {
      // A caption so a bare slider/dial reads as something.
      const cap = svg('text', { x: x + 1, y: y - 5, class: 'node-caption' });
      cap.textContent = node.text || node.className;
      root.appendChild(cap);
      const fo = svg('foreignObject', { x, y, width: w, height: h, class: 'widget-host' });
      widget.classList.add('max-widget');
      fo.appendChild(widget);
      root.appendChild(fo);
      continue;
    }

    const domain = nodeDomain(node);
    const impl = isSupported(node.className);
    const g = svg('g', { class: `node node-${domain}${impl ? '' : ' node-stub'}` });
    g.appendChild(svg('rect', { x, y, width: w, height: h, rx: 5, class: 'node-body' }));
    // left accent bar in the domain colour
    g.appendChild(
      svg('rect', { x, y, width: 3.5, height: h, rx: 0, fill: DOMAIN_COLOR[domain] ?? '#7a828c' })
    );
    const label = svg('text', { x: x + 10, y: y + h / 2 + 4, class: 'node-label' });
    label.textContent = node.text || node.className;
    g.appendChild(label);
    root.appendChild(g);
  }

  container.appendChild(root);
}
