// Where a patch cord is allowed to land.
//
// The nub is 16x10 CSS pixels. If that were really the only drop target — which it was
// — then the editor would be unusable by anyone with Max's reflexes, because in Max the
// WHOLE OBJECT is the target and the nearest inlet wins. Three separate defects made
// that so, and each has an assertion here:
//
//   1. hitPort() stopped at the first port of ANY direction its ring probe found, and
//      the probes run downward first. On a 22–26px box the destination's own OUTLET row
//      straddles the bottom edge, so a cord released on the body found that, the caller
//      discarded it as facing the wrong way, and the search never resumed. Measured over
//      `unpack 1 2 3`, every one of its 93 px was dead.
//   2. Nothing resolved a drop on a box's body to a port at all, so even when no port
//      was in range the gesture produced no cord, no box, and no message.
//   3. A release OUTSIDE the canvas still minted a box, because clientToPatch() happily
//      projects the palette rail or the inspector to a (usually negative) patch point.
//
// The sweeps below walk a drop across a whole box in small steps and assert there is no
// dead column anywhere, which is the only form of assertion that would have caught (1):
// a single well-aimed drop passed the whole time.

import { afterEach, describe, expect, it } from 'vitest';
import { edgeKey } from '../../src/doc/ops';
import {
  boxCentre,
  down,
  editorInput,
  mountPatcher,
  move,
  patchToClient,
  portCentre,
  up,
  type ClientPoint,
  type Mounted,
} from './helpers/gestures';

let m: Mounted;

afterEach(() => m?.destroy());

/** Drag a cord from one port and let go at `to`. Returns nothing; read the document. */
function dropCord(mm: Mounted, from: ClientPoint, to: ClientPoint): void {
  down(mm, from);
  move(mm, { clientX: (from.clientX + to.clientX) / 2, clientY: (from.clientY + to.clientY) / 2 });
  move(mm, to);
  up(mm, to);
}

/** The inlet index of the single cord in the document, or null if there is none. */
function landedInlet(mm: Mounted): number | null {
  const edges = [...mm.doc.edges()];
  return edges.length === 1 ? edges[0].to.inlet : null;
}

describe('patcher: a cord dropped on a box body', () => {
  it('lands on the nearest inlet from anywhere on the box, with no dead columns', async () => {
    m = await mountPatcher();
    const src = m.doc.addBox('button', 60, 40);
    const dst = m.doc.addBox('unpack 1 2 3', 60, 200);
    const geom = m.view.boxGeom(dst.id)!;
    const from = portCentre(m, src.id, 'out', 0);

    const landed: (number | null)[] = [];
    // Across the full width, and at three heights: the top edge, the middle of the body
    // (where the destination's own outlet row used to win the hit test) and the bottom.
    for (const dy of [3, geom.h / 2, geom.h - 3]) {
      for (let dx = 0; dx <= geom.w; dx += 4) {
        const to = patchToClient(m.view, { x: geom.x + dx, y: geom.y + dy });
        dropCord(m, from, to);
        landed.push(landedInlet(m));
        for (const e of [...m.doc.edges()]) m.doc.removeEdge(edgeKey(e));
      }
    }

    // `unpack` has exactly one inlet, so every single drop must produce cord 0.
    expect(landed.filter((v) => v === null), 'dead spots on the box body').toEqual([]);
    expect(new Set(landed)).toEqual(new Set([0]));
  });

  it('picks the inlet nearest the release point on a multi-inlet box', async () => {
    m = await mountPatcher();
    const src = m.doc.addBox('cycle~ 440', 60, 40);
    const dst = m.doc.addBox('*~ 0.2', 60, 220); // 2 inlets
    const geom = m.view.boxGeom(dst.id)!;
    const from = portCentre(m, src.id, 'out', 0);

    const at = (dx: number) => {
      dropCord(m, from, patchToClient(m.view, { x: geom.x + dx, y: geom.y + geom.h / 2 }));
      const inlet = landedInlet(m);
      for (const e of [...m.doc.edges()]) m.doc.removeEdge(edgeKey(e));
      return inlet;
    };

    expect(at(2), 'the left edge belongs to inlet 0').toBe(0);
    expect(at(geom.w - 2), 'the right edge belongs to inlet 1').toBe(1);
    // Everywhere across the box resolves to one or the other; nothing is dead.
    const all: (number | null)[] = [];
    for (let dx = 0; dx <= geom.w; dx += 3) all.push(at(dx));
    expect(all).not.toContain(null);
    expect(all[0]).toBe(0);
    expect(all[all.length - 1]).toBe(1);
  });

  it('still refuses an illegal pair and still says why', async () => {
    m = await mountPatcher();
    // A video outlet onto a signal inlet: no transport in engine.ts could carry it.
    const video = m.doc.addBox('jit.noise', 340, 40);
    const osc = m.doc.addBox('cycle~', 340, 240);
    const geom = m.view.boxGeom(osc.id)!;

    // Dropped on the BODY, not the nub — the new path must judge the pair it resolves.
    dropCord(
      m,
      portCentre(m, video.id, 'out', 0),
      patchToClient(m.view, { x: geom.x + geom.w / 2, y: geom.y + geom.h / 2 }),
    );

    expect(m.doc.edgeCount).toBe(0);
    expect(m.doc.nodeCount, 'a refusal must not mint a box either').toBe(2);
    expect(m.status.join(' | ')).toMatch(/jit_matrix/);
  });

  it('dropped back on the box it came from, it does nothing at all', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    const from = portCentre(m, osc.id, 'out', 0);

    dropCord(m, from, boxCentre(m, osc.id));

    // No self-cord, and no new box either: a release on the source is a cancel.
    expect(m.doc.edgeCount).toBe(0);
    expect(m.doc.nodeCount).toBe(1);
    expect(editorInput(m)).toBeNull();
  });

  it('dragging from an INLET onto a box body finds that box outlet', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 60, 40);
    const amp = m.doc.addBox('*~ 0.2', 60, 220);
    const geom = m.view.boxGeom(osc.id)!;

    dropCord(
      m,
      portCentre(m, amp.id, 'in', 0),
      patchToClient(m.view, { x: geom.x + geom.w / 2, y: geom.y + geom.h / 2 }),
    );

    expect(m.doc.edgeCount).toBe(1);
    const edge = [...m.doc.edges()][0];
    expect(edge.from).toEqual({ id: osc.id, outlet: 0 });
    expect(edge.to).toEqual({ id: amp.id, inlet: 0 });
  });
});

describe('patcher: a cord released off the canvas', () => {
  it('makes no box and no editor', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    const from = portCentre(m, osc.id, 'out', 0);
    const canvas = m.svg.getBoundingClientRect();

    // Four directions out of the canvas, standing in for the palette rail, the header,
    // the inspector pane and the status bar of the real app shell.
    const outside: ClientPoint[] = [
      { clientX: canvas.left - 24, clientY: canvas.top + 120 },
      { clientX: canvas.left + 200, clientY: canvas.top - 24 },
      { clientX: canvas.right + 24, clientY: canvas.top + 120 },
      { clientX: canvas.left + 200, clientY: canvas.bottom + 24 },
    ];

    for (const to of outside) {
      dropCord(m, from, to);
      expect(m.doc.nodeCount, `a box was minted for a drop at ${to.clientX},${to.clientY}`).toBe(1);
      expect(editorInput(m), 'an editor was opened off-canvas').toBeNull();
      expect(m.doc.edgeCount).toBe(0);
    }
  });

  it('but a drop on genuinely empty canvas still opens a pre-wired editor', async () => {
    // The guard above must not cost the gesture the patcher is built around.
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 80, 80);
    const empty = patchToClient(m.view, { x: 340, y: 320 });

    dropCord(m, portCentre(m, osc.id, 'out', 0), empty);

    expect(m.doc.nodeCount).toBe(2);
    expect(editorInput(m)).not.toBeNull();
  });
});
