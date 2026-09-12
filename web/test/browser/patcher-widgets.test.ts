// Can you actually operate the click-me boxes?
//
// `toggle`, `button`, `number`, `flonum` and `message` are the five objects a Max
// tutorial reaches for first, and all five are things you work with the mouse. They
// shipped as message behaviour with no DOM element at all: the canvas drew them with a
// solid border (so they read as playable), ui/layout.ts even reserved widget sizes for
// four of them, and a click in run mode landed on the <text> rendering the word
// "toggle". The canonical first patch — `toggle -> metro 500 -> button` — could not be
// started by hand, and nothing on screen said why.
//
// So the assertions here are end to end and deliberately mean: (a) the engine built an
// element for the box, (b) in run mode a click at the centre of the box REACHES that
// element rather than the label painted over it, and (c) the click travels down a real
// patch cord to the next object. Anything less would pass on a widget that exists but
// is unreachable, which is the state this file was written about.

import { afterEach, describe, expect, it } from 'vitest';
import '../../src/objects';
import { Engine } from '../../src/engine/engine';
import type { MaxNode } from '../../src/engine/registry';
import type { Msg } from '../../src/runtime/atoms';
import { boxCentre, mountPatcher, press, type Mounted } from './helpers/gestures';

let m: Mounted;

afterEach(() => m?.destroy());

/** Build the document into an offline engine and mount whatever widgets it made. */
function buildInto(mm: Mounted): Map<string, MaxNode> {
  const engine = new Engine(new OfflineAudioContext(2, 128, 44100));
  const report = engine.build(mm.doc.toIR());
  for (const [id, n] of report.built) if (n.el) mm.widgets.set(id, n.el);
  mm.refreshWidgets();
  return report.built;
}

/** What the browser says is on top at the middle of a box. */
const topAt = (mm: Mounted, id: string): Element | null => {
  const c = boxCentre(mm, id);
  return document.elementFromPoint(c.clientX, c.clientY);
};

describe('patcher: the click-me boxes', () => {
  it('every one of the five builds a widget the canvas mounts', async () => {
    m = await mountPatcher();
    const ids = ['toggle', 'button', 'number', 'flonum', 'message 1 2'].map(
      (text, i) => [text, m.doc.addBox(text, 40 + i * 120, 60).id] as const,
    );
    const built = buildInto(m);

    for (const [text, id] of ids) {
      expect(built.get(id)?.el, `${text} built no DOM element`).toBeTruthy();
      expect(
        m.svg.querySelector(`[data-box="${id}"] .widget-host .max-widget`),
        `${text} was never mounted on the canvas`,
      ).toBe(built.get(id)!.el);
    }
  });

  it('in run mode a click on a toggle reaches it and bangs the object it feeds', async () => {
    m = await mountPatcher();
    const tog = m.doc.addBox('toggle', 80, 60);
    const btn = m.doc.addBox('button', 80, 220);
    m.doc.addEdge({ id: tog.id, outlet: 0 }, { id: btn.id, inlet: 0 });
    const built = buildInto(m);

    const bangs: Msg[] = [];
    built.get(btn.id)!.onControlOut!(0, (msg) => bangs.push(msg));

    // Edit mode first: the widget must NOT be reachable, or dragging the box would
    // flip the toggle instead of moving it.
    expect(m.input.mode).toBe('edit');
    expect(built.get(tog.id)!.el!.contains(topAt(m, tog.id))).toBe(false);

    press(m, 'e', { metaKey: true });
    expect(m.input.mode).toBe('run');

    const under = topAt(m, tog.id);
    // The failure this replaces: `under` was `text.box-label`, the word "toggle".
    expect(built.get(tog.id)!.el!.contains(under), 'the click lands on the label, not the toggle')
      .toBe(true);

    under!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(bangs).toEqual([['bang']]);
    // Clicking again flips it back to 0, and a toggle emits on every change.
    under!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(bangs).toHaveLength(2);
  });

  it('a message box sends its contents when clicked', async () => {
    m = await mountPatcher();
    const msg = m.doc.addBox('message 60 12', 80, 60);
    const store = m.doc.addBox('int', 80, 220);
    m.doc.addEdge({ id: msg.id, outlet: 0 }, { id: store.id, inlet: 0 });
    const built = buildInto(m);

    const out: Msg[] = [];
    built.get(store.id)!.onControlOut!(0, (v) => out.push(v));

    press(m, 'e', { metaKey: true });
    topAt(m, msg.id)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // `int` stores and re-emits the first atom of what it receives.
    expect(out).toEqual([[60]]);
    // The widget draws the contents itself, so the canvas must not caption it too.
    expect(m.svg.querySelector(`[data-box="${msg.id}"] .box-caption`)).toBeNull();
    expect(built.get(msg.id)!.el!.textContent).toBe('60 12');
  });

  it('a message box is still sized from its text, not pinned to a control width', async () => {
    m = await mountPatcher();
    const short = m.doc.addBox('message 1', 40, 60);
    const long = m.doc.addBox('message 1 2 3 4 5 6 7 8', 40, 160);
    buildInto(m);

    const a = m.view.boxGeom(short.id)!;
    const b = m.view.boxGeom(long.id)!;
    expect(b.w).toBeGreaterThan(a.w);
  });

  it('int and float stay plain object boxes — only number/flonum get a field', async () => {
    m = await mountPatcher();
    const plain = m.doc.addBox('int', 40, 60);
    const ui = m.doc.addBox('number', 200, 60);
    const built = buildInto(m);

    expect(built.get(plain.id)!.el, '`int` is an object box in Max, not a widget')
      .toBeUndefined();
    expect((built.get(ui.id)!.el as HTMLInputElement).tagName).toBe('INPUT');
  });
});
