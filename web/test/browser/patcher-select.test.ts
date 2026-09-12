// Selecting and moving: click, shift-click, marquee, drag, nudge, delete.
//
// The load-bearing assertion in this file is the undo one. A drag emits one `set-rect`
// op per pointermove, and the whole ops-document design exists so that sixty of them
// still cost the user exactly one ⌘Z and cost the engine nothing at all. If that ever
// regresses it will regress silently — the patch will look right and only undo will be
// wrong — so it is pinned here by label AND by asserting that a single undo puts every
// box in the selection back where it started.
//
// The marquee is pinned as INTERSECT, not contain, because that is what Max does and
// because "contain" selects nothing useful on a patch laid out at normal density.

import { afterEach, describe, expect, it } from 'vitest';
import {
  boxCentre,
  click,
  down,
  drag,
  makeTestWidget,
  mountPatcher,
  move,
  patchToClient,
  press,
  up,
  type Mounted,
} from './helpers/gestures';

let m: Mounted;

afterEach(() => m?.destroy());

/** Five boxes: three in a left column, two well off to the right. */
async function fiveBoxes(): Promise<string[]> {
  m = await mountPatcher();
  return [
    m.doc.addBox('cycle~ 440', 40, 40).id,
    m.doc.addBox('cycle~ 441', 40, 120).id,
    m.doc.addBox('cycle~ 442', 40, 200).id,
    m.doc.addBox('cycle~ 443', 360, 40).id,
    m.doc.addBox('cycle~ 444', 360, 120).id,
  ];
}

const originOf = (mm: Mounted, id: string): [number, number] => {
  const rect = mm.doc.node(id)!.rect;
  return [rect[0], rect[1]];
};

describe('patcher: selection', () => {
  it('click selects one box; shift-click adds a second', async () => {
    const ids = await fiveBoxes();

    click(m, boxCentre(m, ids[0]));
    expect([...m.view.selection]).toEqual([ids[0]]);

    click(m, boxCentre(m, ids[1]), { shiftKey: true });
    expect(new Set(m.view.selection)).toEqual(new Set([ids[0], ids[1]]));

    // A plain click elsewhere replaces the selection rather than extending it.
    click(m, boxCentre(m, ids[3]));
    expect([...m.view.selection]).toEqual([ids[3]]);
  });

  it('a marquee selects every box it TOUCHES — three of five', async () => {
    const ids = await fiveBoxes();

    // The sweep starts above/left of the left column and ends part-way THROUGH the
    // third box: intersect semantics must still take it.
    const from = patchToClient(m.view, { x: 24, y: 24 });
    const to = patchToClient(m.view, { x: 70, y: 210 });
    down(m, from);
    move(m, { clientX: (from.clientX + to.clientX) / 2, clientY: (from.clientY + to.clientY) / 2 });
    expect(m.svg.querySelector('.overlay-marquee'), 'the marquee is drawn').not.toBeNull();
    move(m, to);
    up(m, to);

    expect(new Set(m.view.selection)).toEqual(new Set([ids[0], ids[1], ids[2]]));
    expect(m.svg.querySelector('.overlay-marquee')).toBeNull();
  });

  it('dragging a multi-selection moves every box as ONE undo entry', async () => {
    const ids = await fiveBoxes();
    const picked = [ids[0], ids[1], ids[2]];
    const before = picked.map((id) => originOf(m, id));

    // Marquee the left column, then press on one of the already-selected boxes: the
    // gesture must drag the whole selection, not reselect the box under the pointer.
    const sweepFrom = patchToClient(m.view, { x: 24, y: 24 });
    const sweepTo = patchToClient(m.view, { x: 70, y: 230 });
    down(m, sweepFrom);
    move(m, sweepTo);
    up(m, sweepTo);
    expect(m.view.selection.size).toBe(3);

    const grab = boxCentre(m, ids[1]);
    drag(m, grab, { clientX: grab.clientX + 80, clientY: grab.clientY + 40 });

    expect(m.view.selection.size).toBe(3);
    picked.forEach((id, i) => {
      expect(originOf(m, id)).toEqual([before[i][0] + 80, before[i][1] + 40]);
    });
    expect(m.doc.undoLabel).toBe('Move 3 boxes');

    m.doc.undo();
    picked.forEach((id, i) => expect(originOf(m, id)).toEqual(before[i]));
  });

  it('a drag snaps to the 8px grid', async () => {
    m = await mountPatcher();
    const id = m.doc.addBox('cycle~ 440', 40, 40).id;

    const grab = boxCentre(m, id);
    drag(m, grab, { clientX: grab.clientX + 13, clientY: grab.clientY });
    // 40 + 13 = 53, which snaps to 56 — the nearest multiple of 8.
    expect(originOf(m, id)[0]).toBe(56);
  });

  it('⌥-drag duplicates: the original stays put and the copy moves off the grid', async () => {
    m = await mountPatcher();
    const id = m.doc.addBox('cycle~ 440', 40, 40).id;

    const grab = boxCentre(m, id);
    drag(m, grab, { clientX: grab.clientX + 13, clientY: grab.clientY }, { altKey: true });

    expect(m.doc.nodeCount).toBe(2);
    expect(originOf(m, id)).toEqual([40, 40]);
    const copy = [...m.doc.nodes()].find((n) => n.id !== id)!;
    // ⌥ means "unconstrained": the copy lands where the pointer was, not on the grid.
    expect(copy.rect[0]).toBe(53);
    expect(copy.text).toBe('cycle~ 440');
    expect([...m.view.selection]).toEqual([copy.id]);
  });

  it('⌥-drag is ONE undo entry, so a single ⌘Z removes the copy', async () => {
    m = await mountPatcher();
    const id = m.doc.addBox('cycle~ 440', 40, 40).id;

    const grab = boxCentre(m, id);
    drag(m, grab, { clientX: grab.clientX + 60, clientY: grab.clientY + 20 }, { altKey: true });
    expect(m.doc.nodeCount).toBe(2);

    // The clone and the move that follows it are one action in Max. Split in two, the
    // first ⌘Z parked the copy pixel-exactly on top of the original: the canvas looked
    // like one box while the document held two, and every later edit was a coin toss
    // about which of them it landed on.
    expect(m.doc.undoLabel).toBe('Duplicate');
    m.doc.undo();
    expect(m.doc.nodeCount).toBe(1);
    expect(originOf(m, id)).toEqual([40, 40]);
  });

  it('a drag leaves the mounted widget and its host element untouched', async () => {
    // The single most important property of the renderer, and the one a move is most
    // likely to break by accident: a set-rect must write a transform and nothing else.
    // Re-creating the <foreignObject> would keep every position correct and still lose
    // focus, cancel an in-flight pointer capture and restart CSS transitions.
    m = await mountPatcher();
    const id = m.doc.addBox('slider', 80, 80).id;
    const widget = makeTestWidget();
    m.widgets.set(id, widget);
    m.refreshWidgets();

    const host = m.svg.querySelector('.widget-host');
    expect(host, 'the widget never mounted').not.toBeNull();
    expect(host!.firstElementChild).toBe(widget);

    const grab = boxCentre(m, id);
    drag(m, grab, { clientX: grab.clientX + 96, clientY: grab.clientY + 48 });
    expect(m.doc.node(id)!.rect[0]).not.toBe(80); // the drag really happened

    expect(m.svg.querySelector('.widget-host'), 'the host was re-created').toBe(host);
    expect(host!.firstElementChild, 'the widget was re-parented').toBe(widget);

    // An arrow nudge takes the same set-rect path and must cost the same nothing.
    press(m, 'ArrowRight');
    expect(m.svg.querySelector('.widget-host')).toBe(host);
    expect(host!.firstElementChild).toBe(widget);
  });

  it('arrows nudge the selection by 1px, shift-arrows by 10', async () => {
    const ids = await fiveBoxes();
    click(m, boxCentre(m, ids[0]));
    const [x0, y0] = originOf(m, ids[0]);

    press(m, 'ArrowRight');
    expect(originOf(m, ids[0])).toEqual([x0 + 1, y0]);

    press(m, 'ArrowDown', { shiftKey: true });
    expect(originOf(m, ids[0])).toEqual([x0 + 1, y0 + 10]);
  });

  it('Backspace deletes the selected box and every cord touching it', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 40, 40);
    const amp = m.doc.addBox('*~ 0.2', 40, 200);
    m.doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 0 });
    expect(m.doc.edgeCount).toBe(1);

    click(m, boxCentre(m, osc.id));
    press(m, 'Backspace');

    expect(m.doc.nodeCount).toBe(1);
    expect(m.doc.edgeCount).toBe(0);
    expect(m.svg.querySelectorAll('[data-edge]')).toHaveLength(0);
  });

  it('clicking a cord selects it, and Backspace cuts only the cord', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 40, 40);
    const amp = m.doc.addBox('*~ 0.2', 40, 240);
    m.doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 0 });

    const cord = m.svg.querySelector<SVGPathElement>('.cord-hit')!;
    const box = cord.getBoundingClientRect();
    click(m, { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 });

    expect(m.view.selectedEdges.size).toBe(1);
    // Box and cord selection are mutually exclusive, as in Max.
    expect(m.view.selection.size).toBe(0);

    press(m, 'Backspace');
    expect(m.doc.edgeCount).toBe(0);
    expect(m.doc.nodeCount).toBe(2);
  });
});
