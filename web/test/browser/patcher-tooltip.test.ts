// The port assist tip: the answer to "what does this inlet do?".
//
// Real Chromium because the whole thing is `elementFromPoint`-shaped hover routing over
// an SVG under a transform, plus a timer. The assertions are about the three properties
// that decide whether a tooltip helps or hurts: it says something TRUE about the port
// actually under the cursor, it never intercepts the gesture it is explaining, and it
// gets out of the way the moment a gesture starts.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadObjDocs } from '../../src/ir/connect';
import { attachPortTips } from '../../src/ui/tooltip';
import { mountPatcher, portCentre, type Mounted } from './helpers/gestures';

let m: Mounted;
let detach: (() => void) | null = null;

beforeEach(async () => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  detach?.();
  detach = null;
  m?.destroy();
});

const tipEl = () => document.querySelector<HTMLElement>('.port-tip');

/** Hover a port, wait past the dwell, and return the tip's text (or '' if hidden). */
function hover(mm: Mounted, id: string, dir: 'in' | 'out', index: number): string {
  const at = portCentre(mm, id, dir, index);
  const target = document.elementFromPoint(at.clientX, at.clientY) ?? mm.svg;
  target.dispatchEvent(
    new PointerEvent('pointerover', { ...at, bubbles: true, composed: true, pointerId: 1 }),
  );
  vi.advanceTimersByTime(400);
  const tip = tipEl();
  return tip && !tip.hidden ? (tip.textContent ?? '') : '';
}

describe('patcher: port tips', () => {
  it('names the object, the port, and what the port is for', async () => {
    // Real timers for the async setup; the hover itself runs on fake ones.
    vi.useRealTimers();
    m = await mountPatcher();
    await loadObjDocs();
    vi.useFakeTimers();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    detach = attachPortTips({ svg: m.svg, doc: () => m.doc });

    expect(hover(m, osc.id, 'in', 0)).toMatch(/cycle~ · inlet 0[\s\S]*Frequency/);
    // Inlet 1 is the one nothing on the canvas could ever have told you about.
    expect(hover(m, osc.id, 'in', 1)).toMatch(/inlet 1[\s\S]*Phase/);
    expect(hover(m, osc.id, 'out', 0)).toMatch(/outlet 0/);
  });

  it('prints the type only when the corpus really has one', async () => {
    vi.useRealTimers();
    m = await mountPatcher();
    await loadObjDocs();
    vi.useFakeTimers();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    const scale = m.doc.addBox('scale 0 127 0. 1.', 300, 80);
    detach = attachPortTips({ svg: m.svg, doc: () => m.doc });

    // cycle~'s inlets carry a real type string, so it is shown…
    expect(hover(m, osc.id, 'in', 0)).toContain('signal/float');
    // …while scale's carry the unfilled doc-template placeholder, which must not be.
    // 1400 of the 3373 documented ports say INLET_TYPE / OUTLET_TYPE and nothing else.
    const text = hover(m, scale.id, 'in', 2);
    expect(text).toContain('input range high');
    expect(text).not.toContain('INLET_TYPE');
  });

  it('follows an alias to the canonical object documentation', async () => {
    vi.useRealTimers();
    m = await mountPatcher();
    await loadObjDocs();
    vi.useFakeTimers();
    // `t b f` is the shape the plan calls out: two typed outlets, and an alias.
    const trig = m.doc.addBox('t b f', 80, 80);
    detach = attachPortTips({ svg: m.svg, doc: () => m.doc });

    const text = hover(m, trig.id, 'out', 0);
    expect(text).toContain('outlet 0');
    expect(text.length, 'an alias fell back to bare geometry').toBeGreaterThan(12);
  });

  it('never intercepts the pointer, and hides the moment a gesture starts', async () => {
    vi.useRealTimers();
    m = await mountPatcher();
    await loadObjDocs();
    vi.useFakeTimers();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    detach = attachPortTips({ svg: m.svg, doc: () => m.doc });

    const at = portCentre(m, osc.id, 'out', 0);
    expect(hover(m, osc.id, 'out', 0)).not.toBe('');

    // The port is still what the browser reports at that pixel — a tip that shadowed it
    // would break the one gesture the patcher exists for.
    const under = document.elementFromPoint(at.clientX, at.clientY);
    expect(under?.closest('[data-port]')).not.toBeNull();

    m.svg.dispatchEvent(
      new PointerEvent('pointerdown', { ...at, bubbles: true, composed: true, pointerId: 1 }),
    );
    expect(tipEl()!.hidden, 'the tip floated over a gesture in progress').toBe(true);
  });

  it('leaves nothing on the page when detached', async () => {
    vi.useRealTimers();
    m = await mountPatcher();
    vi.useFakeTimers();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    const off = attachPortTips({ svg: m.svg, doc: () => m.doc });
    expect(tipEl()).not.toBeNull();
    hover(m, osc.id, 'in', 0);

    off();
    expect(tipEl(), 'the tip element outlived its view').toBeNull();
  });
});
