// The inspector pane: does it tell the truth about the selected box, and does editing a
// row really change the box?
//
// WHY REAL CHROMIUM. Every assertion here is about form controls behaving as form
// controls: `change` firing on an <input type=number> and its value surviving
// sanitization, a <details> disclosure holding its rows in the DOM whether or not it is
// open, and a checkbox's `checked` round-tripping through a rebuild. jsdom implements
// enough of that to pass a test that would fail in a browser (number-input value
// sanitization in particular), so the pane is exercised where it actually runs.
//
// THE LOOP UNDER TEST IS THE REAL ONE. The fixture wires `onEdit` to
// PatchDoc.setBoxText() and then re-shows the updated node, which is exactly what the app
// shell does through doc.on(). So each of these tests drives the full round trip —
// widget → box text → document → re-render — rather than asserting that a callback was
// called with a string.

import '../../src/objects'; // side effect: real factories, so the tier badge is real
import { afterEach, describe, expect, it } from 'vitest';
import { PatchDoc } from '../../src/doc/patch-doc';
import { isSupported } from '../../src/engine/registry';
import { loadObjDocs } from '../../src/ir/connect';
import { Inspector, type AlignEdge } from '../../src/ui/inspector';

interface Fixture {
  doc: PatchDoc;
  host: HTMLDivElement;
  inspector: Inspector;
  /** Every box text handed to onEdit, in order. */
  edits: string[];
  aligns: [string[], AlignEdge][];
  destroy(): void;
}

let live: Fixture | null = null;

afterEach(() => {
  live?.destroy();
  live = null;
});

/** The placeholder patcher.html seeds the pane with; destroy() must give it back. */
const PLACEHOLDER = 'Select a box to see its arguments';

async function mount(opts: { align?: boolean } = {}): Promise<Fixture> {
  const doc = await PatchDoc.create();
  await loadObjDocs(); // cached module-side; only the first mount pays for it

  const host = document.createElement('div');
  const seeded = document.createElement('p');
  seeded.className = 'pane-placeholder';
  seeded.textContent = PLACEHOLDER;
  host.appendChild(seeded);
  document.body.appendChild(host);

  const edits: string[] = [];
  const aligns: [string[], AlignEdge][] = [];
  let view: Inspector | null = null;
  const inspector = new Inspector(host, {
    onEdit(id, text) {
      edits.push(text);
      doc.setBoxText(id, text);
      const node = doc.node(id);
      if (node) view?.show(node);
    },
    ...(opts.align ? { onAlign: (ids, edge) => aligns.push([ids, edge]) } : {}),
  });
  view = inspector;

  const fixture: Fixture = {
    doc,
    host,
    inspector,
    edits,
    aligns,
    destroy() {
      inspector.destroy();
      host.remove();
    },
  };
  live = fixture;
  return fixture;
}

/** One control by its data-field name. */
function q<T extends HTMLElement = HTMLElement>(f: Fixture, name: string): T | null {
  return f.host.querySelector<T>(`[data-field="${name}"]`);
}

function must<T extends HTMLElement = HTMLInputElement>(f: Fixture, name: string): T {
  const el = q<T>(f, name);
  if (!el) throw new Error(`the inspector has no [data-field="${name}"]`);
  return el;
}

/** Type into a field and commit it, the way blurring or pressing Enter would. */
function type(f: Fixture, name: string, value: string): void {
  const el = must<HTMLInputElement>(f, name);
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('inspector: the selected box', () => {
  it('names the object and shows the argument it was typed with', async () => {
    const f = await mount();
    const node = f.doc.addBox('cycle~ 440', 60, 40);
    f.inspector.show(node);

    const text = f.host.textContent ?? '';
    expect(text).toContain('cycle~');
    expect(text, 'the package chip').toContain('msp');
    expect(text, 'the digest from objdocs.json').toContain('Sinusoidal oscillator');
    // The frequency row: named from the manifest signature, valued from the box text.
    expect(text).toContain('frequency');
    expect(must<HTMLInputElement>(f, 'arg-0').value).toBe('440');

    // A number slot gets a number widget; a symbol slot (buffer-name) gets a text one.
    expect(must<HTMLInputElement>(f, 'arg-0').type).toBe('number');
    expect(must<HTMLInputElement>(f, 'arg-1').type).toBe('text');
    expect(must<HTMLInputElement>(f, 'arg-1').value).toBe('');
  });

  it('rewrites the box text when an argument row is edited', async () => {
    const f = await mount();
    const node = f.doc.addBox('cycle~ 440', 60, 40);
    f.inspector.show(node);

    type(f, 'arg-0', '220');

    expect(f.edits).toEqual(['cycle~ 220']);
    expect(f.doc.node(node.id)?.text).toBe('cycle~ 220');
    // …and the pane is showing the new document, not the value it was typed with.
    expect(must<HTMLInputElement>(f, 'arg-0').value).toBe('220');
    expect(must<HTMLInputElement>(f, 'text').value).toBe('cycle~ 220');
  });

  it('appends @name val when an attribute is set, and drops it when unset', async () => {
    const f = await mount();
    const node = f.doc.addBox('cycle~ 440', 60, 40);
    f.inspector.show(node);

    // The rows exist whether or not the disclosure is open — this is the same DOM the
    // user reaches by clicking "Attributes (5)".
    expect(must<HTMLInputElement>(f, 'attr-set:phase').checked).toBe(false);

    type(f, 'attr:phase', '0.25');

    expect(f.doc.node(node.id)?.text).toBe('cycle~ 440 @phase 0.25');
    // Typing a value is the whole gesture: the "set" box follows it.
    expect(must<HTMLInputElement>(f, 'attr-set:phase').checked).toBe(true);
    expect(must<HTMLInputElement>(f, 'text').value).toBe('cycle~ 440 @phase 0.25');

    const check = must<HTMLInputElement>(f, 'attr-set:phase');
    check.checked = false;
    check.dispatchEvent(new Event('change', { bubbles: true }));

    expect(f.doc.node(node.id)?.text).toBe('cycle~ 440');
    expect(f.edits).toEqual(['cycle~ 440 @phase 0.25', 'cycle~ 440']);
  });

  it('rebuilds the argument rows when the raw box text row is edited', async () => {
    const f = await mount();
    const node = f.doc.addBox('cycle~ 440', 60, 40);
    f.inspector.show(node);

    type(f, 'text', 'scale 0 127 0. 1.');

    expect(f.doc.node(node.id)?.text).toBe('scale 0 127 0. 1.');
    expect(f.host.textContent, 'the rows are scale’s now').toContain('input-low');
    expect(must<HTMLInputElement>(f, 'arg-0').value).toBe('0');
    expect(must<HTMLInputElement>(f, 'arg-1').value).toBe('127');
    // A float argument still reads as a float: JS prints 0, the box text says `0.`.
    expect(Number(must<HTMLInputElement>(f, 'arg-2').value)).toBe(0);
    expect(must<HTMLInputElement>(f, 'arg-2').value).toContain('.');
  });

  it('shows arguments typed beyond the documented signature rather than dropping them', async () => {
    const f = await mount();
    // trigger's signature is two slots; `t b f b` is four arguments and two outlets.
    const node = f.doc.addBox('t b f b', 60, 40);
    f.inspector.show(node);

    // trigger documents two argument slots, so `b` and `f` fill them and the third
    // argument is printed rather than silently dropped.
    expect(must<HTMLInputElement>(f, 'arg-0').value).toBe('b');
    expect(must<HTMLInputElement>(f, 'arg-1').value).toBe('f');
    expect(f.host.textContent).toContain('extra args');
    expect(must<HTMLElement>(f, 'extra-args').textContent).toBe('b');
    expect(f.host.textContent, 'an alias is named as one').toContain('alias of trigger');
  });
});

describe('inspector: the tier badge', () => {
  it('reads playable for an object with real behaviour', async () => {
    const f = await mount();
    expect(isSupported('cycle~'), 'fixture assumption').toBe(true);
    f.inspector.show(f.doc.addBox('cycle~ 440', 60, 40));

    expect(must<HTMLElement>(f, 'tier').textContent).toBe('playable');
  });

  it('says so outright when the object is a metadata-only stub', async () => {
    const f = await mount();
    // Recognized, saved correctly, 18 attributes, 2 inlets — and no sound.
    expect(isSupported('sfplay~'), 'fixture assumption').toBe(false);
    f.inspector.show(f.doc.addBox('sfplay~', 60, 40));

    expect(must<HTMLElement>(f, 'tier').textContent).toBe('stub — no sound yet');
  });
});

describe('inspector: ports', () => {
  it('explains each inlet and outlet from the object documentation', async () => {
    const f = await mount();
    f.inspector.show(f.doc.addBox('cycle~ 440', 60, 40));

    const inlets = must<HTMLTableElement>(f, 'ports-in');
    expect(inlets.querySelectorAll('tr')).toHaveLength(2);
    expect(inlets.textContent).toContain('Frequency');
    expect(inlets.textContent).toContain('Phase');
    // The domain dot is the audio one, not the default control colour.
    expect(inlets.querySelector('.insp-dot')?.className).toContain('signal');

    const outlets = must<HTMLTableElement>(f, 'ports-out');
    expect(outlets.querySelectorAll('tr')).toHaveLength(1);
  });

  it('has a row per real inlet even when the documentation is shorter', async () => {
    const f = await mount();
    // midiformat has 7 inlets and 0 documented ones; a table driven by the docs would
    // show none of them.
    const node = f.doc.addBox('midiformat', 60, 40);
    expect(node.numInlets).toBe(7);
    f.inspector.show(node);

    expect(must<HTMLTableElement>(f, 'ports-in').querySelectorAll('tr')).toHaveLength(7);
  });
});

describe('inspector: honesty about what it cannot edit', () => {
  it('counts the Max-only properties carried on the box dict', async () => {
    const f = await mount();
    const node = f.doc.addBox('cycle~ 440', 60, 40);
    // A box that came out of a real .maxpat carries keys the IR has no opinion about.
    f.inspector.show({
      ...node,
      raw: { ...(node.raw ?? {}), bgcolor: [0, 0, 0, 1], presentation_rect: [1, 2, 3, 4] },
    });

    const foot = must<HTMLElement>(f, 'max-only');
    expect(foot.textContent).toBe('2 Max-only properties preserved but not editable');
    expect(foot.title, 'the footer names them on hover').toContain('bgcolor');
  });

  it('says plainly when there are none', async () => {
    const f = await mount();
    f.inspector.show(f.doc.addBox('cycle~ 440', 60, 40));

    expect(must<HTMLElement>(f, 'max-only').textContent).toBe(
      'No Max-only properties on this box.',
    );
  });

  it('leaves the position fields read-only when the host cannot move a box', async () => {
    const f = await mount();
    f.inspector.show(f.doc.addBox('cycle~ 440', 60, 40));

    const x = must<HTMLInputElement>(f, 'x');
    expect(x.value).toBe('60');
    expect(x.readOnly, 'a field that silently did nothing would be worse').toBe(true);
  });
});

describe('inspector: multi-selection and empty states', () => {
  it('shows the count, not one box’s fields', async () => {
    const f = await mount();
    const a = f.doc.addBox('cycle~ 440', 40, 40);
    const b = f.doc.addBox('*~ 0.2', 40, 100);
    f.inspector.show(a);
    f.inspector.showMulti([a.id, b.id, 'obj-99']);

    expect(f.host.textContent).toContain('3 boxes selected');
    expect(q(f, 'arg-0'), 'a single box’s argument rows survived').toBeNull();
    expect(q(f, 'text')).toBeNull();
    // No onAlign was wired, so no buttons claim an action nothing will perform.
    expect(q(f, 'align-left')).toBeNull();
  });

  it('offers alignment only when the host wired it, and only for two boxes or more', async () => {
    const f = await mount({ align: true });
    const a = f.doc.addBox('cycle~ 440', 40, 40);
    const b = f.doc.addBox('*~ 0.2', 90, 100);

    f.inspector.showMulti([a.id]);
    expect(must<HTMLButtonElement>(f, 'align-left').disabled).toBe(true);

    f.inspector.showMulti([a.id, b.id]);
    must<HTMLButtonElement>(f, 'align-left').click();
    expect(f.aligns).toEqual([[[a.id, b.id], 'left']]);
  });

  it('hides to a placeholder and gives the host back on destroy', async () => {
    const f = await mount();
    f.inspector.show(f.doc.addBox('cycle~ 440', 60, 40));
    expect(q(f, 'text')).not.toBeNull();

    f.inspector.hide();
    expect(q(f, 'text')).toBeNull();
    expect(f.host.textContent).toContain('Select a box');

    f.inspector.destroy();
    expect(f.host.querySelector('.insp'), 'the pane outlived destroy()').toBeNull();
    expect(f.host.textContent, 'the host’s own placeholder never came back').toContain(
      PLACEHOLDER,
    );
  });
});
