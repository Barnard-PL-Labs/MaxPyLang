// Read-only node-graph renderer for the player. Every coordinate — box sizes, port
// positions, cord curves, the canvas origin — comes from ui/layout.ts; what's left here
// is the DOM half: build the SVG, colour it by domain, and mount interactive widgets in
// place. The renderer owns the one-shot origin shift, because only a fixed-size canvas
// that is rebuilt wholesale can afford to move every box at once.

import type { IRPatch } from '../ir/types';
import { isSupported, type MaxNode } from '../engine/registry';
import {
  cordPath, DOMAIN_COLOR, GRAPH_PAD, inletPoint, layout, nodeDomain, normalizeOrigin,
  outletPoint, SELF_LABELLED,
} from './layout';

const SVG_NS = 'http://www.w3.org/2000/svg';

function svg<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

export function renderGraph(
  container: HTMLElement,
  patch: IRPatch,
  built?: Map<string, MaxNode>
): void {
  container.innerHTML = '';

  // 1. Lay out in patch coordinates, then frame it: origin at a small padding.
  const widgets = new Map<string, HTMLElement>();
  if (built) for (const [id, node] of built) if (node.el) widgets.set(id, node.el);
  const boxes = layout(patch, widgets);
  const { width, height } = normalizeOrigin(boxes.values(), GRAPH_PAD);

  const root = svg('svg', { width, height, class: 'patch-graph', viewBox: `0 0 ${width} ${height}` });

  // 2. Cords (curved) beneath the boxes.
  const cords = svg('g', { class: 'cords' });
  for (const e of patch.edges) {
    const src = boxes.get(e.from.id);
    const dst = boxes.get(e.to.id);
    if (!src || !dst) continue;
    const color = DOMAIN_COLOR[e.domain] ?? '#888';
    cords.appendChild(
      svg('path', {
        d: cordPath(outletPoint(src, e.from.outlet), inletPoint(dst, e.to.inlet)),
        fill: 'none',
        stroke: color,
        'stroke-width': e.domain === 'signal' ? 3 : 1.6,
        'stroke-opacity': 0.85,
        'stroke-linecap': 'round',
      })
    );
  }
  root.appendChild(cords);

  // 3. Boxes + widgets on top.
  for (const b of boxes.values()) {
    const { x, y, w, h, node, widget } = b;

    if (widget) {
      // A caption so a bare slider/dial reads as something — but not over a widget that
      // already draws its own text (a message box, a comment), which would print it
      // twice, once above the box and once inside it.
      if (!SELF_LABELLED.has(node.className)) {
        const cap = svg('text', { x: x + 1, y: y - 5, class: 'node-caption' });
        cap.textContent = node.text || node.className;
        root.appendChild(cap);
      }
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
