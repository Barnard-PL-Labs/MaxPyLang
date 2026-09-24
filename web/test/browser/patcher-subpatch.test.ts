// Opening a `p` box on the canvas, editing inside it, and coming back out.
//
// The gestures are Max's: double-click a subpatcher in run mode, ⌘-double-click it in
// edit mode (where a plain double-click still edits the box's text), Escape to leave.
// The navigation test at the bottom is the app shell's loop in miniature — swap the
// view for one over PatchDoc.openSubpatch(), mount widgets from the `p` box's NESTED
// engine, edit, swap back — because that is where the promises meet: an edit made
// through real gestures inside is in the top document, and the widget a box shows
// inside is the live node the running subpatcher uses.

import '../../src/objects';
import { afterEach, describe, expect, it } from 'vitest';
import { PatchDoc } from '../../src/doc/patch-doc';
import { Engine } from '../../src/engine/engine';
import { loadObjDocs } from '../../src/ir/connect';
import { parseMaxPat } from '../../src/parser/maxpat';
import { patchToMaxPat } from '../../src/parser/write-maxpat';
import { Inspector } from '../../src/ui/inspector';
import { Interaction } from '../../src/ui/patcher-input';
import { PatcherView } from '../../src/ui/patcher';
import {
  boxCentre,
  dblclick,
  editorInput,
  mountPatcher,
  press,
  type Mounted,
} from './helpers/gestures';

type Box = Record<string, unknown>;
const box = (id: string, x: number, y: number, fields: Box): { box: Box } => ({
  box: { id, patching_rect: [x, y, 60, 22], numinlets: 1, numoutlets: 1, outlettype: [''], ...fields },
});
const line = (from: string, to: string) => ({ patchline: { source: [from, 0], destination: [to, 0] } });

/** A top patch: `+ 0` -> `p relay` (inlet -> outlet) -> `+ 0`. */
function patch() {
  return parseMaxPat({
    patcher: {
      boxes: [
        box('obj-1', 40, 40, { maxclass: 'newobj', text: '+ 0', numinlets: 2 }),
        box('obj-2', 40, 120, {
          maxclass: 'newobj',
          text: 'p relay',
          patcher: {
            boxes: [
              box('obj-1', 40, 40, { maxclass: 'inlet', numinlets: 0 }),
              box('obj-2', 40, 200, { maxclass: 'outlet', numoutlets: 0, outlettype: [] }),
            ],
            lines: [line('obj-1', 'obj-2')],
          },
        }),
        box('obj-3', 40, 200, { maxclass: 'newobj', text: '+ 0', numinlets: 2 }),
      ],
      lines: [line('obj-1', 'obj-2'), line('obj-2', 'obj-3')],
    },
  });
}

let m: Mounted | null = null;
const cleanups: (() => void)[] = [];

afterEach(() => {
  m?.destroy();
  m = null;
  for (const fn of cleanups.splice(0)) fn();
});

describe('patcher: opening a subpatcher', () => {
  it('run mode: a double-click on a `p` box opens it; on any other box it does nothing', async () => {
    const opened: string[] = [];
    m = await mountPatcher({ doc: await PatchDoc.open(patch()), hooks: { onOpenSubpatch: (id) => opened.push(id) } });
    m.input.setMode('run');

    dblclick(m, boxCentre(m, 'obj-1'));
    expect(opened).toEqual([]);
    dblclick(m, boxCentre(m, 'obj-2'));
    expect(opened).toEqual(['obj-2']);
    expect(m.doc.nodeCount).toBe(3); // and nothing was created
  });

  it('edit mode: a plain double-click edits the box text; ⌘-double-click opens it', async () => {
    const opened: string[] = [];
    m = await mountPatcher({ doc: await PatchDoc.open(patch()), hooks: { onOpenSubpatch: (id) => opened.push(id) } });

    dblclick(m, boxCentre(m, 'obj-2'));
    expect(opened).toEqual([]);
    expect(editorInput(m)?.value).toBe('p relay');
    press(m, 'Escape', { target: editorInput(m)! });
    expect(editorInput(m)).toBeNull();

    dblclick(m, boxCentre(m, 'obj-2'), { metaKey: true });
    expect(opened).toEqual(['obj-2']);
    expect(editorInput(m)).toBeNull();

    dblclick(m, boxCentre(m, 'obj-2'), { ctrlKey: true });
    expect(opened).toEqual(['obj-2', 'obj-2']);
  });

  it('Escape asks to go back, in either mode; with nowhere to go it changes nothing', async () => {
    let depth = 1;
    m = await mountPatcher({
      doc: await PatchDoc.open(patch()),
      hooks: {
        onBack: () => {
          if (depth === 0) return false;
          depth--;
          return true;
        },
      },
    });
    const first = press(m, 'Escape');
    expect(depth).toBe(0);
    expect(first.defaultPrevented).toBe(true);
    // At the top level Escape stays what it was: harmless.
    const second = press(m, 'Escape');
    expect(depth).toBe(0);
    expect(m.doc.nodeCount).toBe(3);
    expect(second.defaultPrevented).toBe(true); // editKey still claims it in edit mode
  });

  it('the inspector offers Open for a subpatcher box, and only for one', async () => {
    await loadObjDocs();
    const doc = await PatchDoc.open(patch());
    const host = document.createElement('div');
    document.body.appendChild(host);
    const opened: string[] = [];
    const inspector = new Inspector(host, { onEdit: () => {}, onOpen: (id) => opened.push(id) });
    cleanups.push(() => {
      inspector.destroy();
      host.remove();
    });

    inspector.show(doc.node('obj-1')!);
    expect(host.querySelector('[data-field="open-subpatch"]')).toBeNull();
    inspector.show(doc.node('obj-2')!);
    const button = host.querySelector<HTMLButtonElement>('[data-field="open-subpatch"]');
    expect(button).not.toBeNull();
    button!.click();
    expect(opened).toEqual(['obj-2']);
  });
});

describe('patcher: editing inside a subpatcher', () => {
  it('open, add a live widget inside, go back: the top document and the running engine both have it', async () => {
    const top = await PatchDoc.open(patch());
    const engine = new Engine(new OfflineAudioContext(2, 128, 44100));
    engine.build(top.toIR());
    cleanups.push(top.on((ops) => engine.applyOps(ops, top)));
    cleanups.push(() => engine.clear());

    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:0;top:0;width:700px;height:460px;z-index:2147483000;';
    document.body.appendChild(host);
    cleanups.push(() => host.remove());

    // The shell's loop, reduced to what it does: one view and one controller per level.
    let child: PatchDoc | null = null;
    let current: { view: PatcherView; input: Interaction } | null = null;
    const nested = () => engine.getNode('obj-2')!.subpatch!.engine;
    const mount = (doc: PatchDoc, widgets: () => ReadonlyMap<string, { el?: HTMLElement }>) => {
      current?.input.destroy();
      current?.view.destroy();
      const view = new PatcherView(host, { doc, widgetFor: (id) => widgets().get(id)?.el });
      const input = new Interaction({
        doc,
        view,
        onOpenSubpatch: (id) => {
          child = doc.openSubpatch(id);
          mount(child, () => nested().built);
        },
        onBack: () => {
          if (!child) return false;
          child.close();
          child = null;
          mount(top, () => engine.built);
          return true;
        },
      });
      current = { view, input };
    };
    mount(top, () => engine.built);
    cleanups.push(() => {
      current?.input.destroy();
      current?.view.destroy();
    });
    const svg = () => current!.view.svg;
    const centre = (id: string) => {
      const g = current!.view.boxGeom(id)!;
      const r = svg().getBoundingClientRect();
      const vp = current!.view.viewport;
      return { clientX: r.left + vp.x + (g.x + g.w / 2) * vp.zoom, clientY: r.top + vp.y + (g.y + g.h / 2) * vp.zoom };
    };
    const at = () => ({ doc: child ?? top, view: current!.view, svg: svg() }) as unknown as Mounted;

    // In: ⌘-double-click in edit mode.
    dblclick(at(), centre('obj-2'), { metaKey: true });
    expect(child).not.toBeNull();
    expect(svg().querySelectorAll('[data-box]').length).toBeGreaterThan(0);
    expect([...child!.nodes()].map((n) => n.className)).toEqual(['inlet', 'outlet']);

    // Edit: the `i` shortcut makes a number box at the pointer — a widget the NESTED
    // engine builds, and the canvas mounts from there.
    press(at(), 'i');
    const made = [...child!.nodes()].find((n) => n.className === 'number');
    expect(made).toBeDefined();
    const live = nested().getNode(made!.id);
    expect(live?.el).toBeDefined();
    expect(svg().contains(live!.el!)).toBe(true);

    // Out, with Escape: the top canvas again, and the edit in a save of the top document.
    press(at(), 'Escape');
    expect(child).toBeNull();
    expect(svg().querySelector('[data-box="obj-3"]')).not.toBeNull();
    const saved = patchToMaxPat(top) as { patcher: { boxes: { box: Box }[] } };
    const inner = saved.patcher.boxes[1].box.patcher as { boxes: { box: Box }[] };
    expect(inner.boxes.map((b) => b.box.maxclass)).toContain('number');

    // Undo from the top reaches inside: the document and the running subpatcher both
    // lose the box, and the `p` box itself was never rebuilt.
    const pBefore = engine.getNode('obj-2');
    press(at(), 'z', { metaKey: true });
    expect(nested().getNode(made!.id)).toBeUndefined();
    expect(engine.getNode('obj-2')).toBe(pBefore);
  });
});
