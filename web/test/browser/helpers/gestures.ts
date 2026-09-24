// Synthetic gestures for the patcher's interaction tests.
//
// WHY REAL CHROMIUM AND NOT jsdom. Every assertion these tests make rests on something
// jsdom fakes badly or not at all: `document.elementFromPoint` (the renderer's whole hit
// test), `getBoundingClientRect` under an SVG transform (patch <-> screen), pointer
// routing through a <foreignObject> (what makes a mounted slider swallow or not swallow
// a drag), and `pointer-events: none` deciding which element a pointerdown lands on
// (the edit/run lock itself). A passing jsdom run would prove nothing about any of them.
//
// WHY EXPLICIT PointerEvent DISPATCH AND NOT userEvent. ui/patcher-input.ts listens for
// pointer events directly, and a testing-library-style driver synthesizes a whole
// mouse/pointer/click sequence whose exact composition is its own implementation detail.
// Constructing the three events the controller actually reads makes each test say
// precisely which gesture it is performing, and makes a failure point at the controller
// rather than at the driver.
//
// TWO THINGS SYNTHETIC EVENTS CANNOT DO, and both shape the tests that use this file:
//
//   • They are untrusted, so they do not run a UA default action. Dispatching
//     pointerdown at a real <input type=range> does NOT move its thumb. A test that
//     needs "the widget reacted" therefore mounts a widget with its own pointerdown
//     listener (see makeTestWidget) rather than pretending a range input will respond.
//   • There is no live pointer behind the id, so `setPointerCapture` throws
//     NotFoundError. The controller treats capture as an optimization and catches that;
//     the moves below are dispatched on the <svg> root, which is where a captured
//     pointer's events would have been retargeted anyway.

import '../../../src/objects'; // side effect: real factories, so catalog tiers are real
import { PatchDoc } from '../../../src/doc/patch-doc';
import { loadObjDocs } from '../../../src/ir/connect';
import { Interaction, type InteractionHost } from '../../../src/ui/patcher-input';
import { PatcherView } from '../../../src/ui/patcher';

export interface ClientPoint {
  clientX: number;
  clientY: number;
}

export interface Mods {
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  button?: number;
}

export interface Mounted {
  doc: PatchDoc;
  view: PatcherView;
  input: Interaction;
  host: HTMLDivElement;
  svg: SVGSVGElement;
  /** Everything the controller reported through onStatus, in order. */
  status: string[];
  /** id -> the element PatcherView should mount for that box. Edit, then refresh(). */
  widgets: Map<string, HTMLElement>;
  refreshWidgets(): void;
  destroy(): void;
}

// Deliberately smaller than any plausible test-runner viewport: `elementFromPoint`
// returns null outside the viewport, which would turn every hit test into a silent
// miss. Keep test coordinates inside this box.
const HOST_W = 700;
const HOST_H = 460;

/**
 * A patcher on the page: empty document, live renderer, live controller.
 *
 * Awaits the two generated tables the interaction layer needs to be correct rather than
 * merely functional — boxspecs (PatchDoc.create), so `unpack 1 2 3` really has three
 * outlets, and objdocs (loadObjDocs), so canConnect can tell a video inlet from a
 * signal one. Both are cached module-side, so only the first mount pays for them.
 */
export async function mountPatcher(
  opts: {
    /** Mount this document instead of a fresh empty one. */
    doc?: PatchDoc;
    /** Extra InteractionHost hooks (onOpenSubpatch, onBack, built). */
    hooks?: Partial<Pick<InteractionHost, 'onOpenSubpatch' | 'onBack' | 'built'>>;
  } = {}
): Promise<Mounted> {
  const doc = opts.doc ?? (await PatchDoc.create());
  await loadObjDocs();

  const host = document.createElement('div');
  host.style.cssText =
    `position:fixed;left:0;top:0;width:${HOST_W}px;height:${HOST_H}px;` +
    'margin:0;padding:0;background:#16181c;z-index:2147483000;';
  document.body.appendChild(host);

  const widgets = new Map<string, HTMLElement>();
  const view = new PatcherView(host, { doc, widgetFor: (id) => widgets.get(id) });
  const status: string[] = [];
  const input = new Interaction({ doc, view, onStatus: (m) => status.push(m), ...opts.hooks });

  return {
    doc,
    view,
    input,
    host,
    svg: view.svg,
    status,
    widgets,
    refreshWidgets: () => view.refreshWidgets(),
    destroy() {
      input.destroy();
      view.destroy();
      host.remove();
      // The completion panel is parented to document.body, not to the SVG; a leaked one
      // would be found by the next test's querySelector.
      for (const panel of document.querySelectorAll('.box-complete')) panel.remove();
    },
  };
}

// ── coordinates ──────────────────────────────────────────────────────────────

/** Patch point -> client point, the inverse of PatcherView.clientToPatch. */
export function patchToClient(view: PatcherView, p: { x: number; y: number }): ClientPoint {
  const box = view.svg.getBoundingClientRect();
  const vp = view.viewport;
  return { clientX: box.left + vp.x + p.x * vp.zoom, clientY: box.top + vp.y + p.y * vp.zoom };
}

/** The middle of a box, in client coordinates. */
export function boxCentre(m: Mounted, id: string): ClientPoint {
  const g = m.view.boxGeom(id);
  if (!g) throw new Error(`no box ${id} on the canvas`);
  return patchToClient(m.view, { x: g.x + g.w / 2, y: g.y + g.h / 2 });
}

/**
 * The middle of one port's hit rect, read off the DOM rather than recomputed.
 *
 * Recomputing it from ui/layout would make the test agree with the layout module even
 * when the layout module and the rendered DOM had diverged — which is the one bug the
 * test most needs to be able to see.
 */
export function portCentre(m: Mounted, id: string, dir: 'in' | 'out', index: number): ClientPoint {
  const sel = `[data-port][data-box="${id}"][data-dir="${dir}"][data-index="${index}"]`;
  const el = m.svg.querySelector(sel);
  if (!el) throw new Error(`no ${dir} port ${index} on ${id}`);
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

// ── pointer ──────────────────────────────────────────────────────────────────

function pointerEvent(type: string, at: ClientPoint, mods: Mods): PointerEvent {
  return new PointerEvent(type, {
    clientX: at.clientX,
    clientY: at.clientY,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    bubbles: true,
    cancelable: true,
    composed: true,
    button: mods.button ?? 0,
    buttons: type === 'pointerup' ? 0 : 1,
    shiftKey: mods.shiftKey === true,
    altKey: mods.altKey === true,
    metaKey: mods.metaKey === true,
    ctrlKey: mods.ctrlKey === true,
  });
}

/**
 * pointerdown at a point, on whatever the browser says is topmost there.
 *
 * Targeting is the whole point: the controller's first decision is
 * `e.target.closest('[data-port]')`, so a test that always dispatched on the <svg> root
 * would never exercise it. Falls back to the root for a point that lands outside the
 * canvas (or on its host div), so a mis-aimed coordinate fails an assertion rather than
 * silently dispatching nowhere.
 */
export function down(m: Mounted, at: ClientPoint, mods: Mods = {}): Element {
  const hit = document.elementFromPoint(at.clientX, at.clientY);
  const target = hit && m.svg.contains(hit) ? hit : m.svg;
  target.dispatchEvent(pointerEvent('pointerdown', at, mods));
  return target;
}

export function move(m: Mounted, at: ClientPoint, mods: Mods = {}): void {
  m.svg.dispatchEvent(pointerEvent('pointermove', at, mods));
}

export function up(m: Mounted, at: ClientPoint, mods: Mods = {}): void {
  m.svg.dispatchEvent(pointerEvent('pointerup', at, mods));
}

/**
 * A whole press-move-release. The intermediate step is what takes the gesture past the
 * controller's 3px slop threshold, so a drag that only ever reported its destination
 * would be read as a click.
 */
export function drag(m: Mounted, from: ClientPoint, to: ClientPoint, mods: Mods = {}): void {
  down(m, from, mods);
  move(m, { clientX: (from.clientX + to.clientX) / 2, clientY: (from.clientY + to.clientY) / 2 }, mods);
  move(m, to, mods);
  up(m, to, mods);
}

/** A click that never moves: the gesture that selects rather than drags. */
export function click(m: Mounted, at: ClientPoint, mods: Mods = {}): void {
  down(m, at, mods);
  up(m, at, mods);
}

export function dblclick(m: Mounted, at: ClientPoint, mods: Mods = {}): void {
  const hit = document.elementFromPoint(at.clientX, at.clientY);
  const target = hit && m.svg.contains(hit) ? hit : m.svg;
  target.dispatchEvent(
    new MouseEvent('dblclick', {
      clientX: at.clientX,
      clientY: at.clientY,
      bubbles: true,
      cancelable: true,
      metaKey: mods.metaKey === true,
      ctrlKey: mods.ctrlKey === true,
      shiftKey: mods.shiftKey === true,
    })
  );
}

// ── keyboard ─────────────────────────────────────────────────────────────────

/**
 * One keystroke. Defaults to the canvas root, which is where the controller listens;
 * pass `target` to type into the box editor's <input> instead.
 */
export function press(
  m: Mounted,
  key: string,
  mods: Mods & { target?: Element } = {}
): KeyboardEvent {
  const target = mods.target ?? m.svg;
  const init: KeyboardEventInit = {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
    shiftKey: mods.shiftKey === true,
    altKey: mods.altKey === true,
    metaKey: mods.metaKey === true,
    ctrlKey: mods.ctrlKey === true,
  };
  const event = new KeyboardEvent('keydown', init);
  target.dispatchEvent(event);
  target.dispatchEvent(new KeyboardEvent('keyup', init));
  return event;
}

// ── the box editor ───────────────────────────────────────────────────────────

/** The open editor's <input>, or null. */
export function editorInput(m: Mounted): HTMLInputElement | null {
  return m.svg.querySelector<HTMLInputElement>('input.box-input');
}

/**
 * Replace the editor's contents and put the caret at the end.
 *
 * Assigning `value` and firing `input` is what a real keystroke amounts to from the
 * editor's point of view — it reads `input.value` and `input.selectionStart` and never
 * looks at the key that caused the change.
 */
export function typeInto(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.setSelectionRange(text.length, text.length);
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

/** The completion panel, which lives on document.body so the SVG cannot clip it. */
export function completionPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.box-complete');
}

/** Object names currently offered, best first. */
export function completions(): string[] {
  const panel = completionPanel();
  if (!panel || panel.style.display === 'none') return [];
  return [...panel.querySelectorAll('[data-name]')].map((el) => el.getAttribute('data-name') ?? '');
}

// ── widgets ──────────────────────────────────────────────────────────────────

export interface TestWidget extends HTMLElement {
  /** Bumped by every pointerdown that actually reaches the widget. */
  hits: number;
}

/**
 * A stand-in for a mounted Max UI object.
 *
 * It has its own pointerdown listener for the reason in this file's header: an
 * `<input type=range>` ignores untrusted events, so a test built on one could not tell
 * "the lock worked" from "synthetic events never move a range thumb". What the mode
 * test actually needs to observe is whether the pointer REACHED the widget at all, and
 * that is exactly what this counts.
 */
export function makeTestWidget(): TestWidget {
  const el = document.createElement('div') as unknown as TestWidget;
  el.className = 'max-widget test-widget';
  el.style.cssText = 'width:100%;height:100%;background:#39404b;';
  el.hits = 0;
  el.addEventListener('pointerdown', () => {
    el.hits += 1;
  });
  return el;
}
