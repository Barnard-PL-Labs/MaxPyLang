// Dropping patcher JSON onto the canvas.
//
// ui/file-io.ts reads the payload off the DataTransfer and hands it over as text plus a
// point; Interaction.insertFragment is the only thing that can turn that into boxes. It
// was private until the drop path needed it — ⌘V was the sole caller — so the two
// behaviours that differ between a paste and a drop are the ones asserted here:
//
//   • a PASTE steps the fragment by CLONE_OFFSET, so the copy is visibly not the
//     original;
//   • a DROP puts the fragment's TOP-LEFT CORNER on the cursor and keeps every box's
//     position relative to it, which is what makes dropping two connected boxes land a
//     shape rather than a pile.
//
// Both go through one transaction, so one ⌘Z takes the whole fragment back out — the
// property that makes a drop feel like a single act rather than n creations.

import { afterEach, describe, expect, it } from 'vitest';
import { mountPatcher, type Mounted } from './helpers/gestures';

let m: Mounted;

afterEach(() => m?.destroy());

/** Two boxes and the cord between them, in the shape this patcher copies out. */
const FRAGMENT = JSON.stringify({
  boxes: [
    {
      box: {
        id: 'obj-1',
        maxclass: 'newobj',
        text: 'cycle~ 440',
        numinlets: 2,
        numoutlets: 1,
        patching_rect: [100, 60, 70, 22],
      },
    },
    {
      box: {
        id: 'obj-2',
        maxclass: 'newobj',
        text: '*~ 0.2',
        numinlets: 2,
        numoutlets: 1,
        patching_rect: [140, 140, 60, 22],
      },
    },
  ],
  lines: [{ patchline: { source: ['obj-1', 0], destination: ['obj-2', 0] } }],
});

describe('patcher: a dropped fragment', () => {
  it('lands its top-left corner on the drop point and keeps the layout', async () => {
    m = await mountPatcher();
    expect(m.input.insertFragment(FRAGMENT, { x: 300, y: 200 })).toBe(true);

    const nodes = [...m.doc.nodes()];
    expect(nodes.map((n) => n.text)).toEqual(['cycle~ 440', '*~ 0.2']);
    // (100,60) was the fragment's corner, so it is the box that lands on the cursor…
    expect(nodes[0].rect.slice(0, 2)).toEqual([300, 200]);
    // …and the other keeps its offset from it: +40 across, +80 down.
    expect(nodes[1].rect.slice(0, 2)).toEqual([340, 280]);
    expect(m.doc.edgeCount).toBe(1);
  });

  it('is one undo, cord included', async () => {
    m = await mountPatcher();
    m.input.insertFragment(FRAGMENT, { x: 50, y: 50 });
    expect(m.doc.nodeCount).toBe(2);

    m.doc.undo();
    expect(m.doc.nodeCount).toBe(0);
    expect(m.doc.edgeCount).toBe(0);
  });

  it('without a point, offsets the way a paste does', async () => {
    m = await mountPatcher();
    m.input.insertFragment(FRAGMENT);

    const nodes = [...m.doc.nodes()];
    // CLONE_OFFSET from the authored coordinates, not from the cursor.
    expect(nodes[0].rect.slice(0, 2)).toEqual([124, 84]);
    expect(nodes[1].rect.slice(0, 2)).toEqual([164, 164]);
  });

  it('says so, and creates nothing, when the text is not a patch', async () => {
    m = await mountPatcher();
    expect(m.input.insertFragment('{"not":"a patch"}', { x: 10, y: 10 })).toBe(false);
    expect(m.doc.nodeCount).toBe(0);
    // The message names the gesture the user actually made.
    expect(m.status[m.status.length - 1]).toMatch(/drop/i);
  });
});
