// Minimal read-only node-graph renderer. Draws each object at its patch coords
// and colours cords by domain. Unsupported objects get a dashed outline.

import type { IRPatch } from '../ir/types';
import { isSupported, type MaxNode } from '../engine/registry';

const DOMAIN_COLOR: Record<string, string> = {
  signal: '#e0b341', // yellow-ish, like Max signal cords
  control: '#5a9bd4',
  video: '#8e6fd0',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

/** Port position (x,y) on a box edge, spread evenly across the width. */
function portX(rect: number[], index: number, count: number): number {
  const [x, , w] = rect;
  if (count <= 1) return x + w / 2;
  return x + (w * index) / (count - 1);
}

export function renderGraph(
  container: HTMLElement,
  patch: IRPatch,
  built?: Map<string, MaxNode>
): void {
  container.innerHTML = '';

  const pad = 40;
  const maxX = Math.max(...patch.nodes.map((n) => n.rect[0] + n.rect[2]), 200) + pad;
  const maxY = Math.max(...patch.nodes.map((n) => n.rect[1] + n.rect[3]), 200) + pad;

  const svg = el('svg', { width: maxX, height: maxY, class: 'patch-graph' });

  // cords first so boxes draw on top
  for (const e of patch.edges) {
    const src = patch.byId.get(e.from.id);
    const dst = patch.byId.get(e.to.id);
    if (!src || !dst) continue;
    const x1 = portX(src.rect, e.from.outlet, src.numOutlets);
    const y1 = src.rect[1] + src.rect[3];
    const x2 = portX(dst.rect, e.to.inlet, dst.numInlets);
    const y2 = dst.rect[1];
    svg.appendChild(
      el('line', {
        x1, y1, x2, y2,
        stroke: DOMAIN_COLOR[e.domain] ?? '#888',
        'stroke-width': e.domain === 'signal' ? 2.5 : 1.5,
      })
    );
  }

  for (const n of patch.nodes) {
    const [x, y, w, h] = n.rect;
    const width = Math.max(w, 30);
    const height = Math.max(h, 18);

    // If the built object provides a DOM widget (slider, dial, number box…),
    // mount it in place via a foreignObject instead of the default box.
    const widget = built?.get(n.id)?.el;
    if (widget) {
      const fo = el('foreignObject', { x, y, width, height });
      fo.appendChild(widget);
      svg.appendChild(fo);
      continue;
    }

    const supported = isSupported(n.className);
    const g = el('g', {});
    g.appendChild(
      el('rect', {
        x, y, width, height, rx: 3,
        fill: supported ? '#2c2c2c' : '#3a2020',
        stroke: supported ? '#666' : '#a55',
        'stroke-dasharray': supported ? '0' : '4 3',
      })
    );
    const label = el('text', {
      x: x + 5, y: y + height / 2 + 4, fill: '#ddd', 'font-size': 11,
      'font-family': 'monospace',
    });
    label.textContent = n.text || n.className;
    g.appendChild(label);
    svg.appendChild(g);
  }

  container.appendChild(svg);
}
