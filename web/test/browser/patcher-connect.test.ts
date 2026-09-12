// Drawing a cord: outlet to inlet, inlet to outlet, and the two refusals.
//
// The gesture is the reason the ports live in their own SVG layer above the boxes and
// the reason hit testing is DOM delegation, so the assertions here are deliberately
// about what is ON THE CANVAS mid-gesture — a rubber cord that exists, and carries the
// styling of the verdict — and not only about the document afterwards. A cord that
// silently refuses to attach, with no visible reason, is the failure mode that makes an
// editor feel broken; this test is what says the reason is shown.

import { afterEach, describe, expect, it } from 'vitest';
import {
  down,
  editorInput,
  mountPatcher,
  move,
  patchToClient,
  portCentre,
  press,
  typeInto,
  up,
  type Mounted,
} from './helpers/gestures';

let m: Mounted;

afterEach(() => m?.destroy());

const rubberCord = (mm: Mounted) => mm.svg.querySelector<SVGPathElement>('.overlay-cord');

describe('patcher: cords', () => {
  it('an outlet-to-inlet drag draws a live cord and commits exactly one edge', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    const amp = m.doc.addBox('*~ 0.2', 80, 240);

    const from = portCentre(m, osc.id, 'out', 0);
    const to = portCentre(m, amp.id, 'in', 0);

    down(m, from);
    move(m, { clientX: (from.clientX + to.clientX) / 2, clientY: (from.clientY + to.clientY) / 2 });
    const rubber = rubberCord(m);
    expect(rubber, 'a cord is drawn while the pointer is still down').not.toBeNull();
    expect(rubber!.getAttribute('d')).toMatch(/^M /);
    // Signal cords are amber, and the preview says so before the cord is committed.
    expect(rubber!.getAttribute('stroke')).toBe('#e8b73e');

    move(m, to);
    up(m, to);

    expect(m.doc.edgeCount).toBe(1);
    expect(rubberCord(m), 'the overlay is cleared on release').toBeNull();
    const edge = [...m.doc.edges()][0];
    expect(edge.from).toEqual({ id: osc.id, outlet: 0 });
    expect(edge.to).toEqual({ id: amp.id, inlet: 0 });
    expect(edge.domain).toBe('signal');
  });

  it('dragging from an INLET back to an outlet makes the same cord', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    const amp = m.doc.addBox('*~ 0.2', 80, 240);

    const from = portCentre(m, amp.id, 'in', 0);
    const to = portCentre(m, osc.id, 'out', 0);
    down(m, from);
    move(m, to);
    up(m, to);

    expect(m.doc.edgeCount).toBe(1);
    const edge = [...m.doc.edges()][0];
    // The commit sorts the ends out: a cord always runs outlet -> inlet however it was
    // drawn, so the document never has to know which way the hand moved.
    expect(edge.from).toEqual({ id: osc.id, outlet: 0 });
    expect(edge.to).toEqual({ id: amp.id, inlet: 0 });
  });

  it('a refused pair shows the invalid style, creates nothing, and says why', async () => {
    m = await mountPatcher();
    // jit.noise's left outlet carries a jit_matrix; cycle~'s left inlet is documented
    // signal. There is no transport in engine.ts that could carry one to the other.
    const video = m.doc.addBox('jit.noise', 340, 80);
    const osc = m.doc.addBox('cycle~', 340, 260);

    const from = portCentre(m, video.id, 'out', 0);
    const to = portCentre(m, osc.id, 'in', 0);
    down(m, from);
    move(m, to);

    const rubber = rubberCord(m)!;
    expect(rubber.classList.contains('refused')).toBe(true);
    expect(rubber.getAttribute('stroke')).toBe('#e8736b');
    expect(rubber.getAttribute('stroke-dasharray')).toBe('5 4');

    up(m, to);

    expect(m.doc.edgeCount).toBe(0);
    expect(m.status.join(' | ')).toMatch(/jit_matrix/);
  });

  it('dropping on empty canvas opens a pre-wired editor whose commit makes box AND cord', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);

    const from = portCentre(m, osc.id, 'out', 0);
    const empty = patchToClient(m.view, { x: 320, y: 300 });
    down(m, from);
    move(m, empty);
    up(m, empty);

    const input = editorInput(m);
    expect(input, 'a drop on nothing opens an editor for the next object').not.toBeNull();
    // The box is there to type into; the cord waits for the arity the text will decide.
    expect(m.doc.nodeCount).toBe(2);
    expect(m.doc.edgeCount).toBe(0);

    typeInto(input!, '*~ 0.2');
    press(m, 'Enter', { target: input! });

    expect(m.doc.nodeCount).toBe(2);
    expect(m.doc.edgeCount).toBe(1);
    const edge = [...m.doc.edges()][0];
    expect(edge.from).toEqual({ id: osc.id, outlet: 0 });
    expect(m.doc.node(edge.to.id)?.className).toBe('*~');
    expect(edge.to.inlet).toBe(0);
  });

  it('a cord dropped on the same outlet it came from creates nothing', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    const at = portCentre(m, osc.id, 'out', 0);
    down(m, at);
    move(m, at);
    up(m, at);
    expect(m.doc.edgeCount).toBe(0);
  });
});
