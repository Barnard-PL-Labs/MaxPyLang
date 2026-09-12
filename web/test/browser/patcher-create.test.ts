// Making a box: the gesture that turns an empty canvas into a patch.
//
// Three things are being pinned here, and only the first is obvious:
//   1. the round trip double-click -> type -> Enter really produces a box with the
//      ARITY the object has, not the arity of the empty box the editor opened on;
//   2. the seven single-letter shortcuts stamp the seven Max box classes, because a
//      patch saved from here has to reopen in Max as the boxes the user made;
//   3. an empty commit on a brand-new box leaves nothing behind, which is the escape
//      hatch for the most common mis-gesture there is (double-clicking by accident).

import { afterEach, describe, expect, it } from 'vitest';
import {
  click,
  completions,
  completionPanel,
  dblclick,
  editorInput,
  mountPatcher,
  patchToClient,
  press,
  typeInto,
  type Mounted,
} from './helpers/gestures';

let m: Mounted;

afterEach(() => m?.destroy());

describe('patcher: creating boxes', () => {
  it('double-click, type an object, Enter — and the box has the right ports', async () => {
    m = await mountPatcher();
    const at = patchToClient(m.view, { x: 160, y: 120 });

    dblclick(m, at);
    const input = editorInput(m);
    expect(input, 'double-clicking empty canvas opens an editor').not.toBeNull();
    // The box exists from the first keystroke, as it does in Max — the editor is
    // sitting on it, not floating in place of it.
    expect(m.doc.nodeCount).toBe(1);

    typeInto(input!, 'cycle~');
    expect(completions()[0]).toBe('cycle~');

    // Past the first token the panel stops offering objects and starts explaining the
    // arguments — the affordance Max does not have.
    typeInto(input!, 'cycle~ 440');
    expect(completions()).toEqual([]);
    expect(completionPanel()?.getAttribute('data-kind')).toBe('signature');
    expect(completionPanel()?.textContent).toContain('frequency');

    press(m, 'Enter', { target: input! });
    expect(editorInput(m)).toBeNull();

    const node = [...m.doc.nodes()][0];
    expect(node.className).toBe('cycle~');
    expect(node.numInlets).toBe(2);
    expect(node.numOutlets).toBe(1);
    expect(node.outletDomains[0]).toBe('signal');
    // …and the canvas drew all three ports, which is what the next gesture hit-tests.
    expect(m.svg.querySelectorAll(`[data-port][data-box="${node.id}"][data-dir="in"]`)).toHaveLength(2);
    expect(m.svg.querySelectorAll(`[data-port][data-box="${node.id}"][data-dir="out"]`)).toHaveLength(1);
  });

  it('each single-letter shortcut stamps the Max box class it names', async () => {
    m = await mountPatcher();
    const expected: [string, string][] = [
      ['n', 'newobj'],
      ['m', 'message'],
      ['i', 'number'],
      ['f', 'flonum'],
      ['t', 'toggle'],
      ['b', 'button'],
      ['c', 'comment'],
    ];

    for (const [key, maxclass] of expected) {
      press(m, key);
      const live = [...m.doc.nodes()];
      const node = live[live.length - 1];
      expect(node, `${key} made no box`).toBeDefined();
      expect(node!.maxclass, `${key} should make a ${maxclass}`).toBe(maxclass);
      // n and m open an editor (they are containers for text); dismiss it so the next
      // keystroke reaches the canvas rather than the input.
      const input = editorInput(m);
      if (input) press(m, 'Escape', { target: input });
    }

    // Escape on the empty object box removed it; the other six are complete as made.
    expect([...m.doc.nodes()].map((n) => n.maxclass)).toEqual([
      'message',
      'number',
      'flonum',
      'toggle',
      'button',
      'comment',
    ]);
  });

  it('an empty commit on a brand-new box removes it', async () => {
    m = await mountPatcher();
    dblclick(m, patchToClient(m.view, { x: 200, y: 200 }));
    expect(m.doc.nodeCount).toBe(1);

    const input = editorInput(m)!;
    press(m, 'Enter', { target: input });

    expect(m.doc.nodeCount).toBe(0);
  });

  it('clicking the canvas commits the open editor, and the click is spent doing it', async () => {
    m = await mountPatcher();
    dblclick(m, patchToClient(m.view, { x: 160, y: 120 }));
    typeInto(editorInput(m)!, 'toggle');

    click(m, patchToClient(m.view, { x: 420, y: 320 }));

    expect(editorInput(m)).toBeNull();
    expect(m.doc.nodeCount).toBe(1);
    expect([...m.doc.nodes()][0].maxclass).toBe('toggle');
  });

  it('making a box is ONE undo entry, and ⌘Z removes it rather than emptying it', async () => {
    m = await mountPatcher();
    const anchor = m.doc.addBox('ezdac~', 400, 400); // a prior real edit to land back on
    expect(m.doc.undoLabel).toBe('Add ezdac~');

    dblclick(m, patchToClient(m.view, { x: 160, y: 120 }));
    typeInto(editorInput(m)!, 'cycle~ 440');
    press(m, 'Enter', { target: editorInput(m)! });
    expect(m.doc.nodeCount).toBe(2);

    // The empty box the editor sat on and the text that named it are one action. As two
    // entries, ⌘Z left `cycle~ 440` as an empty red-dashed box and you had to press it
    // again — which is not what Max does and not what the undo label promised.
    expect(m.doc.undoLabel).toBe('New cycle~');
    press(m, 'z', { metaKey: true });
    expect(m.doc.nodeCount).toBe(1);
    expect([...m.doc.nodes()][0].id).toBe(anchor.id);
    expect(m.doc.undoLabel).toBe('Add ezdac~');
  });

  it('a CANCELLED box leaves the undo stack exactly as it found it', async () => {
    m = await mountPatcher();
    const first = m.doc.addBox('cycle~ 440', 40, 40);
    const rev = m.doc.revision;

    dblclick(m, patchToClient(m.view, { x: 200, y: 200 }));
    expect(m.doc.nodeCount).toBe(2);
    press(m, 'Escape', { target: editorInput(m)! });
    expect(m.doc.nodeCount).toBe(1);

    // Create-then-delete used to leave TWO entries, so the next ⌘Z resurrected a phantom
    // empty box instead of reaching the user's last real edit.
    expect(m.doc.undoLabel).toBe('Add cycle~');
    press(m, 'z', { metaKey: true });
    expect(m.doc.nodeCount).toBe(0);
    expect(m.doc.canUndo).toBe(false);
    expect(m.doc.revision).toBeGreaterThan(rev); // the cancel really did reach the doc
    expect(first.id).toBeTruthy();
  });

  it('double-clicking a patch cord selects it instead of minting a box on top of it', async () => {
    m = await mountPatcher();
    const osc = m.doc.addBox('cycle~ 440', 40, 40);
    const amp = m.doc.addBox('*~ 0.2', 40, 240);
    m.doc.addEdge({ id: osc.id, outlet: 0 }, { id: amp.id, inlet: 0 });

    const cord = m.svg.querySelector<SVGPathElement>('.cord-hit')!;
    const box = cord.getBoundingClientRect();
    dblclick(m, { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 });

    // `.cord-hit` carries data-edge, not data-box, so this used to fall through to
    // "make a box here" — a phantom empty box from a gesture that in Max does nothing.
    expect(m.doc.nodeCount).toBe(2);
    expect(editorInput(m)).toBeNull();
    expect(m.view.selectedEdges.size).toBe(1);
  });

  it('the completion panel stays inside the window however long the signatures are', async () => {
    m = await mountPatcher();
    dblclick(m, patchToClient(m.view, { x: 60, y: 60 }));
    // `poly` pulls in mc.poly~, whose argument signature is the longest in the corpus.
    typeInto(editorInput(m)!, 'poly');
    expect(completions().length).toBeGreaterThan(0);

    const panel = completionPanel()!;
    const r = panel.getBoundingClientRect();
    // Rows are `white-space: nowrap`, so without a cap the panel was as wide as the
    // longest signature — measured at 1165px in a 573px canvas, clipped by the window,
    // hiding the very names it was offering.
    expect(r.width).toBeLessThanOrEqual(520);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(window.innerWidth + 0.5);
  });

  it('an empty commit on an EXISTING box leaves it alone', async () => {
    m = await mountPatcher();
    const node = m.doc.addBox('cycle~ 440', 120, 120);

    dblclick(m, patchToClient(m.view, { x: 130, y: 130 }));
    const input = editorInput(m)!;
    expect(input.value).toBe('cycle~ 440');

    typeInto(input, '');
    press(m, 'Enter', { target: input });

    // Clearing the field and committing is not a delete gesture: silently emptying
    // somebody's object would be data loss dressed up as an edit.
    expect(m.doc.node(node.id)?.text).toBe('cycle~ 440');
  });
});
