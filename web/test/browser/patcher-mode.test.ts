// Edit vs run: the test that proves the lock actually works.
//
// This is the single most important interaction in the patcher and the one a Max
// newcomer most reliably gets wrong: in EDIT mode a press on a slider must drag the BOX
// and leave the value alone, and in RUN mode the identical press must reach the slider
// and leave the box alone. Everything about the architecture — the ports living in
// their own SVG layer, the widget living in a <foreignObject> whose `pointer-events` is
// written per mode, the controller refusing to start an editing gesture when locked —
// exists to make those two sentences true, and none of it is checkable without real
// pointer routing through a real foreignObject.
//
// What "the widget reacted" means here is "the pointer reached the widget at all",
// counted by the widget's own listener. A real <input type=range> would be a worse
// probe, not a better one: synthetic events are untrusted, so Chromium runs no UA
// default action for them and the thumb would not move even in run mode — the test
// would pass for the wrong reason in one mode and fail for the wrong reason in the
// other. See helpers/gestures.ts.

import { afterEach, describe, expect, it } from 'vitest';
import {
  boxCentre,
  drag,
  makeTestWidget,
  mountPatcher,
  press,
  type Mounted,
  type TestWidget,
} from './helpers/gestures';

let m: Mounted;

afterEach(() => m?.destroy());

async function sliderBox(): Promise<{ id: string; widget: TestWidget }> {
  m = await mountPatcher();
  const node = m.doc.addBox('slider', 80, 80);
  const widget = makeTestWidget();
  m.widgets.set(node.id, widget);
  m.refreshWidgets();
  // The renderer really did mount it, inside a <foreignObject> in the box's group.
  expect(m.svg.querySelector('.widget-host .test-widget')).toBe(widget);
  return { id: node.id, widget };
}

describe('patcher: the edit/run lock', () => {
  it('edit mode drags the BOX and the widget never sees the pointer', async () => {
    const { id, widget } = await sliderBox();
    const grab = boxCentre(m, id);

    drag(m, grab, { clientX: grab.clientX + 40, clientY: grab.clientY });

    expect(m.doc.node(id)!.rect[0]).toBe(120); // 80 + 40, already on the grid
    expect(widget.hits).toBe(0);
  });

  it('after ⌘E the identical gesture reaches the widget and the box stays put', async () => {
    const { id, widget } = await sliderBox();

    press(m, 'e', { metaKey: true });
    expect(m.input.mode).toBe('run');
    expect(m.view.mode).toBe('run');

    const before = [...m.doc.node(id)!.rect];
    const grab = boxCentre(m, id);
    drag(m, grab, { clientX: grab.clientX + 40, clientY: grab.clientY });

    expect(widget.hits).toBe(1);
    expect(m.doc.node(id)!.rect).toEqual(before);
  });

  it('run mode hides the ports, so there is nothing to draw a cord from', async () => {
    m = await mountPatcher();
    m.doc.addBox('cycle~ 440', 80, 80);
    const ports = m.svg.querySelector<SVGGElement>('.layer-ports')!;
    expect(ports.style.display).toBe('');

    press(m, 'e', { metaKey: true });
    // A visible port you cannot use reads as a bug; a port that is not there reads as
    // a mode — and a hidden layer cannot be hit, so hitPort needs no special case.
    expect(ports.style.display).toBe('none');
  });

  it('⌘E toggles back, and the mode is read from the renderer, never mirrored', async () => {
    m = await mountPatcher();
    expect(m.input.mode).toBe('edit');

    press(m, 'e', { metaKey: true });
    expect(m.input.mode).toBe('run');

    // The app shell drives mode through the view directly (its segmented control does
    // exactly this). The controller must follow, or the next ⌘E would toggle from a
    // stale value and appear to do nothing.
    m.view.setMode('edit');
    expect(m.input.mode).toBe('edit');

    press(m, 'e', { metaKey: true });
    expect(m.input.mode).toBe('run');
  });

  it('editing keys do nothing while the patch is locked', async () => {
    m = await mountPatcher();
    const id = m.doc.addBox('cycle~ 440', 80, 80).id;
    m.view.select([id]);
    press(m, 'e', { metaKey: true });

    press(m, 'Backspace');
    press(m, 'n');
    press(m, 'ArrowRight');

    expect(m.doc.nodeCount).toBe(1);
    expect(m.doc.node(id)!.rect[0]).toBe(80);
  });
});
